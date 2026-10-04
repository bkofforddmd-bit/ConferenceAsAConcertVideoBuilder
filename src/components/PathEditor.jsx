// src/components/PathEditor.jsx
//
// Visual editor for a still's camera path. The image is shown with a 16:9
// "camera frame" for the selected keyframe: drag it to pan, use the zoom
// slider (or scroll on the frame) to zoom. Keyframes sit on a time strip —
// drag their time to make a move slow or fast, choose how each move eases,
// add holds by duplicating a keyframe. Preview plays the path at real speed.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { EASES, DEFAULT_PATH, pathRectAt, clampRect, lyricAt } from "../lib/video-render.js";

const PRESETS = [
  { id: "push", label: "Push in (centre)", kf: [{ t: 0, cx: 0.5, cy: 0.5, w: 1 }, { t: 1, cx: 0.5, cy: 0.5, w: 0.75 }] },
  { id: "pull", label: "Pull out", kf: [{ t: 0, cx: 0.5, cy: 0.5, w: 0.7 }, { t: 1, cx: 0.5, cy: 0.5, w: 1 }] },
  { id: "l2r", label: "Sweep left → right", kf: [{ t: 0, cx: 0.4, cy: 0.5, w: 0.8 }, { t: 1, cx: 0.6, cy: 0.5, w: 0.8 }] },
  { id: "r2l", label: "Sweep right → left", kf: [{ t: 0, cx: 0.6, cy: 0.5, w: 0.8 }, { t: 1, cx: 0.4, cy: 0.5, w: 0.8 }] },
  { id: "rise", label: "Rise (bottom → top)", kf: [{ t: 0, cx: 0.5, cy: 0.62, w: 0.78 }, { t: 1, cx: 0.5, cy: 0.38, w: 0.78 }] },
  { id: "holdthen", label: "Hold, then push in late", kf: [{ t: 0, cx: 0.5, cy: 0.5, w: 1 }, { t: 0.6, cx: 0.5, cy: 0.5, w: 1 }, { t: 1, cx: 0.5, cy: 0.5, w: 0.7 }] },
];

export default function PathEditor({ src, initialPath, durationSec = 8, title, onSave, onClose, segment = null, audioUrl = "", lyricsMode = "one" }) {
  // Song time for a progress p through this shot, and the lyric on screen then.
  const shotStart = segment ? segment.start : 0;
  const shotLen = segment ? Math.max(0.01, segment.end - segment.start) : durationSec;
  const lyricFor = (p) => (segment && segment.lyrics ? lyricAt(segment, shotStart + p * shotLen, lyricsMode) : { text: "", alpha: 0 });
  // Where lines change inside this shot (for the markers on the time strip).
  const lineMarks = useMemo(() => {
    if (!segment || !segment.lyrics) return [];
    const out = [];
    let last = null;
    for (let i = 0; i <= 200; i++) {
      const p = i / 200;
      const l = lyricAt(segment, shotStart + p * shotLen, lyricsMode);
      if (l.text && l.text !== last) { out.push({ p, text: l.text }); last = l.text; }
    }
    return out;
  }, [segment, lyricsMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const audioRef = useRef(null);
  const [kfs, setKfs] = useState(() => (initialPath && initialPath.keyframes ? initialPath.keyframes : DEFAULT_PATH.keyframes).map((k) => ({ ease: "inout", ...k })));
  const [sel, setSel] = useState(0);
  const [img, setImg] = useState(null);
  const [preview, setPreview] = useState(false);
  const [previewP, setPreviewP] = useState(0);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = src;
  }, [src]);

  const iw = img ? img.naturalWidth : 1536, ih = img ? img.naturalHeight : 1024;
  const sorted = useMemo(() => kfs.map((k, i) => ({ ...k, i })).sort((a, b) => a.t - b.t), [kfs]);
  const cur = kfs[sel] || kfs[0];

  function update(i, patch) {
    setKfs((prev) => prev.map((k, j) => (j === i ? { ...k, ...clampIfRect({ ...k, ...patch }) } : k)));
  }
  function clampIfRect(k) {
    const r = clampRect(k, iw, ih);
    return { ...k, cx: r.cx, cy: r.cy, w: r.w, t: Math.max(0, Math.min(1, k.t)) };
  }
  function addAfter() {
    const k = kfs[sel];
    const nextT = sorted.find((x) => x.t > k.t);
    const t = nextT ? (k.t + nextT.t) / 2 : Math.min(1, k.t + 0.25);
    const nk = { ...k, t };
    setKfs((prev) => [...prev, nk]);
    setSel(kfs.length);
  }
  function remove() {
    if (kfs.length <= 2) return;
    setKfs((prev) => prev.filter((_, j) => j !== sel));
    setSel(0);
  }
  function applyPreset(p) {
    setKfs(p.kf.map((k) => ({ ease: "inout", ...clampIfRect({ ...k }) })));
    setSel(0);
  }

  // Stage geometry: image fit inside the stage box.
  const [stageW, setStageW] = useState(640);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    setStageW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const stageH = Math.round(stageW * (ih / iw));
  const rect = preview ? pathRectAt({ keyframes: kfs }, previewP) : cur;
  const r = clampRect(rect, iw, ih);
  const box = { left: (r.cx - r.w / 2) * stageW, top: (r.cy - r.h / 2) * stageH, width: r.w * stageW, height: r.h * stageH };

  // Drag any keyframe's frame (green = selected, dashed = the others) to pan
  // it; dragging a dashed one selects it as it moves. The corner handle
  // resizes (zooms) instead of moving.
  function startDrag(e, idx, mode = "move") {
    if (preview) return;
    e.preventDefault();
    e.stopPropagation();
    const k = kfs[idx];
    if (!k) return;
    if (idx !== sel) setSel(idx);
    const p = e.touches ? e.touches[0] : e;
    dragRef.current = { x: p.clientX, y: p.clientY, cx: k.cx, cy: k.cy, w: k.w, idx, mode };
    const move = (ev) => {
      const q = ev.touches ? ev.touches[0] : ev;
      const d = dragRef.current;
      if (!d) return;
      if (ev.cancelable) ev.preventDefault();
      if (d.mode === "resize") {
        // dragging the corner outward widens the frame (zooms out), inward zooms in
        update(d.idx, { w: d.w + ((q.clientX - d.x) / stageW) * 2 });
      } else {
        update(d.idx, { cx: d.cx + (q.clientX - d.x) / stageW, cy: d.cy + (q.clientY - d.y) / stageH });
      }
    };
    const up = () => { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
  }
  const onDown = (e) => startDrag(e, sel, "move");
  function onWheel(e) {
    if (preview) return;
    e.preventDefault();
    update(sel, { w: cur.w * (e.deltaY > 0 ? 1.04 : 0.96) });
  }

  // Preview at real speed — with the song playing this shot's stretch when we have it.
  function startPreview() {
    setPreview(true);
    const a = audioRef.current;
    const useAudio = Boolean(a && audioUrl && segment);
    if (useAudio) { try { a.currentTime = shotStart; a.play().catch(() => {}); } catch {} }
    const t0 = performance.now();
    const tick = () => {
      const p = useAudio && !a.paused
        ? Math.max(0, Math.min(1, (a.currentTime - shotStart) / shotLen))
        : Math.min(1, (performance.now() - t0) / 1000 / Math.max(0.5, shotLen));
      setPreviewP(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else { if (useAudio) a.pause(); setTimeout(() => setPreview(false), 400); }
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  function stopPreview() {
    cancelAnimationFrame(rafRef.current);
    const a = audioRef.current; if (a) a.pause();
    setPreview(false);
  }
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); const a = audioRef.current; if (a) a.pause(); }, []);
  const shownLyric = lyricFor(preview ? previewP : (cur ? cur.t : 0));

  const zoomPct = Math.round((1 / r.w) * 100);
  const timeOf = (t) => `${(t * durationSec).toFixed(1)}s`;

  return (
    <div className="sync-overlay">
      <div className="sync-sheet" style={{ maxWidth: 960 }}>
        <div className="sync-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sync-kicker">🎥 Camera path</div>
            <div className="sync-title">{title || "Shot"} · on screen {durationSec.toFixed(1)} s</div>
          </div>
          {preview ? (
            <button className="btn btn-ghost btn-sm" onClick={stopPreview}>■ Stop</button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={startPreview} title={audioUrl && segment ? "Plays this stretch of the song with the camera move and lyrics" : "Plays the camera move at real speed"}>▶ Preview{audioUrl && segment ? " with song" : ""}</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => { stopPreview(); onClose(); }}>✕ Close</button>
        </div>
        {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" style={{ display: "none" }} />}

        <div className="path-stage" ref={stageRef} style={{ height: stageH || 360 }}>
          {img && <img src={src} alt="" draggable={false} />}
          {img && (
            <div className={`path-frame${preview ? " preview" : ""}`} style={box} onMouseDown={onDown} onTouchStart={onDown} onWheel={onWheel} title="Drag to pan · scroll or drag the corner to zoom">
              <span className="path-frame-label">{preview ? `${timeOf(previewP)}` : `Keyframe ${sorted.findIndex((x) => x.i === sel) + 1} · ${zoomPct}% · ${timeOf(cur.t)}`}</span>
              {!preview && <span className="path-handle" onMouseDown={(e) => startDrag(e, sel, "resize")} onTouchStart={(e) => startDrag(e, sel, "resize")} title="Drag to resize (zoom)" />}
            </div>
          )}
          {!preview && sorted.map((k, n) => k.i !== sel && (
            <div
              key={k.i}
              className="path-ghost"
              style={(() => { const g = clampRect(k, iw, ih); return { left: (g.cx - g.w / 2) * stageW, top: (g.cy - g.h / 2) * stageH, width: g.w * stageW, height: g.h * stageH }; })()}
              onMouseDown={(e) => startDrag(e, k.i, "move")}
              onTouchStart={(e) => startDrag(e, k.i, "move")}
              title={`Keyframe ${n + 1} · drag to move it`}
            >
              <span className="path-ghost-label">{n + 1}</span>
            </div>
          ))}
          {img && shownLyric.text && (
            <div className="path-lyric" style={{ left: box.left, width: box.width, top: box.top + box.height * 0.78, opacity: Math.max(0.25, shownLyric.alpha), fontSize: Math.max(11, box.width * 0.035) }}>
              {shownLyric.text}
            </div>
          )}
        </div>

        <div className="path-strip">
          <div className="path-track">
            {lineMarks.map((m, i) => (
              <div key={i} className="path-linemark" style={{ left: `${m.p * 100}%` }} title={`♪ ${m.text} (from ${timeOf(m.p)})`} onClick={() => update(sel, { t: m.p })}>
                <span>♪</span>
              </div>
            ))}
            {sorted.map((k, n) => (
              <button key={k.i} className={`path-dot${k.i === sel ? " sel" : ""}`} style={{ left: `${k.t * 100}%` }} onClick={() => setSel(k.i)} title={`Keyframe ${n + 1} at ${timeOf(k.t)}`}>{n + 1}</button>
            ))}
            {preview && <div className="timeline-head" style={{ left: `${previewP * 100}%` }} />}
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 11, color: "var(--silver)" }}><span>0 s</span><span>{durationSec.toFixed(1)} s</span></div>
          {segment && segment.lyrics && (
            <div className="path-lyric-now">
              ♪ {shownLyric.text || "(no line yet)"}
              {lineMarks.length > 1 && <span className="note" style={{ margin: "0 0 0 10px" }}>· ♪ marks on the strip show where lines change — click one to put this keyframe there</span>}
            </div>
          )}
        </div>

        <div className="path-controls">
          <label className="path-ctl">
            <span>When <strong>{timeOf(cur.t)}</strong></span>
            <input type="range" min="0" max="1" step="0.01" value={cur.t} onChange={(e) => update(sel, { t: Number(e.target.value) })} />
          </label>
          <label className="path-ctl">
            <span>Zoom <strong>{zoomPct}%</strong></span>
            <input type="range" min="0.12" max="1" step="0.01" value={r.w} onChange={(e) => update(sel, { w: Number(e.target.value) })} style={{ direction: "rtl" }} />
          </label>
          <label className="path-ctl">
            <span>Move to next</span>
            <select value={cur.ease || "inout"} onChange={(e) => update(sel, { ease: e.target.value })}>
              {EASES.map((es) => <option key={es.id} value={es.id}>{es.label}</option>)}
            </select>
          </label>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={addAfter} title="Add a keyframe after this one (same framing — drag it to make a move, leave it to make a hold)">+ Keyframe after</button>
            <button className="btn btn-ghost btn-sm" onClick={remove} disabled={kfs.length <= 2}>Remove</button>
          </div>
        </div>

        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <span className="note" style={{ margin: 0 }}>Presets:</span>
          {PRESETS.map((p) => <button key={p.id} className="picker-example-chip" onClick={() => applyPreset(p)}>{p.label}</button>)}
        </div>
        <p className="note">
          Drag the frame to choose what's in view; scroll on it (or use Zoom) to push in or out. Each keyframe's <em>When</em>
          sets its moment in the shot — close together = fast, far apart = slow. Two keyframes with the same framing = a hold.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => onSave({ keyframes: kfs.map((k) => ({ t: k.t, cx: k.cx, cy: k.cy, w: k.w, ease: k.ease || "inout" })) })}>💾 Save path</button>
        </div>
      </div>
    </div>
  );
}
