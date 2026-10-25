// src/components/TalkLyricsView.jsx — the talk and the song side by side.
// Left: the talk, paragraph by paragraph. Right: the lyrics. Tap a lyric line
// to see the paragraph it came from with the phrase it echoes lit up; tap a
// paragraph to see every line drawn from it. "Play along" plays the song and
// follows the lyric sync, moving through the talk as it goes. The same map is
// published to the Conference Concert app (Publish card) for its reading view.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getMedia } from "../lib/project-store.js";
import { traceLyricSources } from "../lib/api.js";
import { buildCompanion, lineAtTime } from "../lib/talk-companion.js";

function scrollInside(box, el) {
  if (!box || !el) return;
  // the box is position:relative, so offsetTop is already measured from it
  const top = el.offsetTop - box.clientHeight / 3;
  box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

export default function TalkLyricsView({ lyrics, talkText, talkMeta = {}, sources, onSources, songVersion }) {
  const comp = useMemo(() => buildCompanion({ lyrics, talkText, sources, sync: songVersion && songVersion.sync }), [lyrics, talkText, sources, songVersion && songVersion.sync]); // eslint-disable-line react-hooks/exhaustive-deps
  const { lines, paragraphs } = comp;
  const [sel, setSel] = useState(-1);      // selected lyric line (index into lines)
  const [para, setPara] = useState(-1);    // selected paragraph (when a paragraph was tapped)
  const talkBox = useRef(null), lyricBox = useRef(null);
  const paraRefs = useRef({}), lineRefs = useRef({});

  const linesByPara = useMemo(() => { const m = {}; lines.forEach((l, k) => { if (l.p >= 0) (m[l.p] = m[l.p] || []).push(k); }); return m; }, [lines]);
  const activePara = sel >= 0 ? lines[sel] && lines[sel].p : para;
  const lit = new Set(sel >= 0 ? [sel] : para >= 0 ? linesByPara[para] || [] : []);

  function pickLine(k, fromPlay = false) {
    setSel(k); setPara(-1);
    const l = lines[k];
    if (l && l.p >= 0) scrollInside(talkBox.current, paraRefs.current[l.p]);
    if (fromPlay) scrollInside(lyricBox.current, lineRefs.current[k]);
  }
  function pickPara(p) {
    setPara(p); setSel(-1);
    const ks = linesByPara[p] || [];
    if (ks.length) scrollInside(lyricBox.current, lineRefs.current[ks[0]]);
  }

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
    if (k !== lastK.current) { lastK.current = k; if (k >= 0) pickLine(k, true); }
  }
  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (sel >= 0 && lines[sel].t != null && Math.abs(a.currentTime - lines[sel].t) > 2) a.currentTime = Math.max(0, lines[sel].t - 0.3);
      a.play().catch(() => {});
    } else a.pause();
  }

  if (!talkText || !paragraphs.length) return null;
  if (!lines.length) return null;
  const traced = lines.filter((l) => l.ai).length;
  const found = lines.filter((l) => l.p >= 0).length;

  const renderPara = (p, i) => {
    const l = sel >= 0 ? lines[sel] : null;
    const range = l && l.p === i ? l.phrase : null;
    const n = (linesByPara[i] || []).length;
    const body = range ? <>{p.slice(0, range[0])}<mark className="tl-mark">{p.slice(range[0], range[1])}</mark>{p.slice(range[1])}</> : p;
    return (
      <p key={i} ref={(el) => { paraRefs.current[i] = el; }} className={`tl-para${activePara === i ? " on" : ""}${n ? " has" : ""}`} onClick={() => pickPara(i)}>
        {n ? <span className="tl-count" title={`${n} line${n === 1 ? "" : "s"} of the song come from here`}>♪ {n}</span> : null}
        {body}
      </p>
    );
  };

  let lastSection = null;
  return (
    <div className="music-card tl-card" style={{ marginBottom: 16 }}>
      <h3>📖 The talk and the song, side by side <span className={`chip${found === lines.length ? " ok" : ""}`}>{found} of {lines.length} lines found in the talk</span>{traced ? <span className="chip ok" style={{ marginLeft: 6 }}>{traced} traced by AI</span> : null}</h3>
      <p className="note" style={{ marginTop: 0 }}>
        Tap a lyric line to see where it came from in the talk; tap a paragraph to see the lines it became.
        Publishing to Conference Concert adds this view to the song there, with a link you can share.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={trace} disabled={Boolean(tracing && !tracing.startsWith("Couldn't"))} title="Claude reads the lyrics against the talk and names the paragraph and exact phrase behind each line (a fraction of a cent)">
          {tracing && !tracing.startsWith("Couldn't") ? "Tracing…" : traced ? "✨ Trace again with AI" : "✨ Trace the lines with AI"}
        </button>
        {audioUrl && comp.timed && <button className="btn btn-primary btn-sm" onClick={togglePlay}>{playing ? "⏸ Pause" : "▶ Play along"}</button>}
        {audioUrl && !comp.timed && <span className="note" style={{ margin: 0 }}>Sync the lyrics on the Song step to play along.</span>}
        {tracing && <span className="note" style={{ margin: 0 }}>{tracing}</span>}
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
