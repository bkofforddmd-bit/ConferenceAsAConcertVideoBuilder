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

  const {
    styleBible = null,
    scene = null,
    styleReference = "",
    revisionNotes = "",
    prevScene = null,
    nextScene = null,
    talkText = "",
  } = body;
  if (!styleBible || !scene) {
    return json({ error: "Provide styleBible and scene." }, 400);
  }

  const system = [
    "You are an art director for a reverent Latter-day Saint music video.",
    "Expand ONE scene into a vivid description and a single image-generation",
    "prompt. The prompt MUST restate the art style, color palette, lighting,",
    "and any characters present, so this frame matches the rest of the video.",
    "Base the scene's CONTENT on what the conference talk actually conveys for",
    "this beat (its teaching, story, example, scripture) — the lyric only marks",
    "where it sits in the song. Stay faithful to the talk's substance.",
    "Imagery: reverent, uplifting, doctrinally appropriate, wholesome, no",
    "copyrighted characters. Tasteful, reverent depictions of Jesus Christ",
    "the Savior are welcome and encouraged where fitting. Do NOT depict",
    "God the Father; suggest His presence only indirectly (light, etc.).",
    revisionNotes
      ? "You are REVISING this scene per the director's notes. Honor the notes, " +
        "keep the same lyric section, and make sure this scene is distinct from " +
        "its neighbors and clearly moves the story forward (avoid redundancy)."
      : "",
    "",
    "Output ONLY raw JSON. No code fences, no commentary. Schema:",
    '{ "sceneNumber": number, "lyricSection": string,',
    '  "description": string, "imagePrompt": string }',
  ].filter(Boolean).join("\n");

  const neighborContext =
    (prevScene ? `PREVIOUS SCENE (for flow, do not duplicate): ${JSON.stringify(prevScene)}\n` : "") +
    (nextScene ? `NEXT SCENE (for flow, do not duplicate): ${JSON.stringify(nextScene)}\n` : "");

  const userContent =
    (styleReference ? `Visual/genre direction: ${styleReference}\n` : "") +
    (talkText.trim()
      ? `CONFERENCE TALK (content source for this scene):\n${talkText.slice(0, 8000)}\n\n`
      : "") +
    `STYLE BIBLE (reuse for consistency):\n${JSON.stringify(styleBible)}\n\n` +
    neighborContext +
    `SCENE TO ${revisionNotes ? "REVISE" : "EXPAND"}:\n${JSON.stringify(scene)}\n\n` +
    (revisionNotes ? `DIRECTOR'S REVISION NOTES:\n${revisionNotes}\n\n` : "") +
    `Return ONLY raw JSON for this one scene. Keep description to 2-3 ` +
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
        max_tokens: 1200,
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
