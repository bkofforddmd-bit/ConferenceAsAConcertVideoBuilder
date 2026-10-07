// netlify/functions/generate-lyrics.js
//
// Generates or revises song lyrics from a General Conference talk using Claude.
// The ANTHROPIC_API_KEY stays server-side and is never exposed to the browser.

import { keyFor } from "../lib/keys.js";
import { splitParagraphs, sungLines, parseSourcesBlock } from "../lib/lyric-index.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = keyFor(req, "anthropic");
  if (!apiKey) {
    return json({ error: "No Anthropic key. Add one under Settings → API keys (or set ANTHROPIC_API_KEY on the site)." }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    talkText = "",
    styleReference = "",
    currentLyrics = "",
    revisionRequest = "",
  } = body;

  if (!talkText.trim() && !currentLyrics.trim()) {
    return json({ error: "Provide talkText (first draft) or currentLyrics (revision)." }, 400);
  }

  const isRevision = Boolean(currentLyrics.trim() && revisionRequest.trim());

  const system = [
    "You are a hymn and Christian-music lyricist who writes original song lyrics",
    "based on talks from General Conference of The Church of Jesus Christ of",
    "Latter-day Saints. Your lyrics must:",
    "- Faithfully teach the doctrines and principles taught in the talk.",
    "- Stay true to Latter-day Saint culture, scripture, and reverent tone.",
    "- Be ORIGINAL words. Do NOT copy sentences from the talk verbatim;",
    "  paraphrase and set the ideas to verse. Do NOT reproduce existing",
    "  copyrighted song lyrics or hymn text.",
    "- Use a clear song structure with labeled sections:",
    "  [Verse 1], [Chorus], [Verse 2], [Bridge], etc.",
    "- Be singable: consistent meter, natural rhyme where it serves the line.",
    "- LENGTH: keep the whole lyric under 1,500 characters (section labels not",
    "  counted) — roughly 20 to 26 short lines: two verses, a chorus sung twice,",
    "  and a bridge. This is the default; only go longer or shorter when the",
    "  request explicitly asks for a different length (e.g. \"longer\", \"about",
    "  2,500 characters\", \"three verses\").",
    "When a style reference is given, match its GENRE, mood, instrumentation feel,",
    "and energy — never imitate a specific artist's actual copyrighted lyrics or",
    "reproduce their songs. Treat the reference purely as a stylistic direction.",
    "",
    "SOURCE INDEX: when the talk is provided (its paragraphs are numbered [1], [2], …),",
    "finish with a line that reads exactly ===SOURCES=== followed by one line per SUNG",
    "lyric line — count only lines that are sung; skip [Section] labels and blank lines —",
    "numbered from 1 in order, in this form:",
    "  n: p | \"short exact phrase from that paragraph\"",
    "where p is the paragraph number the line draws on (two numbers separated by a",
    "comma when a line blends two paragraphs). Use  n: - |  for a line that is pure",
    "lyrical glue. Every sung line gets exactly one entry.",
  ].join("\n");

  const paras = splitParagraphs(talkText);
  const numberedTalk = paras.map((t, i) => `[${i + 1}] ${t}`).join("\n\n");

  let userContent;
  if (isRevision) {
    userContent =
      (paras.length ? `TALK (numbered paragraphs):\n${numberedTalk}\n\n` : "") +
      `Here are the current lyrics:\n\n${currentLyrics}\n\n` +
      (styleReference ? `Style direction: ${styleReference}\n\n` : "") +
      `Please revise them per this request:\n${revisionRequest}\n\n` +
      `Keep the result under 1,500 characters of lyric (labels not counted) unless the request above asks for a different length.\n\n` +
      (paras.length
        ? `Return the full revised lyrics with section labels, then the ===SOURCES=== block, nothing else.`
        : `Return ONLY the full revised lyrics with section labels, nothing else.`);
  } else {
    userContent =
      `Create original song lyrics that teach the principles of this General ` +
      `Conference talk, staying true to Latter-day Saint doctrine and culture.\n\n` +
      (styleReference
        ? `Match the genre/style/mood of: ${styleReference} ` +
          `(stylistic direction only — original words).\n\n`
        : "") +
      `TALK (numbered paragraphs):\n${numberedTalk || talkText}\n\n` +
      `Length: under 1,500 characters of lyric (labels not counted) unless the style direction above says otherwise.\n` +
      `Return the lyrics with clear section labels, then the ===SOURCES=== block, nothing else.`;
  }

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "Anthropic API error", detail }, resp.status);
    }

    const data = await resp.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const { lyrics, map } = parseSourcesBlock(text, paras.length);
    // The index rides along with the lyrics: which talk paragraph each sung
    // line came from (keyed by the line's text, so later hand edits still match).
    const sources = map && paras.length
      ? { lines: sungLines(lyrics), map, paragraphCount: paras.length, model: MODEL, at: Date.now(), from: isRevision ? "revision" : "generation" }
      : null;

    return json({ lyrics, sources });
  } catch (err) {
    return json({ error: "Request failed", detail: String(err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
