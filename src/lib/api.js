// src/lib/api.js
import { keyHeaders } from "./keys.js";

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
    headers: { "content-type": "application/json", ...keyHeaders() },
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
// Scene images take 30–90 s, longer than a normal Netlify function may run, so
// generation happens in a background function and the browser polls for the
// result. If the background function isn't available (old deploy / plan), fall
// back to the original synchronous call.
export async function generateImage(payload) {
  if (IMAGE_API_URL) return postTo(IMAGE_API_URL, payload);
  const jobId = "img_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  let started;
  try {
    started = await fetch(`${BASE}/generate-image-background`, {
      method: "POST",
      headers: { "content-type": "application/json", ...keyHeaders() },
      body: JSON.stringify({ ...payload, jobId }),
    });
  } catch {
    started = null;
  }
  if (!started || (started.status !== 202 && started.status !== 200)) {
    return post("generate-image", payload);
  }
  const t0 = Date.now();
  let delay = 3000;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.2, 8000);
    let s;
    try {
      const resp = await fetch(`${BASE}/image-status?id=${encodeURIComponent(jobId)}`, { headers: keyHeaders() });
      s = await resp.json();
    } catch {
      continue; // transient network blip; keep polling
    }
    if (s.status === "done" && s.imageDataUrl) return { imageDataUrl: s.imageDataUrl };
    if (s.status === "failed") throw new Error((s.error || "Image generation failed.") + (s.detail ? `\n${truncate(s.detail)}` : ""));
  }
  throw new Error("Timed out waiting for the image (6 minutes). Try again.");
}
export const describeImage = (payload) => post("describe-image", payload);
export const matchImages = (payload) => post("match-images", payload);
export const outlineFromImages = (payload) => post("outline-from-images", payload);

// Single-call full storyboard (style bible + all scenes) on the long-running
// service. Returns null URL → caller should fall back to the multi-call flow.
export const storyboardAvailable = () => !!STORYBOARD_API_URL;
export const generateStoryboard = (payload) => postTo(STORYBOARD_API_URL, payload);

// ---- Studio: configuration, music, video ----

export async function getConfig() {
  try {
    const resp = await fetch(`${BASE}/config`);
    const data = await resp.json();
    return data && data.serverKeys ? data : { serverKeys: {}, providers: { music: [], video: [] } };
  } catch {
    return { serverKeys: {}, providers: { music: [], video: [] } };
  }
}

export const musicStart = (payload) => post("music-start", payload);
export const musicStatus = (jobId) => post("music-status", { jobId });
export const videoStart = (payload) => post("video-start", payload);
export const videoStatus = (jobId) => post("video-status", { jobId });

// Poll a job until it completes. `onTick` gets each status reply.
export async function pollJob(statusFn, jobId, { intervalMs = 5000, timeoutMs = 15 * 60 * 1000, onTick, signal } = {}) {
  const started = Date.now();
  let delay = intervalMs;
  while (true) {
    if (signal && signal.aborted) throw new Error("Cancelled.");
    const s = await statusFn(jobId);
    if (onTick) onTick(s);
    if (s.status === "completed") return s;
    if (s.status === "failed") throw new Error((s.error || "The job failed.") + (s.detail ? `\n${truncate(s.detail)}` : ""));
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the job.");
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.25, 15000);
  }
}

// Download generated media as a Blob. Tries the URL directly (CDNs with CORS),
// then falls back to the host-locked fetch-media proxy.
export async function fetchMediaBlob(url) {
  if (url.startsWith("data:")) {
    const r = await fetch(url);
    return r.blob();
  }
  try {
    const direct = await fetch(url, { mode: "cors" });
    if (direct.ok) return await direct.blob();
  } catch {}
  const proxied = await fetch(`${BASE}/fetch-media?src=${encodeURIComponent(url)}`, { headers: keyHeaders() });
  if (!proxied.ok) {
    const d = await proxied.json().catch(() => ({}));
    throw new Error(d.error || `Could not download the media (${proxied.status}).`);
  }
  return proxied.blob();
}
