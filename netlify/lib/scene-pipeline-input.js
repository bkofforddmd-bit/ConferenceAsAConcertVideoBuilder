// netlify/lib/scene-pipeline-input.js — the one place a storyboard build's
// inputs are cleaned, and its first record is shaped (used by the "create"
// call in scene-pipeline.js and by the background function itself).

export function cleanPipelineInput(i = {}) {
  return {
    lyrics: String(i.lyrics || ""),
    styleReference: String(i.styleReference || ""),
    talkText: String(i.talkText || "").slice(0, 120000),
    sceneBasis: ["song", "talk", "sections"].includes(i.sceneBasis) ? i.sceneBasis : "song",
    lockReference: i.lockReference !== false,
    autoImages: i.autoImages !== false,
    meta: i.meta && typeof i.meta === "object" ? i.meta : {},
  };
}

export function newPipelineDoc(pipeId, input, status = "queued") {
  return {
    id: pipeId, status, phase: status === "queued" ? "queued" : "style",
    progress: status === "queued" ? "Starting on the server…" : "Designing the visual style…",
    input: cleanPipelineInput(input),
    styleBible: null, scenes: null, images: {}, cards: {}, meta: null, failures: [], stop: false,
    createdAt: Date.now(), lease: null, handoffs: 0,
  };
}

// Has a build gone quiet? Running with no live lease for 4+ minutes (its
// invocation died without handing off), or queued for 45+ seconds (the kick
// never arrived). The browser re-kicks stale builds; work resumes where it stopped.
export function isStale(doc, now = Date.now()) {
  if (!doc) return false;
  const quiet = now - (doc.updatedAt || 0);
  const lease = doc.lease;
  if (doc.status === "running") return quiet > 4 * 60 * 1000 && !(lease && lease.until > now && quiet < 12 * 60 * 1000);
  if (doc.status === "queued") return quiet > 45 * 1000;
  return false;
}
