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
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...keyHeaders() },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(
      "Couldn't reach the app's server (the browser refused or lost the request). " +
      "Try a hard refresh (Ctrl+F5). If you pasted keys under Settings, open Settings and save them again — " +
      `a stray character in a key blocks every request. (${e && e.message ? e.message : e})`
    );
  }
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
  const { referenceImageB64 = "", ...rest } = payload || {};

  // Background functions accept only ~256 KB per request, so a reference image
  // (several MB as PNG) is shrunk to JPEG and staged in storage first; the job
  // itself carries just the key.
  let refKey = "";
  if (referenceImageB64) {
    try {
      const small = await shrinkImage(referenceImageB64, 1536, 0.9);
      const r = await postTo(`${BASE}/image-ref`, { jobId, dataUrl: small });
      refKey = r.refKey || "";
    } catch (e) {
      throw new Error(`Couldn't send the reference image: ${e.message}`);
    }
  }

  let started;
  try {
    started = await fetch(`${BASE}/generate-image-background`, {
      method: "POST",
      headers: { "content-type": "application/json", ...keyHeaders() },
      body: JSON.stringify({ ...rest, jobId, refKey }),
    });
  } catch {
    started = null;
  }
  if (!started) {
    // The request itself failed (blocked, offline, or a bad header). Say so
    // plainly instead of retrying a slower path that will fail the same way.
    return post("generate-image", payload);
  }
  if (started.status !== 202 && started.status !== 200) {
    // Old deploy or background functions unavailable: original synchronous call.
    return post("generate-image", payload);
  }

  const t0 = Date.now();
  let delay = 3000;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.2, 8000);
    let s;
    try {
      const resp = await fetch(`${BASE}/image-status?id=${encodeURIComponent(jobId)}`);
      s = await resp.json();
    } catch {
      continue; // transient network blip; keep polling
    }
    if (s.status === "done") {
      if (s.imageDataUrl) return { imageDataUrl: s.imageDataUrl };
      const r = await fetch(`${BASE}/image-result?id=${encodeURIComponent(jobId)}`);
      if (!r.ok) throw new Error(`The image finished but couldn't be fetched (${r.status}).`);
      const blob = await r.blob();
      return { imageDataUrl: await blobToDataUrl(blob) };
    }
    if (s.status === "failed") throw new Error((s.error || "Image generation failed.") + (s.detail ? `\n${truncate(s.detail)}` : ""));
  }
  throw new Error("Timed out waiting for the image (6 minutes). Try again.");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("Couldn't read the image."));
    fr.readAsDataURL(blob);
  });
}

// Re-encode an image data URL as a JPEG no wider than maxW. Returns the input
// untouched if it can't be drawn (e.g. not a browser context).
export function shrinkImage(dataUrl, maxW = 1536, quality = 0.9) {
  return new Promise((resolve) => {
    try {
      const im = new Image();
      im.onload = () => {
        try {
          const scale = Math.min(1, maxW / (im.naturalWidth || maxW));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round((im.naturalWidth || maxW) * scale);
          canvas.height = Math.round((im.naturalHeight || maxW) * scale);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(dataUrl);
        }
      };
      im.onerror = () => resolve(dataUrl);
      im.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
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
