// src/components/LyricSyncEditor.jsx
//
// Tap-along lyric sync — a port of the Y-Mountain Music editor. Full-screen:
// the song plays (1× / 0.75× / 0.5×), every lyric line is listed with a
// timestamp column, the next unmarked line is highlighted, and the big button
// (or Space) marks "this line starts now". Tap any line to re-mark it; Undo,
// ±¼ s nudge of every mark, Clear, Save. Produces [[lineIndex, seconds], ...]
// over the full lyrics.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { lyricLines, isSectionLine, singableIndices, parseSync, fmtStamp } from "../lib/lyric-sync.js";

export default function LyricSyncEditor({ title, lyrics, audioUrl, initialSync, onSave, onClose }) {
  const lines = useMemo(() => lyricLines(lyrics), [lyrics]);
  const singable = useMemo(() => singableIndices(lines), [lines]);
  const [times, setTimes] = useState(() => {
    const m = new Map();
    (parseSync(lyrics, initialSync) || []).forEach(([i, t]) => {
      const text = (lines[i] || "").replace(/\s+$/, "");
      if (text && !isSectionLine(text)) m.set(i, t);
    });
    return m;
  });
  const [history, setHistory] = useState([]);
  const [rate, setRate] = useState(1);
  const [msg, setMsg] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const audioRef = useRef(null);
  const listRef = useRef(null);
  const nextIdx = singable.find((i) => !times.has(i));

  useEffect(() => { const a = audioRef.current; if (a) a.playbackRate = rate; }, [rate]);

  // Keep the next line to mark centered in the list.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = nextIdx == null ? null : list.querySelector(`[data-syncline="${nextIdx}"]`);
    if (target) list.scrollTo({ top: target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2, behavior: "smooth" });
  }, [nextIdx]);

  function markLine(i) {
    const a = audioRef.current;
    if (!a) return;
    const t = Math.max(0, a.currentTime);
    setTimes((prev) => {
      const m = new Map(prev);
      // Drop marks the new one would put out of order, so times always ascend.
      for (const [k, v] of m) { if ((k > i && v <= t) || (k < i && v >= t)) m.delete(k); }
      m.set(i, t);
      return m;
    });
    setHistory((h) => [...h, i]);
    setMsg("");
  }
  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setTimes((prev) => { const m = new Map(prev); m.delete(last); return m; });
      return h.slice(0, -1);
    });
  }
  function nudge(d) {
    setTimes((prev) => {
      const m = new Map();
      for (const [k, v] of prev) m.set(k, Math.max(0, v + d));
      return m;
    });
  }
  function clearAll() {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return; }
    setConfirmClear(false);
    setTimes(new Map());
    setHistory([]);
  }
  function save() {
    if (times.size < 2) { setMsg("Mark at least two lines first — play the song and tap along."); return; }
    const arr = [...times.entries()].sort((a, b) => a[1] - b[1]).map(([i, t]) => [i, Math.round(t * 10) / 10]);
    const a = audioRef.current;
    if (a) a.pause();
    onSave(arr);
  }

  // Space / Enter mark the next line; Esc closes. Ignore when typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); if (nextIdx != null) markLine(nextIdx); }
      if (e.code === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextText = nextIdx == null ? "" : lines[nextIdx].trim();

  return (
    <div className="sync-overlay">
      <div className="sync-sheet">
        <div className="sync-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sync-kicker">⏱ Sync lyrics</div>
            <div className="sync-title">{title || "Song"}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { const a = audioRef.current; if (a) a.pause(); onClose(); }}>✕ Close</button>
        </div>

        <audio
          ref={audioRef}
          controls
          preload="auto"
          src={audioUrl}
          onLoadedMetadata={() => { const a = audioRef.current; if (a) a.playbackRate = rate; }}
          style={{ width: "100%" }}
        />
        <div className="row" style={{ gap: 6, margin: "8px 0 6px", alignItems: "center" }}>
          <span className="note" style={{ margin: 0 }}>Speed:</span>
          {[1, 0.75, 0.5].map((r) => (
            <button key={r} className={`picker-chip${rate === r ? " active" : ""}`} onClick={() => setRate(r)} aria-pressed={rate === r} style={{ padding: "4px 12px", fontSize: 12 }}>
              {r}×
            </button>
          ))}
          <span className="note" style={{ margin: "0 0 0 auto" }}>{times.size} of {singable.length} lines marked</span>
        </div>
        <p className="note" style={{ margin: "0 0 8px" }}>
          Play the song. The moment the highlighted line is sung, hit the big button (or press Space).
          Tap any line to re-mark it as "starts now." Slow the speed if it helps.
        </p>

        <div className="sync-list" ref={listRef}>
          {lines.map((ln, i) => {
            const text = ln.replace(/\s+$/, "");
            const sec = isSectionLine(text);
            const t = times.get(i);
            const isNext = i === nextIdx;
            if (!text) return <div key={i} style={{ height: 12 }} />;
            if (sec) return <div key={i} className="sync-section">{text}</div>;
            return (
              <div key={i} data-syncline={i} className={`sync-line${isNext ? " next" : ""}${t != null ? " marked" : ""}`} onClick={() => markLine(i)}>
                <span className="sync-stamp">{t != null ? fmtStamp(t) : "· · ·"}</span>
                <span className="sync-text">{text}</span>
              </div>
            );
          })}
        </div>

        <div style={{ paddingTop: 10 }}>
          <button className={`sync-big${nextIdx == null ? " done" : ""}`} onClick={() => { if (nextIdx != null) markLine(nextIdx); }} disabled={nextIdx == null}>
            {nextIdx == null ? "Every line is marked — hit Save sync" : `⏺ Starts NOW → "${nextText.length > 44 ? nextText.slice(0, 44) + "…" : nextText}"`}
          </button>
          {msg && <p className="note" style={{ color: "var(--danger)", margin: "8px 0 0" }}>{msg}</p>}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.length}>↩ Undo</button>
            <button className="btn btn-ghost btn-sm" onClick={() => nudge(-0.25)} title="Shift every mark a quarter second earlier">−¼s</button>
            <button className="btn btn-ghost btn-sm" onClick={() => nudge(0.25)} title="Shift every mark a quarter second later">+¼s</button>
            <button className={`btn btn-ghost btn-sm${confirmClear ? " danger" : ""}`} onClick={clearAll}>{confirmClear ? "Really clear?" : "Clear"}</button>
            <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={save}>💾 Save sync</button>
          </div>
        </div>
      </div>
    </div>
  );
}
