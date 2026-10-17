// netlify/functions/lyric-sync-background.js
//
// "✨ Sync with AI": Gemini listens to the whole song and pins when each
// lyric unit (line or phrase) begins. The browser first sends the song's
// audio in ≤ 3 MB pieces to concert-chunk (16 kHz mono WAV); this job joins
// them, uploads the file to Gemini's Files API, and asks for a start time per
// numbered unit. The words are known, so this is alignment, not
// transcription — more reliable than captioning from scratch.
//
//   POST { jobId, uploadId, count, durationSec, units: [{ key, text }] }
//   -> 202; job → { status: "completed", times: { key: seconds }, model }

import { keyFor, googleFetch, json } from "../lib/keys.js";
import { jobSet, blobGetBytes, blobDelete, validJobId } from "../lib/jobs.js";

export const config = { background: true };
const MODELS = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { jobId, uploadId = "", count = 0, durationSec = 0, units = [] } = body || {};
  if (!validJobId(jobId)) return json({ error: "Need a jobId." }, 400);
  const fail = async (error, detail) => { cleanup(); await jobSet(jobId, { status: "failed", error, detail }); return json({ ok: false }, 202); };
  const cleanup = () => { for (let n = 0; n < count; n++) blobDelete(`chunk:${uploadId}:${n}`).catch(() => {}); };
  if (!validJobId(uploadId) || !Number.isInteger(count) || count < 1 || count > 60) return fail("Bad upload description.");
  const list = (Array.isArray(units) ? units : []).map((u) => ({ key: String(u.key || ""), text: String(u.text || "").replace(/\s+/g, " ").trim() })).filter((u) => u.key && u.text).slice(0, 400);
  if (list.length < 2) return fail("Need at least two lyric lines to sync.");

  try {
    const apiKey = keyFor(req, "gemini");
    if (!apiKey) return fail("No Gemini key. Add one under Settings → API keys (or set GEMINI_API_KEY on the site).");

    await jobSet(jobId, { status: "running", step: "Gathering the song…" });
    const parts = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
      const buf = await blobGetBytes(`chunk:${uploadId}:${n}`);
      if (!buf || !buf.byteLength) return fail(`Piece ${n + 1} of ${count} of the song is missing — try again.`);
      parts.push(new Uint8Array(buf)); total += buf.byteLength;
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { bytes.set(p, off); off += p.byteLength; }

    await jobSet(jobId, { status: "running", step: "Handing the song to Gemini…" });
    const start = await googleFetch("https://generativelanguage.googleapis.com/upload/v1beta/files", apiKey, {
      method: "POST",
      headers: { "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": "audio/wav", "content-type": "application/json" },
      body: JSON.stringify({ file: { display_name: "song-for-lyric-sync" } }),
    });
    if (!start.ok) return fail(`Gemini upload couldn't start (${start.status})`, (await start.text()).slice(0, 200));
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) return fail("Gemini didn't return an upload URL.");
    const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes });
    if (!up.ok) return fail(`Gemini upload failed (${up.status})`, (await up.text()).slice(0, 200));
    let file = (await up.json()).file || {};
    for (let i = 0; i < 30 && file.state && file.state !== "ACTIVE"; i++) {
      await sleep(2000);
      const r = await googleFetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, apiKey, { method: "GET" });
      if (r.ok) file = await r.json();
    }
    if (file.state && file.state !== "ACTIVE") return fail("Gemini is still processing the song — try again in a minute.");
    cleanup();

    await jobSet(jobId, { status: "running", step: "Listening for where each line begins…" });
    const listing = list.map((u, i) => `[${i + 1}] ${u.text}`).join("\n");
    const prompt =
      "This audio is a song. Below are its sung lyrics as numbered units, in the order they are sung" + (durationSec ? ` (the song is about ${Math.round(durationSec)} seconds long)` : "") + ".\n" +
      "Listen to the recording and return, for EVERY numbered unit, the time in seconds (from the start of the audio) at which the singer BEGINS that unit. " +
      "Times must be strictly increasing and within the song's length. Account for instrumental intros, breaks and repeats — a chorus sung twice appears twice in the list, in order. " +
      "If a unit is hard to hear, estimate it from its neighbours rather than skipping it.\n\n" +
      'Return ONLY JSON of the form {"units":[{"n":1,"start":12.5},{"n":2,"start":15.1}]}.\n\n' +
      "UNITS:\n" + listing;

    let times = null, used = "", lastErr = "";
    for (const model of MODELS) {
      const r = await googleFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, apiKey, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ file_data: { mime_type: "audio/wav", file_uri: file.uri } }, { text: prompt }] }], generationConfig: { response_mime_type: "application/json", temperature: 0 } }),
      });
      if (!r.ok) { lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 160)}`; continue; }
      const data = await r.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      try {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.units || parsed.lines || parsed.times || [];
        const out = new Array(list.length).fill(null);
        for (const it of arr) {
          const n = Number(it.n ?? it.unit ?? it.index), t = Number(it.start ?? it.time ?? it.seconds);
          if (Number.isInteger(n) && n >= 1 && n <= list.length && Number.isFinite(t) && t >= 0 && (!durationSec || t <= durationSec + 2)) out[n - 1] = t;
        }
        const got = out.filter((x) => x != null).length;
        if (got >= Math.max(2, Math.ceil(list.length * 0.6))) { times = out; used = model; break; }
        lastErr = `${model}: only ${got} of ${list.length} units timed`;
      } catch { lastErr = `${model}: unreadable answer`; }
    }
    googleFetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, apiKey, { method: "DELETE" }).catch(() => {});
    if (!times) return fail("The song couldn't be synced automatically — tap along instead.", lastErr);
    // Fill gaps between neighbours and enforce ascending order.
    for (let i = 0; i < times.length; i++) {
      if (times[i] != null) continue;
      let a = i - 1; while (a >= 0 && times[a] == null) a--;
      let b = i + 1; while (b < times.length && times[b] == null) b++;
      if (a >= 0 && b < times.length) times[i] = times[a] + ((times[b] - times[a]) * (i - a)) / (b - a);
      else if (a >= 0) times[i] = times[a] + 2.5 * (i - a);
      else if (b < times.length) times[i] = Math.max(0, times[b] - 2.5 * (b - i));
      else times[i] = 0;
    }
    for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 0.1;
    const result = {};
    list.forEach((u, i) => { result[u.key] = Math.round(times[i] * 100) / 100; });
    await jobSet(jobId, { status: "completed", times: result, model: used, count: list.length });
    return json({ ok: true }, 202);
  } catch (e) {
    return fail("AI sync failed.", String(e && e.message ? e.message : e).slice(0, 300));
  }
};
