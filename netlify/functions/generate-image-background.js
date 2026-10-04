// netlify/functions/generate-image-background.js
//
// Scene image generation as a Netlify BACKGROUND function (up to 15 minutes).
// gpt-image-2 takes 30–90 s per image — far past the limit of a normal
// function, which is why the old synchronous call surfaced as "Failed to fetch".
//
// Request body (kept tiny — background functions accept ~256 KB):
//   { jobId, prompt, size, refKey? }
// refKey points at a reference image the browser staged via image-ref.js.
// The result goes to storage (out:<jobId>); image-status.js reports progress
// and image-result.js streams the finished PNG.
//
//   - Generation: prompt only                 -> /v1/images/generations
//   - Reference-locked: prompt + prior image  -> /v1/images/edits
//     (keeps characters/style consistent across scenes)

import { keyFor, json, readJson } from "../lib/keys.js";
import { jobSet, blobGetText, blobSetText, blobDelete, validJobId } from "../lib/jobs.js";

const GEN_URL = "https://api.openai.com/v1/images/generations";
const EDIT_URL = "https://api.openai.com/v1/images/edits";
const MODEL = "gpt-image-2";

export const config = { background: true };

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || !validJobId(body.jobId)) return json({ error: "Provide a jobId." }, 400);
  const { jobId, prompt = "", size = "1536x1024", refKey = "" } = body;

  const fail = async (error, detail) => {
    await jobSet(jobId, { status: "failed", error, detail });
    return json({ ok: false }, 202);
  };

  const apiKey = keyFor(req, "openai");
  if (!apiKey) return fail("No OpenAI key. Add one under Settings → API keys (or set OPENAI_API_KEY on the site).");
  if (!prompt.trim()) return fail("Provide a prompt.");

  await jobSet(jobId, { status: "running", startedAt: Date.now() });

  try {
    let resp;
    let ref = null;
    if (refKey) {
      const text = await blobGetText(String(refKey));
      if (text) { try { ref = JSON.parse(text); } catch { ref = null; } }
      blobDelete(String(refKey)).catch(() => {});
    }

    if (ref && ref.b64) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", prompt);
      form.append("size", size);
      const bytes = Buffer.from(ref.b64, "base64");
      const mime = ref.mime || "image/png";
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      form.append("image", new Blob([bytes], { type: mime }), `reference.${ext}`);
      resp = await fetch(EDIT_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    } else {
      resp = await fetch(GEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, prompt, size }),
      });
    }

    if (!resp.ok) {
      const detail = await resp.text();
      return fail(`OpenAI image API error (${resp.status})`, detail.slice(0, 600));
    }
    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return fail("No image returned", JSON.stringify(data).slice(0, 400));

    await blobSetText(`out:${jobId}`, JSON.stringify({ mime: "image/png", b64 }));
    await jobSet(jobId, { status: "done", bytes: Math.round(b64.length * 0.75) });
    return json({ ok: true }, 202);
  } catch (err) {
    return fail("Request failed", String(err).slice(0, 400));
  }
};
