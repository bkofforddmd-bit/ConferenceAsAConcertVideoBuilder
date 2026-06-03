// netlify/functions/generate-lyrics.js
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    talkText = "",
    styleReference = "",
    currentLyrics = "",
    revisionRequest = "",
  } = body;

  if (!talkText.trim() && !currentLyrics.trim()) {
    return json({ error: "Provide talkText (first draft) or currentLyrics (revision)." }, 400);
  }

  const isRevision = Boolean(currentLyrics.trim() && revisionRequest.trim());

  const system = [
    "You are a hymn and Christian-music lyricist who writes original song lyrics",
    "based on talks from General Conference of The Church of Jesus Christ of",
    "Latter-day Saints. Your lyrics must:",
    "- Faithfully teach the doctrines and principles taught in the talk.",
    "- Stay true to Latter-day Saint culture, scripture, and reverent tone.",
    "- Be ORIGINAL words. Do NOT copy sentences from the talk verbatim;",
    "  paraphrase and set the ideas to verse. Do NOT reproduce existing",
    "  copyrighted song lyrics or hymn text.",
    "- Use a clear song structure with labeled sections:",
    "  [Verse 1], [Chorus], [Verse 2], [Bridge], etc.",
    "- Be singable: consistent meter, natural rhyme where it serves the line.",
    "When a style reference is given, match its GENRE, mood, instrumentation feel,",
    "and energy — never imitate a specific artist's actual copyrighted lyrics or",
    "reproduce their songs. Treat the reference purely as a stylistic direction.",
  ].join("\n");

  let userContent;
  if (isRevision) {
    userContent =
      `Here are the current lyrics:\n\n${currentLyrics}\n\n` +
      (styleReference ? `Style direction: ${styleReference}\n\n` : "") +
      `Please revise them per this request:\n${revisionRequest}\n\n` +
      `Return ONLY the full revised lyrics with section labels, nothing else.`;
  } else {
    userContent =
      `Create original song lyrics that teach the principles of this General ` +
      `Conference talk, staying true to Latter-day Saint doctrine and culture.\n\n` +
      (styleReference
        ? `Match the genre/style/mood of: ${styleReference} ` +
          `(stylistic direction only — original words).\n\n`
        : "") +
      `TALK:\n${talkText}\n\n` +
      `Return ONLY the lyrics with clear section labels, nothing else.`;
  }

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
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "Anthropic API error", detail }, resp.status);
    }

    const data = await resp.json();
    const lyrics = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return json({ lyrics });
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
