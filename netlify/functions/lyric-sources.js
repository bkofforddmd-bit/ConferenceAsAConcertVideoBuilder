// netlify/functions/lyric-sources.js
//
// Trace each lyric line back to the talk: which paragraph(s) it was drawn
// from, and the phrase in the talk it echoes. Lets the Video step jump the
// talk's video to the moment behind a favourite line. One quick call per song.

import { keyFor as serviceKey } from "../lib/keys.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = serviceKey(req, "anthropic");
  if (!apiKey) return json({ error: "No Anthropic key. Add one under Settings → API keys (or set ANTHROPIC_API_KEY on the site)." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const lines = (Array.isArray(body.lines) ? body.lines : []).map((s) => String(s || "").trim()).filter(Boolean).slice(0, 80);
  const paragraphs = (Array.isArray(body.paragraphs) ? body.paragraphs : []).map((s) => String(s || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 200);
  if (lines.length < 1 || paragraphs.length < 1) return json({ error: "Need lyric lines and talk paragraphs." }, 400);

  const talk = paragraphs.map((p, i) => `[${i + 1}] ${p.length > 900 ? p.slice(0, 900) + "…" : p}`).join("\n\n");
  const lyr = lines.map((l, i) => `(${i + 1}) ${l}`).join("\n");

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: "disabled" },
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                lines: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      line: { type: "integer", description: "1-based lyric line number" },
                      paragraphs: { type: "array", items: { type: "integer" }, description: "1-based talk paragraph numbers this line draws on, best first (empty if the line is purely lyrical glue)" },
                      phrase: { type: "string", description: "the exact words from the best paragraph the line echoes (short; empty if none)" },
                      confidence: { type: "number", description: "0-1" },
                    },
                    required: ["line", "paragraphs", "phrase", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["lines"],
              additionalProperties: false,
            },
          },
        },
        system:
          "You trace song lyrics back to the General Conference talk they were adapted from. " +
          "For each lyric line, name the talk paragraph(s) whose idea, image, scripture or wording it echoes. " +
          "Prefer the paragraph with the closest wording; include a second paragraph only when the line clearly blends two. " +
          "Quote the exact phrase from the talk it echoes. Chorus lines usually trace to the talk's central thesis. " +
          "Do not include internal or system XML tags in your response.",
        messages: [{ role: "user", content: `TALK PARAGRAPHS:\n${talk}\n\nLYRIC LINES:\n${lyr}` }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Claude responded ${res.status}`);
    if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
    const parsed = JSON.parse((data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""));
    const map = {};
    for (const it of parsed.lines || []) {
      const i = Number(it.line) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= lines.length) continue;
      const ps = (it.paragraphs || []).map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < paragraphs.length);
      map[i] = { paragraphs: ps, phrase: String(it.phrase || "").slice(0, 200), confidence: Math.max(0, Math.min(1, Number(it.confidence) || 0)) };
    }
    return json({ map, model: MODEL });
  } catch (e) {
    return json({ error: "Couldn't trace the lyrics to the talk.", detail: String(e.message) }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
