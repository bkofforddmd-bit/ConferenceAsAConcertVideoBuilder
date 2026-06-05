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
export const generateOutline = (payload) => post("generate-outline", payload);
export const generateSceneDetail = (payload) => post("generate-scene-detail", payload);
export const extractMeta = (payload) => post("extract-meta", payload);
export const generateImage = (payload) => post("generate-image", payload);
export const describeImage = (payload) => post("describe-image", payload);
export const matchImages = (payload) => post("match-images", payload);
export const outlineFromImages = (payload) => post("outline-from-images", payload);
