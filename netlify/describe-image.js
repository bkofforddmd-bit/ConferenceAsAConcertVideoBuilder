// netlify/functions/describe-image.js
// Uses Claude vision to produce a short description of an uploaded image,
// so it can be matched to the best-fitting scene/lyric.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  // imageDataUrl: "data:image/png;base64,...."
  const { imageDataUrl = "" } = body;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageDataUrl || "");
  if (!m) return json({ error: "Provide a base64 image data URL." }, 400);
  const mediaType = m[1];
  const b64 = m[2];

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
        max_tokens: 200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text:
              "Describe this image in one or two concise sentences for matching " +
              "it to song lyrics: name the main subject(s), setting, mood, and any " +
              "notable action. Be specific and literal." },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "Anthropic API error", detail }, resp.status);
    }
    const data = await resp.json();
    const description = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    return json({ description });
  } catch (err) {
    return json({ error: "Request failed", detail: String(err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json" },
  });
}
