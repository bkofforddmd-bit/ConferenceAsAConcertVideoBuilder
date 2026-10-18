// src/lib/scene-pipeline.js — the browser side of the server-side storyboard
// build (netlify/functions/scene-pipeline-background.js). Start it, poll it,
// stop it, resume it if its server run died, and fetch finished images.
import { keyHeaders } from "./keys.js";

const BASE = "/.netlify/functions";

export const newPipeId = () => "pipe_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);

// Start a build. The build is stored FIRST (so the very next status check
// finds it), then the background function is kicked. Resolves once accepted.
export async function pipelineStart(pipeId, input) {
  let stored = false;
  try {
    const c = await fetch(`${BASE}/scene-pipeline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", pipeId, input }) });
    if (c.ok) stored = true;
    else if (c.status === 400) { const d = await c.json().catch(() => ({})); throw Object.assign(new Error(d.error || "The scene build couldn't start."), { status: 400 }); }
  } catch (e) { if (e.status === 400) throw e; }
  const resp = await fetch(`${BASE}/scene-pipeline-background`, {
    method: "POST",
    headers: { "content-type": "application/json", ...keyHeaders() },
    body: JSON.stringify(stored ? { pipeId } : { pipeId, input }),
  });
  if (resp.status !== 202 && resp.status !== 200) {
    const d = await resp.json().catch(() => ({}));
    const err = new Error(d.error || `The scene build couldn't start (${resp.status}).`);
    err.status = resp.status;
    throw err;
  }
  return pipeId;
}

// Kick a build whose server run went quiet (no lease): it continues from its last saved step.
export async function pipelineResume(pipeId) {
  const run = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await fetch(`${BASE}/scene-pipeline-background`, { method: "POST", headers: { "content-type": "application/json", ...keyHeaders() }, body: JSON.stringify({ pipeId, run }) }).catch(() => {});
}

export async function pipelineStatus(pipeId) {
  const r = await fetch(`${BASE}/scene-pipeline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status", pipeId }) });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()).pipe;
}

export async function pipelineStop(pipeId) {
  await fetch(`${BASE}/scene-pipeline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop", pipeId }) });
}

// A finished image (stored by the image job) as a data URL.
export async function fetchJobImage(jobId) {
  const r = await fetch(`${BASE}/art-result?id=${encodeURIComponent(jobId)}`);
  if (!r.ok) throw new Error(`image ${r.status}`);
  const blob = await r.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("Couldn't read the image."));
    fr.readAsDataURL(blob);
  });
}

// A short fingerprint of the lyrics, so a build is started automatically only
// once per set of lyrics (not again after it's stopped or the scenes deleted).
export function lyricsKey(text) {
  let h = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}

// Merge what the server has into the storyboard state, never overwriting what
// the person already has (their edits, uploads, saved images). `applied`
// records which image jobs were already merged. Returns { next, changed, applied }.
export function mergePipeline(state, pipe, images, applied) {
  const s = state || {};
  const next = { ...s, images: { ...(s.images || {}) }, endcards: { intro: { ...((s.endcards || {}).intro || {}) }, outro: { ...((s.endcards || {}).outro || {}) } }, meta: { ...(s.meta || {}) } };
  const ap = { images: { ...((applied && applied.images) || {}) }, cards: { ...((applied && applied.cards) || {}) } };
  let changed = false;
  if (pipe.styleBible && !s.styleBible) { next.styleBible = pipe.styleBible; changed = true; }
  if (Array.isArray(pipe.scenes) && pipe.scenes.length) {
    const local = Array.isArray(s.scenes) ? s.scenes : [];
    if (!local.length) { next.scenes = pipe.scenes.map((x) => ({ ...x })); changed = true; }
    else {
      next.scenes = local.map((x) => {
        const d = pipe.scenes.find((y) => y.sceneNumber === x.sceneNumber);
        if (!d) return x;
        const y = { ...x };
        for (const k of ["description", "imagePrompt", "lyrics", "lyricSection"]) if (!y[k] && d[k]) { y[k] = d[k]; changed = true; }
        return y;
      });
    }
  }
  for (const [n, jobId] of Object.entries(pipe.images || {})) {
    if (ap.images[n] === jobId) continue;
    const url = images[jobId];
    if (!url) continue;
    if (!next.images[n] && !((s.saved || {})[n])) { next.images[n] = url; changed = true; }
    ap.images[n] = jobId;
  }
  for (const kind of ["intro", "outro"]) {
    const c = (pipe.cards || {})[kind];
    if (!c || !c.jobId || ap.cards[kind] === c.jobId) continue;
    const url = images[c.jobId];
    if (!url) continue;
    if (!next.endcards[kind].image) { next.endcards[kind] = { ...next.endcards[kind], image: url, prompt: next.endcards[kind].prompt || c.prompt || "" }; changed = true; }
    ap.cards[kind] = c.jobId;
  }
  if (pipe.meta) for (const k of ["songTitle", "speaker", "conferenceMonthYear", "session"]) if (!next.meta[k] && pipe.meta[k]) { next.meta[k] = pipe.meta[k]; changed = true; }
  return { next, changed, applied: ap };
}
