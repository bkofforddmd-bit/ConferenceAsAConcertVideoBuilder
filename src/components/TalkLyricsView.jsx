// src/components/TalkLyricsView.jsx — the talk and the song side by side.
// Left: the talk, paragraph by paragraph. Right: the lyrics. Tap OR highlight
// on either side and the other side lights up: lyric lines → the talk passage
// they came from (each echoed phrase marked); a paragraph or words dragged in
// the talk → the lyric lines drawn from them. "Play along" plays the song and
// follows the lyric sync. The same map is published to the Conference Concert
// app (Publish card) for its reading view.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getMedia } from "../lib/project-store.js";
import { traceLyricSources } from "../lib/api.js";
import { buildCompanion, lineAtTime, focusFromLines, focusFromTalk, mergeRanges } from "../lib/talk-companion.js";

function scrollInside(box, el) {
  if (!box || !el) return;
  // the box is position:relative, so offsetTop is already measured from it
  const top = el.offsetTop - box.clientHeight / 3;
  box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}
// characters of `root`'s own text (skipping [data-skip] bits like the ♪ count) before a selection point
function textOffset(root, node, off) {
  const r = document.createRange();
  r.selectNodeContents(root);
  try { r.setEnd(node, off); } catch { return 0; }
  const f = r.cloneContents();
  f.querySelectorAll("[data-skip]").forEach((x) => x.remove());
  return f.textContent.length;
}
const hasSelection = () => { const s = window.getSelection && window.getSelection(); return Boolean(s && !s.isCollapsed && s.toString().trim()); };

export default function TalkLyricsView({ lyrics, talkText, talkMeta = {}, sources, onSources, songVersion }) {
  const comp = useMemo(() => buildCompanion({ lyrics, talkText, sources, sync: songVersion && songVersion.sync }), [lyrics, talkText, sources, songVersion && songVersion.sync]); // eslint-disable-line react-hooks/exhaustive-deps
  const { lines, paragraphs } = comp;
  const [focus, setFocus] = useState(null);
  const [note, setNote] = useState("");
  const talkBox = useRef(null), lyricBox = useRef(null);
  const paraRefs = useRef({}), lineRefs = useRef({});

  const linesByPara = useMemo(() => { const m = {}; lines.forEach((l, k) => { if (l.p >= 0) (m[l.p] = m[l.p] || []).push(k); }); return m; }, [lines]);
  useEffect(() => { setFocus(null); }, [comp]);

  // show a focus: scroll the OTHER side to it (both when the music drives it)
  function show(f, from) {
    setFocus(f);
    if (from !== "talk" && f.paras.length) scrollInside(talkBox.current, paraRefs.current[f.paras[0]]);
    if (from !== "lyrics" && f.lines.length) scrollInside(lyricBox.current, lineRefs.current[f.lines[0]]);
  }
  function pickLine(k) { if (hasSelection()) return; show(focusFromLines(comp, [k]), "lyrics"); }
  function pickPara(p) { if (hasSelection()) return; const f = focusFromLines(comp, linesByPara[p] || [], `“${paragraphs[p]}”`); f.paras = [p]; show(f, "talk"); }

  // drag-select words on either side; act once the selection is finished
  useEffect(() => {
    let timer = 0, down = false;
    const run = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount || s.toString().trim().length < 2) return;
      const r = s.getRangeAt(0);
      const tb = talkBox.current, lb = lyricBox.current;
      if (tb && tb.contains(r.commonAncestorContainer)) {
        const pieces = [];
        Object.entries(paraRefs.current).forEach(([pi, el]) => {
          if (!el || !r.intersectsNode(el)) return;
          const p = Number(pi), len = paragraphs[p].length;
          const a = el.contains(r.startContainer) ? textOffset(el, r.startContainer, r.startOffset) : 0;
          const b = el.contains(r.endContainer) ? textOffset(el, r.endContainer, r.endOffset) : len;
          if (b > a) pieces.push({ p, a: Math.max(0, a), b: Math.min(len, b) });
        });
        if (pieces.length) show(focusFromTalk(comp, pieces), "talk");
      } else if (lb && lb.contains(r.commonAncestorContainer)) {
        const ks = Object.entries(lineRefs.current).filter(([, el]) => el && r.intersectsNode(el)).map(([k]) => Number(k)).sort((a, b) => a - b);
        if (ks.length) show(focusFromLines(comp, ks), "lyrics");
      }
    };
    const onSel = () => { clearTimeout(timer); if (!down) timer = setTimeout(run, 450); };
    const onDown = () => { down = true; clearTimeout(timer); };
    const onUp = () => { down = false; clearTimeout(timer); timer = setTimeout(run, 40); };
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("keyup", onUp, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("keyup", onUp, true);
    };
  }, [comp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- trace with AI ----
  const [tracing, setTracing] = useState("");
  async function trace() {
    const sung = lines.map((l) => l.text);
    if (!sung.length || !paragraphs.length) return;
    setTracing("Reading the song against the talk…");
    try {
      const r = await traceLyricSources({ lines: sung, paragraphs });
      onSources && onSources({ lines: sung, map: r.map || {}, model: r.model, at: Date.now(), from: "trace" });
      setTracing("");
    } catch (e) { setTracing(`Couldn't trace the lyrics: ${e.message || e}`); }
  }

  // ---- play along ----
  const [audioUrl, setAudioUrl] = useState("");
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let u = "", alive = true;
    (async () => {
      if (!songVersion || !songVersion.mediaKey) { setAudioUrl(""); return; }
      const rec = await getMedia(songVersion.mediaKey);
      if (!alive || !rec) return;
      u = URL.createObjectURL(rec.blob); setAudioUrl(u);
    })();
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [songVersion && songVersion.mediaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastK = useRef(-2);
  function onTime(e) {
    const k = lineAtTime(lines, e.currentTarget.currentTime);
    if (k !== lastK.current) { lastK.current = k; if (k >= 0) show(focusFromLines(comp, [k]), "music"); }
  }
  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      const k = focus && focus.lines.length ? focus.lines[0] : -1;
      if (k >= 0 && lines[k].t != null && Math.abs(a.currentTime - lines[k].t) > 2) a.currentTime = Math.max(0, lines[k].t - 0.3);
      a.play().catch(() => {});
    } else a.pause();
  }
  async function copyQuote() {
    try { await navigator.clipboard.writeText(focus.quote); setNote("Copied."); } catch { setNote("Select the words and copy them by hand."); }
    setTimeout(() => setNote(""), 2000);
  }

  if (!talkText || !paragraphs.length) return null;
  if (!lines.length) return null;
  const traced = lines.filter((l) => l.ai).length;
  const found = lines.filter((l) => l.p >= 0).length;
  const litParas = new Set(focus ? focus.paras : []);
  const lit = new Set(focus ? focus.lines : []);

  const renderPara = (p, i) => {
    const n = (linesByPara[i] || []).length;
    const ranges = mergeRanges(focus && focus.marks[i], p.length);
    const parts = [];
    let at = 0;
    ranges.forEach(([a, b], j) => { if (a > at) parts.push(p.slice(at, a)); parts.push(<mark key={j} className="tl-mark">{p.slice(a, b)}</mark>); at = b; });
    if (at < p.length) parts.push(p.slice(at));
    return (
      <p key={i} ref={(el) => { paraRefs.current[i] = el; }} className={`tl-para${litParas.has(i) ? " on" : ""}${n ? " has" : ""}`} onClick={() => pickPara(i)}>
        {n ? <span data-skip="1" className="tl-count" title={`${n} line${n === 1 ? "" : "s"} of the song come from here`}>♪ {n}</span> : null}
        {ranges.length ? parts : p}
      </p>
    );
  };

  let lastSection = null;
  return (
    <div className="music-card tl-card" style={{ marginBottom: 16 }}>
      <h3>📖 The talk and the song, side by side <span className={`chip${found === lines.length ? " ok" : ""}`}>{found} of {lines.length} lines found in the talk</span>{traced ? <span className="chip ok" style={{ marginLeft: 6 }}>{traced} traced by AI</span> : null}</h3>
      <p className="note" style={{ marginTop: 0 }}>
        Tap or highlight words on either side and the other side lights up: the talk passage behind a lyric, or the lyrics that came from part of the talk.
        Publishing to Conference Concert adds this view to the song there, with a link you can share.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <button className="btn btn-ghost btn-sm" onClick={trace} disabled={Boolean(tracing && !tracing.startsWith("Couldn't"))} title="Claude reads the lyrics against the talk and names the paragraph and exact phrase behind each line (a fraction of a cent)">
          {tracing && !tracing.startsWith("Couldn't") ? "Tracing…" : traced ? "✨ Trace again with AI" : "✨ Trace the lines with AI"}
        </button>
        {audioUrl && comp.timed && <button className="btn btn-primary btn-sm" onClick={togglePlay}>{playing ? "⏸ Pause" : "▶ Play along"}</button>}
        {audioUrl && !comp.timed && <span className="note" style={{ margin: 0 }}>Sync the lyrics on the Song step to play along.</span>}
        <button className="btn btn-ghost btn-sm" onClick={copyQuote} disabled={!focus || !focus.quote} title={focus && focus.quote ? `Copy: ${focus.quote.slice(0, 140)}` : "Tap or highlight something first"}>📋 Copy quote</button>
        {focus && <button className="btn btn-ghost btn-sm" onClick={() => { setFocus(null); try { window.getSelection().removeAllRanges(); } catch {} }}>Clear</button>}
        {(tracing || note) && <span className="note" style={{ margin: 0 }}>{tracing || note}</span>}
      </div>
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" onTimeUpdate={onTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} style={{ display: "none" }} />}
      <div className="tl-split">
        <div className="tl-col">
          <div className="tl-head">From the talk{talkMeta.title ? <> · <em>{talkMeta.title}</em></> : null}{talkMeta.speaker ? ` · ${talkMeta.speaker}` : ""}</div>
          <div className="tl-scroll tl-talk" ref={talkBox}>{paragraphs.map(renderPara)}</div>
        </div>
        <div className="tl-col">
          <div className="tl-head">In the song</div>
          <div className="tl-scroll tl-lyrics" ref={lyricBox}>
            {lines.map((l, k) => {
              const head = l.section && l.section !== lastSection ? <div className="tl-section" key={`s${k}`}>{l.section}</div> : null;
              lastSection = l.section;
              return (
                <React.Fragment key={k}>
                  {head}
                  <div ref={(el) => { lineRefs.current[k] = el; }} className={`tl-line${lit.has(k) ? " on" : ""}${l.p < 0 ? " free" : ""}`} onClick={() => pickLine(k)} title={l.p < 0 ? "Not found in the talk — written for the song" : `From paragraph ${l.p + 1}${l.ai ? " (traced by AI)" : ""}`}>
                    {l.text}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
