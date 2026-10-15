// netlify/functions/melodycraft-suggest.js
//
// "Sound like …" → MelodyCraft settings. Given a reference song or artist
// (plus the lyrics and talk, for context), asks Claude for three genre + mood
// combinations drawn ONLY from MelodyCraft's own vocabulary, ranked by how
// close they should land to the reference. Anything not in the list is
// dropped server-side, so the picker never shows a tag MelodyCraft can't take.
//
// Body: { reference, lyrics?, talkTitle?, moodHint? }
// Returns: { combos: [{ genres: [..], moods: [..], why, confidence }], model }

import { keyFor, json, readJson } from "../lib/keys.js";
import { MELODYCRAFT_GENRES, MELODYCRAFT_MOODS, canonGenre, canonMood } from "../lib/melodycraft-tags.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = keyFor(req, "anthropic");
  if (!apiKey) return json({ error: "No Anthropic key. Add one under Settings → API keys (or set ANTHROPIC_API_KEY on the site)." }, 400);
  const body = (await readJson(req)) || {};
  const reference = String(body.reference || "").trim().slice(0, 200);
  if (!reference) return json({ error: "Tell me a song or artist to sound like." }, 400);
  const lyrics = String(body.lyrics || "").slice(0, 4000);
  const talkTitle = String(body.talkTitle || "").slice(0, 200);
  const moodHint = String(body.moodHint || "").slice(0, 100);

  const system =
    "You are a music producer who knows the MelodyCraft AI song generator. MelodyCraft only understands the genre and mood tags " +
    "listed below, and any combination of them can be selected. Your job: translate a reference song or artist into the MelodyCraft " +
    "combination most likely to produce a similar sound — instrumentation, tempo feel, vocal delivery, era, energy. Use ONLY tags from the lists, " +
    "spelled exactly as given. Prefer specific compound genres from the list over generic ones when they fit (e.g. 'worship', 'praise', 'gospel', " +
    "'piano country', 'folk', 'soulful folk', 'dream pop', 'orchestral' are all real tags). Each combination: 1–3 genres and 1–3 moods. " +
    "These songs set General Conference talks to music for a faith audience, so avoid tags that would clash with that (no 'Dark', 'Depressive', " +
    "'Weird', 'death metal', 'thrash metal', 'dirty south', 'crunk' unless the reference itself is in that lane).\n\n" +
    `GENRES:\n${MELODYCRAFT_GENRES.join(", ")}\n\nMOODS:\n${MELODYCRAFT_MOODS.join(", ")}\n\n` +
    "Answer with JSON only, no prose, in this shape:\n" +
    '{"combos":[{"genres":["…"],"moods":["…"],"why":"one short sentence on why this lands close to the reference","confidence":0.0}, … exactly 3 combos, best first]}';

  const user =
    `Reference to sound like: ${reference}\n` +
    (moodHint ? `The student picked this mood: ${moodHint}\n` : "") +
    (talkTitle ? `The song is based on the talk "${talkTitle}".\n` : "") +
    (lyrics ? `Lyrics (for the feel, section labels included):\n${lyrics}\n` : "") +
    "Give the 3 best MelodyCraft combinations.";

  let text = "";
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: user }] }),
    });
    if (!resp.ok) return json({ error: "Anthropic API error", detail: (await resp.text()).slice(0, 300) }, resp.status);
    const data = await resp.json();
    text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } catch (e) {
    return json({ error: "Couldn't reach the AI service.", detail: String(e).slice(0, 200) }, 502);
  }

  let parsed = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return json({ error: "The AI answer couldn't be read — try again." }, 502);
  }
  const combos = (Array.isArray(parsed.combos) ? parsed.combos : [])
    .map((c) => ({
      genres: [...new Set((Array.isArray(c.genres) ? c.genres : []).map(canonGenre).filter(Boolean))].slice(0, 3),
      moods: [...new Set((Array.isArray(c.moods) ? c.moods : []).map(canonMood).filter(Boolean))].slice(0, 3),
      why: String(c.why || "").slice(0, 240),
      confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)),
    }))
    .filter((c) => c.genres.length && c.moods.length)
    .slice(0, 3);
  if (!combos.length) return json({ error: "No usable combination came back — try a different reference." }, 502);
  return json({ combos, model: MODEL, reference });
};
