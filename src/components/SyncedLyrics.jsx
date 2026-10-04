// src/components/SyncedLyrics.jsx
//
// Karaoke-style lyrics for a synced song (port of Y-Mountain Music's
// SyncedLyrics): highlights the line being sung, keeps it centered, and lets
// you tap a line to jump the audio there. Follows the audio clock with rAF
// plus timeupdate/seeked listeners so it keeps moving in a hidden tab.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { lyricLines, isSectionLine } from "../lib/lyric-sync.js";

export default function SyncedLyrics({ audioRef, lyrics, sync, height = 260 }) {
  const lines = useMemo(() => lyricLines(lyrics), [lyrics]);
  const timeByLine = useMemo(() => { const m = new Map(); (sync || []).forEach(([i, t]) => m.set(i, t)); return m; }, [sync]);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const activeRef = useRef(-1);

  useEffect(() => {
    const update = () => {
      const a = audioRef && audioRef.current;
      if (!a) return;
      const t = a.currentTime + 0.05;
      let cur = -1;
      for (const [i, st] of sync || []) { if (st <= t) cur = i; else break; }
      if (cur !== activeRef.current) { activeRef.current = cur; setActive(cur); }
    };
    let raf;
    const tick = () => { update(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const a = audioRef && audioRef.current;
    if (a) { a.addEventListener("timeupdate", update); a.addEventListener("seeked", update); }
    return () => {
      cancelAnimationFrame(raf);
      if (a) { a.removeEventListener("timeupdate", update); a.removeEventListener("seeked", update); }
    };
  }, [sync, audioRef]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (active < 0) { box.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const el = box.querySelector(`[data-line="${active}"]`);
    if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
  }, [active]);

  const seek = (i) => {
    const a = audioRef && audioRef.current, t = timeByLine.get(i);
    if (!a || t == null) return;
    try { a.currentTime = t; } catch {}
    if (a.paused) a.play().catch(() => {});
  };

  return (
    <div className="synced-box" ref={boxRef} style={{ height, maxHeight: height }}>
      <div style={{ padding: `${height / 2 - 14}px 0` }}>
        {lines.map((ln, i) => {
          const text = ln.replace(/\s+$/, "");
          const sec = isSectionLine(text);
          const isActive = i === active;
          const canSeek = timeByLine.has(i);
          const cls = `synced-line${sec ? " section" : ""}${isActive ? " active" : ""}${active >= 0 && i < active && !sec ? " past" : ""}${canSeek ? " seek" : ""}`;
          return (
            <div key={i} data-line={i} className={cls} onClick={canSeek ? () => seek(i) : undefined} title={canSeek ? "Jump here" : undefined}>
              {text || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}
