// src/lib/song-sync.js
//
// "✨ Sync with AI" for the lyric sync editor: convert the song to 16 kHz mono
// WAV in the browser (sung words over instruments deserve more than phone
// quality), send it to the server in ≤ 3 MB pieces, start the Gemini
// alignment job, and wait for a start time per lyric unit.

import { jobStatus, pollJob, withRetry } from "./api.js";
import { keyHeaders } from "./keys.js";

const BASE = "/.netlify/functions";
const RATE = 16000;
const CHUNK = 3 * 1048576;
const MAX_SEC = 8 * 60;

async function toMonoWav(blob, rate = RATE) {
  const ACtx = window.AudioContext || window.webkitAudioContext;
  const probe = new ACtx();
  let decoded;
  try { decoded = await probe.decodeAudioData(await blob.arrayBuffer()); } finally { try { probe.close(); } catch {} }
  const seconds = decoded.duration;
  if (seconds > MAX_SEC) throw new Error(`This song is ${Math.round(seconds / 60)} minutes long — AI sync works on songs up to ${MAX_SEC / 60} minutes.`);
  const frames = Math.ceil(seconds * rate);
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start(0);
  const pcm = (await off.startRendering()).getChannelData(0);
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return { blob: new Blob([buf], { type: "audio/wav" }), seconds };
}

// units: [{ key, text }] in sung order. Returns { times: { key: seconds }, model }.
export async function aiSyncLyrics(songBlob, units, { onStep = () => {}, signal } = {}) {
  onStep("Reading the song…");
  const { blob, seconds } = await toMonoWav(songBlob);
  const count = Math.ceil(blob.size / CHUNK);
  const uploadId = "up_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  let sent = 0;
  const sendPiece = async (n) => {
    const piece = blob.slice(n * CHUNK, Math.min(blob.size, (n + 1) * CHUNK));
    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(`${BASE}/concert-chunk?id=${uploadId}&n=${n}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: piece });
        if (r.ok) { sent++; onStep(`Sending the song… ${sent} of ${count} (${(blob.size / 1048576).toFixed(1)} MB)`); return; }
        lastErr = `piece ${n + 1} failed (${r.status})`;
      } catch (e) { lastErr = e.message; }
      await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
    }
    throw new Error(`Couldn't send piece ${n + 1} of ${count}: ${lastErr}`);
  };
  let next = 0;
  const worker = async () => { while (next < count) { const n = next++; await sendPiece(n); } };
  await Promise.all(Array.from({ length: Math.min(4, count) }, worker));

  const jobId = "ls_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const start = await withRetry(() => fetch(`${BASE}/lyric-sync-background`, {
    method: "POST",
    headers: { "content-type": "application/json", ...keyHeaders() },
    body: JSON.stringify({ jobId, uploadId, count, durationSec: seconds, units }),
  }), "lyric-sync-background");
  if (start.status !== 202 && start.status !== 200) {
    const d = await start.json().catch(() => ({}));
    throw new Error(d.error || `The sync job couldn't start (${start.status}).`);
  }
  onStep("Listening to the song… (about half a minute)");
  const res = await pollJob(jobStatus, jobId, { intervalMs: 3000, timeoutMs: 6 * 60 * 1000, signal, onTick: (s) => { if (s.step) onStep(s.step); } });
  if (!res.times || typeof res.times !== "object") throw new Error("No timing came back.");
  return { times: res.times, model: res.model || "", seconds };
}
