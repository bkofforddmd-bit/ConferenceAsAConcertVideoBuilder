// netlify/functions/generate-scenes.js
//
// Takes finalized lyrics and produces:
//   1. A "style bible" (characters, palette, art style, recurring motifs)
//      that every scene shares — this is the key to visual consistency.
//   2. An ordered list of scenes, each with a ready-to-use image prompt
//      that embeds the style bible so generated frames stay coherent.
//
// Uses Claude with a strict JSON-only response for reliable parsing.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { lyrics = "", styleReference = "" } = body;
  if (!lyrics.trim()) return json({ error: "Provide finalized lyrics." }, 400);

  const system = [
    "You are an art director and storyboard planner for a reverent Latter-day",
    "Saint music video. You receive finalized song lyrics and design a visual",
    "story. Consistency across frames is critical, so you first define a STYLE",
    "BIBLE that every scene must reuse verbatim, then break the song into scenes.",
    "",
    "Imagery guidelines: reverent, uplifting, doctrinally appropriate; avoid",
    "depicting Deity in irreverent ways; no copyrighted characters; wholesome",
    "and family-appropriate.",
    "",
    "Respond with STRICT JSON only — no markdown, no commentary. Schema:",
    "{",
    '  "styleBible": {',
    '    "artStyle": string,        // e.g. "warm painterly realism"',
    '    "colorPalette": string,    // named colors / mood',
    '    "lighting": string,',
    '    "characters": [ { "name": string, "description": string } ],',
    '    "recurringMotifs": string',
    "  },",
    '  "scenes": [',
    "    {",
    '      "sceneNumber": number,',
    '      "lyricSection": string,   // which lyric lines this illustrates',
    '      "description": string,    // what happens on screen',
    '      "imagePrompt": string     // full prompt EMBEDDING the style bible',
    "    }",
    "  ]",
    "}",
    "",
    "Every imagePrompt MUST restate the art style, palette, lighting, and any",
    "characters present so each frame is renderable independently yet consistent.",
  ].join("\n");

  const userContent =
    (styleReference ? `Overall visual/genre direction: ${styleReference}\n\n` : "") +
    `Design the style bible and scenes for these lyrics:\n\n${lyrics}\n\n` +
    `Aim for one scene per major lyric section. Return STRICT JSON only.`;

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
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "Anthropic API error", detail }, resp.status);
    }

    const data = await resp.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "Model did not return valid JSON", raw }, 502);
    }

    return json(parsed);
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
