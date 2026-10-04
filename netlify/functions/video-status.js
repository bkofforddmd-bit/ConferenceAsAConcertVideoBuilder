// netlify/functions/video-status.js
//
// Polls a clip job from video-start.js. Uniform reply:
//   { status: "queued" | "running" | "completed" | "failed", videoUrl?, error? }
// The browser then downloads videoUrl (through fetch-media.js, which adds the
// Google key for Veo downloads and sidesteps missing CORS headers).

import { keyFor, json, readJson } from "../lib/keys.js";

const FAL_KLING = "https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  const jobId = String((body && body.jobId) || "");
  const sep = jobId.indexOf(":");
  if (sep === -1) return json({ error: "Bad job id" }, 400);
  const provider = jobId.slice(0, sep);
  const id = jobId.slice(sep + 1);

  if (provider === "fal-kling") {
    const key = keyFor(req, "fal");
    if (!key) return json({ error: "No fal.ai key." }, 400);
    const sresp = await fetch(`${FAL_KLING}/requests/${encodeURIComponent(id)}/status`, { headers: { Authorization: `Key ${key}` } });
    const stext = await sresp.text();
    if (!sresp.ok) return json({ status: "failed", error: `fal.ai returned ${sresp.status}`, detail: stext.slice(0, 400) });
    let sdata;
    try { sdata = JSON.parse(stext); } catch { return json({ status: "failed", error: "Unexpected reply from fal.ai" }); }
    const st = String(sdata.status || "").toUpperCase();
    if (st === "IN_QUEUE") return json({ status: "queued", position: sdata.queue_position });
    if (st === "IN_PROGRESS") return json({ status: "running" });
    if (st !== "COMPLETED") return json({ status: "failed", error: `fal.ai reported ${st || "unknown"}` });
    const rresp = await fetch(`${FAL_KLING}/requests/${encodeURIComponent(id)}`, { headers: { Authorization: `Key ${key}` } });
    const rtext = await rresp.text();
    if (!rresp.ok) return json({ status: "failed", error: `fal.ai result returned ${rresp.status}`, detail: rtext.slice(0, 400) });
    let rdata;
    try { rdata = JSON.parse(rtext); } catch { return json({ status: "failed", error: "Unexpected result from fal.ai" }); }
    const url = rdata?.video?.url || "";
    if (!url) return json({ status: "failed", error: "fal.ai finished but returned no video", detail: rtext.slice(0, 400) });
    return json({ status: "completed", videoUrl: url, mimeType: rdata?.video?.content_type || "video/mp4" });
  }

  if (provider === "veo") {
    const key = keyFor(req, "gemini");
    if (!key) return json({ error: "No Google Gemini key." }, 400);
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${id}`, { headers: { "x-goog-api-key": key } });
    const text = await resp.text();
    if (!resp.ok) return json({ status: "failed", error: `Google returned ${resp.status}`, detail: text.slice(0, 400) });
    let data;
    try { data = JSON.parse(text); } catch { return json({ status: "failed", error: "Unexpected reply from Google" }); }
    if (!data.done) return json({ status: "running" });
    if (data.error) return json({ status: "failed", error: data.error.message || "Google reported an error", detail: JSON.stringify(data.error).slice(0, 400) });
    const samples = data?.response?.generateVideoResponse?.generatedSamples || [];
    const uri = samples[0]?.video?.uri || "";
    if (!uri) {
      const filtered = data?.response?.generateVideoResponse?.raiMediaFilteredReasons;
      return json({ status: "failed", error: filtered ? `Google's safety filter blocked this clip: ${JSON.stringify(filtered).slice(0, 300)}` : "Google finished but returned no video", detail: text.slice(0, 400) });
    }
    return json({ status: "completed", videoUrl: uri, mimeType: "video/mp4" });
  }

  return json({ error: `Unknown provider "${provider}"` }, 400);
};
