// src/lib/concert.js
//
// Publishing a finished song to the Conference Concert library
// (conferenceconcert.netlify.app). Mirrors that app's own band upload:
//   1. verify the band password
//   2. "sign" → a presigned storage link for the audio
//   3. PUT the audio there (directly, or via our relay function)
//   4. "save" the catalog entry (title, talk, speaker, lyrics, timings…)

import { lyricLines, isSectionLine } from "./lyric-sync.js";

const BASE = "/.netlify/functions";
const PW_KEY = "cac-concert-pw";
export const CONCERT_SITE = "https://conferenceconcert.netlify.app";

export function loadConcertPassword() {
  try { return localStorage.getItem(PW_KEY) || ""; } catch { return ""; }
}
export function saveConcertPassword(pw) {
  try { if (pw) localStorage.setItem(PW_KEY, pw); else localStorage.removeItem(PW_KEY); } catch {}
}

async function relay(password, action, payload) {
  const resp = await fetch(`${BASE}/concert-publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, action, payload }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Conference Concert returned ${resp.status}`);
  return data;
}

// The Concert app wants one number per lyric line (seconds), aligned 1:1 with
// lyrics.split("\n"). Our sync marks only sung lines, so: each sung line gets
// its mark; a [Section] label or blank line takes the time of the next sung
// line (a hair earlier, so the next line lights up on its own mark); anything
// before the first mark is 0.
export function syncToLyricTimings(lyrics, sync) {
  const lines = lyricLines(lyrics);
  if (!Array.isArray(sync) || sync.length < 2) return null;
  const byLine = new Map();
  for (const [i, t] of sync) if (Number.isInteger(i) && typeof t === "number") byLine.set(i, t);
  const out = new Array(lines.length).fill(null);
  for (let i = 0; i < lines.length; i++) if (byLine.has(i)) out[i] = byLine.get(i);
  // fill non-sung lines from the next marked line
  let next = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (out[i] != null) { next = out[i]; continue; }
    const text = lines[i].trim();
    const filler = !text || isSectionLine(text);
    if (next != null) out[i] = filler ? Math.max(0, next - 0.01) : next;
    else out[i] = 0;
  }
  // lines before the first mark → 0 (handled), but also enforce non-decreasing
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return out.map((t) => Math.round(t * 100) / 100);
}

function extFor(mime) {
  const t = String(mime || "").toLowerCase();
  if (t.includes("wav")) return ".wav";
  if (t.includes("m4a") || t.includes("aac") || t.includes("mp4")) return ".m4a";
  if (t.includes("ogg")) return ".ogg";
  return ".mp3";
}

// song: { title, talk, speaker, session, theme, style, talkUrl, lyrics, duration, blurb, lyricTimings }
// audio: Blob. onStep(text) reports progress. Returns the saved catalog entry.
export async function publishToConcert({ password, song, audio, onStep = () => {} }) {
  onStep("Checking the band password…");
  await relay(password, "verify", {});

  onStep("Asking the Concert app for an upload link…");
  const ct = audio.type && /^audio\//.test(audio.type) ? audio.type : "audio/mpeg";
  const filename = `${(song.title || "song").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}${extFor(ct)}`;
  const sign = await relay(password, "sign", { filename, contentType: ct, titleHint: song.title });
  if (!sign.uploadUrl || !sign.publicUrl) throw new Error("The Concert app didn't return an upload link.");

  onStep(`Uploading the song (${(audio.size / 1048576).toFixed(1)} MB)…`);
  let uploaded = false;
  try {
    const put = await fetch(sign.uploadUrl, { method: "PUT", headers: { "content-type": ct }, body: audio });
    uploaded = put.ok;
  } catch {
    uploaded = false;
  }
  if (!uploaded) {
    // The Concert storage doesn't accept uploads straight from this site, so
    // send the song in pieces and let a Studio background job deliver it.
    const CHUNK = 3 * 1048576;
    const count = Math.ceil(audio.size / CHUNK);
    const uploadId = "up_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    for (let n = 0; n < count; n++) {
      onStep(`Uploading the song in pieces… ${n + 1} of ${count}`);
      const piece = audio.slice(n * CHUNK, Math.min(audio.size, (n + 1) * CHUNK));
      let ok = false, lastErr = "";
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const r = await fetch(`${BASE}/concert-chunk?id=${uploadId}&n=${n}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: piece });
          if (r.ok) ok = true;
          else { const d = await r.json().catch(() => ({})); lastErr = d.error || `piece ${n + 1} failed (${r.status})`; }
        } catch (e) { lastErr = e.message; }
        if (!ok) await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
      if (!ok) throw new Error(`Couldn't upload piece ${n + 1} of ${count}: ${lastErr}`);
    }
    onStep("Pieces received — delivering the song to the Concert storage…");
    const jobId = "cj_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    const start = await fetch(`${BASE}/concert-assemble-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, uploadId, count, to: sign.uploadUrl, contentType: ct }),
    });
    if (start.status !== 202 && start.status !== 200) {
      const d = await start.json().catch(() => ({}));
      throw new Error(d.error || `Couldn't start the delivery job (${start.status}).`);
    }
    const t0 = Date.now();
    let delay = 2500;
    while (true) {
      await new Promise((res) => setTimeout(res, delay));
      delay = Math.min(delay * 1.2, 8000);
      let s = {};
      try { s = await (await fetch(`${BASE}/art-status?id=${encodeURIComponent(jobId)}`)).json(); } catch { continue; }
      if (s.status === "done") break;
      if (s.status === "failed") throw new Error((s.error || "Delivery failed.") + (s.detail ? ` ${s.detail}` : ""));
      if (Date.now() - t0 > 10 * 60 * 1000) throw new Error("Timed out delivering the song to the Concert storage.");
    }
  }

  onStep("Saving the song in the Concert library…");
  const entry = {
    title: song.title,
    talk: song.talk || "",
    speaker: song.speaker || "",
    session: song.session || "",
    theme: song.theme || "",
    style: song.style || "",
    talkUrl: song.talkUrl || "",
    youtube: song.youtube || "",
    audioUrl: sign.publicUrl,
    previewStart: song.previewStart || 0,
    duration: Math.round(song.duration || 0),
    lyrics: song.lyrics || "",
    blurb: song.blurb || "",
  };
  if (Array.isArray(song.lyricTimings)) entry.lyricTimings = song.lyricTimings;
  const saved = await relay(password, "save", { song: entry });
  return saved.entry || entry;
}
