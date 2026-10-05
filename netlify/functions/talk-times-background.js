// netlify/functions/talk-times-background.js
//
// "Find the moment": where in the talk's official recording does each
// paragraph begin? Gemini listens to the talk's MP3 (uploaded to the Files
// API) alongside the numbered paragraph text and returns a start time per
// paragraph. Runs as a background job (the audio download + upload + listen
// takes a minute or two); the browser polls art-status for { times }.
//
// Results are cached per recording in Blobs, so each talk is only ever
// timed once.

import { keyFor, googleFetch, json } from "../lib/keys.js";
import { jobSet, blobGetText, blobSetText } from "../lib/jobs.js";

export const config = { background: true };

const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { jobId, audioUrl, paragraphs } = body || {};
  if (!jobId || !audioUrl || !Array.isArray(paragraphs) || !paragraphs.length) {
    return json({ error: "Need jobId, audioUrl and paragraphs." }, 400);
  }
  if (!/^https:\/\/assets\.churchofjesuschrist\.org\//.test(audioUrl)) {
    return json({ error: "Only the Church's own recordings can be timed." }, 400);
  }
  const paras = paragraphs.slice(0, 200).map((p) => String(p || "").replace(/\s+/g, " ").trim());
  const cacheKey = `talk-times:${hash(audioUrl)}:${paras.length}:${hash(paras.join("|"))}`;

  try {
    const cached = await blobGetText(cacheKey);
    if (cached) {
      await jobSet(jobId, { status: "completed", ...JSON.parse(cached), cached: true });
      return json({ ok: true });
    }
    const apiKey = keyFor(req, "gemini");
    if (!apiKey) throw new Error("No Gemini key. Add one under Settings → API keys (or set GEMINI_API_KEY on the site).");

    await jobSet(jobId, { status: "running", step: "Downloading the talk's recording…" });
    const audio = await fetch(audioUrl, { headers: { "User-Agent": "ConferenceAsAConcert/1.0" } });
    if (!audio.ok) throw new Error(`The recording couldn't be downloaded (${audio.status}).`);
    const bytes = new Uint8Array(await audio.arrayBuffer());

    await jobSet(jobId, { status: "running", step: "Handing the recording to Gemini…" });
    const start = await googleFetch("https://generativelanguage.googleapis.com/upload/v1beta/files", apiKey, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": "audio/mpeg",
        "content-type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "conference-talk-audio" } }),
    });
    if (!start.ok) throw new Error(`Gemini upload couldn't start (${start.status}): ${(await start.text()).slice(0, 200)}`);
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("Gemini didn't return an upload URL.");
    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
      body: bytes,
    });
    if (!up.ok) throw new Error(`Gemini upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    let file = (await up.json()).file || {};
    for (let i = 0; i < 30 && file.state && file.state !== "ACTIVE"; i++) {
      await sleep(2000);
      const r = await googleFetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, apiKey, { method: "GET" });
      if (r.ok) file = await r.json();
    }
    if (file.state && file.state !== "ACTIVE") throw new Error("Gemini is still processing the recording — try again in a minute.");

    await jobSet(jobId, { status: "running", step: "Listening for where each paragraph begins…" });
    const listing = paras.map((p, i) => `[${i + 1}] ${p.length > 220 ? p.slice(0, 220) + "…" : p}`).join("\n");
    const prompt =
      "This audio is a General Conference talk. Below is the talk's text as numbered paragraphs, in order.\n" +
      "Listen to the recording and return, for EVERY numbered paragraph, the time in seconds (from the start of the audio) " +
      "at which the speaker BEGINS that paragraph. Times must be strictly increasing. If a paragraph is skipped in the " +
      "recording, estimate its time from its neighbours.\n\n" +
      'Return ONLY JSON of the form {"paragraphs":[{"n":1,"start":12.5},{"n":2,"start":40.0}]}.\n\n' +
      "PARAGRAPHS:\n" + listing;

    let times = null, used = "";
    let lastErr = "";
    for (const model of MODELS) {
      const r = await googleFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, apiKey, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ file_data: { mime_type: "audio/mpeg", file_uri: file.uri } }, { text: prompt }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0 },
        }),
      });
      if (!r.ok) { lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 160)}`; continue; }
      const data = await r.json();
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      try {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.paragraphs || parsed.times || [];
        const out = new Array(paras.length).fill(null);
        for (const it of arr) {
          const n = Number(it.n ?? it.paragraph ?? it.index), t = Number(it.start ?? it.time ?? it.seconds);
          if (Number.isInteger(n) && n >= 1 && n <= paras.length && Number.isFinite(t) && t >= 0) out[n - 1] = t;
        }
        if (out.filter((x) => x != null).length >= Math.max(2, paras.length * 0.5)) { times = out; used = model; break; }
        lastErr = `${model}: too few paragraphs timed`;
      } catch (e) { lastErr = `${model}: unreadable answer`; }
    }
    if (!times) throw new Error("Gemini couldn't time the paragraphs. " + lastErr);

    // Fill gaps and enforce increasing order so clicking a paragraph always lands forward.
    for (let i = 0; i < times.length; i++) {
      if (times[i] != null) continue;
      let a = i - 1; while (a >= 0 && times[a] == null) a--;
      let b = i + 1; while (b < times.length && times[b] == null) b++;
      if (a >= 0 && b < times.length) times[i] = times[a] + ((times[b] - times[a]) * (i - a)) / (b - a);
      else if (a >= 0) times[i] = times[a] + 20 * (i - a);
      else if (b < times.length) times[i] = Math.max(0, times[b] - 20 * (b - i));
      else times[i] = 0;
    }
    for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 1;
    times = times.map((t) => Math.round(t * 10) / 10);

    const result = { times, model: used };
    await blobSetText(cacheKey, JSON.stringify(result));
    await jobSet(jobId, { status: "completed", ...result });
    try { await googleFetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, apiKey, { method: "DELETE" }); } catch {}
  } catch (e) {
    await jobSet(jobId, { status: "failed", error: String((e && e.message) || e) });
  }
  return json({ ok: true });
};
