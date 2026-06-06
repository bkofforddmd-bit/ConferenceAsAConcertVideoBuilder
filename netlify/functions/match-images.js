// netlify/functions/match-images.js
// Given the scene outline (with lyric sections + descriptions) and a list of
// described images, return the best image index for each scene.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { scenes = [], images = [] } = body;
  if (!scenes.length || !images.length) {
    return json({ error: "Provide scenes and images." }, 400);
  }

  const sceneList = scenes.map((s) =>
    `Scene ${s.sceneNumber}: [lyric] ${s.lyricSection || ""} [visual] ${s.description || ""}`
  ).join("\n");
  const imageList = images.map((d, i) => `Image ${i}: ${d}`).join("\n");

  const system = [
    "You match pre-made images to song-video scenes. Each scene has lyric text",
    "and a visual description. Each image has a description. Assign the BEST",
    "image to each scene by meaning and imagery. Each image may be used at most",
    "once. If no image fits a scene well, use null for that scene.",
    "",
    "Output ONLY raw JSON. No code fences. Schema:",
    "{ \"assignments\": [ { \"sceneNumber\": number, \"imageIndex\": number|null } ] }",
  ].join("\n");

  const userContent =
    `SCENES:\n${sceneList}\n\nIMAGES:\n${imageList}\n\n` +
    `Return ONLY raw JSON assigning the best image to each scene. Each image ` +
    `index used at most once; null if nothing fits.`;

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
        max_tokens: 1500,
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
    let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const f = s.indexOf("{"), l = s.lastIndexOf("}");
    if (f !== -1 && l !== -1) s = s.slice(f, l + 1);
    let parsed;
    try { parsed = JSON.parse(s); } catch { parsed = { assignments: [] }; }
    return json({ assignments: parsed.assignments || [] });
  } catch (err) {
    return json({ error: "Request failed", detail: String(err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json" },
  });
}
