// netlify/functions/generate-scene-detail.js
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

  const { styleBible = null, scene = null, styleReference = "" } = body;
  if (!styleBible || !scene) {
    return json({ error: "Provide styleBible and scene." }, 400);
  }

  const system = [
    "You are an art director for a reverent Latter-day Saint music video.",
    "Expand ONE scene into a vivid description and a single image-generation",
    "prompt. The prompt MUST restate the art style, color palette, lighting,",
    "and any characters present, so this frame matches the rest of the video.",
    "Imagery: reverent, uplifting, doctrinally appropriate, wholesome, no",
    "copyrighted characters, no irreverent depictions of Deity.",
    "",
    "Respond with STRICT JSON only — no markdown, no prose. Schema:",
    '{ "sceneNumber": number, "lyricSection": string,',
    '  "description": string, "imagePrompt": string }',
  ].join("\n");

  const userContent =
    (styleReference ? `Visual/genre direction: ${styleReference}\n` : "") +
    `STYLE BIBLE (reuse for consistency):\n${JSON.stringify(styleBible)}\n\n` +
    `SCENE TO EXPAND:\n${JSON.stringify(scene)}\n\n` +
    `Return STRICT JSON only for this one scene. Keep description to 2-3 ` +
    `sentences; make imagePrompt detailed and self-contained.`;

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
        max_tokens: 700,
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

    const parsed = tryParse(raw);
    if (!parsed) return json({ error: "Model did not return valid JSON", raw }, 502);
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
