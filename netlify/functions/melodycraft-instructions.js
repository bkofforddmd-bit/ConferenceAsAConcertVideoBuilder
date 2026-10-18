// netlify/functions/melodycraft-instructions.js
//
// Writes the text for MelodyCraft AI's "Instructions" field: about 450
// characters describing the SOUND to aim for (vocal timbre and delivery,
// instruments, production, tempo/feel, mood, dynamics), modelled on the artist
// chosen on the Lyrics step. Uses ChatGPT (OpenAI). The artist is never named
// in the result — AI music generators commonly reject real artists' names —
// the sound is described instead.
//
// Body: { request, artist?, profile?, title?, lyrics? }
// Returns: { text, chars, model }

import { keyFor, json, readJson } from "../lib/keys.js";

const URL_CHAT = "https://api.openai.com/v1/chat/completions";
const MODELS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"];
const LIMIT = 450;

// Trim to the limit at a sentence (or clause) end, never mid-word.
export function fitToLimit(text, limit = LIMIT) {
  let t = String(text || "").replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.endsWith(".") ? cut.length - 1 : -1);
  if (end > limit * 0.6) return cut.slice(0, end + 1).trim();
  const comma = cut.lastIndexOf(", ");
  if (comma > limit * 0.6) return cut.slice(0, comma).trim() + ".";
  return cut.slice(0, cut.lastIndexOf(" ")).trim() + ".";
}

// Remove the artist's name if the model slipped it in.
export function scrubName(text, artist) {
  const a = String(artist || "").trim();
  if (!a || a.length < 3) return text;
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text).replace(new RegExp(`\\b(in the style of |like |à la )?${esc}('s)?\\b`, "gi"), "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = keyFor(req, "openai");
  if (!apiKey) return json({ error: "No OpenAI key. Add one under Settings → API keys (or set OPENAI_API_KEY on the site)." }, 400);
  const body = (await readJson(req)) || {};
  const artist = String(body.artist || "").trim().slice(0, 120);
  const request = String(body.request || "").trim().slice(0, 600) || (artist ? `Write a 450 character description for MelodyCraft AI to elicit a similar sound to ${artist}` : "");
  if (!request) return json({ error: "Pick an artist (or say what sound you want) first." }, 400);
  const profile = String(body.profile || "").slice(0, 240);
  const title = String(body.title || "").slice(0, 160);
  const lyrics = String(body.lyrics || "").slice(0, 1500);

  const system = [
    "You write the text for the 'Instructions' field of MelodyCraft AI, an AI song generator.",
    `Write ONE paragraph of ${LIMIT - 50}–${LIMIT} characters (hard maximum ${LIMIT}, spaces included) describing the SOUND to aim for:`,
    "the lead vocal (gender, timbre, delivery, range, what to avoid), harmonies, instrumentation, production style, tempo and groove, energy and dynamics, and mood.",
    "Be concrete and sonic, like a producer's brief. Plain prose, no lists, no quotation marks, no hashtags, no emojis.",
    "NEVER name the artist, any band, song, album or real person — music generators reject names. Describe the sound instead.",
    "The song is a reverent, uplifting faith song drawn from a General Conference talk of The Church of Jesus Christ of Latter-day Saints; keep the description fitting for that.",
    "Return only the paragraph.",
  ].join(" ");
  const user = [
    request,
    artist ? `Selected artist (for your reference only — do not name them): ${artist}.` : "",
    profile ? `Their songwriting profile: ${profile}.` : "",
    title ? `Song title: ${title}.` : "",
    lyrics ? `Lyrics (for mood only):\n${lyrics}` : "",
  ].filter(Boolean).join("\n");

  let lastErr = "";
  for (const model of MODELS) {
    try {
      const payload = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_completion_tokens: model.startsWith("gpt-5") ? 2000 : 400 };
      if (model.startsWith("gpt-5")) payload.reasoning_effort = "low";
      const resp = await fetch(URL_CHAT, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        lastErr = (data.error && data.error.message) || `OpenAI error ${resp.status}`;
        if (resp.status === 404 || /model/i.test(lastErr)) continue; // try the next model
        return json({ error: lastErr }, 502);
      }
      const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!raw || !String(raw).trim()) { lastErr = "The model returned nothing."; continue; }
      const text = fitToLimit(scrubName(raw, artist));
      return json({ text, chars: text.length, model });
    } catch (e) { lastErr = String(e.message || e); }
  }
  return json({ error: lastErr || "Couldn't write the instructions." }, 502);
};
