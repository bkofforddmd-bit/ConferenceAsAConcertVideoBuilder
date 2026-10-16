// src/components/LyricSyncEditor.jsx
//
// Tap-along lyric sync — a port of the Y-Mountain Music editor. Full-screen:
// the song plays (1× / 0.75× / 0.5×), every unit is listed with a timestamp
// column, the next unmarked unit is highlighted, and the big button (or
// Space) marks "this starts now". Tap any unit to re-mark it; Undo, ±¼ s
// nudge of every mark, Clear, Save.
//
// Units are whole lyric LINES, or — in phrase mode — the PHRASES each line
// splits into ("Go, declare glad tidings, in the Savior's name" → three
// taps). The split is suggested at commas and dashes and can be edited per
// line with " / " marks. Saving produces:
//   • line sync   [[lineIndex, seconds], ...]  (first phrase of each line —
//     what the Concert library and the lyric scroller use)
//   • phrase sync { lines: { lineIndex: [phrases] }, marks: [[lineIndex, phraseIndex, seconds], ...] }
//     (what the Video step uses for on-screen lyrics and scene timing)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { lyricLines, isSectionLine, singableIndices, parseSync, fmtStamp, splitPhrases } from "../lib/lyric-sync.js";

export default function LyricSyncEditor({ title, lyrics, audioUrl, initialSync, initialPhraseSync, onSave, onClose }) {
  const lines = useMemo(() => lyricLines(lyrics), [lyrics]);
  const singable = useMemo(() => singableIndices(lines), [lines]);
  const [mode, setMode] = useState(initialPhraseSync && initialPhraseSync.marks ? "phrase" : "line");
  // Per-line phrase lists (phrase mode). Seeded from the saved phrase sync
  // when its text still matches, else suggested at commas and dashes.
  const [splits, setSplits] = useState(() => {
    const m = new Map();
    const saved = (initialPhraseSync && initialPhraseSync.lines) || {};
    for (const i of singable) {
      const text = lines[i].trim();
      const s = saved[i];
      m.set(i, Array.isArray(s) && s.length && s.join(" ").replace(/\s+/g, " ") === text.replace(/\s+/g, " ") ? s : splitPhrases(text));
    }
    return m;
  });
  const units = useMemo(() => {
    const out = [];
    for (const i of singable) {
      const text = lines[i].trim();
      if (mode === "phrase") (splits.get(i) || [text]).forEach((p, k) => out.push({ key: `${i}:${k}`, line: i, phrase: k, text: p }));
      else out.push({ key: `${i}:0`, line: i, phrase: 0, text });
    }
    return out;
  }, [singable, lines, mode, splits]);
  const unitIndex = useMemo(() => new Map(units.map((u, n) => [u.key, n])), [units]);

  const [times, setTimes] = useState(() => {
    const m = new Map();
    const pm = initialPhraseSync && Array.isArray(initialPhraseSync.marks) ? initialPhraseSync.marks : null;
    if (pm) for (const [i, k, t] of pm) { if (Number.isInteger(i) && Number.isInteger(k) && typeof t === "number") m.set(`${i}:${k}`, t); }
    else (parseSync(lyrics, initialSync) || []).forEach(([i, t]) => { const text = (lines[i] || "").trim(); if (text && !isSectionLine(text)) m.set(`${i}:0`, t); });
    return m;
  });
  const [history, setHistory] = useState([]);
  const [rate, setRate] = useState(1);
  const [msg, setMsg] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [editing, setEditing] = useState(null); // line index whose split is being edited
  const [editText, setEditText] = useState("");
  const audioRef = useRef(null);
  const listRef = useRef(null);
  const next = units.find((u) => !times.has(u.key));
  const nextKey = next ? next.key : null;

  useEffect(() => { const a = audioRef.current; if (a) a.playbackRate = rate; }, [rate]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = nextKey == null ? null : list.querySelector(`[data-syncunit="${nextKey}"]`);
    if (target) list.scrollTo({ top: target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2, behavior: "smooth" });
  }, [nextKey]);

  function markUnit(key) {
    const a = audioRef.current;
    if (!a) return;
    const t = Math.max(0, a.currentTime);
    const n = unitIndex.get(key);
    setTimes((prev) => {
      const m = new Map(prev);
      for (const [k, v] of m) { const kn = unitIndex.get(k); if (kn == null) continue; if ((kn > n && v <= t) || (kn < n && v >= t)) m.delete(k); }
      m.set(key, t);
      return m;
    });
    setHistory((h) => [...h, key]);
    setMsg("");
  }
  function undo() {
    setHistory((h) => { if (!h.length) return h; const last = h[h.length - 1]; setTimes((prev) => { const m = new Map(prev); m.delete(last); return m; }); return h.slice(0, -1); });
  }
  function nudge(d) { setTimes((prev) => { const m = new Map(); for (const [k, v] of prev) m.set(k, Math.max(0, v + d)); return m; }); }
  function clearAll() {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return; }
    setConfirmClear(false); setTimes(new Map()); setHistory([]);
  }
  function switchMode(m) {
    if (m === mode) return;
    // Keep what carries over: line marks become phrase-0 marks and vice versa.
    setTimes((prev) => { const out = new Map(); for (const [k, v] of prev) if (k.endsWith(":0")) out.set(k, v); return out; });
    setHistory([]);
    setMode(m);
  }
  function startEdit(i) { setEditing(i); setEditText((splits.get(i) || [lines[i].trim()]).join(" / ")); }
  function applyEdit() {
    if (editing == null) return;
    const i = editing;
    const parts = editText.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) { setEditing(null); return; }
    const squash = (s) => s.replace(/\s+/g, " ").replace(/[\s,.;:]+/g, " ").trim().toLowerCase();
    if (squash(parts.join(" ")) !== squash(lines[i])) { setMsg("Keep the line's words as they are — only add or move the \" / \" marks."); return; }
    setSplits((prev) => { const m = new Map(prev); m.set(i, parts); return m; });
    setTimes((prev) => { const m = new Map(prev); for (const k of [...m.keys()]) if (k.startsWith(`${i}:`)) m.delete(k); return m; });
    setEditing(null); setMsg("");
  }
  function resplitAll(fn) {
    setSplits((prev) => { const m = new Map(); for (const i of singable) m.set(i, fn(lines[i].trim())); return m; });
    setTimes(new Map()); setHistory([]);
  }
  function save() {
    if (times.size < 2) { setMsg("Mark at least two first — play the song and tap along."); return; }
    // Line sync: the earliest mark of each line.
    const byLine = new Map();
    for (const [k, t] of times) { const i = Number(k.split(":")[0]); if (!byLine.has(i) || t < byLine.get(i)) byLine.set(i, t); }
    const arr = [...byLine.entries()].sort((a, b) => a[1] - b[1]).map(([i, t]) => [i, Math.round(t * 10) / 10]);
    let phraseSync = null;
    if (mode === "phrase") {
      const linesOut = {};
      for (const i of singable) linesOut[i] = splits.get(i) || [lines[i].trim()];
      const marks = [...times.entries()].map(([k, t]) => { const [i, p] = k.split(":").map(Number); return [i, p, Math.round(t * 100) / 100]; }).sort((a, b) => a[2] - b[2]);
      phraseSync = { lines: linesOut, marks, savedAt: Date.now() };
    }
    const a = audioRef.current;
    if (a) a.pause();
    onSave(arr, phraseSync);
  }

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); if (nextKey != null) markUnit(nextKey); }
      if (e.code === "Escape") { const a = audioRef.current; if (a) a.pause(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextKey, unitIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextText = next ? next.text : "";
  const unitWord = mode === "phrase" ? "phrase" : "line";

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

        <audio ref={audioRef} controls preload="auto" src={audioUrl} onLoadedMetadata={() => { const a = audioRef.current; if (a) a.playbackRate = rate; }} style={{ width: "100%" }} />
        <div className="row" style={{ gap: 6, margin: "8px 0 6px", alignItems: "center", flexWrap: "wrap" }}>
          <span className="note" style={{ margin: 0 }}>Speed:</span>
          {[1, 0.75, 0.5].map((r) => (
            <button key={r} className={`picker-chip${rate === r ? " active" : ""}`} onClick={() => setRate(r)} aria-pressed={rate === r} style={{ padding: "4px 12px", fontSize: 12 }}>{r}×</button>
          ))}
          <span className="note" style={{ margin: "0 0 0 14px" }}>Tap per:</span>
          <button className={`picker-chip${mode === "line" ? " active" : ""}`} onClick={() => switchMode("line")} style={{ padding: "4px 12px", fontSize: 12 }}>line</button>
          <button className={`picker-chip${mode === "phrase" ? " active" : ""}`} onClick={() => switchMode("phrase")} style={{ padding: "4px 12px", fontSize: 12 }} title="Split each line at commas and dashes so the on-screen lyrics change phrase by phrase">phrase</button>
          <span className="note" style={{ margin: "0 0 0 auto" }}>{times.size} of {units.length} {unitWord}s marked</span>
        </div>
        {mode === "phrase" && (
          <div className="row" style={{ gap: 6, margin: "0 0 6px", alignItems: "center", flexWrap: "wrap" }}>
            <span className="note" style={{ margin: 0 }}>Phrases split at commas and dashes. Use ✎ on a line to move the splits (" / " marks a break).</span>
            <button className="btn btn-ghost btn-sm" onClick={() => resplitAll((t) => splitPhrases(t))}>Re-split all at commas</button>
            <button className="btn btn-ghost btn-sm" onClick={() => resplitAll((t) => [t])}>No splits (one per line)</button>
          </div>
        )}
        <p className="note" style={{ margin: "0 0 8px" }}>
          Play the song. The moment the highlighted {unitWord} is sung, hit the big button (or press Space).
          Tap any {unitWord} to re-mark it as "starts now." Slow the speed if it helps.
        </p>

        <div className="sync-list" ref={listRef}>
          {lines.map((ln, i) => {
            const text = ln.replace(/\s+$/, "");
            if (!text) return <div key={i} style={{ height: 12 }} />;
            if (isSectionLine(text)) return <div key={i} className="sync-section">{text}</div>;
            const lineUnits = units.filter((u) => u.line === i);
            return (
              <div key={i}>
                {editing === i ? (
                  <div className="row" style={{ gap: 6, padding: "4px 0", alignItems: "center" }}>
                    <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyEdit(); } if (e.key === "Escape") setEditing(null); }} style={{ flex: 1, fontSize: 14 }} />
                    <button className="btn btn-primary btn-sm" onClick={applyEdit}>Apply</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : lineUnits.map((u) => {
                  const t = times.get(u.key);
                  const isNext = u.key === nextKey;
                  return (
                    <div key={u.key} data-syncunit={u.key} className={`sync-line${isNext ? " next" : ""}${t != null ? " marked" : ""}`} onClick={() => markUnit(u.key)} style={mode === "phrase" && u.phrase > 0 ? { paddingLeft: 26 } : undefined}>
                      <span className="sync-stamp">{t != null ? fmtStamp(t) : "· · ·"}</span>
                      <span className="sync-text">{u.text}</span>
                      {mode === "phrase" && u.phrase === 0 && <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto", padding: "2px 8px" }} title="Edit where this line splits" onClick={(e) => { e.stopPropagation(); startEdit(i); }}>✎</button>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div style={{ paddingTop: 10 }}>
          <button className={`sync-big${nextKey == null ? " done" : ""}`} onClick={() => { if (nextKey != null) markUnit(nextKey); }} disabled={nextKey == null}>
            {nextKey == null ? `Every ${unitWord} is marked — hit Save sync` : `⏺ Starts NOW → "${nextText.length > 44 ? nextText.slice(0, 44) + "…" : nextText}"`}
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
