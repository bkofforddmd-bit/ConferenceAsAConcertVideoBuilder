// netlify/functions/image-ref.js
//
// Stages a reference image (the previous scene, for "Lock consistency") in
// Netlify storage before a scene-image job starts. Background functions only
// accept ~256 KB of request body, far less than an image, so the browser
// uploads the image here (synchronous functions take up to 6 MB) and passes
// the returned key to generate-image-background instead.

import { json, readJson } from "../lib/keys.js";
import { blobSetText, validJobId } from "../lib/jobs.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || !validJobId(body.jobId)) return json({ error: "Provide a jobId." }, 400);
  const dataUrl = String(body.dataUrl || "");
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) return json({ error: "dataUrl must be a base64 image data URL." }, 400);
  const key = `ref:${body.jobId}`;
  try {
    await blobSetText(key, JSON.stringify({ mime: m[1], b64: m[2] }));
  } catch (e) {
    return json({ error: "Couldn't store the reference image", detail: String(e).slice(0, 300) }, 500);
  }
  return json({ refKey: key, bytes: Math.round(m[2].length * 0.75) });
};
