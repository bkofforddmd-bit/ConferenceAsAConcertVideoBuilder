// netlify/functions/art-status.js
//
// Polls a scene-image job started by art-job-background.js.
//   { status: "queued" | "running" | "done" | "failed", imageDataUrl?, error? }
// "queued" means no record exists yet (the background function hasn't started).

import { json } from "../lib/keys.js";
import { jobGet, validJobId } from "../lib/jobs.js";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!validJobId(id)) return json({ error: "Bad job id" }, 400);
  const rec = await jobGet(id);
  if (!rec) return json({ status: "queued" });
  return json(rec);
};
