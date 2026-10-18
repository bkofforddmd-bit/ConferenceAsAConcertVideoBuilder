// src/components/ReactionRecorder.jsx — film a listener's reaction right in
// the Studio (front or back camera), with the question being asked shown big
// so it can be read aloud. Keep → the clip goes into the Q&A intro, where it's
// transcribed and opens with a question card.
import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_QUESTIONS } from "../campus/questions.js";

const MAX_SEC = 180;
function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4", 'video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', "video/webm"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return "";
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function ReactionRecorder({ onKeep, defaultQuestion }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | live | recording | review | saving
  const [question, setQuestion] = useState(defaultQuestion || DEFAULT_QUESTIONS[3]);
  const [custom, setCustom] = useState(false);
  const [facing, setFacing] = useState("user");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const vref = useRef(null), streamRef = useRef(null), recRef = useRef(null), chunks = useRef([]), blobRef = useRef(null), urlRef = useRef(""), timer = useRef(0);

  useEffect(() => () => { stop(); clearInterval(timer.current); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function stop() { if (streamRef.current) { streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} }); streamRef.current = null; } }
  async function camera(face = facing) {
    setErr(""); stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      streamRef.current = s;
      const v = vref.current; if (v) { v.srcObject = s; v.muted = true; v.controls = false; await v.play().catch(() => {}); }
      setPhase("live");
    } catch (e) { setErr(e && e.name === "NotAllowedError" ? "Camera access was blocked — allow the camera and microphone for this site." : `Couldn't open the camera: ${e.message || e}`); setPhase("idle"); }
  }
  function record() {
    const mime = pickMime();
    if (!mime || !streamRef.current) { setErr("This browser can't record video (use Chrome, Edge or Safari)."); return; }
    chunks.current = [];
    const r = new MediaRecorder(streamRef.current, { mimeType: mime, videoBitsPerSecond: 3_500_000, audioBitsPerSecond: 128_000 });
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: mime.split(";")[0] });
      blobRef.current = blob;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      stop();
      const v = vref.current; if (v) { v.srcObject = null; v.muted = false; v.src = urlRef.current; v.controls = true; }
      setPhase("review");
    };
    recRef.current = r; r.start(1000);
    setSecs(0); setPhase("recording");
    const t0 = Date.now();
    clearInterval(timer.current);
    timer.current = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); setSecs(s); if (s >= MAX_SEC) finish(); }, 250);
  }
  function finish() { clearInterval(timer.current); try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch {} }
  async function keep() {
    if (!blobRef.current) return;
    setPhase("saving");
    try { await onKeep(blobRef.current, question.trim()); blobRef.current = null; close(); }
    catch (e) { setErr(e.message || String(e)); setPhase("review"); }
  }
  function close() { finish(); stop(); setPhase("idle"); setOpen(false); const v = vref.current; if (v) { v.removeAttribute("src"); v.load(); } }

  if (!open) return <button className="btn btn-primary" onClick={() => { setOpen(true); camera(); }}>🎥 Record a reaction</button>;
  return (
    <div className="reaction-rec">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="note" style={{ margin: 0 }}>Ask:</span>
        {custom ? (
          <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} style={{ flex: 1, minWidth: 220 }} disabled={phase === "recording"} />
        ) : (
          <select value={DEFAULT_QUESTIONS.includes(question) ? question : ""} onChange={(e) => { if (e.target.value === "__own") { setCustom(true); setQuestion(""); } else setQuestion(e.target.value); }} disabled={phase === "recording"} style={{ flex: 1, minWidth: 220 }}>
            {DEFAULT_QUESTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
            <option value="__own">✏️ Ask something else…</option>
          </select>
        )}
        <button className="btn btn-ghost btn-sm" onClick={close}>Close</button>
      </div>
      <div className="reaction-question">“{question || "…"}”</div>
      <video ref={vref} playsInline autoPlay className="reaction-video" />
      {phase === "recording" && <div className="reaction-rec-dot">● REC {fmt(secs)}</div>}
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {phase === "live" && <><button className="btn btn-primary" onClick={record}>● Start recording</button><button className="btn btn-ghost" onClick={() => { const f = facing === "user" ? "environment" : "user"; setFacing(f); camera(f); }}>🔄 Flip camera</button></>}
        {phase === "recording" && <button className="btn btn-primary" onClick={finish}>■ Stop ({fmt(secs)} / {fmt(MAX_SEC)})</button>}
        {phase === "review" && <><button className="btn btn-primary" onClick={keep}>✓ Keep — add to the intro</button><button className="btn btn-ghost" onClick={() => { blobRef.current = null; camera(); }}>Retake</button></>}
        {phase === "saving" && <span className="note" style={{ margin: 0 }}><span className="spinner" /> Adding…</span>}
        {phase === "idle" && !err && <span className="note" style={{ margin: 0 }}>Opening the camera…</span>}
      </div>
      {err && <p className="note" style={{ color: "var(--danger)" }}>{err}</p>}
    </div>
  );
}
