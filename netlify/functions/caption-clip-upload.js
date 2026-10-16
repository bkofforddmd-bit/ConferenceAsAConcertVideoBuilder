// netlify/functions/caption-clip-upload.js
//
// Step 1 of auto-captioning a closing clip: the browser sends the clip's
// audio (mono WAV, base64) and it's parked in Blobs for the background job.
// Background functions only take a small request body, hence the two steps.
//
//   POST { audioBase64, mime, durationSec } -> { key }

import { json, readJson } from "../lib/keys.js";
import { blobSetText } from "../lib/jobs.js";

const MAX_CHARS = 5_000_000; // ≈ 3.7 MB of audio — about 4 minutes of 8 kHz mono WAV

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || typeof body.audioBase64 !== "string" || !body.audioBase64) return json({ error: "Send the clip's audio as audioBase64." }, 400);
  if (body.audioBase64.length > MAX_CHARS) return json({ error: "That clip's audio is too long to caption automatically — keep the clip under about 4 minutes, or tap the captions along instead." }, 413);
  const mime = /^audio\/(wav|x-wav|mpeg|mp4|webm|ogg)/.test(String(body.mime || "")) ? String(body.mime) : "audio/wav";
  const key = `clipaudio:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    await blobSetText(key, JSON.stringify({ mime, durationSec: Number(body.durationSec) || 0, data: body.audioBase64 }));
  } catch (e) {
    return json({ error: "Couldn't store the audio for captioning.", detail: String(e).slice(0, 200) }, 500);
  }
  return json({ key });
};
