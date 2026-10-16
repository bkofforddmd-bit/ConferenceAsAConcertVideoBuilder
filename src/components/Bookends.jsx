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
import { resolveTalkMedia, proxiedMediaUrl, talkTimesStart, jobStatus, pollJob, traceLyricSources } from "../lib/api.js";
import { captureClip, captureSegments, captureConcat, captionPhrases, captionSchedule } from "../lib/video-render.js";
import { autoCaptionClip } from "../lib/clip-audio.js";
import { mediaApi } from "../campus/campus-api.js";
import { lyricLines, singableIndices } from "../lib/lyric-sync.js";
import { loadTalksIndex, byConferenceDesc } from "../lib/talks-index.js";

// ---- instant lyric → paragraph matching by weighted word overlap ----
const STOP = new Set("the a an and or but of to in on at for with by from as is are was were be been being it its this that these those we our us you your he she his her they their them i me my will shall can may might do does did not no so than then there here when where which who whom what how all any each every some such only own same too very just also into over under again further once up down out off about above below between through during before after because while until unless if".split(" "));
const stem = (w) => w.replace(/(ing|edly|ed|es|s|ly)$/, "");
function tokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).map((w) => w.replace(/^'|'$/g, "")).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}
export function matchLyricToParagraphs(line, paragraphs) {
  const docs = paragraphs.map((p) => tokens(p));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length || 1;
  const q = tokens(line);
  if (!q.length) return [];
  const scored = docs.map((d, i) => {
    const set = new Set(d);
    let score = 0, hits = 0;
    for (const w of new Set(q)) if (set.has(w)) { hits++; score += Math.log(1 + N / (df.get(w) || 1)); }
    return { i, score, hits };
  }).filter((x) => x.hits > 0).sort((a, b) => b.score - a.score);
  const top = scored[0] ? scored[0].score : 0;
  return scored.slice(0, 3).map((x) => ({ i: x.i, strength: top ? x.score / top : 0, hits: x.hits }));
}

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

// Does this stored clip actually carry sound? Decodes the audio and measures
// its level — a clip captured by an older build can have a silent track.
export async function soundLevel(blob) {
  try {
    const ACtx = window.AudioContext || window.webkitAudioContext;
    const ac = new ACtx();
    const ab = await ac.decodeAudioData(await blob.arrayBuffer());
    let sum = 0, n = 0;
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i += 4) { sum += d[i] * d[i]; n++; } }
    try { ac.close(); } catch {}
    return { ok: true, rms: n ? Math.sqrt(sum / n) : 0, seconds: ab.duration };
  } catch (e) {
    return { ok: false, rms: 0, seconds: 0, error: String(e && e.message || e) };
  }
}
const SILENT = 0.002;

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
  const [sound, setSound] = useState(null); // { ok, rms, seconds }
  useEffect(() => {
    let alive = true;
    setSound(null);
    (async () => {
      if (!clip.mediaKey) return;
      const rec = await getMedia(clip.mediaKey);
      if (!rec || !alive) return;
      const lv = await soundLevel(rec.blob);
      if (alive) setSound(lv);
    })();
    return () => { alive = false; };
  }, [clip.mediaKey]);
  const inAt = Number(clip.in) || 0, outAt = Number(clip.out) || clip.duration || 0;
  const len = Math.max(0, outAt - inAt);
  function preview() {
    const v = ref.current; if (!v) return;
    v.currentTime = inAt; v.play();
    const stop = () => { if (v.currentTime >= outAt - 0.05) { v.pause(); v.removeEventListener("timeupdate", stop); } };
    v.addEventListener("timeupdate", stop);
  }
  const trimmable = clip.kind === "upload" || clip.kind === "campus";
  // ---- caption timing: play the clip and tap when each caption starts ----
  const capPhrases = clip.captions && clip.captions.on ? captionPhrases(clip.captions.text) : [];
  // Live caption preview over the player, from the same schedule the render uses.
  const capSched = useMemo(() => (clip.captions && clip.captions.on ? captionSchedule(clip, len) : []), [clip.captions, clip.segments, len]); // eslint-disable-line react-hooks/exhaustive-deps
  const capNow = useMemo(() => { if (!capSched.length) return ""; const lt = t - inAt; const c = capSched.find((x) => lt >= x.from && lt < x.to); return c ? c.text : ""; }, [capSched, t, inAt]);
  const [autoMsg, setAutoMsg] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  async function autoCaption() {
    setAutoBusy(true); setAutoMsg("Loading the clip…");
    try {
      const rec = await getMedia(clip.mediaKey);
      if (!rec || !rec.blob) throw new Error("The clip's file isn't in this browser's storage.");
      const phrases = await autoCaptionClip(rec.blob, { hint: clip.quote || (clip.captions && clip.captions.text) || "", onStep: setAutoMsg });
      onChange({ ...clip, captions: { on: true, text: phrases.map((p) => p.text).join("\n"), marks: phrases.map((p) => p.start), auto: true } });
      setAutoMsg(`✓ ${phrases.length} captions, timed to the clip. Check the words, nudge with Tap captions if needed.`);
    } catch (e) { setAutoMsg(`Couldn't auto-caption: ${e.message || e}`); }
    setAutoBusy(false);
  }
  const [capTap, setCapTap] = useState(-1); // index of the next phrase to mark, -1 = not tapping
  const capMarksRef = useRef([]);
  function startCapTap() {
    const v = ref.current; if (!v || !capPhrases.length) return;
    capMarksRef.current = [];
    v.currentTime = inAt; v.muted = false; v.play();
    setCapTap(0);
  }
  function finishCapTap() {
    const v = ref.current; if (v) v.pause();
    const marks = capMarksRef.current.slice(0, capPhrases.length);
    while (marks.length < capPhrases.length) marks.push(marks.length ? marks[marks.length - 1] + 0.5 : 0);
    onChange({ ...clip, captions: { ...clip.captions, marks } });
    setCapTap(-1);
  }
  function tapCap() {
    const v = ref.current; if (!v || capTap < 0) return;
    capMarksRef.current[capTap] = Math.max(0, Math.round((v.currentTime - inAt) * 100) / 100);
    if (capTap + 1 >= capPhrases.length) finishCapTap(); else setCapTap(capTap + 1);
  }
  useEffect(() => {
    if (capTap < 0) return;
    const v = ref.current;
    const onEnd = () => { if (v && v.currentTime >= outAt - 0.05) finishCapTap(); };
    const onKey = (e) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); tapCap(); } if (e.code === "Escape") { if (v) v.pause(); setCapTap(-1); } };
    v && v.addEventListener("timeupdate", onEnd);
    window.addEventListener("keydown", onKey);
    return () => { v && v.removeEventListener("timeupdate", onEnd); window.removeEventListener("keydown", onKey); };
  }, [capTap]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bookend-card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{title}</strong>
        <span className="note" style={{ margin: 0 }}>{clip.name || (clip.kind === "talk" ? "from the talk's video" : clip.kind === "campus" ? "from the campus session" : "clip")} · {fmt(len)} used</span>
      </div>
      {url && (
        <div className="bookend-stage">
          <video ref={ref} src={url} controls playsInline className="bookend-video" onTimeUpdate={(e) => setT(e.target.currentTime)} />
          {capNow && <div className="bookend-cap"><span>{capNow}</span></div>}
        </div>
      )}
      {sound && (
        sound.ok && sound.rms >= SILENT
          ? <div className="note" style={{ margin: "4px 0 0", color: "var(--success)" }}>Sound check ✓ — this clip carries audio{sound.seconds ? ` (${fmt(sound.seconds)} recorded)` : ""}.</div>
          : <div className="music-card" style={{ margin: "6px 0 0", borderColor: "var(--danger)" }}><div className="note" style={{ margin: 0 }}><strong>This clip has no sound.</strong> It was captured before the sound fix, so it will be silent in the video. Remove it and capture it again — the new capture records the speaker's voice.</div></div>
      )}
      {clip.quote && !(clip.captions && clip.captions.on) && <div className="note" style={{ margin: "4px 0 0" }}>“{clip.quote}”</div>}
      {(clip.kind === "talk" || clip.quote || (clip.captions && clip.captions.on)) && (
        <div style={{ marginTop: 8 }}>
          <label className="row" style={{ gap: 6, fontSize: 13 }} title="Draw the speaker's words at the bottom of the clip, phrase by phrase">
            <input type="checkbox" checked={Boolean(clip.captions && clip.captions.on)} onChange={(e) => onChange({ ...clip, captions: { on: e.target.checked, text: (clip.captions && clip.captions.text) || clip.quote || "" } })} />
            Caption the speaker's words
          </label>
          {!(clip.captions && clip.captions.on) && (
            <div className="row" style={{ gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" onClick={autoCaption} disabled={autoBusy || !url} title="Gemini listens to this clip and writes the captions with their timing — a fraction of a cent, about 15 seconds">{autoBusy ? "Listening…" : "✨ Auto-caption this clip"}</button>
              {autoMsg && <span className="note" style={{ margin: 0 }}>{autoMsg}</span>}
            </div>
          )}
          {clip.captions && clip.captions.on && (
            <>
              <textarea value={clip.captions.text || ""} onChange={(e) => onChange({ ...clip, captions: { ...clip.captions, text: e.target.value, marks: null } })} style={{ width: "100%", minHeight: 110, fontSize: 13, marginTop: 6, boxSizing: "border-box" }} placeholder="What is said in this clip — one caption per line" />
              <p className="note" style={{ margin: "4px 0 0" }}>
                Put each caption on its own line (press Enter), then tap along to time them: the clip plays and you press the button (or Space) the moment each caption is spoken.
                Without taps, the words are spread across the clip by length, which is only a rough guess.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                {capTap < 0 && <button className="btn btn-primary btn-sm" onClick={autoCaption} disabled={autoBusy || !url} title="Gemini listens to this clip and writes the captions with their timing — a fraction of a cent, about 15 seconds">{autoBusy ? "Listening…" : "✨ Auto-caption this clip"}</button>}
                {capTap < 0 ? (
                  <button className="btn btn-ghost btn-sm" onClick={startCapTap} disabled={!capPhrases.length || !url || autoBusy}>▶ Tap captions along{clip.captions.marks && clip.captions.marks.length === capPhrases.length ? " (re-time)" : ""}</button>
                ) : (
                  <>
                    <button className="btn btn-primary" onClick={tapCap}>Now: “{capPhrases[capTap]}” ({capTap + 1} of {capPhrases.length})</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { const v = ref.current; if (v) v.pause(); setCapTap(-1); }}>Stop</button>
                  </>
                )}
                {capTap < 0 && clip.captions.marks && clip.captions.marks.length === capPhrases.length && <span className="chip ok">{clip.captions.auto ? `timed by AI (${capPhrases.length})` : `timed from your taps (${capPhrases.length})`}</span>}
                {autoMsg && <span className="note" style={{ margin: 0 }}>{autoMsg}</span>}
                {capTap < 0 && (!clip.captions.marks || clip.captions.marks.length !== capPhrases.length) && capPhrases.length > 0 && <span className="note" style={{ margin: 0 }}>{capPhrases.length} caption{capPhrases.length === 1 ? "" : "s"} · not yet timed</span>}
              </div>
            </>
          )}
        </div>
      )}
      {trimmable && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <label className="row" style={{ gap: 4 }}>Start <input type="number" step="0.1" min="0" value={inAt} onChange={(e) => onChange({ ...clip, in: Math.max(0, Math.min(outAt - 0.5, Number(e.target.value) || 0)) })} style={{ width: 70 }} /> s</label>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...clip, in: Math.max(0, Math.min(outAt - 0.5, Math.round(t * 10) / 10)) })}>⟦ Start at playhead ({fmt(t)})</button>
          <label className="row" style={{ gap: 4 }}>End <input type="number" step="0.1" min="0" value={outAt} onChange={(e) => onChange({ ...clip, out: Math.max(inAt + 0.5, Math.min(clip.duration || 1e9, Number(e.target.value) || 0)) })} style={{ width: 70 }} /> s</label>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange({ ...clip, out: Math.max(inAt + 0.5, Math.min(clip.duration || t, Math.round(t * 10) / 10)) })}>End at playhead ⟧</button>
          <button className="btn btn-ghost btn-sm" onClick={preview}>▶ Preview the trimmed part</button>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 6, fontSize: 13 }} title="Fade in at the start and out at the end of this clip in the finished video">
          Edge fade
          <select value={Number(clip.fade) || 0.4} onChange={(e) => onChange({ ...clip, fade: Number(e.target.value) })}>
            {[0.25, 0.4, 0.5, 0.75, 1, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v} s</option>)}
          </select>
        </label>
        {clip.segments && clip.segments.length > 1 && <span className="note" style={{ margin: 0 }}>joins were captured with a {clip.fade || 0.5}-second fade — recapture to change that</span>}
        <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)", marginLeft: "auto" }} onClick={onRemove}>Remove clip</button>
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

// ---- which talk? shows the project's talk; search the library to correct it ----
function TalkChooser({ current, onPick, busy }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!open || idx) return;
    loadTalksIndex().then((d) => setIdx(d.talks || [])).catch(() => setIdx([]));
  }, [open, idx]);
  const results = useMemo(() => {
    if (!idx) return [];
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const words = t.split(/\s+/).filter(Boolean);
    return idx
      .filter((x) => { const hay = `${x.title || ""} ${x.speaker || ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort(byConferenceDesc)
      .slice(0, 14);
  }, [idx, q]);
  const has = current && current.sourceUrl;
  return (
    <div className="talk-chooser">
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="note" style={{ margin: 0 }}>
          Talk: <strong style={{ color: "var(--cloud)" }}>{has ? current.title || "untitled" : "none chosen"}</strong>
          {has && current.speaker ? ` — ${current.speaker}` : ""}{has && current.conferenceMonthYear ? ` · ${current.conferenceMonthYear}` : ""}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)} disabled={busy}>{open ? "Cancel" : has ? "Not this talk? Choose the right one" : "Choose the talk"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 6 }}>
          <input type="text" className="picker-search-input" placeholder="search by title or speaker, e.g. peaceable things" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ width: "100%" }} />
          <div className="para-list" style={{ maxHeight: 260 }}>
            {results.map((t) => (
              <button key={t.uri} className="para-row" onClick={async () => { setErr(""); try { await onPick(t.uri); setOpen(false); } catch (e) { setErr(e.message || String(e)); } }} title="Use this talk for the project">
                <span className="para-time">{String(t.month) === "10" ? "Oct" : "Apr"} {t.year}</span>
                <span className="para-text"><strong style={{ color: "var(--cloud)" }}>{t.title}</strong> — {t.speaker}</span>
              </button>
            ))}
            {!idx && q.trim().length >= 2 && <p className="note">Loading the talk list…</p>}
            {idx && q.trim().length >= 2 && !results.length && <p className="note">No talk matches that.</p>}
          </div>
          {err && <p className="note" style={{ color: "var(--danger)" }}>{err}</p>}
          <p className="note" style={{ margin: "6px 0 0" }}>Picking one corrects the project's talk — its title, speaker, text and link — and leaves your lyrics, song, scenes and video exactly as they are.</p>
        </div>
      )}
    </div>
  );
}

// ---- the talk's own video: find the moment, mark it, capture it ----
function TalkClipPicker({ projectId, talkMeta, talkText, lyrics, sources, onSources, onCaptured, onFixTalk }) {
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
  const [segs, setSegs] = useState([]); // spliced sections: [{ from, to, quote }]
  const [fadeSec, setFadeSec] = useState(1.0); // fade out/in at every join, and at the clip's edges in the video
  const [lyricQ, setLyricQ] = useState("");
  const [pickedLine, setPickedLine] = useState(-1);
  const [tracing, setTracing] = useState("");
  const [showLyrics, setShowLyrics] = useState(true);
  const paraRefs = useRef({});

  const paragraphs = useMemo(() => String(talkText || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 20), [talkText]);
  // Estimated start of each paragraph by its share of the text (until AI pins them).
  const estimates = useMemo(() => {
    const total = paragraphs.reduce((a, p) => a + p.length, 0) || 1;
    let acc = 0;
    return paragraphs.map((p) => { const t0 = (acc / total) * dur; acc += p.length; return t0; });
  }, [paragraphs, dur]);
  const startOf = (i) => (times && times[i] != null ? times[i] : estimates[i]);

  // ---- the song's lines → the paragraph each came from ----
  const songLines = useMemo(() => { const ls = lyricLines(lyrics); return singableIndices(ls).map((i) => ls[i].trim()); }, [lyrics]);
  // The index is keyed by the line TEXT at the time it was made (lyrics may
  // have been edited since): match each current line to a stored one exactly,
  // else by word overlap, so edits don't orphan the index.
  const normLine = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const traced = useMemo(() => {
    if (!sources || !sources.map) return null;
    const stored = Array.isArray(sources.lines) ? sources.lines : null;
    if (!stored) return sources.map;
    const normed = stored.map(normLine);
    const out = {};
    songLines.forEach((ln, li) => {
      let j = normed.indexOf(normLine(ln));
      if (j < 0) {
        const t = new Set(tokens(ln));
        let best = -1, bs = 0;
        normed.forEach((sl, k) => { const tk = tokens(sl); const hits = tk.filter((w) => t.has(w)).length; const sc = hits / Math.max(1, Math.max(tk.length, t.size)); if (sc > bs) { bs = sc; best = k; } });
        if (bs >= 0.5) j = best;
      }
      if (j >= 0 && sources.map[j]) out[li] = sources.map[j];
    });
    return Object.keys(out).length ? out : null;
  }, [sources, songLines]);
  const matchFor = (li) => {
    const tr = traced && traced[li];
    if (tr && tr.paragraphs && tr.paragraphs.length) return { paragraphs: tr.paragraphs, phrase: tr.phrase, strength: tr.confidence, ai: true };
    const m = matchLyricToParagraphs(songLines[li], paragraphs);
    return m.length ? { paragraphs: m.map((x) => x.i), phrase: "", strength: m[0].strength * Math.min(1, m[0].hits / 3), ai: false } : { paragraphs: [], phrase: "", strength: 0, ai: false };
  };
  const [lineMatch, setLineMatch] = useState(null); // { paragraphs:[...], phrase, ai }
  function pickLine(li) {
    setPickedLine(li);
    const m = matchFor(li);
    setLineMatch(m);
    if (m.paragraphs.length) {
      const pi = m.paragraphs[0];
      setQ("");
      seekTo(pi);
      setTimeout(() => { const el = paraRefs.current[pi]; if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 50);
    }
  }
  async function traceWithAI() {
    if (!songLines.length || !paragraphs.length) return;
    setTracing("Reading the song against the talk…");
    try {
      const r = await traceLyricSources({ lines: songLines, paragraphs });
      onSources && onSources({ lines: songLines, map: r.map || {}, model: r.model, at: Date.now(), from: "trace" });
      setTracing("");
      if (pickedLine >= 0) setTimeout(() => pickLine(pickedLine), 0);
    } catch (e) { setTracing(`Couldn't trace the lyrics: ${e.message || e}`); }
  }
  const matchedSet = new Set(lineMatch ? lineMatch.paragraphs : []);

  async function load(url) {
    setBusy(true); setMsg("Finding the talk's official video…");
    try {
      const m = await resolveTalkMedia(url || talkMeta.sourceUrl);
      if (!m || !m.video || !(m.video.p720 || m.video.p360 || m.video.p1080)) throw new Error("No video recording is available for this talk.");
      setMedia(m);
      setQuality(m.video.p720 ? "p720" : m.video.p1080 ? "p1080" : "p360");
      setMsg("");
    } catch (e) { setMsg(e.message || String(e)); }
    setBusy(false);
  }
  const src = media && media.video && media.video[quality] ? proxiedMediaUrl(media.video[quality]) : "";
  async function pickTalk(uri) {
    if (!onFixTalk) return;
    setBusy(true);
    try {
      const meta = await onFixTalk(uri);
      setMedia(null); setTimes(null); setTiming(""); setSegs([]); setInAt(null); setOutAt(null); setPicked(-1); setPickedLine(-1); setLineMatch(null);
      if (meta && meta.sourceUrl) await load(meta.sourceUrl);
    } finally { setBusy(false); }
  }
  const chooser = onFixTalk ? <TalkChooser current={talkMeta || {}} onPick={pickTalk} busy={busy} /> : null;

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
  const currentQuote = () => (picked >= 0 ? paragraphs[picked].slice(0, 140) : "");
  function addSegment() {
    if (inAt == null || outAt == null || outAt <= inAt) { setCapMsg("Mark a start and an end first."); return; }
    setSegs((list) => [...list, { from: inAt, to: outAt, quote: currentQuote() }]);
    setCapMsg("");
    setInAt(null); setOutAt(null);
  }
  function moveSeg(i, dir) {
    setSegs((list) => { const n = list.slice(); const j = i + dir; if (j < 0 || j >= n.length) return list; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }
  function previewSegments() {
    const v = vref.current; if (!v || !segs.length) return;
    let i = 0;
    const playOne = () => {
      const g = segs[i]; if (!g) { v.pause(); return; }
      v.currentTime = g.from; v.play();
      const stop = () => { if (v.currentTime >= g.to - 0.05) { v.removeEventListener("timeupdate", stop); i++; if (i < segs.length) playOne(); else v.pause(); } };
      v.addEventListener("timeupdate", stop);
    };
    playOne();
  }
  const segTotal = segs.reduce((a, g) => a + (g.to - g.from), 0);
  async function capture() {
    // Either the spliced list, or the single marked range.
    const list = segs.length ? segs : (inAt != null && outAt != null && outAt > inAt ? [{ from: inAt, to: outAt, quote: currentQuote() }] : []);
    if (!list.length) { setCapMsg("Mark a start and an end first (or add sections to splice)."); return; }
    const total = list.reduce((a, g) => a + (g.to - g.from), 0);
    if (total > 240) { setCapMsg("Keep the closing clip under 4 minutes in total."); return; }
    setBusy(true);
    try {
      const prog = (p) => setCapMsg(`Capturing… ${Math.round(p * 100)}% (plays in real time${list.length > 1 ? ", fading between sections" : ""})`);
      const { blob, ext } = list.length > 1
        ? await captureSegments({ src, segments: list, fade: fadeSec, onProgress: prog })
        : await captureClip({ src, start: list[0].from, end: list[0].to, onProgress: prog });
      const lv = await soundLevel(blob);
      if (lv.ok && lv.rms < SILENT) throw new Error("The capture came out silent. Make sure the video actually played with sound (press play once in the player above, then capture again).");
      const mediaKey = `${projectId}:bookend:post`;
      await putMedia(mediaKey, blob, { ext, source: "talk", segments: list });
      const name = list.length > 1
        ? `${talkMeta.speaker || "Speaker"} · ${list.length} sections · ${list.map((g) => `${fmtS(g.from)}–${fmtS(g.to)}`).join(" + ")}`
        : `${talkMeta.speaker || "Speaker"} · ${fmtS(list[0].from)}–${fmtS(list[0].to)}`;
      onCaptured({ mediaKey, kind: "talk", name, in: 0, out: total, duration: total, quote: list.map((g) => g.quote).filter(Boolean).join(" … "), sourceUrl: media.video[quality], segments: list, fade: fadeSec });
      setCapMsg("");
      setSegs([]);
    } catch (e) { setCapMsg(`Capture failed: ${e.message || e}`); }
    setBusy(false);
  }

  const filtered = paragraphs.map((p, i) => ({ p, i })).filter(({ p }) => !q.trim() || p.toLowerCase().includes(q.trim().toLowerCase()));

  if (!talkMeta || !talkMeta.sourceUrl) {
    return (
      <div className="talk-picker">
        {chooser || <p className="note">Choose the talk in the Library first — then its official video can be searched here.</p>}
      </div>
    );
  }
  if (!media) {
    return (
      <div className="talk-picker">
        {chooser}
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => load()} disabled={busy}>{busy ? "Loading…" : "Load the talk's official video"}</button>
          {msg && <span className="note" style={{ margin: 0 }}>{msg}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="talk-picker">
      {chooser}
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
        <button className="btn btn-ghost btn-sm" onClick={addSegment} disabled={inAt == null || outAt == null} title="Keep this section and mark another; they'll be spliced in order with a fade between them">＋ Add as a section to splice</button>
        <label className="row" style={{ gap: 6, fontSize: 13 }} title="How long the picture and sound fade out and back in — between spliced sections, and at the start and end of the clip in the finished video">
          Fade
          <select value={fadeSec} onChange={(e) => setFadeSec(Number(e.target.value))}>
            {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v} s</option>)}
          </select>
        </label>
        <button className="btn btn-primary btn-sm" onClick={capture} disabled={busy || (!segs.length && (inAt == null || outAt == null))}>
          {busy ? "Working…" : segs.length ? `✂ Capture ${segs.length} section${segs.length === 1 ? "" : "s"} as one clip (${fmt(segTotal)})` : "✂ Capture this clip for the ending"}
        </button>
      </div>
      {capMsg && <p className="note">{capMsg}</p>}
      {segs.length > 0 && (
        <div className="splice-list">
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>Sections to splice</strong>
            <span className="note" style={{ margin: 0 }}>played in this order, with a {fadeSec}-second fade out and in at each join · {fmt(segTotal)} total</span>
            <button className="btn btn-ghost btn-sm" onClick={previewSegments} style={{ marginLeft: "auto" }}>▶ Preview all</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSegs([])}>Clear</button>
          </div>
          {segs.map((g, i) => (
            <div key={i} className="splice-row">
              <span className="splice-n">{i + 1}</span>
              <span className="splice-time">{fmtS(g.from)} → {fmtS(g.to)} <span className="note" style={{ margin: 0 }}>({fmt(g.to - g.from)})</span></span>
              <span className="splice-quote">{g.quote ? `“${g.quote.slice(0, 90)}${g.quote.length > 90 ? "…" : ""}”` : ""}</span>
              <span className="splice-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => { const v = vref.current; if (v) { v.currentTime = g.from; v.play(); } }} title="Play from here">▶</button>
                <button className="btn btn-ghost btn-sm" onClick={() => moveSeg(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button className="btn btn-ghost btn-sm" onClick={() => moveSeg(i, 1)} disabled={i === segs.length - 1} title="Move down">↓</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSegs((l) => l.filter((_, k) => k !== i))} style={{ color: "var(--danger)" }} title="Remove this section">✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {songLines.length > 0 && (
        <div className="talk-find">
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>Start from the song</strong>
            <span className="note" style={{ margin: 0 }}>click a lyric line to jump to the part of the talk it came from</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowLyrics((v) => !v)} style={{ marginLeft: "auto" }}>{showLyrics ? "Hide lines" : "Show lines"}</button>
          </div>
          {showLyrics && (
            <>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                <input type="text" className="picker-search-input" placeholder="filter the lyric lines…" value={lyricQ} onChange={(e) => setLyricQ(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                {!traced
                  ? <button className="btn btn-ghost btn-sm" onClick={traceWithAI} disabled={!!tracing} title="Claude reads the song against the talk and records which paragraph each line was drawn from (one quick pass per song)">{tracing ? "Tracing…" : "✨ Trace every line to the talk with AI"}</button>
                  : <span className="chip" style={{ background: "rgba(127,209,168,0.18)" }}>{sources && sources.from === "trace" ? "lines traced by AI" : "indexed to the talk when the lyrics were written"}</span>}
              </div>
              {tracing && <p className="note" style={{ margin: "4px 0" }}>{tracing}</p>}
              {!traced && !tracing && <p className="note" style={{ margin: "4px 0" }}>Lyrics written in this app carry their own index to the talk. These don't (pasted, or written before the index existed), so matches are a word-overlap guess — or run the AI trace once.</p>}
              <div className="lyric-pick">
                {songLines.map((ln, li) => (!lyricQ.trim() || ln.toLowerCase().includes(lyricQ.trim().toLowerCase())) && (
                  <button key={li} className={`lyric-pick-row${pickedLine === li ? " active" : ""}`} onClick={() => pickLine(li)} title="Jump to the part of the talk behind this line">♪ {ln}</button>
                ))}
              </div>
              {lineMatch && pickedLine >= 0 && (
                <p className="note" style={{ margin: "6px 0 0" }}>
                  {lineMatch.paragraphs.length
                    ? <>{lineMatch.ai ? "From the talk" : "Best guess"}: paragraph {lineMatch.paragraphs[0] + 1}{lineMatch.paragraphs.length > 1 ? ` (also ${lineMatch.paragraphs.slice(1).map((n) => n + 1).join(", ")})` : ""} at {dur ? fmtS(startOf(lineMatch.paragraphs[0])) : "–:––"}{lineMatch.phrase ? <> — “{lineMatch.phrase}”</> : lineMatch.strength < 0.5 ? " — weak match; try the AI trace" : ""}. The video jumped there — mark the start and end around the words you want.</>
                    : "No clear match for that line — it may be lyrical glue. Try the AI trace or search the talk below."}
                </p>
              )}
            </>
          )}
        </div>
      )}

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
            <button key={i} ref={(el) => { paraRefs.current[i] = el; }} className={`para-row${picked === i ? " active" : ""}${matchedSet.has(i) ? " match" : ""}`} onClick={() => seekTo(i)} title="Jump the video to this paragraph">
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

// ---- clips recorded in a Campus Session → spliced into the opening clip ----
// The project came from /?campus=<id>; the clips live in the private R2
// bucket and are read with the Campus Sessions sign-in in this browser.
function CampusClipsPicker({ projectId, sessionId, fade, onCaptured }) {
  const [clips, setClips] = useState(null);
  const [picked, setPicked] = useState([]); // clip ids in splice order
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let alive = true;
    mediaApi.list(sessionId).then((r) => { if (alive) { setClips(r.clips || []); setPicked((r.clips || []).map((c) => c.id)); } }).catch((e) => { if (alive) { setClips([]); setMsg(e.message || String(e)); } });
    return () => { alive = false; };
  }, [sessionId]);
  const LABEL = { "lyrics-reaction": "Lyrics reaction", "song-reaction": "Song reaction", testimony: "Testimony", other: "Clip" };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const move = (id, dir) => setPicked((p) => { const i = p.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= p.length) return p; const n = p.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; });
  async function splice() {
    const order = picked.map((id) => (clips || []).find((c) => c.id === id)).filter(Boolean);
    if (!order.length) { setMsg("Tick at least one clip."); return; }
    setBusy(true); setMsg(""); setPct(0);
    try {
      const total = order.reduce((a, c) => a + (c.durationSec || 0), 0);
      if (total > 240) throw new Error("Keep the opening under 4 minutes in total — untick a clip or two.");
      const { blob, ext, duration } = await captureConcat({ sources: order.map((c) => ({ src: c.url })), fade, onProgress: setPct });
      const mediaKey = `${projectId}:bookend:pre`;
      await putMedia(mediaKey, blob, { ext, source: "campus", clips: order.map((c) => c.id) });
      onCaptured({ mediaKey, kind: "campus", name: `Campus session · ${order.length} clip${order.length === 1 ? "" : "s"}`, in: 0, out: Math.round(duration * 10) / 10, duration: Math.round(duration * 10) / 10, fade, segments: order.map((c) => ({ from: 0, to: c.durationSec || 0, quote: LABEL[c.stage] || "" })) });
    } catch (e) { setMsg(e.message || String(e)); }
    setBusy(false);
  }
  if (clips === null) return <p className="note">Loading the session's clips…</p>;
  if (!clips.length) return <p className="note">{msg || "This session has no video clips yet. Record them on the campus phone (lyrics reaction, song reaction, testimony) and they'll appear here."}</p>;
  return (
    <div className="talk-picker">
      <p className="note" style={{ marginTop: 0 }}>Tick the clips to include and set their order — they play back to back with a fade at each join, before the intro card.</p>
      <div className="para-list" style={{ maxHeight: 320 }}>
        {clips.map((c) => {
          const i = picked.indexOf(c.id);
          return (
            <div key={c.id} className="para-row" style={{ display: "flex", gap: 10, alignItems: "center", cursor: "default" }}>
              <input type="checkbox" checked={i >= 0} onChange={() => toggle(c.id)} />
              <video src={c.url} controls playsInline preload="metadata" style={{ width: 150, borderRadius: 6, background: "#000" }} />
              <div style={{ flex: 1 }}>
                <div><strong style={{ color: "var(--cloud)" }}>{i >= 0 ? `${i + 1}. ` : ""}{LABEL[c.stage] || "Clip"}</strong></div>
                <div className="note" style={{ margin: 0 }}>{c.durationSec ? `${Math.round(c.durationSec)} s · ` : ""}{(c.bytes / 1048576).toFixed(1)} MB</div>
                {i >= 0 && <div className="row" style={{ gap: 4, marginTop: 4 }}><button className="btn btn-ghost btn-sm" onClick={() => move(c.id, -1)}>▲</button><button className="btn btn-ghost btn-sm" onClick={() => move(c.id, 1)}>▼</button></div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={splice} disabled={busy || !picked.length}>{busy ? `Splicing… ${Math.round(pct * 100)}%` : `✂ Splice ${picked.length} clip${picked.length === 1 ? "" : "s"} into the opening`}</button>
        {busy && <span className="note" style={{ margin: 0 }}>plays in real time — keep this tab in front</span>}
      </div>
      {msg && <p className="note" style={{ color: "var(--danger)" }}>{msg}</p>}
    </div>
  );
}

export default function Bookends({ projectId, tl, setTimeline, talkMeta, talkText, lyrics, sources, onSources, onFixTalk }) {
  const bookends = tl.bookends || {};
  const [busy, setBusy] = useState("");
  const [closingMode, setClosingMode] = useState(talkMeta && talkMeta.sourceUrl ? "talk" : "upload");
  const campusSessionId = tl.campusSessionId || "";
  const [openingMode, setOpeningMode] = useState(campusSessionId ? "campus" : "upload");
  const [openingFade, setOpeningFade] = useState(0.5);
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
          {bookends.pre ? (
            <ClipCard clip={bookends.pre} title="Opening clip" onChange={(c) => setBookend("pre", c)} onRemove={() => remove("pre")} />
          ) : (
            <>
              {campusSessionId && (
                <div className="row" style={{ gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button className={`btn btn-sm ${openingMode === "campus" ? "btn-primary" : "btn-ghost"}`} onClick={() => setOpeningMode("campus")}>From the campus session</button>
                  <button className={`btn btn-sm ${openingMode === "upload" ? "btn-primary" : "btn-ghost"}`} onClick={() => setOpeningMode("upload")}>Upload a file</button>
                  {openingMode === "campus" && (
                    <label className="row" style={{ gap: 6, fontSize: 13 }}>Fade
                      <select value={openingFade} onChange={(e) => setOpeningFade(Number(e.target.value))}>{[0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v} s</option>)}</select>
                    </label>
                  )}
                </div>
              )}
              {campusSessionId && openingMode === "campus"
                ? <CampusClipsPicker projectId={projectId} sessionId={campusSessionId} fade={openingFade} onCaptured={(c) => setBookend("pre", c)} />
                : <UploadBox label="Upload an opening clip" hint="MP4 or WebM from a phone or webcam" onFile={(f) => upload("pre", f)} busy={busy === "pre"} />}
            </>
          )}
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
                ? <TalkClipPicker projectId={projectId} talkMeta={talkMeta} talkText={talkText} lyrics={lyrics} sources={sources || null} onSources={onSources} onFixTalk={onFixTalk} onCaptured={(c) => setBookend("post", c)} />
                : <UploadBox label="Upload a closing clip" hint="MP4 or WebM" onFile={(f) => upload("post", f)} busy={busy === "post"} />}
            </>
          )}
        </div>
      </div>
      {err && <p className="note" style={{ color: "var(--danger)" }}>{err}</p>}
    </div>
  );
}
