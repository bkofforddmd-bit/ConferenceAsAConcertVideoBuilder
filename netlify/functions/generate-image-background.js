// netlify/functions/generate-image-background.js
import { getStore } from "@netlify/blobs";

const GEN_URL = "https://api.openai.com/v1/images/generations";
const EDIT_URL = "https://api.openai.com/v1/images/edits";
const MODEL = "gpt-image-2";

export default async (req) => {
  const store = getStore("scene-images");

  let jobId = "";
  try {
    const body = await req.json();
    jobId = body.jobId || "";
    const {
      prompt = "",
      size = "1536x1024",
      referenceImageB64 = "",
    } = body;

    if (!jobId) return new Response("missing jobId", { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, { status: "error", error: "Server missing OPENAI_API_KEY" });
      return new Response("ok");
    }
    if (!prompt.trim()) {
      await store.setJSON(jobId, { status: "error", error: "Provide a prompt." });
      return new Response("ok");
    }

    await store.setJSON(jobId, { status: "pending" });

    let resp;
    if (referenceImageB64) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", prompt);
      form.append("size", size);
      const b64 = referenceImageB64.includes(",")
        ? referenceImageB64.split(",")[1]
        : referenceImageB64;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      form.append("image", new Blob([bytes], { type: "image/png" }), "reference.png");

      resp = await fetch(EDIT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      resp = await fetch(GEN_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: MODEL, prompt, size }),
      });
    }

    if (!resp.ok) {
      const detail = await resp.text();
      await store.setJSON(jobId, { status: "error", error: "OpenAI image API error", detail });
      return new Response("ok");
    }

    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      await store.setJSON(jobId, { status: "error", error: "No image returned" });
      return new Response("ok");
    }

    await store.setJSON(jobId, {
      status: "done",
      imageDataUrl: `data:image/png;base64,${b64}`,
    });
    return new Response("ok");
  } catch (err) {
    try {
      if (jobId) await store.setJSON(jobId, { status: "error", error: String(err) });
    } catch {}
    return new Response("ok");
  }
};
