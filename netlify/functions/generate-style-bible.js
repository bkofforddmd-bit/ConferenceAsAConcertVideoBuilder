// netlify/functions/generate-style-bible.js
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

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
    "You are an art director for a reverent Latter-day Saint music video.",
    "Given song lyrics, output a compact STYLE BIBLE and a lightweight scene",
    "OUTLINE only (no detailed prompts yet). Keep it short. Maximum 6 scenes.",
    "Imagery: reverent, uplifting, doctrinally appropriate, wholesome, no",
    "copyrighted characters, no irreverent depictions of Deity.",
    "",
    "Respond with STRICT JSON only — no markdown, no prose. Schema:",
    "{",
    '  "styleBible": {',
    '    "artStyle": string,',
    '    "colorPalette": string,',
    '    "lighting": string,',
    '    "characters": [ { "name": string, "description": string } ],',
    '    "recurringMotifs": string',
    "  },",
    '  "outline": [',
    '    { "sceneNumber": number, "lyricSection": string, "beat": string }',
    "  ]",
    "}",
    "Each 'beat' is a one-line summary of what that scene shows.",
  ].join("\n");

  const userContent =
    (styleReference ? `Visual/genre direction: ${styleReference}\n` : "") +
    `Lyrics:\n${lyrics}\n\n` +
    `Return STRICT JSON only. Max 6 scenes. Be concise.`;

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
        max_tokens: 900,
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
