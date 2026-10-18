// netlify/functions/scene-pipeline-background.js
//
// Builds a whole storyboard ON THE SERVER, so it keeps going when the person
// moves to another page, closes the tab, or their phone sleeps:
//
//   style bible → scene outline → each scene's description + image prompt →
//   every scene image in order (each referencing the previous image so
//   characters and style stay consistent) → title & credits → intro and
//   outro cards.
//
// State lives in the job store as pipe:<id> (see scene-pipeline.js for the
// status / stop calls the browser makes). Every step is saved as it finishes,
// so the work is resumable. A Netlify background function may run 15 minutes;
// this one hands itself off to a fresh invocation after ~11 minutes. A lease
// keeps two invocations from working on the same pipeline at once.
//
// Body: { pipeId, run, input? }   input only on the first call:
//   { lyrics, styleReference, talkText, sceneBasis, lockReference, autoImages, meta }
// The person's own API keys (x-user-*-key headers, if they pasted any in
// Settings) are passed straight through to each step and to the hand-off —
// never stored.

import { json, readJson } from "../lib/keys.js";
import { jobGet, jobSet, blobGetText, blobSetText, validJobId } from "../lib/jobs.js";
import styleBibleFn from "./generate-style-bible.js";
import outlineFn from "./generate-outline.js";
import sceneDetailFn from "./generate-scene-detail.js";
import extractMetaFn from "./extract-meta.js";
import artJobFn from "./art-job-background.js";
import { cardBackgroundPrompt } from "../../src/lib/card-prompts.js";

export const config = { background: true };

const BUDGET_MS = Number(process.env.SCENE_PIPELINE_BUDGET_MS) || 11 * 60 * 1000; // hand off well before the 15-minute limit
const LEASE_MS = 16 * 60 * 1000;
const KEY_HEADERS = ["x-user-anthropic-key", "x-user-openai-key", "x-user-gemini-key", "x-user-fal-key"];
const newRun = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const imgJobId = (pipeId, tag) => `${pipeId}_${tag}_${Date.now().toString(36)}`.slice(0, 80);

function keyHeadersFrom(req) {
  const h = {};
  for (const k of KEY_HEADERS) { const v = req.headers.get(k); if (v) h[k] = v; }
  return h;
}

// Call another function's handler in this process, with the same keys.
async function callFn(fn, payload, keyHeaders) {
  const res = await fn(new Request("http://internal/", { method: "POST", headers: { "content-type": "application/json", ...keyHeaders }, body: JSON.stringify(payload) }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `step failed (${res.status})`);
  return data;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const pipeId = String(body.pipeId || "");
  if (!validJobId(pipeId) || !pipeId.startsWith("pipe_")) return json({ error: "Provide a pipeId." }, 400);
  const keyHeaders = keyHeadersFrom(req);
  const t0 = Date.now();
  const run = String(body.run || newRun());

  let doc = await jobGet(pipeId);
  if (!doc) {
    // First call: the browser sends the inputs.
    const i = body.input || {};
    if (!String(i.lyrics || "").trim()) return json({ error: "Provide finalized lyrics." }, 400);
    doc = {
      id: pipeId, status: "running", phase: "style", progress: "Designing the visual style…",
      input: {
        lyrics: String(i.lyrics), styleReference: String(i.styleReference || ""), talkText: String(i.talkText || "").slice(0, 120000),
        sceneBasis: ["song", "talk", "sections"].includes(i.sceneBasis) ? i.sceneBasis : "song",
        lockReference: i.lockReference !== false, autoImages: i.autoImages !== false, meta: i.meta || {},
      },
      styleBible: null, scenes: null, images: {}, cards: {}, meta: null, failures: [], stop: false,
      createdAt: Date.now(), lease: { run, until: Date.now() + LEASE_MS }, handoffs: 0,
    };
    await jobSet(pipeId, doc);
  } else {
    if (["done", "failed", "stopped"].includes(doc.status)) return json({ ok: true, status: doc.status }, 202);
    // Someone else holds a live lease (another invocation is working) → leave it alone.
    if (doc.lease && doc.lease.until > Date.now() && doc.lease.run !== run) return json({ ok: true, busy: true }, 202);
    doc.lease = { run, until: Date.now() + LEASE_MS };
    await jobSet(pipeId, doc);
  }

  const save = async (patch) => {
    const cur = (await jobGet(pipeId)) || doc;
    if (cur.stop) doc.stop = true; // a stop request may have arrived meanwhile
    doc = { ...doc, ...patch, stop: doc.stop || cur.stop };
    await jobSet(pipeId, doc);
  };
  const stopped = async () => {
    const cur = await jobGet(pipeId);
    if (cur && cur.stop) { doc = { ...doc, stop: true }; await save({ status: "stopped", progress: "Stopped." }); return true; }
    return false;
  };
  // Out of time for this invocation → hand off to a fresh one and exit.
  const handoff = async () => {
    const next = newRun();
    await save({ lease: { run: next, until: Date.now() + 90 * 1000 }, handoffs: (doc.handoffs || 0) + 1 });
    const url = new URL("/.netlify/functions/scene-pipeline-background", req.url).toString();
    await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...keyHeaders }, body: JSON.stringify({ pipeId, run: next }) }).catch(() => {});
    return json({ ok: true, handedOff: true }, 202);
  };
  const outOfTime = () => Date.now() - t0 > BUDGET_MS;
  const I = doc.input;

  try {
    // 1) style bible
    if (!doc.styleBible) {
      if (await stopped()) return json({ ok: true }, 202);
      await save({ phase: "style", progress: "Designing the visual style…" });
      const r = await callFn(styleBibleFn, { lyrics: I.lyrics, styleReference: I.styleReference, talkText: I.talkText }, keyHeaders);
      await save({ styleBible: r.styleBible || r || {} });
    }

    // 2) outline
    if (!Array.isArray(doc.scenes)) {
      if (await stopped()) return json({ ok: true }, 202);
      await save({ phase: "outline", progress: "Outlining the scenes…" });
      const r = await callFn(outlineFn, { lyrics: I.lyrics, styleBible: doc.styleBible, talkText: I.talkText, sceneBasis: I.sceneBasis }, keyHeaders);
      const outline = (r.outline || []).slice().sort((a, b) => a.sceneNumber - b.sceneNumber);
      if (!outline.length) throw new Error("The outline came back empty.");
      await save({
        scenes: outline.map((b) => ({ sceneNumber: b.sceneNumber, lyrics: b.lyrics || "", lyricSection: b.lyricSection || "", description: "", imagePrompt: "", _beat: b.beat || "" })),
      });
    }

    // 3) each scene's description + image prompt
    for (let i = 0; i < doc.scenes.length; i++) {
      const sc = doc.scenes[i];
      if (sc.imagePrompt || sc._detailTried) continue;
      if (await stopped()) return json({ ok: true }, 202);
      if (outOfTime()) return handoff();
      await save({ phase: "details", progress: `Writing scene ${i + 1} of ${doc.scenes.length}…` });
      let next;
      try {
        const d = await callFn(sceneDetailFn, { styleBible: doc.styleBible, scene: { sceneNumber: sc.sceneNumber, lyricSection: sc.lyricSection, beat: sc._beat || sc.lyricSection || sc.lyrics, lyrics: sc.lyrics }, styleReference: I.styleReference, talkText: I.talkText }, keyHeaders);
        next = { ...sc, lyricSection: d.lyricSection || sc.lyricSection, description: d.description || sc._beat || "", imagePrompt: d.imagePrompt || "", _detailTried: true };
      } catch {
        next = { ...sc, description: sc._beat || "", _detailTried: true };
      }
      const scenes = doc.scenes.slice(); scenes[i] = next;
      await save({ scenes });
    }

    // 4) scene images, in order, each referencing the previous one
    if (I.autoImages) {
      const order = doc.scenes.slice().sort((a, b) => a.sceneNumber - b.sceneNumber).filter((s) => s.imagePrompt);
      for (let k = 0; k < order.length; k++) {
        const sc = order[k];
        const n = sc.sceneNumber;
        if (doc.images[n] || (doc.failures || []).includes(n)) continue;
        if (await stopped()) return json({ ok: true }, 202);
        if (outOfTime()) return handoff();
        await save({ phase: "images", progress: `Painting scene ${n} (${Object.keys(doc.images).length + 1} of ${order.length})…` });
        const jobId = imgJobId(pipeId, `s${n}`);
        let refKey = "";
        const prev = order.slice(0, k).reverse().find((x) => doc.images[x.sceneNumber]);
        if (I.lockReference && prev) {
          const out = await blobGetText(`out:${doc.images[prev.sceneNumber]}`);
          if (out) { refKey = `ref:${jobId}`; await blobSetText(refKey, out); }
        }
        await artJobFn(new Request("http://internal/", { method: "POST", headers: { "content-type": "application/json", ...keyHeaders }, body: JSON.stringify({ jobId, prompt: sc.imagePrompt, size: "1536x1024", refKey }) }));
        const st = await jobGet(jobId);
        if (st && st.status === "done") await save({ images: { ...doc.images, [n]: jobId } });
        else await save({ failures: [...(doc.failures || []), n], lastError: (st && (st.error + (st.detail ? `: ${String(st.detail).slice(0, 200)}` : ""))) || "image failed" });
      }

      // 5) title & credits, then the intro / outro cards
      if (!doc.meta) {
        if (await stopped()) return json({ ok: true }, 202);
        await save({ phase: "cards", progress: "Filling in title & credits…" });
        const known = I.meta || {};
        let m = {};
        if (!known.songTitle) { try { m = await callFn(extractMetaFn, { talkText: I.talkText, lyrics: I.lyrics }, keyHeaders); } catch { m = {}; } }
        await save({ meta: {
          songTitle: known.songTitle || m.songTitle || "", speaker: known.speaker || m.speaker || "",
          conferenceMonthYear: known.conferenceMonthYear || m.conferenceMonthYear || "", session: known.session || m.session || "", scripture: known.scripture || "",
        } });
      }
      const ordered = doc.scenes.slice().sort((a, b) => a.sceneNumber - b.sceneNumber).filter((s) => doc.images[s.sceneNumber]);
      const firstJob = ordered.length ? doc.images[ordered[0].sceneNumber] : "";
      const lastJob = ordered.length ? doc.images[ordered[ordered.length - 1].sceneNumber] : "";
      if (doc.meta && doc.meta.songTitle) {
        for (const kind of ["intro", "outro"]) {
          if (doc.cards[kind] && (doc.cards[kind].jobId || doc.cards[kind].failed)) continue;
          if (await stopped()) return json({ ok: true }, 202);
          if (outOfTime()) return handoff();
          await save({ phase: "cards", progress: `Painting the ${kind} card…` });
          const prompt = cardBackgroundPrompt(kind, doc.meta, doc.styleBible);
          const jobId = imgJobId(pipeId, kind);
          let refKey = "";
          const refJob = I.lockReference ? (kind === "intro" ? firstJob : lastJob) : "";
          if (refJob) { const out = await blobGetText(`out:${refJob}`); if (out) { refKey = `ref:${jobId}`; await blobSetText(refKey, out); } }
          await artJobFn(new Request("http://internal/", { method: "POST", headers: { "content-type": "application/json", ...keyHeaders }, body: JSON.stringify({ jobId, prompt, size: "1536x1024", refKey }) }));
          const st = await jobGet(jobId);
          await save({ cards: { ...doc.cards, [kind]: st && st.status === "done" ? { jobId, prompt } : { failed: true, prompt } } });
        }
      }
    }

    const failed = (doc.failures || []).length;
    await save({ status: "done", phase: "done", progress: failed ? `Done — ${failed} scene image${failed === 1 ? "" : "s"} failed; use "Regenerate here" on those.` : "Done.", lease: null, finishedAt: Date.now() });
    return json({ ok: true }, 202);
  } catch (e) {
    await save({ status: "failed", error: String(e.message || e).slice(0, 400), progress: "Stopped with an error.", lease: null });
    return json({ ok: false }, 202);
  }
};
