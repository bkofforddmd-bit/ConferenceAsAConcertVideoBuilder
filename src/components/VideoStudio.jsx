// src/components/VideoStudio.jsx
//
// Step 5 of the Create pipeline: motion + the final cut.
//   1. Clips — each storyboard still becomes a short video clip (Kling via
//      fal.ai, or Google Veo), generated asynchronously and stored in the
//      project. Scenes without a clip get a slow Ken Burns drift instead.
//   2. Timeline — when each scene starts in the song: auto (by lyric length),
//      numeric, or "tap along" while the song plays.
//   3. Render — the browser paints every frame to a canvas in real time, mixes
//      in the song, and records an MP4 (Chrome/Edge) you can download.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { videoStart, videoStatus, pollJob, fetchMediaBlob, shrinkImage } from "../lib/api.js";
import { putMedia, getMedia, deleteMedia } from "../lib/project-store.js";
import { hasKey } from "../lib/keys.js";
import { renderMusicVideo, autoTimeline, cropTo16x9, pickRenderMime, MOTIONS } from "../lib/video-render.js";

function fmt(sec) {
  if (!isFinite(sec)) return "0:00";
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// Relative hold lengths for shots within a scene (or card) time slot.
const WEIGHTS = [
  { v: 0.5, l: "½× hold" },
  { v: 1, l: "1× hold" },
  { v: 1.5, l: "1½× hold" },
  { v: 2, l: "2× hold" },
  { v: 3, l: "3× hold" },
];

// Split [start, end) among shots in proportion to their weights.
function splitByWeight(shots, start, end) {
  const total = shots.reduce((a, s) => a + (Number(s.weight) || 1), 0) || 1;
  let t = start;
  return shots.map((s, k) => {
    const share = ((end - start) * (Number(s.weight) || 1)) / total;
    const seg = { ...s, start: t, end: k === shots.length - 1 ? end : t + share };
    t += share;
    return seg;
  });
}

// Controls for the shots of one scene or card: motion + hold for the primary
// picture, and the list of added images (motion, hold, order, remove, add).
function ShotsEditor({ id, extrasList, extraUrls, motion, weight, busy, onMotion, onWeight, onAdd, onUpdate, onMove, onRemove, primaryTitle }) {
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 6 }} title={primaryTitle || "Camera motion over this picture"}>
          <span className="note" style={{ margin: 0 }}>Motion</span>
          <select value={motion || "auto"} onChange={(e) => onMotion(e.target.value)} style={{ fontSize: 12, padding: "3px 6px" }}>
            {MOTIONS.map((mo) => <option key={mo.id} value={mo.id}>{mo.label}</option>)}
          </select>
        </label>
        {(extrasList || []).length > 0 && (
          <select value={weight || 1} onChange={(e) => onWeight(Number(e.target.value))} style={{ fontSize: 12, padding: "3px 6px" }} title="How long the first picture holds compared with the added shots">
            {WEIGHTS.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}
          </select>
        )}
      </div>
      {(extrasList || []).length > 0 && (
        <div className="extra-shots">
          {(extrasList || []).map((x, k, arr) => (
            <div className="extra-shot" key={x.id}>
              {extraUrls[x.id] ? <img src={extraUrls[x.id]} alt="" /> : <div className="extra-thumb-blank">…</div>}
              <div className="extra-shot-body">
                <span className="note" style={{ margin: 0 }}>Shot {k + 2}{x.name ? ` · ${x.name.slice(0, 22)}` : ""}</span>
                <span className="row" style={{ gap: 4 }}>
                  <select value={x.motion || "auto"} onChange={(e) => onUpdate(x.id, { motion: e.target.value })} style={{ fontSize: 12, padding: "3px 6px" }}>
                    {MOTIONS.map((mo) => <option key={mo.id} value={mo.id}>{mo.label}</option>)}
                  </select>
                  <select value={x.weight || 1} onChange={(e) => onUpdate(x.id, { weight: Number(e.target.value) })} style={{ fontSize: 12, padding: "3px 6px" }} title="How long this shot holds compared with the others">
                    {WEIGHTS.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}
                  </select>
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" disabled={k === 0} onClick={() => onMove(x.id, -1)} title="Earlier">↑</button>
                  <button className="btn btn-ghost btn-sm" disabled={k === arr.length - 1} onClick={() => onMove(x.id, 1)} title="Later">↓</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => onRemove(x.id)} title="Remove this shot">✕</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", alignSelf: "flex-start" }} title="Add one or more images that play after this picture, sharing its time">
        {busy ? "Adding…" : "+ Add images"}
        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
      </label>
    </>
  );
}

function motionPromptFor(scene) {
  const d = (scene.description || scene.imagePrompt || "").trim();
  return `Gentle, reverent cinematic motion. ${d.slice(0, 500)} Keep every character, face and composition exactly as in the image; slow camera drift; natural subtle movement (breeze, light, fabric); no new objects, no text.`;
}

export default function VideoStudio({
  projectId, scenes, images, endcards, song, meta,
  clips, setClips, timeline, setTimeline, render, setRender,
  config, onContinue,
}) {
  const providers = (config && config.providers && config.providers.video) || [];
  const serverKeys = (config && config.serverKeys) || {};
  const [provider, setProvider] = useState("fal-kling");
  const [clipSec, setClipSec] = useState(5);
  const [blendNext, setBlendNext] = useState(false);
  const [prompts, setPrompts] = useState({});
  const [busyAll, setBusyAll] = useState(false);
  const [busyScene, setBusyScene] = useState({});
  const [clipStatus, setClipStatus] = useState({});
  const [clipUrls, setClipUrls] = useState({});
  const [error, setError] = useState("");
  const stopRef = useRef(false);

  // song audio url
  const [audioUrl, setAudioUrl] = useState("");
  const songVersion = (song && song.versions || []).find((v) => v.id === song.activeId) || null;
  const totalSec = songVersion ? songVersion.durationSec : 0;
  useEffect(() => {
    let url = "";
    (async () => {
      if (!songVersion || !songVersion.mediaKey) { setAudioUrl(""); return; }
      const rec = await getMedia(songVersion.mediaKey);
      if (!rec) { setAudioUrl(""); return; }
      url = URL.createObjectURL(rec.blob);
      setAudioUrl(url);
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [songVersion && songVersion.mediaKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // clip object urls
  const ordered = useMemo(() => (scenes || []).slice().sort((a, b) => a.sceneNumber - b.sceneNumber), [scenes]);
  useEffect(() => {
    const urls = {};
    let alive = true;
    (async () => {
      for (const sc of ordered) {
        const c = clips && clips[sc.sceneNumber];
        if (c && c.mediaKey) {
          const rec = await getMedia(c.mediaKey);
          if (rec) urls[sc.sceneNumber] = URL.createObjectURL(rec.blob);
        }
      }
      if (alive) setClipUrls(urls);
      else Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => { alive = false; Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); };
  }, [JSON.stringify(Object.entries(clips || {}).map(([k, v]) => [k, v && v.mediaKey]))]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- timeline ----
  const tl = timeline || { starts: {}, introSec: 4, outroSec: 6, lyricsOverlay: true };

  // ---- extra shots: additional images added to a scene in the Video step ----
  // tl.extras = { [scene]: [ { id, mediaKey, motion } ] }  (blobs live in IndexedDB)
  // tl.motion = { [scene]: motionId }  (camera motion for the scene's own still)
  const extras = tl.extras || {};
  const [extraUrls, setExtraUrls] = useState({});
  useEffect(() => {
    const urls = {};
    let alive = true;
    (async () => {
      for (const list of Object.values(extras)) {
        for (const x of list || []) {
          if (!x || !x.mediaKey) continue;
          const rec = await getMedia(x.mediaKey);
          if (rec) urls[x.id] = URL.createObjectURL(rec.blob);
        }
      }
      if (alive) setExtraUrls(urls);
      else Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => { alive = false; Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); };
  }, [JSON.stringify(Object.entries(extras).map(([k, v]) => [k, (v || []).map((x) => x && x.mediaKey)]))]); // eslint-disable-line react-hooks/exhaustive-deps

  const [extraBusy, setExtraBusy] = useState({});
  async function addExtras(sceneNumber, fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setExtraBusy((p) => ({ ...p, [sceneNumber]: true }));
    try {
      const added = [];
      for (const f of files) {
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = rej; r.readAsDataURL(f); });
        const small = await shrinkImage(dataUrl, 1920, 0.92);
        const blob = await (await fetch(small)).blob();
        const id = "x_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
        const mediaKey = `${projectId}:extra:${id}`;
        await putMedia(mediaKey, blob, { scene: sceneNumber, name: f.name });
        added.push({ id, mediaKey, motion: "auto", name: f.name });
      }
      setTimeline({ ...tl, extras: { ...extras, [sceneNumber]: [...(extras[sceneNumber] || []), ...added] } });
    } catch (e) {
      setError(`Add images: ${e.message}`);
    } finally {
      setExtraBusy((p) => ({ ...p, [sceneNumber]: false }));
    }
  }
  function updateExtra(sceneNumber, id, patch) {
    setTimeline({ ...tl, extras: { ...extras, [sceneNumber]: (extras[sceneNumber] || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) } });
  }
  function moveExtra(sceneNumber, id, dir) {
    const list = (extras[sceneNumber] || []).slice();
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setTimeline({ ...tl, extras: { ...extras, [sceneNumber]: list } });
  }
  function removeExtra(sceneNumber, id) {
    const x = (extras[sceneNumber] || []).find((e) => e.id === id);
    if (x && x.mediaKey) deleteMedia(x.mediaKey).catch(() => {});
    setTimeline({ ...tl, extras: { ...extras, [sceneNumber]: (extras[sceneNumber] || []).filter((e) => e.id !== id) } });
  }
  function setSceneMotion(sceneNumber, motion) {
    setTimeline({ ...tl, motion: { ...(tl.motion || {}), [sceneNumber]: motion } });
  }
  function setPrimaryWeight(key, w) {
    setTimeline({ ...tl, weight: { ...(tl.weight || {}), [key]: w } });
  }
  // Props bundle for ShotsEditor, keyed by scene number or "intro"/"outro".
  const shotsProps = (key) => ({
    id: key,
    extrasList: extras[key] || [],
    extraUrls,
    motion: (tl.motion || {})[key] || "auto",
    weight: (tl.weight || {})[key] || 1,
    busy: Boolean(extraBusy[key]),
    onMotion: (mo) => setSceneMotion(key, mo),
    onWeight: (w) => setPrimaryWeight(key, w),
    onAdd: (files) => addExtras(key, files),
    onUpdate: (id, patch) => updateExtra(key, id, patch),
    onMove: (id, dir) => moveExtra(key, id, dir),
    onRemove: (id) => removeExtra(key, id),
  });
  const hasIntro = Boolean(endcards && endcards.intro && endcards.intro.image);
  const hasOutro = Boolean(endcards && endcards.outro && endcards.outro.image);

  function autoTime() {
    if (!totalSec) return;
    const starts = autoTimeline(ordered, totalSec, { introSec: tl.introSec, outroSec: tl.outroSec, hasIntro: tl.includeIntro !== false, hasOutro: tl.includeOutro !== false });
    setTimeline({ ...tl, starts, lineStarts: {} });
  }
  // Auto-time once when a song exists and nothing is timed yet.
  useEffect(() => {
    if (totalSec && ordered.length && (!tl.starts || Object.keys(tl.starts).length === 0)) autoTime();
  }, [totalSec, ordered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function setStart(n, v) {
    const num = Math.max(0, Math.min(totalSec || 1e9, Number(v) || 0));
    setTimeline({ ...tl, starts: { ...(tl.starts || {}), [n]: num } });
  }

  // tap-along
  const tapAudioRef = useRef(null);
  const [tapIdx, setTapIdx] = useState(-1); // index of next scene to mark
  const [tapTime, setTapTime] = useState(0);
  function startTap() {
    const a = tapAudioRef.current;
    if (!a) return;
    a.currentTime = hasIntro ? tl.introSec : 0;
    a.play();
    setTapIdx(0);
  }
  function tapNext() {
    const a = tapAudioRef.current;
    if (!a || tapIdx < 0) return;
    const sc = ordered[tapIdx];
    if (sc) setStart(sc.sceneNumber, Math.round(a.currentTime * 10) / 10);
    if (tapIdx + 1 >= ordered.length) { a.pause(); setTapIdx(-1); }
    else setTapIdx(tapIdx + 1);
  }
  function stopTap() { const a = tapAudioRef.current; if (a) a.pause(); setTapIdx(-1); }

  // Intro/outro: the designed card image when there is one, otherwise a text
  // card drawn by the renderer from the title & credits. Each can be toggled.
  const includeIntro = tl.includeIntro !== false;
  const includeOutro = tl.includeOutro !== false;
  const DISCLAIMER =
    "This music and video presentation is not an official production of The Church of Jesus Christ of Latter-day Saints " +
    "and is not endorsed by the Church. The creators of this presentation fully and wholeheartedly sustain and support the Church, its leaders, doctrines, and teachings.";
  const m = meta || {};
  const introCard = {
    kicker: "Conference As A Concert",
    title: m.songTitle || "",
    lines: [
      m.speaker ? `Adapted from a talk given by ${m.speaker}` : "",
      [m.conferenceMonthYear, m.session].filter(Boolean).join(" · "),
      "General Conference of The Church of Jesus Christ of Latter-day Saints",
    ].filter(Boolean),
    small: DISCLAIMER,
  };
  const outroCard = {
    title: m.songTitle || "",
    lines: [
      m.speaker ? `A song inspired by ${m.speaker}` : "",
      "If this message touched your heart, please share this video with someone who may need hope.",
      m.scripture || "",
    ].filter(Boolean),
    small: DISCLAIMER,
  };

  // segments for the bar + render
  const segments = useMemo(() => {
    if (!totalSec) return [];
    const segs = [];
    const starts = tl.starts || {};
    const lineStarts = tl.lineStarts || {};
    const list = ordered.map((s) => ({ s, start: starts[s.sceneNumber] ?? 0 })).sort((a, b) => a.start - b.start);
    const weights = tl.weight || {};
    const extraShots = (key) => (extras[key] || [])
      .map((x) => ({ kind: "image", src: extraUrls[x.id] || "", motion: x.motion || "auto", weight: x.weight || 1 }))
      .filter((x) => x.src);
    // Primary picture + added images, each holding in proportion to its weight.
    const pushShots = (primary, key, start, end, common, label) => {
      const shots = [{ ...primary, weight: weights[key] || 1 }, ...extraShots(key)].filter((x) => x.src);
      splitByWeight(shots, start, end).forEach((seg, k) => {
        segs.push({ ...seg, ...common, label: shots.length > 1 ? `${label} · ${k + 1}/${shots.length}` : label });
      });
    };

    const introEnd = list.length ? list[0].start : Math.min(totalSec, tl.introSec);
    if (includeIntro && introEnd > 0.2) {
      const primary = hasIntro
        ? { kind: "image", src: endcards.intro.image, motion: (tl.motion || {}).intro || "auto" }
        : { kind: "textcard", src: "text", card: introCard, motion: (tl.motion || {}).intro || "auto" };
      pushShots(primary, "intro", 0, introEnd, { lyrics: "", isCard: true }, "Intro");
    }
    const outroStart = includeOutro
      ? (list.length ? Math.max(list[list.length - 1].start + 1, totalSec - tl.outroSec) : Math.max(0, totalSec - tl.outroSec))
      : totalSec;
    for (let i = 0; i < list.length; i++) {
      const { s, start } = list[i];
      const next = i + 1 < list.length ? list[i + 1].start : outroStart;
      const end = Math.max(start, next);
      const n = s.sceneNumber;
      const clip = clips && clips[n];
      const primarySrc = clip && clip.mediaKey && clipUrls[n] ? clipUrls[n] : (images[n] || "");
      const primary = { kind: clip && clipUrls[n] ? "video" : "image", src: primarySrc, motion: (tl.motion || {})[n] || "auto" };
      const common = { lyrics: s.lyrics || "", lineStarts: lineStarts[n] || null, lyricSpan: { start, end }, isCard: false };
      pushShots(primary, n, start, end, common, `Scene ${n}`);
    }
    if (includeOutro && totalSec - outroStart > 0.2) {
      const primary = hasOutro
        ? { kind: "image", src: endcards.outro.image, motion: (tl.motion || {}).outro || "auto" }
        : { kind: "textcard", src: "text", card: outroCard, motion: (tl.motion || {}).outro || "auto" };
      pushShots(primary, "outro", outroStart, totalSec, { lyrics: "", isCard: true }, "Outro");
    }
    return segs.filter((x) => x.src);
  }, [ordered, tl, totalSec, hasIntro, hasOutro, clips, clipUrls, images, endcards, includeIntro, includeOutro, meta, extraUrls]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- tap-along per LINE: play the song, press Next for every lyric line ----
  const lineList = useMemo(() => {
    const out = [];
    for (const s of ordered) {
      const lines = String(s.lyrics || "").split(/\n/).map((x) => x.trim()).filter(Boolean);
      lines.forEach((text, i) => out.push({ scene: s.sceneNumber, i, n: lines.length, text }));
    }
    return out;
  }, [ordered]);
  const [lineTapIdx, setLineTapIdx] = useState(-1);
  const lineTapsRef = useRef({});
  function startLineTap() {
    const a = tapAudioRef.current;
    if (!a || !lineList.length) return;
    lineTapsRef.current = {};
    a.currentTime = includeIntro ? Math.max(0, (tl.starts || {})[ordered[0]?.sceneNumber] ?? tl.introSec) - 0.5 : 0;
    a.play();
    setLineTapIdx(0);
  }
  function finishLineTap() {
    const a = tapAudioRef.current;
    if (a) a.pause();
    const taps = lineTapsRef.current;
    // Scene starts follow the first tapped line of each scene (the intro keeps the gap before it).
    const starts = { ...(tl.starts || {}) };
    for (const [scene, arr] of Object.entries(taps)) if (arr && arr.length && typeof arr[0] === "number") starts[scene] = Math.round(arr[0] * 10) / 10;
    setTimeline({ ...tl, starts, lineStarts: taps, lyricsMode: "one" });
    setLineTapIdx(-1);
  }
  function tapNextLine() {
    const a = tapAudioRef.current;
    if (!a || lineTapIdx < 0) return;
    const item = lineList[lineTapIdx];
    if (item) {
      const arr = lineTapsRef.current[item.scene] || (lineTapsRef.current[item.scene] = new Array(item.n).fill(null));
      arr[item.i] = Math.round(a.currentTime * 100) / 100;
    }
    if (lineTapIdx + 1 >= lineList.length) finishLineTap();
    else setLineTapIdx(lineTapIdx + 1);
  }
  function stopLineTap() { const a = tapAudioRef.current; if (a) a.pause(); setLineTapIdx(-1); }
  // Space / Enter also taps, so you can keep your eyes on the song.
  useEffect(() => {
    if (lineTapIdx < 0) return;
    const onKey = (e) => {
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); tapNextLine(); }
      if (e.code === "Escape") stopLineTap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lineTapIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const tappedLineCount = Object.values(tl.lineStarts || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.filter((x) => typeof x === "number").length : 0), 0);

  // ---- clips ----
  async function generateClip(scene, prevForBlend) {
    const n = scene.sceneNumber;
    const img = images[n];
    if (!img) { setClipStatus((p) => ({ ...p, [n]: "No image for this scene yet." })); return false; }
    const needs = provider === "veo" ? "gemini" : "fal";
    if (!hasKey(needs, serverKeys)) {
      setError(`This provider needs a ${needs === "gemini" ? "Google Gemini" : "fal.ai"} key. Add one under Settings → API keys.`);
      return false;
    }
    setBusyScene((p) => ({ ...p, [n]: true }));
    setClipStatus((p) => ({ ...p, [n]: "Preparing the frame…" }));
    try {
      const startImage = await cropTo16x9(img);
      let endImage = "";
      if (blendNext) {
        const idx = ordered.findIndex((s) => s.sceneNumber === n);
        const nxt = ordered[idx + 1];
        if (nxt && images[nxt.sceneNumber]) endImage = await cropTo16x9(images[nxt.sceneNumber]);
      }
      const prompt = prompts[n] || motionPromptFor(scene);
      setClipStatus((p) => ({ ...p, [n]: "Sending to the video studio…" }));
      const { jobId } = await videoStart({ provider, prompt, startImage, endImage, duration: clipSec });
      setClips((p) => ({ ...p, [n]: { ...(p[n] || {}), jobId, status: "running", provider, prompt } }));
      const result = await pollJob(videoStatus, jobId, {
        intervalMs: 8000,
        onTick: (s) => setClipStatus((p) => ({ ...p, [n]: s.status === "queued" ? `In queue${s.position != null ? ` (#${s.position})` : ""}…` : "Animating… (30 s – 3 min)" })),
      });
      setClipStatus((p) => ({ ...p, [n]: "Downloading…" }));
      const blob = await fetchMediaBlob(result.videoUrl);
      const mediaKey = `${projectId}:clip:${n}:${Date.now().toString(36)}`;
      await putMedia(mediaKey, blob, { scene: n, provider });
      setClips((p) => ({ ...p, [n]: { jobId, status: "done", provider, prompt, mediaKey, durationSec: clipSec, createdAt: Date.now() } }));
      setClipStatus((p) => ({ ...p, [n]: "" }));
      return true;
    } catch (e) {
      setClips((p) => ({ ...p, [n]: { ...(p[n] || {}), status: "failed", error: e.message } }));
      setClipStatus((p) => ({ ...p, [n]: `✗ ${e.message}` }));
      return false;
    } finally {
      setBusyScene((p) => ({ ...p, [n]: false }));
    }
  }

  async function generateAll() {
    setError("");
    stopRef.current = false;
    setBusyAll(true);
    let made = 0, failed = 0;
    for (const sc of ordered) {
      if (stopRef.current) break;
      const c = clips && clips[sc.sceneNumber];
      if (c && c.mediaKey) continue;
      if (!images[sc.sceneNumber]) continue;
      const ok = await generateClip(sc);
      if (ok) made++; else failed++;
    }
    setBusyAll(false);
    if (failed) setError(`${made} clip${made === 1 ? "" : "s"} made, ${failed} failed — use "Retry" on those scenes.`);
  }

  // ---- render ----
  const [rendering, setRendering] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderMsg, setRenderMsg] = useState("");
  const [finalUrl, setFinalUrl] = useState("");
  const renderRef = useRef(null);
  const canvasRef = useRef(null);
  const [overlayOn, setOverlayOn] = useState(tl.lyricsOverlay !== false);

  useEffect(() => {
    let url = "";
    (async () => {
      if (!render || !render.mediaKey) { setFinalUrl(""); return; }
      const rec = await getMedia(render.mediaKey);
      if (!rec) { setFinalUrl(""); return; }
      url = URL.createObjectURL(rec.blob);
      setFinalUrl(url);
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [render && render.mediaKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startRender() {
    setError("");
    if (!audioUrl || !totalSec) { setError("Generate the song first (step 3)."); return; }
    if (!segments.length) { setError("No scenes with images yet (step 4)."); return; }
    if (!pickRenderMime()) { setError("This browser can't record video — use Chrome or Edge."); return; }
    setRendering(true);
    setRenderPct(0);
    const watermark = "";
    const job = renderMusicVideo(
      { width: 1920, height: 1080, fps: 30, audioUrl, totalSec, segments, lyricsOverlay: overlayOn, lyricsMode: tl.lyricsMode || "one", watermark },
      { previewCanvas: canvasRef.current, onProgress: (p, m) => { setRenderPct(p); setRenderMsg(m); }, onStatus: setRenderMsg }
    );
    renderRef.current = job;
    try {
      const { blob, ext, mime } = await job.promise;
      const mediaKey = `${projectId}:render:${Date.now().toString(36)}`;
      await putMedia(mediaKey, blob, { ext, mime });
      setRender({ mediaKey, ext, mime, createdAt: Date.now(), sizeMB: +(blob.size / 1048576).toFixed(1) });
      setRenderMsg(`Done — ${(blob.size / 1048576).toFixed(1)} MB ${ext.toUpperCase()}.`);
    } catch (e) {
      setError(`Render: ${e.message}`);
      setRenderMsg("");
    } finally {
      setRendering(false);
      renderRef.current = null;
    }
  }
  function cancelRender() { if (renderRef.current) renderRef.current.cancel(); }
  function downloadFinal() {
    if (!finalUrl) return;
    const a = document.createElement("a");
    a.href = finalUrl;
    const safe = (meta && meta.songTitle ? meta.songTitle : "music-video").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.download = `${safe}.${render.ext || "mp4"}`;
    a.click();
  }

  const clipsDone = ordered.filter((s) => clips && clips[s.sceneNumber] && clips[s.sceneNumber].mediaKey).length;
  const withImages = ordered.filter((s) => images[s.sceneNumber]).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Video</h2>
        {render && render.mediaKey && <button className="btn btn-primary btn-sm" onClick={onContinue}>Continue → Export</button>}
      </div>
      <p className="sub">
        Bring the storyboard to life: animate scenes into clips, set when each scene starts in the song,
        then render the finished music video right here.
      </p>

      {!songVersion && (
        <div className="talk-banner empty"><div className="talk-banner-text">
          <div className="talk-banner-title">No song yet</div>
          <div className="talk-banner-meta">The video is timed to the song. Generate it in step 3 first — you can still make clips now.</div>
        </div></div>
      )}
      {withImages === 0 && (
        <div className="talk-banner empty"><div className="talk-banner-text">
          <div className="talk-banner-title">No scene images yet</div>
          <div className="talk-banner-meta">Build the storyboard and generate images in step 4.</div>
        </div></div>
      )}
      {error && <div className="error">{error}</div>}

      {/* ---------------- CLIPS ---------------- */}
      <div className="video-card">
        <div className="panel-head">
          <h3>1 · Clips <span className="chip">{clipsDone} of {withImages} animated</span></h3>
          <div className="row" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="note" style={{ margin: 0 }}>Clip length</span>
              <select value={clipSec} onChange={(e) => setClipSec(Number(e.target.value))} disabled={provider === "veo"}>
                <option value={5}>5 s</option>
                <option value={8}>8 s</option>
                <option value={10}>10 s</option>
              </select>
            </label>
            <label className="row" style={{ gap: 6 }} title="Use the next scene's image as the clip's final frame so one scene flows into the next">
              <input type="checkbox" checked={blendNext} onChange={(e) => setBlendNext(e.target.checked)} />
              <span className="note" style={{ margin: 0 }}>Blend into next scene</span>
            </label>
            {!busyAll ? (
              <button className="btn btn-primary btn-sm" onClick={generateAll} disabled={withImages === 0}>Animate all scenes</button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => { stopRef.current = true; }}>Stop after this clip</button>
            )}
          </div>
        </div>
        <div className="provider-pick">
          {providers.map((p) => {
            const ok = hasKey(p.needs, serverKeys);
            return (
              <button key={p.id} className={`provider-btn${provider === p.id ? " active" : ""}${ok ? "" : " nokey"}`} onClick={() => setProvider(p.id)}>
                <strong>{p.name} {ok ? <span className="chip ok">ready</span> : <span className="chip warn">needs key</span>}</strong>
                <small>{p.note}</small>
              </button>
            );
          })}
        </div>
        <p className="note" style={{ marginTop: 0 }}>
          Scenes you don't animate still appear in the video as slow, drifting stills — so you can render
          with zero clips, or animate only the key moments to keep costs down.
        </p>
        <div className="clip-grid">
          {ordered.map((sc) => {
            const n = sc.sceneNumber;
            const c = clips && clips[n];
            const url = clipUrls[n];
            const busy = busyScene[n];
            return (
              <div className={`clip-card${c && c.mediaKey ? " done" : ""}${busy ? " busy" : ""}`} key={n}>
                <div className="clip-media">
                  {url ? <video src={url} muted loop playsInline controls /> : images[n] ? <img src={images[n]} alt="" /> : <div className="scene-image placeholder" style={{ margin: 0, border: 0, borderRadius: 0 }}>no image</div>}
                  <span className={`clip-tag${c && c.mediaKey ? " ok" : ""}`}>{c && c.mediaKey ? "▶ clip" : busy ? "…" : "still"}</span>
                </div>
                <div className="clip-body">
                  <div className="clip-name">Scene {n} <span className="note" style={{ margin: 0, display: "inline" }}>· starts {fmt((tl.starts || {})[n] || 0)}</span></div>
                  {sc.lyrics && <div className="clip-lyric">♪ {sc.lyrics}</div>}
                  <textarea
                    placeholder="Motion prompt (optional — auto from the scene)"
                    value={prompts[n] ?? (c && c.prompt) ?? ""}
                    onChange={(e) => setPrompts((p) => ({ ...p, [n]: e.target.value }))}
                  />
                  {clipStatus[n] && <div className={`clip-status${clipStatus[n].startsWith("✗") ? " err" : ""}`}>{clipStatus[n]}</div>}
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" disabled={busy || busyAll || !images[n]} onClick={() => generateClip(sc)}>
                      {busy && <span className="spinner" />}
                      {busy ? "Working…" : c && c.mediaKey ? "Redo clip" : c && c.status === "failed" ? "Retry" : "Animate"}
                    </button>
                    {c && c.mediaKey && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setClips((p) => { const x = { ...p }; delete x[n]; return x; })}>Use still</button>
                    )}
                  </div>
                  <ShotsEditor {...shotsProps(n)} primaryTitle={c && c.mediaKey ? "Camera motion used after the clip finishes, while the last frame holds" : "Camera motion over this still"} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- TIMELINE ---------------- */}
      <div className="video-card" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3>2 · Timeline {totalSec ? <span className="chip">{fmt(totalSec)} song</span> : <span className="chip warn">needs the song</span>}</h3>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={autoTime} disabled={!totalSec}>Auto-time by lyrics</button>
            {tapIdx < 0 && lineTapIdx < 0 && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={startTap} disabled={!audioUrl || !ordered.length} title="Play the song and tap 'Next scene' each time the next scene should begin">▶ Tap scenes</button>
                <button className="btn btn-ghost btn-sm" onClick={startLineTap} disabled={!audioUrl || !lineList.length} title="Play the song and tap (or press Space) each time the next lyric LINE is sung — sets scene starts and per-line timing">▶ Tap lines{tappedLineCount ? ` (${tappedLineCount} set)` : ""}</button>
              </>
            )}
            {tapIdx >= 0 && (
              <>
                <button className="btn btn-primary tap-btn armed" onClick={tapNext}>Next scene → Scene {ordered[tapIdx] ? ordered[tapIdx].sceneNumber : ""} ({fmt(tapTime)})</button>
                <button className="btn btn-ghost btn-sm" onClick={stopTap}>Stop</button>
              </>
            )}
            {lineTapIdx >= 0 && (
              <button className="btn btn-ghost btn-sm" onClick={stopLineTap}>Cancel (Esc)</button>
            )}
          </div>
        </div>
        <audio ref={tapAudioRef} src={audioUrl || undefined} onTimeUpdate={(e) => setTapTime(e.target.currentTime)} onEnded={() => { if (lineTapIdx >= 0) finishLineTap(); }} style={{ display: "none" }} />
        {lineTapIdx >= 0 && lineList[lineTapIdx] && (
          <div className="music-card" style={{ margin: "10px 0", borderColor: "var(--success)" }}>
            <div className="note" style={{ margin: "0 0 6px" }}>
              Line {lineTapIdx + 1} of {lineList.length} · Scene {lineList[lineTapIdx].scene} · {fmt(tapTime)} — press <strong>Space</strong> or the button the moment this line is sung:
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--cloud)", margin: "4px 0 10px" }}>♪ {lineList[lineTapIdx].text}</div>
            {lineList[lineTapIdx + 1] && <div className="note" style={{ margin: "0 0 10px" }}>next: {lineList[lineTapIdx + 1].text}</div>}
            <button className="btn btn-primary tap-btn armed" onClick={tapNextLine}>This line starts now</button>
          </div>
        )}
        {totalSec ? (
          <>
            <div className="timeline-bar">
              {segments.map((s, i) => (
                <div
                  key={i}
                  className={`timeline-seg${s.isCard ? " card" : s.kind === "video" ? " clip" : ""}`}
                  style={{ left: `${(s.start / totalSec) * 100}%`, width: `${Math.max(0.5, ((s.end - s.start) / totalSec) * 100)}%` }}
                  title={`${s.label} · ${fmt(s.start)}–${fmt(s.end)}`}
                >
                  {s.label.replace("Scene ", "")}
                </div>
              ))}
              {tapIdx >= 0 && <div className="timeline-head" style={{ left: `${(tapTime / totalSec) * 100}%` }} />}
            </div>
            <div className="timeline-rows">
              {includeIntro && (
                <div className="timeline-row"><span className="lbl2">Intro card length (before Scene 1)</span><input type="number" min="0" step="0.5" value={tl.introSec} onChange={(e) => setTimeline({ ...tl, introSec: Number(e.target.value) || 0 })} /> s</div>
              )}
              {ordered.map((sc) => (
                <div className="timeline-row" key={sc.sceneNumber}>
                  <span className="lbl2">Scene {sc.sceneNumber}{sc.lyrics ? ` · ${sc.lyrics.slice(0, 30)}` : ""}</span>
                  <input type="number" min="0" step="0.5" value={(tl.starts || {})[sc.sceneNumber] ?? 0} onChange={(e) => setStart(sc.sceneNumber, e.target.value)} /> s
                </div>
              ))}
              {includeOutro && (
                <div className="timeline-row"><span className="lbl2">Outro card length</span><input type="number" min="0" step="0.5" value={tl.outroSec} onChange={(e) => setTimeline({ ...tl, outroSec: Number(e.target.value) || 0 })} /> s</div>
              )}
            </div>
            <div className="clip-grid" style={{ marginTop: 12 }}>
              {[
                { key: "intro", label: "Intro card", on: includeIntro, has: hasIntro, img: hasIntro ? endcards.intro.image : "", toggle: (v) => setTimeline({ ...tl, includeIntro: v }) },
                { key: "outro", label: "Outro card", on: includeOutro, has: hasOutro, img: hasOutro ? endcards.outro.image : "", toggle: (v) => setTimeline({ ...tl, includeOutro: v }) },
              ].map((cd) => (
                <div className={`clip-card${cd.on ? "" : " off"}`} key={cd.key}>
                  <div className="clip-media">
                    {cd.img ? <img src={cd.img} alt="" /> : (
                      <div className="textcard-preview">
                        <span className="textcard-kicker">{cd.key === "intro" ? "Conference As A Concert" : ""}</span>
                        <span className="textcard-title">{(meta && meta.songTitle) || "Song title"}</span>
                        <span className="textcard-line">{cd.key === "intro" ? (meta && meta.speaker ? `Adapted from a talk given by ${meta.speaker}` : "") : "If this message touched your heart…"}</span>
                      </div>
                    )}
                    <span className={`clip-tag${cd.has ? " ok" : ""}`}>{cd.has ? "designed image" : "text card"}</span>
                  </div>
                  <div className="clip-body">
                    <label className="row" style={{ gap: 6 }}>
                      <input type="checkbox" checked={cd.on} onChange={(e) => cd.toggle(e.target.checked)} />
                      <span className="clip-name">{cd.label}</span>
                    </label>
                    {!cd.has && <span className="note" style={{ margin: 0 }}>Drawn from the title & credits. Generate the card image on the Storyboard step for a designed one.</span>}
                    {cd.on && <ShotsEditor {...shotsProps(cd.key)} primaryTitle="Camera motion over the card" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 14, marginTop: 10 }}>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={overlayOn} onChange={(e) => { setOverlayOn(e.target.checked); setTimeline({ ...tl, lyricsOverlay: e.target.checked }); }} />
                <span className="note" style={{ margin: 0 }}>Show lyrics on screen</span>
              </label>
              {overlayOn && tappedLineCount > 0 && (
                <span className="note" style={{ margin: 0 }}>
                  <span className="chip ok">line timing from your taps</span>{" "}
                  <button className="btn btn-ghost btn-sm" onClick={() => setTimeline({ ...tl, lineStarts: {} })}>Clear line taps</button>
                </span>
              )}
              {overlayOn && tappedLineCount === 0 && (
                <label className="row" style={{ gap: 6 }} title="How much of each scene's lyric shows at once. Lines share the scene's time evenly and fade between.">
                  <span className="note" style={{ margin: 0 }}>Show</span>
                  <select value={tl.lyricsMode || "one"} onChange={(e) => setTimeline({ ...tl, lyricsMode: e.target.value })}>
                    <option value="one">one line at a time</option>
                    <option value="two">two lines at a time</option>
                    <option value="all">the whole stanza</option>
                  </select>
                </label>
              )}
            </div>
          </>
        ) : (
          <p className="note">Generate the song in step 3 and the timeline appears here.</p>
        )}
      </div>

      {/* ---------------- RENDER ---------------- */}
      <div className="video-card" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3>3 · Render the music video</h3>
          <div className="row" style={{ gap: 8 }}>
            {!rendering ? (
              <button className="btn btn-primary" onClick={startRender} disabled={!audioUrl || !segments.length}>
                {render && render.mediaKey ? "Render again" : "Render 1080p video"}
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={cancelRender}>Cancel</button>
            )}
          </div>
        </div>
        <p className="note" style={{ marginTop: 0 }}>
          Rendering happens in your browser in real time — a 3-minute song takes about 3 minutes. Keep this
          tab open and visible (Chrome or Edge). Nothing is uploaded.
        </p>
        <div className="render-stage">
          <canvas ref={canvasRef} className="render-preview" style={{ display: rendering ? "block" : "none" }} />
          {(rendering || renderMsg) && (
            <div className="status-line">
              {rendering && <span className="spinner" />}
              <span>{renderMsg}</span>
              {rendering && <div className="progress"><span style={{ width: `${Math.round(renderPct * 100)}%` }} /></div>}
            </div>
          )}
          {finalUrl && !rendering && (
            <div className="render-final">
              <video src={finalUrl} controls playsInline />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-primary" onClick={downloadFinal}>Download {render.ext ? render.ext.toUpperCase() : "video"}{render.sizeMB ? ` (${render.sizeMB} MB)` : ""}</button>
                <span className="note" style={{ margin: 0 }}>Rendered {new Date(render.createdAt).toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
