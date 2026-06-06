// netlify/functions/outline-from-images.js
// Retrofit a scene outline from finalized lyrics + described images.
// One scene PER image. AI decides best order and which lyric lines pair with
// each image, following the song's natural progression.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { lyrics = "", images = [] } = body; // images: array of descriptions
  if (!lyrics.trim()) return json({ error: "Provide finalized lyrics." }, 400);
  if (!images.length) return json({ error: "Provide image descriptions." }, 400);

  const imageList = images.map((d, i) => `Image ${i}: ${d}`).join("\n");

  const system = [
    "You build a music-video scene outline by fitting already-finished images",
    "onto FINALIZED lyrics. The LYRICS ARE THE FIXED BACKBONE.",
    "RULES:",
    "- The lyrics stay in their original order, start to finish. NEVER reorder",
    "  the lyrics. The video follows the song top to bottom.",
    "- Walk the lyrics in order. For each image, determine which lyric line(s)",
    "  it best illustrates, and place it there.",
    "- Create EXACTLY one scene per image (same count as images).",
    "- Order the scenes to follow the lyric order: a scene whose lyric line",
    "  comes earlier in the song must have a lower sceneNumber. Scenes are",
    "  sequenced by where their lyric falls in the song, NOT by image order.",
    "- Assign each scene the actual lyric line(s) it covers, in song order, so",
    "  that reading the scenes top to bottom reproduces the lyrics in order with",
    "  no lines out of sequence.",
    "- 'imageIndex' MUST reference the original image numbers; each used once.",
    "",
    "Output ONLY raw JSON. No code fences. Schema:",
    "{",
    '  "outline": [',
    '    { "sceneNumber": number, "imageIndex": number, "lyricSection": string, "beat": string }',
    "  ]",
    "}",
    "sceneNumber is sequential from 1 following the lyric order. 'lyricSection'",
    "is the actual lyric text (in song order) for that scene. 'beat' is a short",
    "phrase naming the moment.",
  ].join("\n");

  const userContent =
    `FINALIZED LYRICS (fixed order — do not rearrange):\n${lyrics}\n\n` +
    `IMAGES (by index):\n${imageList}\n\n` +
    `Return ONLY raw JSON. Keep the lyrics in order; place each image at the ` +
    `lyric line(s) it best illustrates; one scene per image; scenes sequenced ` +
    `by lyric order.`;

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
        max_tokens: 2500,
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
    if (!parsed || !parsed.outline) return json({ error: "Model did not return valid JSON", raw }, 502);
    return json({ outline: parsed.outline });
  } catch (err) {
    return json({ error: "Request failed", detail: String(err) }, 500);
  }
};

function salvageJSON(raw) {
  let s = String(raw).trim().replace(/```json/gi, "").replace(/```/g, "").trim();
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
