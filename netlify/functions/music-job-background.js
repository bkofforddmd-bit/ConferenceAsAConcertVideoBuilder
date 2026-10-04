// netlify/functions/music-job-background.js
//
// Google Lyria song generation as a Netlify BACKGROUND function (15-minute
// limit). The Interactions API's job-status endpoint rejects Google's newer
// "AQ." auth keys with "Multiple authentication credentials received" (job
// creation works; checking the job doesn't). So instead of create-then-poll
// Google, this function runs the request synchronously to completion
// (typically 30–90 s), stores the audio in Netlify storage, and the browser
// polls music-status.js, which reads our own job record.
//
// Request body: { jobId, lyrics, styleDirection, vocals, title, durationHint }

import { keyFor, json, readJson, googleFetch } from "../lib/keys.js";
import { jobSet, blobSetText, validJobId } from "../lib/jobs.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const config = { background: true };

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || !validJobId(body.jobId)) return json({ error: "Provide a jobId." }, 400);
  const { jobId, lyrics = "", styleDirection = "", vocals = "", title = "", durationHint = "" } = body;

  const fail = async (error, detail) => {
    await jobSet(jobId, { status: "failed", error, detail });
    return json({ ok: false }, 202);
  };

  const key = keyFor(req, "gemini");
  if (!key) return fail("No Google Gemini key. Add one under Settings → API keys (or set GEMINI_API_KEY on the site).");
  if (!lyrics.trim()) return fail("Provide finalized lyrics.");

  await jobSet(jobId, { status: "running", startedAt: Date.now() });

  const style = [styleDirection, vocals].filter((s) => s && s.trim()).join("; ");
  const prompt = [
    `Reverent, uplifting song${title ? ` titled "${title}"` : ""}.`,
    style ? `Style: ${style}.` : "Style: cinematic, worshipful, warm acoustic arrangement.",
    durationHint ? `Length: ${durationHint}.` : "Length: about 3 minutes.",
    "Sing these lyrics exactly as written, keeping the section order:",
    "",
    lyrics.trim(),
  ].join("\n");

  try {
    const resp = await googleFetch(GEMINI_URL, key, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "lyria-3.5", input: prompt }),
    });
    const text = await resp.text();
    if (!resp.ok) return fail(`Google Lyria returned ${resp.status}`, text.slice(0, 600));
    let data;
    try { data = JSON.parse(text); } catch { return fail("Unexpected reply from Google", text.slice(0, 400)); }

    const st = String(data.status || "").toLowerCase();
    if (st && st !== "completed") {
      return fail(`Google reported "${st}"`, JSON.stringify(data.error || data.incomplete_details || "").slice(0, 400));
    }
    let audio = null;
    let lyricsOut = "";
    const steps = Array.isArray(data.steps) ? data.steps : [];
    for (const step of steps) {
      for (const c of (Array.isArray(step.content) ? step.content : [])) {
        if (c.type === "audio" && c.data && !audio) audio = c;
        else if (c.type === "text" && c.text) lyricsOut += (lyricsOut ? "\n" : "") + c.text;
      }
    }
    if (!audio && Array.isArray(data.outputs)) {
      for (const c of data.outputs) if (c.type === "audio" && c.data) { audio = c; break; }
    }
    if (!audio) return fail("Google finished but returned no audio", text.slice(0, 400));

    const mime = audio.mime_type || audio.mimeType || "audio/mpeg";
    await blobSetText(`song:${jobId}`, JSON.stringify({ mime, b64: audio.data }));
    await jobSet(jobId, { status: "done", mimeType: mime, lyrics: lyricsOut.slice(0, 20000), bytes: Math.round(audio.data.length * 0.75) });
    return json({ ok: true }, 202);
  } catch (err) {
    return fail("Request failed", String(err).slice(0, 400));
  }
};
