// src/lib/clip-audio.js
//
// Auto-captioning a closing clip: pull the sound out of the captured clip in
// the browser, shrink it to a small mono WAV, hand it to the caption job, and
// wait for the timed phrases. Speech survives 8 kHz mono fine and a 40-second
// clip becomes ~640 KB, so the whole thing costs a fraction of a cent and
// takes 10–20 seconds.

import { jobStatus, pollJob, withRetry } from "./api.js";
import { keyHeaders } from "./keys.js";

const BASE = "/.netlify/functions";
const RATE = 8000;
const MAX_SEC = 240;

// Decode any audio/video blob the browser can play into mono 8 kHz PCM.
export async function extractMonoPcm(blob, rate = RATE) {
  const ACtx = window.AudioContext || window.webkitAudioContext;
  const probe = new ACtx();
  let decoded;
  try {
    decoded = await probe.decodeAudioData(await blob.arrayBuffer());
  } finally { try { probe.close(); } catch {} }
  const seconds = decoded.duration;
  if (seconds > MAX_SEC) throw new Error(`This clip is ${Math.round(seconds)} s long — auto-captioning works on clips up to ${MAX_SEC / 60} minutes. Tap the captions along instead.`);
  const frames = Math.ceil(seconds * rate);
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return { pcm: rendered.getChannelData(0), rate, seconds };
}

export function pcmToWavBase64(pcm, rate) {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Caption a clip: returns [{ start, text }] (seconds from the clip's start).
export async function autoCaptionClip(blob, { hint = "", onStep = () => {}, signal } = {}) {
  onStep("Reading the clip's sound…");
  const { pcm, rate, seconds } = await extractMonoPcm(blob);
  onStep("Packing the audio…");
  const audioBase64 = pcmToWavBase64(pcm, rate);
  onStep(`Sending ${(audioBase64.length * 0.75 / 1048576).toFixed(1)} MB of audio…`);
  const up = await fetch(`${BASE}/caption-clip-upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioBase64, mime: "audio/wav", durationSec: seconds }) });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(upData.error || `The audio upload failed (${up.status}).`);
  const jobId = "cc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const start = await withRetry(() => fetch(`${BASE}/caption-clip-background`, {
    method: "POST",
    headers: { "content-type": "application/json", ...keyHeaders() },
    body: JSON.stringify({ jobId, key: upData.key, hint, durationSec: seconds }),
  }), "caption-clip-background");
  if (start.status !== 202 && start.status !== 200) {
    const d = await start.json().catch(() => ({}));
    throw new Error(d.error || `The captioning job couldn't start (${start.status}).`);
  }
  onStep("Listening to the clip… (10–20 seconds)");
  const res = await pollJob(jobStatus, jobId, { intervalMs: 2500, timeoutMs: 4 * 60 * 1000, signal, onTick: (s) => { if (s.step) onStep(s.step); } });
  const phrases = (res.phrases || []).filter((p) => p && typeof p.start === "number" && p.text);
  if (!phrases.length) throw new Error("No captions came back.");
  // Clamp inside the clip and keep them ascending.
  let last = -1;
  return phrases.map((p) => { const start = Math.min(Math.max(p.start, last + 0.05), Math.max(0, seconds - 0.2)); last = start; return { start: Math.round(start * 100) / 100, text: p.text }; });
}
