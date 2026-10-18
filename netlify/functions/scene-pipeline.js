// netlify/functions/scene-pipeline.js
//
// The browser's window onto a server-side storyboard build
// (scene-pipeline-background.js).
//   { action: "status", pipeId } -> { pipe }   progress, scenes, image job ids, cards (no inputs echoed back)
//   { action: "create", pipeId, input } -> { pipe }  stores the build BEFORE the background
//                                         function is kicked, so the first status check finds it
//   { action: "stop",   pipeId } -> { ok }     finishes the current step, then stops
//   status also reports `stale: true` when a running build has gone quiet
//   (its invocation died without handing off) so the browser can resume it.

import { json, readJson } from "../lib/keys.js";
import { jobGet, jobSet, validJobId } from "../lib/jobs.js";
import { newPipelineDoc, isStale } from "../lib/scene-pipeline-input.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const pipeId = String(body.pipeId || "");
  if (!validJobId(pipeId) || !pipeId.startsWith("pipe_")) return json({ error: "Bad pipeline id" }, 400);
  if (body.action === "create") {
    const existing = await jobGet(pipeId);
    if (existing) return json({ ok: true, existed: true });
    if (!String((body.input && body.input.lyrics) || "").trim()) return json({ error: "Provide finalized lyrics." }, 400);
    await jobSet(pipeId, newPipelineDoc(pipeId, body.input, "queued"));
    return json({ ok: true });
  }

  const doc = await jobGet(pipeId);
  if (!doc) return json({ pipe: null });

  if (body.action === "stop") {
    if (doc.status === "queued") await jobSet(pipeId, { ...doc, stop: true, status: "stopped", progress: "Stopped." });
    else if (doc.status === "running") await jobSet(pipeId, { ...doc, stop: true, progress: "Stopping after the current step…" });
    return json({ ok: true });
  }

  const { input, lease, ...pub } = doc;
  const stale = isStale(doc);
  return json({
    pipe: {
      ...pub,
      scenes: Array.isArray(doc.scenes) ? doc.scenes.map(({ _beat, _detailTried, ...s }) => s) : null,
      autoImages: input ? input.autoImages !== false : true,
      stale,
    },
  });
};
