// netlify/functions/music-result.js
//
// Streams a finished song (stored by music-job-background.js) to the browser
// as raw audio bytes.

import { json } from "../lib/keys.js";
import { blobGetText, validJobId } from "../lib/jobs.js";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!validJobId(id)) return json({ error: "Bad job id" }, 400);
  const text = await blobGetText(`song:${id}`);
  if (!text) return json({ error: "No song for that job (yet)." }, 404);
  let rec;
  try { rec = JSON.parse(text); } catch { return json({ error: "Stored song is unreadable." }, 500); }
  const bytes = Buffer.from(rec.b64, "base64");
  const CHUNK = 256 * 1024;
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += CHUNK) controller.enqueue(bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": rec.mime || "audio/mpeg", "cache-control": "private, max-age=3600" },
  });
};
