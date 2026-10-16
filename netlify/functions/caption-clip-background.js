// netlify/functions/caption-clip-background.js
//
// Step 2 of auto-captioning: Gemini listens to the clip's audio (parked by
// caption-clip-upload) and returns a verbatim transcript already broken into
// caption-sized phrases, each with the second it starts. A short clip costs a
// fraction of a cent and takes ~10–20 s. The browser polls art-status.
//
//   POST { jobId, key, hint?, durationSec? }   -> 202; job → { status: "completed", phrases: [{ start, text }] }

import { keyFor, googleFetch, json } from "../lib/keys.js";
import { jobSet, blobGetText, blobDelete } from "../lib/jobs.js";

export const config = { background: true };
const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { jobId, key, hint = "", durationSec = 0 } = body || {};
  if (!jobId || !key || !String(key).startsWith("clipaudio:")) return json({ error: "Need jobId and the audio key." }, 400);
  const fail = async (error, detail) => { await jobSet(jobId, { status: "failed", error, detail }); return json({ ok: false }, 202); };

  try {
    const apiKey = keyFor(req, "gemini");
    if (!apiKey) return fail("No Gemini key. Add one under Settings → API keys (or set GEMINI_API_KEY on the site).");
    await jobSet(jobId, { status: "running", step: "Loading the clip's audio…" });
    const raw = await blobGetText(key);
    if (!raw) return fail("The clip's audio wasn't found — try again.");
    const { mime, data, durationSec: dur } = JSON.parse(raw);
    const seconds = Number(durationSec) || Number(dur) || 0;

    await jobSet(jobId, { status: "running", step: "Listening to the clip…" });
    const prompt =
      "This audio is a short excerpt (" + (seconds ? `about ${Math.round(seconds)} seconds` : "under a few minutes") + ") of a speaker at a General Conference of The Church of Jesus Christ of Latter-day Saints.\n" +
      "Transcribe EXACTLY what is said, verbatim, and split it into caption-sized phrases of roughly 4–10 words that break at natural pauses " +
      "(clauses, commas, sentence ends). For each phrase give the time in seconds from the start of the audio at which it BEGINS. " +
      "Times must be strictly increasing and within the audio's length. Do not add words that aren't spoken; do not summarize.\n" +
      (hint ? `Spelling guide (the printed text of this part of the talk — use it for names and scripture wording, but transcribe what is actually spoken):\n${String(hint).slice(0, 2000)}\n\n` : "") +
      'Return ONLY JSON of the form {"phrases":[{"start":0.4,"text":"…"},{"start":3.1,"text":"…"}]}.';

    let phrases = null, used = "", lastErr = "";
    for (const model of MODELS) {
      const r = await googleFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, apiKey, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime || "audio/wav", data } }, { text: prompt }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0 },
        }),
      });
      if (!r.ok) { lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 160)}`; continue; }
      const out = await r.json();
      const text = (out.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      try {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.phrases || parsed.captions || [];
        const clean = [];
        let last = -1;
        for (const it of arr) {
          const t = Number(it.start ?? it.time ?? it.seconds);
          const s = String(it.text || "").replace(/\s+/g, " ").trim();
          if (!s || !Number.isFinite(t) || t < 0) continue;
          if (seconds && t > seconds + 1) continue;
          clean.push({ start: Math.round(Math.max(t, last + 0.05) * 100) / 100, text: s });
          last = clean[clean.length - 1].start;
        }
        if (clean.length) { phrases = clean; used = model; break; }
        lastErr = `${model}: no phrases came back`;
      } catch (e) { lastErr = `${model}: unreadable answer`; }
    }
    blobDelete(key).catch(() => {});
    if (!phrases) return fail("The clip couldn't be captioned automatically — tap the captions along instead.", lastErr);
    await jobSet(jobId, { status: "completed", phrases, model: used });
    return json({ ok: true }, 202);
  } catch (e) {
    blobDelete(key).catch(() => {});
    return fail("Auto-captioning failed.", String(e && e.message ? e.message : e).slice(0, 300));
  }
};
