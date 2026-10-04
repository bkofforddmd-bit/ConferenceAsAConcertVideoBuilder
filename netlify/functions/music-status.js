// netlify/functions/music-status.js
//
// Polls a song job started by music-start.js. Returns a uniform shape:
//   { status: "queued" | "running" | "completed" | "failed",
//     audioDataUrl?, audioUrl?, mimeType?, lyrics?, error? }
//
// Lyria returns the audio as base64 inside the interaction; fal returns a
// CDN URL (the browser fetches it, via fetch-media.js if CORS gets in the way).

import { keyFor, json, readJson } from "../lib/keys.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const FAL_QUEUE = "https://queue.fal.run/fal-ai/minimax-music/v2";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  const jobId = String((body && body.jobId) || "");
  const sep = jobId.indexOf(":");
  if (sep === -1) return json({ error: "Bad job id" }, 400);
  const provider = jobId.slice(0, sep);
  const id = jobId.slice(sep + 1);

  if (provider === "lyria") {
    const key = keyFor(req, "gemini");
    if (!key) return json({ error: "No Google Gemini key." }, 400);
    const resp = await fetch(`${GEMINI_URL}/${encodeURIComponent(id)}`, {
      headers: { "x-goog-api-key": key },
    });
    const text = await resp.text();
    if (!resp.ok) return json({ status: "failed", error: `Google returned ${resp.status}`, detail: text.slice(0, 600) });
    let data;
    try { data = JSON.parse(text); } catch { return json({ status: "failed", error: "Unexpected reply from Google" }); }

    const st = String(data.status || "").toLowerCase();
    if (st === "failed" || st === "cancelled" || st === "incomplete") {
      return json({ status: "failed", error: `Google reported "${st}"`, detail: JSON.stringify(data.error || data.incomplete_details || "").slice(0, 400) });
    }
    if (st !== "completed") return json({ status: st === "queued" ? "queued" : "running" });

    // Dig the audio + lyrics out of the steps' content blocks.
    let audio = null;
    let lyricsOut = "";
    const steps = Array.isArray(data.steps) ? data.steps : [];
    for (const step of steps) {
      const content = Array.isArray(step.content) ? step.content : [];
      for (const c of content) {
        if (c.type === "audio" && c.data && !audio) audio = c;
        else if (c.type === "text" && c.text) lyricsOut += (lyricsOut ? "\n" : "") + c.text;
      }
    }
    // Some responses put content on an "outputs" array instead.
    if (!audio && Array.isArray(data.outputs)) {
      for (const c of data.outputs) if (c.type === "audio" && c.data) { audio = c; break; }
    }
    if (!audio) return json({ status: "failed", error: "Google finished but returned no audio", detail: text.slice(0, 400) });
    const mime = audio.mime_type || audio.mimeType || "audio/mpeg";
    return json({
      status: "completed",
      mimeType: mime,
      audioDataUrl: `data:${mime};base64,${audio.data}`,
      lyrics: lyricsOut,
    });
  }

  if (provider === "minimax") {
    const key = keyFor(req, "fal");
    if (!key) return json({ error: "No fal.ai key." }, 400);
    const sresp = await fetch(`${FAL_QUEUE}/requests/${encodeURIComponent(id)}/status`, {
      headers: { Authorization: `Key ${key}` },
    });
    const stext = await sresp.text();
    if (!sresp.ok) return json({ status: "failed", error: `fal.ai returned ${sresp.status}`, detail: stext.slice(0, 400) });
    let sdata;
    try { sdata = JSON.parse(stext); } catch { return json({ status: "failed", error: "Unexpected reply from fal.ai" }); }
    const st = String(sdata.status || "").toUpperCase();
    if (st === "IN_QUEUE") return json({ status: "queued", position: sdata.queue_position });
    if (st === "IN_PROGRESS") return json({ status: "running" });
    if (st !== "COMPLETED") return json({ status: "failed", error: `fal.ai reported ${st || "unknown"}` });

    const rresp = await fetch(`${FAL_QUEUE}/requests/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Key ${key}` },
    });
    const rtext = await rresp.text();
    if (!rresp.ok) return json({ status: "failed", error: `fal.ai result returned ${rresp.status}`, detail: rtext.slice(0, 400) });
    let rdata;
    try { rdata = JSON.parse(rtext); } catch { return json({ status: "failed", error: "Unexpected result from fal.ai" }); }
    const url = rdata?.audio?.url || rdata?.audio_url || "";
    if (!url) return json({ status: "failed", error: "fal.ai finished but returned no audio", detail: rtext.slice(0, 400) });
    return json({ status: "completed", audioUrl: url, mimeType: rdata?.audio?.content_type || "audio/mpeg" });
  }

  return json({ error: `Unknown provider "${provider}"` }, 400);
};
