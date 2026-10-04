// netlify/functions/generate-image-background.js
//
// Scene image generation as a Netlify BACKGROUND function (up to 15 minutes).
// gpt-image-2 takes 30–90 s per image — far past the limit of a normal
// function, which is why the old synchronous call surfaced as "Failed to fetch".
//
// The browser sends { jobId, prompt, size, referenceImageB64 } and gets an
// immediate 202; it then polls image-status.js until the job record says done.
//
//   - Generation: prompt only                 -> /v1/images/generations
//   - Reference-locked: prompt + prior image  -> /v1/images/edits
//     (keeps characters/style consistent across scenes)

import { keyFor, json, readJson } from "../lib/keys.js";
import { jobSet, validJobId } from "../lib/jobs.js";

const GEN_URL = "https://api.openai.com/v1/images/generations";
const EDIT_URL = "https://api.openai.com/v1/images/edits";
const MODEL = "gpt-image-2";

export const config = { background: true };

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || !validJobId(body.jobId)) return json({ error: "Provide a jobId." }, 400);
  const { jobId, prompt = "", size = "1536x1024", referenceImageB64 = "" } = body;

  const apiKey = keyFor(req, "openai");
  if (!apiKey) {
    await jobSet(jobId, { status: "failed", error: "No OpenAI key. Add one under Settings → API keys (or set OPENAI_API_KEY on the site)." });
    return json({ ok: false }, 202);
  }
  if (!prompt.trim()) {
    await jobSet(jobId, { status: "failed", error: "Provide a prompt." });
    return json({ ok: false }, 202);
  }

  await jobSet(jobId, { status: "running", startedAt: Date.now() });

  try {
    let resp;
    if (referenceImageB64) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", prompt);
      form.append("size", size);
      const b64 = referenceImageB64.includes(",") ? referenceImageB64.split(",")[1] : referenceImageB64;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      form.append("image", new Blob([bytes], { type: "image/png" }), "reference.png");
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
      await jobSet(jobId, { status: "failed", error: `OpenAI image API error (${resp.status})`, detail: detail.slice(0, 600) });
      return json({ ok: false }, 202);
    }
    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      await jobSet(jobId, { status: "failed", error: "No image returned", detail: JSON.stringify(data).slice(0, 400) });
      return json({ ok: false }, 202);
    }
    await jobSet(jobId, { status: "done", imageDataUrl: `data:image/png;base64,${b64}` });
    return json({ ok: true }, 202);
  } catch (err) {
    await jobSet(jobId, { status: "failed", error: "Request failed", detail: String(err).slice(0, 400) });
    return json({ ok: false }, 202);
  }
};
