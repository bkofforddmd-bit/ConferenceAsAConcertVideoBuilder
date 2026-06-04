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

  const { lyrics = "", styleReference = "", talkText = "" } = body;
  if (!lyrics.trim()) return json({ error: "Provide finalized lyrics." }, 400);

  const system = [
    "You are an art director for a reverent Latter-day Saint music video.",
    "Given song lyrics, output a compact STYLE BIBLE and a scene OUTLINE.",
    "Let the SONG decide how many scenes there are: create one scene for each",
    "distinct moment, image, or shift in the lyrics. Most songs land between 6",
    "and 14 scenes — use as many as the story genuinely needs, no artificial cap.",
    "To keep the JSON complete, keep EACH style-bible field to one short",
    "sentence, each character description to one short sentence, and each scene",
    "'beat' to a single concise sentence.",
    "Imagery: reverent, uplifting, doctrinally appropriate, wholesome, no",
    "copyrighted characters. Tasteful, reverent depictions of Jesus Christ",
    "the Savior are welcome and encouraged where fitting. Do NOT depict",
    "God the Father; suggest His presence only indirectly (light, etc.).",
    "",
    "Output ONLY raw JSON. No code fences, no commentary. Schema:",
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
    "Number scenes sequentially starting at 1.",
  ].join("\n");

  const userContent =
    (styleReference ? `Visual/genre direction: ${styleReference}\n\n` : "") +
    `PRIMARY SOURCE — the SONG LYRICS drive the scene structure (one scene per ` +
    `distinct lyrical moment):\n${lyrics}\n\n` +
    (talkText.trim()
      ? `SUPPORTING CONTEXT — the original General Conference talk the song was ` +
        `adapted from. Use it to ground the imagery in accurate doctrine, ` +
        `specific people/places/scriptures, and concrete details that enrich the ` +
        `scenes — but do NOT add scenes for talk content that isn't in the song:\n` +
        `${talkText.slice(0, 8000)}\n\n`
      : "") +
    `Return ONLY raw JSON (no code fences). Create as many scenes as the song ` +
    `needs (one per distinct lyrical moment). Keep every field to one short ` +
    `sentence so the JSON stays complete.`;

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
        max_tokens: 5000,
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

    const parsed = salvageJSON(raw);
    if (!parsed) return json({ error: "Model did not return valid JSON", raw }, 502);
    return json(parsed);
  } catch (err) {
    return json({ error: "Request failed", detail: String(err) }, 500);
  }
};

function salvageJSON(raw) {
  let s = String(raw).trim();
  s = s.replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = s.indexOf("{");
  if (first > 0) s = s.slice(first);

  try { return JSON.parse(s); } catch {}

  let depth = 0, inStr = false, esc = false, lastGood = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth >= 1) lastGood = i; }
  }

  let candidate = lastGood !== -1 ? s.slice(0, lastGood + 1) : s;
  candidate = candidate.replace(/,\s*$/, "");

  const st = [];
  let inS = false, e = false;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (inS) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') inS = false; continue; }
    if (c === '"') { inS = true; continue; }
    if (c === "{") st.push("}");
    else if (c === "[") st.push("]");
    else if (c === "}" || c === "]") st.pop();
  }
  while (st.length) candidate += st.pop();

  try { return JSON.parse(candidate); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
