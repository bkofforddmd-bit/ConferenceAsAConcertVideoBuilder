// netlify/functions/extract-meta.js
// Best-effort extraction of song title + talk attribution from the talk text
// and finalized lyrics. Returns fields the user can edit. Never fails hard —
// returns blanks for anything it can't find.

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

  const { talkText = "", lyrics = "" } = body;

  const system = [
    "Extract attribution metadata for a Latter-day Saint conference talk and",
    "a song adapted from it. Use only what is clearly present; if something is",
    "not stated, return an empty string for that field. Do not invent names,",
    "dates, or sessions. Suggest a short, evocative song title based on the",
    "lyrics/talk themes if lyrics are provided.",
    "",
    "Output ONLY raw JSON. No code fences. Schema:",
    "{",
    '  "songTitle": string,',
    '  "speaker": string,',
    '  "conferenceMonthYear": string,',
    '  "session": string',
    "}",
  ].join("\n");

  const userContent =
    `TALK (may include a byline/title):\n${talkText.slice(0, 6000)}\n\n` +
    (lyrics ? `LYRICS (for title inspiration):\n${lyrics.slice(0, 2000)}\n\n` : "") +
    `Return ONLY raw JSON. Empty strings for anything not clearly present.`;

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
        max_tokens: 400,
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

    let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const f = s.indexOf("{"), l = s.lastIndexOf("}");
    if (f !== -1 && l !== -1) s = s.slice(f, l + 1);
    let parsed;
    try { parsed = JSON.parse(s); } catch { parsed = {}; }

    return json({
      songTitle: parsed.songTitle || "",
      speaker: parsed.speaker || "",
      conferenceMonthYear: parsed.conferenceMonthYear || "",
      session: parsed.session || "",
    });
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
