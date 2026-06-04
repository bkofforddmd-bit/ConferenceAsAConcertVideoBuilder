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
    "OUTLINE only (no detailed prompts yet). Maximum 6 scenes.",
    "Keep EACH style-bible field to one short sentence, and each character",
    "description to one short sentence, so the whole JSON stays compact and",
    "complete. Each 'beat' is a single sentence.",
    "Imagery: reverent, uplifting, doctrinally appropriate, wholesome, no",
    "copyrighted characters, no irreverent depictions of Deity.",
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
  ].join("\n");

  const userContent =
    (styleReference ? `Visual/genre direction: ${styleReference}\n` : "") +
    `Lyrics:\n${lyrics}\n\n` +
    `Return ONLY raw JSON (no code fences). Max 6 scenes. Keep every field to ` +
    `one short sentence so the JSON is complete.`;

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
