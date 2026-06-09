// src/lib/api.js
const BASE = "/.netlify/functions";

// Optional: a dedicated long-running image service (e.g. Render.com) that
// isn't subject to Netlify's 10s function timeout. Set VITE_IMAGE_API_URL at
// build time to its /generate-image URL. If unset, we fall back to Netlify.
const IMAGE_API_URL = (import.meta.env && import.meta.env.VITE_IMAGE_API_URL) || "";
// Optional single-call storyboard endpoint on the same long-running service.
// Derived from the image URL by default (…/generate-image → …/generate-storyboard),
// or set VITE_STORYBOARD_API_URL explicitly.
const STORYBOARD_API_URL =
  (import.meta.env && import.meta.env.VITE_STORYBOARD_API_URL) ||
  (IMAGE_API_URL ? IMAGE_API_URL.replace(/generate-image\/?$/, "generate-storyboard") : "");

async function postTo(url, payload) {
  const resp = await fetch(url, {
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

async function post(fn, payload) {
  return postTo(`${BASE}/${fn}`, payload);
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
export const generateImage = (payload) =>
  IMAGE_API_URL ? postTo(IMAGE_API_URL, payload) : post("generate-image", payload);
export const describeImage = (payload) => post("describe-image", payload);
export const matchImages = (payload) => post("match-images", payload);
export const outlineFromImages = (payload) => post("outline-from-images", payload);

// Single-call full storyboard (style bible + all scenes) on the long-running
// service. Returns null URL → caller should fall back to the multi-call flow.
export const storyboardAvailable = () => !!STORYBOARD_API_URL;
export const generateStoryboard = (payload) => postTo(STORYBOARD_API_URL, payload);
