// src/campus/VideoRecorder.jsx — a small in-app camera window for Campus
// Sessions: record a student's reaction or testimony on the phone, preview
// it, keep it (uploads straight to the private R2 bucket) or retake. Only
// shown when the student authorized recording.
import React, { useEffect, useRef, useState } from "react";
import { mediaApi } from "./campus-api.js";

const MAX_SEC = 180;
const STAGE_LABEL = { "lyrics-reaction": "Reaction to the lyrics", "song-reaction": "Reaction to the song", testimony: "Closing testimony / interview", other: "Clip" };

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4", 'video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', "video/webm"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return "";
}

export default function VideoRecorder({ sessionId, stage, clips = [], onClips, compact = false }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | live | recording | review | uploading
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);
  const [pct, setPct] = useState(0);
  const [facing, setFacing] = useState("user");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const urlRef = useRef("");
  const timerRef = useRef(null);
  const mine = clips.filter((c) => c.stage === stage);

  useEffect(() => () => { stopStream(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); clearInterval(timerRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopStream() {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} }); streamRef.current = null; }
  }

  async function startCamera(face = facing) {
    setErr("");
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; v.muted = true; await v.play().catch(() => {}); }
      setPhase("live");
    } catch (e) {
      setErr(e && e.name === "NotAllowedError" ? "Camera access was blocked — allow the camera and microphone for this site in the browser settings." : `Couldn't open the camera: ${e.message || e}`);
      setPhase("idle");
    }
  }

  function startRecording() {
    const mime = pickMime();
    if (!mime || !streamRef.current) { setErr("This browser can't record video. On iPhone use Safari; on Android use Chrome."); return; }
    chunksRef.current = [];
    const rec = new MediaRecorder(streamRef.current, { mimeType: mime, videoBitsPerSecond: 3_500_000, audioBitsPerSecond: 128_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      blobRef.current = blob;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      stopStream();
      const v = videoRef.current;
      if (v) { v.srcObject = null; v.muted = false; v.src = urlRef.current; v.controls = true; }
      setPhase("review");
    };
    recRef.current = rec;
    rec.start(1000);
    setSecs(0);
    setPhase("recording");
    const t0 = Date.now();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSecs(s);
      if (s >= MAX_SEC) stopRecording();
    }, 250);
  }
  function stopRecording() {
    clearInterval(timerRef.current);
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch {}
  }
  async function retake() {
    blobRef.current = null;
    const v = videoRef.current;
    if (v) { v.controls = false; v.removeAttribute("src"); v.load(); }
    await startCamera();
  }
  async function keep() {
    const blob = blobRef.current;
    if (!blob) return;
    setPhase("uploading"); setPct(0); setErr("");
    try {
      const { clip, uploadUrl } = await mediaApi.signUpload(sessionId, stage, blob.type, blob.size);
      await putWithProgress(uploadUrl, blob, blob.type, setPct);
      const r = await mediaApi.confirm(sessionId, clip.id, blob.size, secs);
      onClips && onClips([...clips, r.clip]);
      blobRef.current = null;
      const v = videoRef.current;
      if (v) { v.controls = false; v.removeAttribute("src"); v.load(); }
      setPhase("idle");
      setOpen(false);
    } catch (e) {
      setErr(`Couldn't save the clip: ${e.message || e}`);
      setPhase("review");
    }
  }
  async function remove(c) {
    try { await mediaApi.remove(sessionId, c.id); onClips && onClips(clips.filter((x) => x.id !== c.id)); } catch (e) { setErr(e.message); }
  }
  function close() { stopRecording(); stopStream(); setPhase("idle"); setOpen(false); }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className={`vr ${compact ? "vr-compact" : ""}`}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="c-worker-tag" style={{ margin: 0 }}>🎥 Video</span>
        <span className="c-note" style={{ margin: 0 }}>{STAGE_LABEL[stage] || "Clip"}{mine.length ? ` · ${mine.length} saved` : ""}</span>
        {!open && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpen(true); startCamera(); }}>Record</button>}
        {open && <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Close</button>}
      </div>
      {mine.length > 0 && !open && (
        <div className="vr-saved">
          {mine.map((c) => (
            <div key={c.id} className="vr-saved-row">
              <video src={c.url} controls playsInline preload="metadata" />
              <div className="c-note" style={{ margin: 0 }}>{c.durationSec ? fmt(Math.round(c.durationSec)) : ""} · {(c.bytes / 1048576).toFixed(1)} MB <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(c)}>Delete</button></div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div className="vr-window">
          <video ref={videoRef} playsInline autoPlay className="vr-video" />
          {phase === "recording" && <div className="vr-rec">● REC {fmt(secs)}</div>}
          {phase === "uploading" && <div className="vr-rec" style={{ background: "rgba(46,95,169,0.85)" }}>Saving… {Math.round(pct * 100)}%</div>}
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {phase === "live" && <>
              <button type="button" className="c-btn primary" style={{ margin: 0, flex: 1 }} onClick={startRecording}>● Start recording</button>
              <button type="button" className="btn btn-ghost" onClick={() => { const f = facing === "user" ? "environment" : "user"; setFacing(f); startCamera(f); }}>🔄 Flip</button>
            </>}
            {phase === "recording" && <button type="button" className="c-btn danger" style={{ margin: 0, flex: 1 }} onClick={stopRecording}>■ Stop ({fmt(secs)} / {fmt(MAX_SEC)})</button>}
            {phase === "review" && <>
              <button type="button" className="c-btn primary" style={{ margin: 0, flex: 1 }} onClick={keep}>✓ Keep this clip</button>
              <button type="button" className="btn btn-ghost" onClick={retake}>Retake</button>
            </>}
            {phase === "idle" && !err && <span className="c-note">Opening the camera…</span>}
          </div>
          {phase === "live" && <p className="c-note" style={{ margin: "6px 0 0" }}>Tell the student when you start and stop. Up to {MAX_SEC / 60} minutes per clip.</p>}
        </div>
      )}
      {err && <div className="c-err">{err}</div>}
    </div>
  );
}

function putWithProgress(url, blob, contentType, onPct) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`storage answered ${xhr.status} — check the bucket's CORS rule and the R2 variables`)));
    xhr.onerror = () => reject(new Error("the upload was blocked — the bucket's CORS rule must allow this site"));
    xhr.send(blob);
  });
}
