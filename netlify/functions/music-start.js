// netlify/functions/music-start.js
//
// Starts a song generation job from finalized lyrics + a style direction and
// returns a job id the browser polls with music-status.js. Generation takes
// 30–120 seconds — far past Netlify's 10-second limit for a plain function —
// so every provider is used in its asynchronous mode:
//
//   lyria   → Google Gemini Interactions API, model lyria-3.5, background:true
//   minimax → fal.ai queue, model fal-ai/minimax-music/v2
//
// Job ids are "<provider>:<provider job id>" so music-status knows where to look.

import { keyFor, json, readJson, encodeFalJob, googleFetch } from "../lib/keys.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const FAL_QUEUE = "https://queue.fal.run/fal-ai/minimax-music/v2";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  const {
    provider = "lyria",
    lyrics = "",
    styleDirection = "",
    title = "",
    vocals = "",          // e.g. "solo male baritone with soft choir on the chorus"
    durationHint = "",    // e.g. "about 3 minutes"
    format = "mp3",
  } = body;

  if (!lyrics.trim()) return json({ error: "Provide finalized lyrics." }, 400);

  const style = [styleDirection, vocals].filter((s) => s && s.trim()).join("; ");

  if (provider === "lyria") {
    const key = keyFor(req, "gemini");
    if (!key) return json({ error: "No Google Gemini key. Add one under Settings → API keys (or set GEMINI_API_KEY on the site)." }, 400);

    const prompt = [
      `Reverent, uplifting song${title ? ` titled "${title}"` : ""}.`,
      style ? `Style: ${style}.` : "Style: cinematic, worshipful, warm acoustic arrangement.",
      durationHint ? `Length: ${durationHint}.` : "Length: about 3 minutes.",
      "Sing these lyrics exactly as written, keeping the section order:",
      "",
      lyrics.trim(),
    ].join("\n");

    const payload = {
      model: "lyria-3.5",
      background: true,
      input: prompt,
    };
    if (format === "wav") payload.response_format = { type: "audio", format: "wav" };

    const resp = await googleFetch(GEMINI_URL, key, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    if (!resp.ok) return json({ error: "Google Lyria rejected the request", detail: text.slice(0, 800) }, resp.status);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "Unexpected reply from Google", detail: text.slice(0, 400) }, 502); }
    if (!data.id) return json({ error: "Google did not return a job id", detail: text.slice(0, 400) }, 502);
    // If Google already finished synchronously, music-status handles it the same way.
    return json({ jobId: `lyria:${data.id}`, status: data.status || "queued" });
  }

  if (provider === "minimax") {
    const key = keyFor(req, "fal");
    if (!key) return json({ error: "No fal.ai key. Add one under Settings → API keys (or set FAL_KEY on the site)." }, 400);

    const resp = await fetch(FAL_QUEUE, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify({
        prompt: (style || "reverent cinematic worship ballad, warm vocals, piano and strings").slice(0, 300),
        lyrics_prompt: lyrics.trim().slice(0, 3000),
        audio_setting: { format: "mp3", sample_rate: 44100, bitrate: 256000 },
      }),
    });
    const text = await resp.text();
    if (!resp.ok) return json({ error: "fal.ai rejected the request", detail: text.slice(0, 800) }, resp.status);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "Unexpected reply from fal.ai", detail: text.slice(0, 400) }, 502); }
    if (!data.request_id) return json({ error: "fal.ai did not return a request id", detail: text.slice(0, 400) }, 502);
    return json({ jobId: `minimax:${encodeFalJob(data, FAL_QUEUE)}`, status: "queued" });
  }

  return json({ error: `Unknown music provider "${provider}"` }, 400);
};
