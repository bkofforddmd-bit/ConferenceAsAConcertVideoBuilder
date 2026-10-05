// Opening & closing clips ("bookends") for the music video.
//
//   Opening: an uploaded clip of a person introducing the talk — what they
//            loved most and the song line that matches it. Trimmed with
//            start/end points; plays with its own sound before the intro card.
//   Closing: the conference speaker's own words — found in the talk's
//            official video ("Find the moment": paragraph list with times,
//            AI-pinned or estimated), marked with start/end, captured to a
//            local clip, and played after the outro card. Or an uploaded file.
//
// Clips live in the project's media store (IndexedDB) under
//   <projectId>:bookend:pre / :post
// and the timeline carries { mediaKey, name, in, out, duration, kind, quote }.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { putMedia, getMedia, deleteMedia } from "../lib/project-store.js";
import { resolveTalkMedia, proxiedMediaUrl, talkTimesStart, jobStatus, pollJob } from "../lib/api.js";
import { captureClip } from "../lib/video-render.js";

const fmt = (t) => { t = Math.max(0, Number(t) || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`; };
const fmtS = (t) => { t = Math.max(0, Math.round(Number(t) || 0)); const m = Math.floor(t / 60), s = t % 60; return `${m}:${String(s).padStart(2, "0")}`; };

function videoDuration(blob) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(blob);
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

function useMediaUrl(mediaKey) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let u = "";
    (async () => {
      if (!mediaKey) { setUrl(""); return; }
      const rec = await getMedia(mediaKey);
      if (!rec) { setUrl(""); return; }
      u = URL.createObjectURL(rec.blob);
      setUrl(u);
    })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [mediaKey]);
  return url;
}

// ---- a stored clip: preview + trim + remove ----
function ClipCard({ clip, title, onChange, onRemove }) {
  const url = useMediaUrl(clip.mediaKey);
  const ref = useRef(null);
  const [t, setT] = useState(0);
  const inAt = Number(clip.in) || 0, outAt = Number(clip.out) || clip.duration || 0;
  const len = Math.max(0, outAt - inAt);
  function preview() {
    const v = ref.current; if (!v) return;
    v.currentTime = inAt; v.play();
    const stop = () => { if (v.currentTime >= outAt - 0.05) { v.pause(); v.removeEventListener("timeupdate", stop); } };
    v.addEventListener("timeupdate", stop);
  }
  const trimmable = clip.kind === "upload";
  return (
    <div className="bookend-card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{title}</strong>
        <span className="note" style={{ margin: 0 }}>{clip.name || (clip.kind === "talk" ? "from the talk's video" : "clip")} · {fmt(len)} used</span>
      </div>
      {url && <video ref={ref} src={url} controls playsInline className="bookend-video" onTimeUpdate={(e) => setT(e.target.currentTime)} />}
      {clip.quote && <div className="note" style={{ margin: "4px 0 0" }}>“{clip.quote}”</div>}
      {trimmable && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <label className="row" style={{ gap: 4 }}>Start <input type="number" step="0.1" min="0" value={inAt} onChange={(e) => onChange({ ...clip, in: Math.max(0, Math.min(outAt - 0.5, Number(e.target.value) || 0)) })} style={{ width: 70 }} /> s</label>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...clip, in: Math.max(0, Math.min(outAt - 0.5, Math.round(t * 10) / 10)) })}>⟦ Start at playhead ({fmt(t)})</button>
          <label className="row" style={{ gap: 4 }}>End <input type="number" step="0.1" min="0" value={outAt} onChange={(e) => onChange({ ...clip, out: Math.max(inAt + 0.5, Math.min(clip.duration || 1e9, Number(e.target.value) || 0)) })} style={{ width: 70 }} /> s</label>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...clip, out: Math.max(inAt + 0.5, Math.min(clip.duration || t, Math.round(t * 10) / 10)) })}>End at playhead ⟧</button>
          <button className="btn btn-ghost btn-sm" onClick={preview}>▶ Preview the trimmed part</button>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={onRemove}>Remove clip</button>
      </div>
    </div>
  );
}

function UploadBox({ label, hint, onFile, busy }) {
  const inputRef = useRef(null);
  return (
    <div className="bookend-upload">
      <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ""; }} />
      <button className="btn btn-primary btn-sm" onClick={() => inputRef.current && inputRef.current.click()} disabled={busy}>{busy ? "Saving…" : label}</button>
      {hint && <span className="note" style={{ margin: 0 }}>{hint}</span>}
    </div>
  );
}

// ---- the talk's own video: find the moment, mark it, capture it ----
function TalkClipPicker({ projectId, talkMeta, talkText, onCaptured }) {
  const [media, setMedia] = useState(null); // { audioUrl, video:{p360,p720,p1080} }
  const [quality, setQuality] = useState("p720");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const vref = useRef(null);
  const [dur, setDur] = useState(0);
  const [t, setT] = useState(0);
  const [inAt, setInAt] = useState(null);
  const [outAt, setOutAt] = useState(null);
  const [q, setQ] = useState("");
  const [times, setTimes] = useState(null); // AI-pinned seconds per paragraph
  const [timing, setTiming] = useState("");
  const [picked, setPicked] = useState(-1);
  const [capMsg, setCapMsg] = useState("");

  const paragraphs = useMemo(() => String(talkText || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 20), [talkText]);
  // Estimated start of each paragraph by its share of the text (until AI pins them).
  const estimates = useMemo(() => {
    const total = paragraphs.reduce((a, p) => a + p.length, 0) || 1;
    let acc = 0;
    return paragraphs.map((p) => { const t0 = (acc / total) * dur; acc += p.length; return t0; });
  }, [paragraphs, dur]);
  const startOf = (i) => (times && times[i] != null ? times[i] : estimates[i]);

  async function load() {
    setBusy(true); setMsg("Finding the talk's official video…");
    try {
      const m = await resolveTalkMedia(talkMeta.sourceUrl);
      if (!m || !m.video || !(m.video.p720 || m.video.p360 || m.video.p1080)) throw new Error("No video recording is available for this talk.");
      setMedia(m);
      setQuality(m.video.p720 ? "p720" : m.video.p1080 ? "p1080" : "p360");
      setMsg("");
    } catch (e) { setMsg(e.message || String(e)); }
    setBusy(false);
  }
  const src = media && media.video && media.video[quality] ? proxiedMediaUrl(media.video[quality]) : "";

  async function pinTimes() {
    if (!media || !media.audioUrl) return;
    setTiming("Starting…");
    try {
      const jobId = await talkTimesStart({ audioUrl: media.audioUrl, paragraphs });
      const res = await pollJob(jobStatus, jobId, { intervalMs: 4000, onTick: (s) => setTiming(s.step || (s.status === "queued" ? "Queued…" : "Working…")) });
      setTimes(res.times || null);
      setTiming(res.times ? "" : "No times came back.");
    } catch (e) { setTiming(`Couldn't pin the times: ${e.message || e}`); }
  }
  function seekTo(i) {
    const v = vref.current; if (!v) return;
    setPicked(i);
    v.currentTime = Math.max(0, startOf(i) - 1);
    v.play().catch(() => {});
  }
  function previewSelection() {
    const v = vref.current; if (!v || inAt == null) return;
    const end = outAt != null ? outAt : Math.min(dur, inAt + 30);
    v.currentTime = inAt; v.play();
    const stop = () => { if (v.currentTime >= end - 0.05) { v.pause(); v.removeEventListener("timeupdate", stop); } };
    v.addEventListener("timeupdate", stop);
  }
  async function capture() {
    if (inAt == null || outAt == null || outAt <= inAt) { setCapMsg("Mark a start and an end first."); return; }
    if (outAt - inAt > 180) { setCapMsg("Keep the closing clip under 3 minutes."); return; }
    setBusy(true);
    try {
      const { blob, ext } = await captureClip({ src, start: inAt, end: outAt, onProgress: (p) => setCapMsg(`Capturing… ${Math.round(p * 100)}% (plays in real time)`) });
      const mediaKey = `${projectId}:bookend:post`;
      await putMedia(mediaKey, blob, { ext, source: "talk", from: inAt, to: outAt });
      const len = outAt - inAt;
      onCaptured({ mediaKey, kind: "talk", name: `${talkMeta.speaker || "Speaker"} · ${fmtS(inAt)}–${fmtS(outAt)}`, in: 0, out: len, duration: len, quote: picked >= 0 ? paragraphs[picked].slice(0, 140) : "", sourceUrl: media.video[quality], from: inAt, to: outAt });
      setCapMsg("");
    } catch (e) { setCapMsg(`Capture failed: ${e.message || e}`); }
    setBusy(false);
  }

  const filtered = paragraphs.map((p, i) => ({ p, i })).filter(({ p }) => !q.trim() || p.toLowerCase().includes(q.trim().toLowerCase()));

  if (!talkMeta || !talkMeta.sourceUrl) return <p className="note">Choose the talk in the Library first — then its official video can be searched here.</p>;
  if (!media) {
    return (
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" onClick={load} disabled={busy}>{busy ? "Loading…" : "Load the talk's official video"}</button>
        {msg && <span className="note" style={{ margin: 0 }}>{msg}</span>}
      </div>
    );
  }
  return (
    <div className="talk-picker">
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="note" style={{ margin: 0 }}>Quality</span>
        <select value={quality} onChange={(e) => setQuality(e.target.value)}>
          {["p360", "p720", "p1080"].filter((k) => media.video[k]).map((k) => <option key={k} value={k}>{k.slice(1)}p{k === "p360" ? " (fastest)" : k === "p1080" ? " (sharpest)" : ""}</option>)}
        </select>
        {msg && <span className="note" style={{ margin: 0 }}>{msg}</span>}
      </div>
      <video ref={vref} src={src} crossOrigin="anonymous" controls playsInline preload="metadata" className="bookend-video" onLoadedMetadata={(e) => setDur(e.target.duration || 0)} onTimeUpdate={(e) => setT(e.target.currentTime)} />
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setInAt(Math.round(t * 10) / 10)}>⟦ Start here ({fmt(t)})</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOutAt(Math.round(t * 10) / 10)}>End here ⟧ ({fmt(t)})</button>
        <span className="chip">{inAt == null ? "no start yet" : `start ${fmt(inAt)}`}{outAt != null ? ` → end ${fmt(outAt)} · ${fmt(outAt - inAt)}` : ""}</span>
        <button className="btn btn-ghost btn-sm" onClick={previewSelection} disabled={inAt == null}>▶ Preview selection</button>
        <button className="btn btn-primary btn-sm" onClick={capture} disabled={busy || inAt == null || outAt == null}>{busy ? "Working…" : "✂ Capture this clip for the ending"}</button>
      </div>
      {capMsg && <p className="note">{capMsg}</p>}

      <div className="talk-find">
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Find the moment</strong>
          <input type="text" className="picker-search-input" placeholder="search the talk for a word or phrase…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          {!times && (
            <button className="btn btn-ghost btn-sm" onClick={pinTimes} disabled={!!timing && !/Couldn|No times/.test(timing)} title="Gemini listens to the recording and pins where each paragraph starts (about a minute; cached per talk)">✨ Pin exact times with AI</button>
          )}
          {times && <span className="chip" style={{ background: "rgba(127,209,168,0.18)" }}>times pinned by AI</span>}
        </div>
        {timing && <p className="note" style={{ margin: "4px 0" }}>{timing}</p>}
        {!times && !timing && dur > 0 && <p className="note" style={{ margin: "4px 0" }}>Times below are estimates from each paragraph's place in the text (usually within a minute). Click one to jump there, then nudge with the player.</p>}
        <div className="para-list">
          {filtered.map(({ p, i }) => (
            <button key={i} className={`para-row${picked === i ? " active" : ""}`} onClick={() => seekTo(i)} title="Jump the video to this paragraph">
              <span className="para-time">{dur ? fmtS(startOf(i)) : "–:––"}</span>
              <span className="para-text">{p.length > 220 ? p.slice(0, 220) + "…" : p}</span>
            </button>
          ))}
          {!filtered.length && <p className="note">Nothing in the talk matches that.</p>}
        </div>
      </div>
    </div>
  );
}

export default function Bookends({ projectId, tl, setTimeline, talkMeta, talkText }) {
  const bookends = tl.bookends || {};
  const [busy, setBusy] = useState("");
  const [closingMode, setClosingMode] = useState(talkMeta && talkMeta.sourceUrl ? "talk" : "upload");
  const [err, setErr] = useState("");

  function setBookend(kind, clip) {
    setTimeline({ ...tl, bookends: { ...(tl.bookends || {}), [kind]: clip } });
  }
  async function upload(kind, file) {
    setErr(""); setBusy(kind);
    try {
      if (!/^video\//.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) throw new Error("Please choose a video file (MP4, WebM or MOV).");
      const duration = await videoDuration(file);
      if (!duration) throw new Error("That file couldn't be read as a video in this browser (MOV files from iPhone often need converting to MP4).");
      const mediaKey = `${projectId}:bookend:${kind}`;
      await putMedia(mediaKey, file, { name: file.name, kind });
      setBookend(kind, { mediaKey, kind: "upload", name: file.name, in: 0, out: Math.round(duration * 10) / 10, duration: Math.round(duration * 10) / 10 });
    } catch (e) { setErr(e.message || String(e)); }
    setBusy("");
  }
  async function remove(kind) {
    const c = bookends[kind];
    if (c && c.mediaKey) { try { await deleteMedia(c.mediaKey); } catch {} }
    const next = { ...(tl.bookends || {}) };
    delete next[kind];
    setTimeline({ ...tl, bookends: next });
  }

  return (
    <div className="bookends">
      <div className="bookend-grid">
        <div>
          <h4>Opening clip <span className="note" style={{ margin: 0 }}>optional · plays before the intro card</span></h4>
          <p className="note">A short clip of someone introducing the talk — what they loved most, and the song line that goes with it. Its own sound plays; the song starts after.</p>
          {bookends.pre
            ? <ClipCard clip={bookends.pre} title="Opening clip" onChange={(c) => setBookend("pre", c)} onRemove={() => remove("pre")} />
            : <UploadBox label="Upload an opening clip" hint="MP4 or WebM from a phone or webcam" onFile={(f) => upload("pre", f)} busy={busy === "pre"} />}
        </div>
        <div>
          <h4>Closing clip <span className="note" style={{ margin: 0 }}>optional · plays after the outro card</span></h4>
          <p className="note">End with the speaker's own voice — a testimony or a line worth remembering, cut from the talk's official video.</p>
          {bookends.post ? (
            <ClipCard clip={bookends.post} title="Closing clip" onChange={(c) => setBookend("post", c)} onRemove={() => remove("post")} />
          ) : (
            <>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <button className={`btn btn-sm ${closingMode === "talk" ? "btn-primary" : "btn-ghost"}`} onClick={() => setClosingMode("talk")}>From the talk's video</button>
                <button className={`btn btn-sm ${closingMode === "upload" ? "btn-primary" : "btn-ghost"}`} onClick={() => setClosingMode("upload")}>Upload a file</button>
              </div>
              {closingMode === "talk"
                ? <TalkClipPicker projectId={projectId} talkMeta={talkMeta} talkText={talkText} onCaptured={(c) => setBookend("post", c)} />
                : <UploadBox label="Upload a closing clip" hint="MP4 or WebM" onFile={(f) => upload("post", f)} busy={busy === "post"} />}
            </>
          )}
        </div>
      </div>
      {err && <p className="note" style={{ color: "var(--danger)" }}>{err}</p>}
    </div>
  );
}
