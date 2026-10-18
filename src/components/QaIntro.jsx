// src/components/QaIntro.jsx — the "Q&A intro" for a music video.
//
// Before the song: [ Conference As A Concert question card — the question
// writes itself out — crossfading into the student's answer, captioned ] × N.
// Answers come from the campus session's recorded clips (each saved with the
// question the worker asked) or from uploaded files. Every answer can be
// transcribed by AI (the same auto-caption job as the closing clip) and the
// captions corrected by hand.
//
// tl.qaIntro = { on, cardSec, fade, items: [{ id, question, mediaKey, kind,
//   clipId, name, in, out, duration, fade, captions }] }
// The answer videos are copied into this browser's project storage
// (<projectId>:qa:<id>) so they render offline and never expire.

import React, { useEffect, useRef, useState } from "react";
import { putMedia, getMedia, deleteMedia } from "../lib/project-store.js";
import { drawQuestionPreview, QUESTION_BG } from "../lib/video-render.js";
import { autoCaptionClip } from "../lib/clip-audio.js";
import { mediaApi } from "../campus/campus-api.js";
import { STAGE_LABEL, DEFAULT_QUESTIONS } from "../campus/questions.js";
import { ClipCard } from "./Bookends.jsx";

const newId = () => "qa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtS = (t) => { t = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

function videoDuration(blob) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(blob);
    v.onloadedmetadata = () => {
      // MediaRecorder files often report Infinity until seeked to the end
      if (Number.isFinite(v.duration) && v.duration > 0) { const d = v.duration; URL.revokeObjectURL(url); resolve(d); return; }
      v.currentTime = 1e7;
      v.ontimeupdate = () => { v.ontimeupdate = null; const d = v.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

function CardPreview({ question, index, count, plain }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) drawQuestionPreview(ref.current, { question, index, count, bgSrc: plain ? "" : QUESTION_BG }); }, [question, index, count, plain]);
  return <canvas ref={ref} width={640} height={360} className="qa-card-preview" title="The question card (shown fully written; in the video it writes itself out)" />;
}

export default function QaIntro({ projectId, tl, setTimeline, campusSessionId }) {
  const qa = tl.qaIntro || { on: false, cardSec: 4, fade: 0.8, items: [] };
  const items = qa.items || [];
  // async work (download, transcribe) must update the LATEST timeline
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const setQa = (patch) => {
    const cur = tlRef.current.qaIntro || { on: true, cardSec: 4, fade: 0.8, items: [] };
    const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
    tlRef.current = { ...tlRef.current, qaIntro: next };
    setTimeline(tlRef.current);
  };
  const setItem = (id, patch) => setQa((cur) => ({ items: (cur.items || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const [campus, setCampus] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState({}); // id -> text
  const [upQ, setUpQ] = useState(DEFAULT_QUESTIONS[0]);

  useEffect(() => {
    if (!campusSessionId) return;
    let alive = true;
    mediaApi.list(campusSessionId).then((r) => { if (alive) setCampus(r.clips || []); }).catch((e) => { if (alive) { setCampus([]); setMsg(`Couldn't load the session's clips: ${e.message || e}. Sign in at /campus in this browser first.`); } });
    return () => { alive = false; };
  }, [campusSessionId]);

  async function transcribe(item, blobIn) {
    setBusy((b) => ({ ...b, [item.id]: "Transcribing…" }));
    try {
      const blob = blobIn || (await getMedia(item.mediaKey))?.blob;
      if (!blob) throw new Error("The answer's video isn't in this browser's storage.");
      const phrases = await autoCaptionClip(blob, { onStep: (s) => setBusy((b) => ({ ...b, [item.id]: s })) });
      setItem(item.id, { captions: { on: true, text: phrases.map((p) => p.text).join("\n"), marks: phrases.map((p) => p.start), auto: true } });
      setBusy((b) => { const n = { ...b }; delete n[item.id]; return n; });
    } catch (e) {
      setBusy((b) => ({ ...b, [item.id]: `Couldn't transcribe: ${e.message || e}` }));
    }
  }

  async function addBlob(blob, base) {
    const id = newId();
    const mediaKey = `${projectId}:qa:${id}`;
    await putMedia(mediaKey, blob, { source: base.kind, name: base.name });
    const duration = Math.round((await videoDuration(blob)) * 10) / 10 || base.duration || 0;
    const item = { id, mediaKey, in: 0, out: duration, duration, fade: 0.8, captions: null, ...base };
    setQa((cur) => ({ on: true, items: [...(cur.items || []), item] }));
    return { item, blob };
  }

  async function addCampus(c) {
    setMsg(""); setBusy((b) => ({ ...b, [c.id]: "Downloading…" }));
    try {
      const res = await fetch(c.url);
      if (!res.ok) throw new Error(`storage answered ${res.status}`);
      const blob = await res.blob();
      const { item } = await addBlob(blob, { kind: "campus", clipId: c.id, name: STAGE_LABEL[c.stage] || "Campus clip", question: c.question || DEFAULT_QUESTIONS[0], duration: c.durationSec || 0 });
      setBusy((b) => { const n = { ...b }; delete n[c.id]; return n; });
      transcribe(item, blob); // starts right away — a fraction of a cent per answer
    } catch (e) { setBusy((b) => ({ ...b, [c.id]: `Couldn't add: ${e.message || e}` })); }
  }

  async function addUpload(file) {
    if (!file) return;
    setMsg("");
    try {
      if (!/^video\//.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) throw new Error("Choose a video file (MP4, WebM or MOV).");
      const { item, blob } = await addBlob(file, { kind: "upload", name: file.name, question: upQ });
      if (!item.duration) throw new Error("That file couldn't be read as a video in this browser (iPhone MOV files often need converting to MP4).");
      transcribe(item, blob);
    } catch (e) { setMsg(e.message || String(e)); }
  }

  async function remove(item) {
    try { await deleteMedia(item.mediaKey); } catch {}
    setQa((cur) => ({ items: (cur.items || []).filter((x) => x.id !== item.id) }));
  }
  const move = (i, dir) => setQa((cur) => { const a = (cur.items || []).slice(); const j = i + dir; if (j < 0 || j >= a.length) return {}; [a[i], a[j]] = [a[j], a[i]]; return { items: a }; });

  const used = new Set(items.map((x) => x.clipId).filter(Boolean));
  const cardSec = qa.cardSec || 4;
  const total = items.reduce((a, x) => a + cardSec + Math.max(0, (Number(x.out) || x.duration || 0) - (Number(x.in) || 0)), 0);
  const untranscribed = items.filter((x) => !(x.captions && x.captions.on) && !busy[x.id]);

  return (
    <div className="qa-intro">
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={Boolean(qa.on)} onChange={(e) => setQa({ on: e.target.checked })} /> <strong>Use the Q&amp;A intro</strong></label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>Question card
          <select value={cardSec} onChange={(e) => setQa({ cardSec: Number(e.target.value) })}>{[3, 4, 5, 6, 8].map((v) => <option key={v} value={v}>{v} s</option>)}</select>
        </label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>Card background
          <select value={qa.background === "plain" ? "plain" : "art"} onChange={(e) => setQa({ background: e.target.value })}>
            <option value="art">Temple at sunrise (artwork)</option>
            <option value="plain">Plain navy with the logo</option>
          </select>
        </label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>Card → answer crossfade
          <select value={qa.fade || 0.8} onChange={(e) => { const f = Number(e.target.value); setQa((cur) => ({ fade: f, items: (cur.items || []).map((x) => ({ ...x, fade: f })) })); }}>{[0.5, 0.8, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v} s</option>)}</select>
        </label>
        {items.length > 0 && <span className="note" style={{ margin: 0 }}>{items.length} question{items.length === 1 ? "" : "s"} · about {fmtS(total)} before the song</span>}
      </div>
      <p className="note">Each answer opens with a Conference As A Concert card. The question writes itself out, then the card crossfades into the student answering, with captions. The answers play back to back, then the song begins.</p>

      {items.map((it, i) => (
        <div key={it.id} className="qa-item">
          <div className="qa-item-head">
            <strong>Question {i + 1}</strong>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
              <button className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1}>▼</button>
            </span>
          </div>
          <div className="qa-item-grid">
            <div>
              <CardPreview question={it.question} index={i} count={items.length} plain={qa.background === "plain"} />
              <label className="field-label" style={{ display: "block", marginTop: 6 }}>Question on the card</label>
              <textarea value={it.question || ""} maxLength={200} onChange={(e) => setItem(it.id, { question: e.target.value })} style={{ width: "100%", minHeight: 54, boxSizing: "border-box" }} />
            </div>
            <div>
              <ClipCard clip={it} title="The answer" alwaysCaption captionLabel="Caption the answer (the transcript)" autoLabel="✨ Transcribe this answer" onChange={(c) => setItem(it.id, c)} onRemove={() => remove(it)} />
              {busy[it.id] && <p className="note" style={{ margin: "4px 0 0" }}>{busy[it.id]}</p>}
            </div>
          </div>
        </div>
      ))}

      {untranscribed.length > 0 && (
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => untranscribed.forEach((x) => transcribe(x))}>✨ Transcribe {untranscribed.length} answer{untranscribed.length === 1 ? "" : "s"}</button>
      )}

      {campusSessionId && (
        <div className="talk-picker" style={{ marginTop: 12 }}>
          <strong>Answers recorded in the campus session</strong>
          {campus === null && <p className="note">Loading the session's clips…</p>}
          {campus && campus.length === 0 && !msg && <p className="note">This session has no video clips yet.</p>}
          {campus && campus.filter((c) => !used.has(c.id)).map((c) => (
            <div key={c.id} className="para-row" style={{ display: "flex", gap: 10, alignItems: "center", cursor: "default" }}>
              <video src={c.url} controls playsInline preload="metadata" style={{ width: 140, borderRadius: 6, background: "#000" }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--cloud)" }}>{c.question ? `“${c.question}”` : <em>No question saved — you can type it after adding</em>}</div>
                <div className="note" style={{ margin: 0 }}>{STAGE_LABEL[c.stage] || "Clip"}{c.durationSec ? ` · ${Math.round(c.durationSec)} s` : ""}</div>
                {busy[c.id] && <div className="note" style={{ margin: 0 }}>{busy[c.id]}</div>}
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => addCampus(c)} disabled={Boolean(busy[c.id])}>＋ Add</button>
            </div>
          ))}
          {campus && campus.length > 0 && campus.every((c) => used.has(c.id)) && <p className="note">All of this session's clips are in the intro.</p>}
        </div>
      )}

      <div className="talk-picker" style={{ marginTop: 12 }}>
        <strong>Add an answer from a video file</strong>
        <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select value={DEFAULT_QUESTIONS.includes(upQ) ? upQ : "__own"} onChange={(e) => setUpQ(e.target.value === "__own" ? "" : e.target.value)} style={{ maxWidth: 420 }}>
            {DEFAULT_QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
            <option value="__own">✏️ My own question…</option>
          </select>
          {!DEFAULT_QUESTIONS.includes(upQ) && <input value={upQ} onChange={(e) => setUpQ(e.target.value)} placeholder="The question that was asked" style={{ flex: 1, minWidth: 220 }} />}
          <label className="btn btn-ghost" style={{ cursor: "pointer" }}>⬆ Choose the answer video
            <input type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { addUpload(e.target.files && e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {msg && <p className="note" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}
