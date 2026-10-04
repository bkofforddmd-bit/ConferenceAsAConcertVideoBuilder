// netlify/functions/video-start.js
//
// Turns one storyboard still into a short video clip (image-to-video) and
// returns a job id for video-status.js to poll. Clip generation takes
// 30 s – several minutes, so each provider runs asynchronously:
//
//   fal-kling → fal.ai queue, Kling 3.0 Pro image-to-video (start + optional
//               end frame, so the next scene's first frame can chain on)
//   veo       → Google Gemini, Veo 3.1 Fast predictLongRunning (image +
//               optional lastFrame; 1080p clips are always 8 seconds)
//
// Images arrive as data URLs (base64 PNG/JPEG) straight from the storyboard.

import { keyFor, json, readJson } from "../lib/keys.js";

const FAL_KLING = "https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video";
const VEO_MODEL = "veo-3.1-fast-generate-preview";

function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  const {
    provider = "fal-kling",
    prompt = "",
    startImage = "",   // data URL
    endImage = "",     // optional data URL (next scene's first frame)
    duration = 5,      // seconds (Kling 3–15; Veo 4/6/8, 8 at 1080p)
    negativePrompt = "blur, distortion, low quality, text, watermark, extra limbs, deformed hands",
  } = body;

  if (!startImage) return json({ error: "Provide startImage (data URL)." }, 400);
  const motion = (prompt || "").trim() || "Slow, gentle cinematic camera movement; subtle natural motion; keep the composition and characters exactly as in the image.";

  if (provider === "fal-kling") {
    const key = keyFor(req, "fal");
    if (!key) return json({ error: "No fal.ai key. Add one under Settings → API keys (or set FAL_KEY on the site)." }, 400);
    const payload = {
      prompt: motion.slice(0, 2500),
      start_image_url: startImage,
      duration: String(Math.min(15, Math.max(3, Math.round(Number(duration) || 5)))),
      generate_audio: false,
      negative_prompt: negativePrompt,
      cfg_scale: 0.5,
    };
    if (endImage) payload.end_image_url = endImage;
    const resp = await fetch(FAL_KLING, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    if (!resp.ok) return json({ error: "fal.ai rejected the clip request", detail: text.slice(0, 800) }, resp.status);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "Unexpected reply from fal.ai", detail: text.slice(0, 400) }, 502); }
    if (!data.request_id) return json({ error: "fal.ai did not return a request id", detail: text.slice(0, 400) }, 502);
    return json({ jobId: `fal-kling:${data.request_id}`, status: "queued" });
  }

  if (provider === "veo") {
    const key = keyFor(req, "gemini");
    if (!key) return json({ error: "No Google Gemini key. Add one under Settings → API keys (or set GEMINI_API_KEY on the site)." }, 400);
    const first = splitDataUrl(startImage);
    if (!first) return json({ error: "startImage must be a base64 data URL." }, 400);
    const instance = {
      prompt: motion,
      image: { inlineData: { mimeType: first.mime, data: first.data } },
    };
    const last = endImage ? splitDataUrl(endImage) : null;
    if (last) instance.lastFrame = { inlineData: { mimeType: last.mime, data: last.data } };
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          instances: [instance],
          parameters: {
            aspectRatio: "16:9",
            resolution: "1080p",
            durationSeconds: "8",
            personGeneration: "allow_adult",
            negativePrompt,
          },
        }),
      }
    );
    const text = await resp.text();
    if (!resp.ok) return json({ error: "Google Veo rejected the clip request", detail: text.slice(0, 800) }, resp.status);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "Unexpected reply from Google", detail: text.slice(0, 400) }, 502); }
    if (!data.name) return json({ error: "Google did not return an operation name", detail: text.slice(0, 400) }, 502);
    return json({ jobId: `veo:${data.name}`, status: "queued" });
  }

  return json({ error: `Unknown video provider "${provider}"` }, 400);
};
