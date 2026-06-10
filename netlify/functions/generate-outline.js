// netlify/functions/generate-outline.js
// Returns ONLY the scene outline (list of beats), using the lyrics and the
// already-generated style bible for context. Kept small/fast.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { lyrics = "", styleBible = null, talkText = "", sceneBasis = "song" } = body;
  if (!lyrics.trim()) return json({ error: "Provide finalized lyrics." }, 400);

  const countRule = sceneBasis === "talk"
    ? [
        "- The TALK'S natural structure sets the count: one scene per distinct point,",
        "  story, or example in the talk, in the talk's order (commonly 8-20). Do NOT",
        "  cap the count at the number of lyric sections.",
        "- Then map each scene onto the lyric section it best lines up with; multiple",
        "  scenes may share a lyric section.",
      ]
    : [
        "- The SONG'S structure sets the count and order: one scene per distinct lyric",
        "  section (each verse, chorus, bridge), in song order.",
        "- For each lyric section, base the beat on the matching part of the TALK.",
      ];

  const system = [
    "You are a music-video director working from a General Conference TALK and a",
    "SONG adapted from it. Output ONLY a scene OUTLINE as raw JSON.",
    "",
    "HOW TO BUILD IT:",
    ...countRule,
    "- The TALK drives each scene's CONTENT (its teaching, story, example,",
    "  scripture) — NOT a literal reading of the lyric. The lyric sets placement.",
    "- Move through the talk's points in order so the video faithfully retells it.",
    "",
    "Output ONLY raw JSON. No code fences, no commentary. Schema:",
    "{",
    '  "outline": [',
    '    { "sceneNumber": number, "lyrics": string, "lyricSection": string, "beat": string }',
    "  ]",
    "}",
    "FIELD DEFINITIONS:",
    "- 'beat': a SHORT phrase (under 14 words) naming the moment, drawn from the",
    "  TALK's content for this part.",
    "- 'lyrics': the ACTUAL lyric words for the section this scene accompanies,",
    "  copied verbatim (real text, not a label).",
    "- 'lyricSection': a short LABEL (e.g. \"Chorus\" or \"Verse 2\").",
    "Number scenes sequentially from 1, in order.",
    "If no talk is provided, fall back to using the lyrics for content.",
  ].join("\n");

  const sbText = styleBible
    ? `STYLE (for tone): ${JSON.stringify(styleBible).slice(0, 600)}\n\n`
    : "";

  const userContent =
    sbText +
    (talkText.trim()
      ? `CONFERENCE TALK (PRIMARY SOURCE for content — follow closely):\n${talkText.slice(0, 12000)}\n\n`
      : "") +
    `SONG LYRICS (sets scene count & order — one per section):\n${lyrics}\n\n` +
    `Return ONLY the outline as raw JSON. One scene per lyric section; base each ` +
    `beat on the matching part of the talk; put the real lyric words in 'lyrics'.`;

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
      .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

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
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth >= 1) lastGood = i; }
  }
  let candidate = lastGood !== -1 ? s.slice(0, lastGood + 1) : s;
  candidate = candidate.replace(/,\s*$/, "");
  const st = []; let inS = false, e = false;
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
    status, headers: { "content-type": "application/json" },
  });
}
