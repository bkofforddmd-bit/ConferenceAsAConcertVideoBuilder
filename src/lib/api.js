// src/lib/api.js
const BASE = "/.netlify/functions";

async function post(fn, payload) {
  const resp = await fetch(`${BASE}/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `Request failed (${resp.status})` +
      (data.detail ? `\n${truncate(data.detail)}` : ""));
  }
  return data;
}

function truncate(s, n = 400) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export const generateLyrics = (payload) => post("generate-lyrics", payload);
export const generateStyleBible = (payload) => post("generate-style-bible", payload);
export const generateSceneDetail = (payload) => post("generate-scene-detail", payload);

function makeJobId() {
  return "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

export async function generateImage({ prompt, referenceImageB64 = "", size }) {
  const jobId = makeJobId();

  await fetch(`${BASE}/generate-image-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, prompt, referenceImageB64, size }),
  });

  const start = Date.now();
  const timeoutMs = 3 * 60 * 1000;
  while (Date.now() - start < timeoutMs) {
    await sleep(3000);
    let rec;
    try {
      rec = await post("image-status", { jobId });
    } catch {
      continue;
    }
    if (rec.status === "done") return { imageDataUrl: rec.imageDataUrl };
    if (rec.status === "error") {
      throw new Error((rec.error || "Image failed") + (rec.detail ? `\n${truncate(rec.detail)}` : ""));
    }
  }
  throw new Error("Image timed out after 3 minutes.");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
