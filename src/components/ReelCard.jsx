// src/components/ReelCard.jsx — the vertical Reel / Short (9:16) for Facebook
// Reels and YouTube Shorts: a short piece of the speaker's own words (from the
// closing clip), the song's first chorus with its lyrics, then the logo.
//
// The chorus window is the song's "preview" (timeline.preview when set by
// hand, otherwise found from the lyric sync). The same window is what the
// Conference Concert library plays as the song's preview.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getMedia, putMedia } from "../lib/project-store.js";
import { renderMusicVideo, pickRenderMime, isRendering } from "../lib/video-render.js";
import { previewWindow } from "../lib/chorus.js";
import { REEL_W, REEL_H, FB_REEL_MAX, SHORTS_MAX, clipLength, defaultSpeakerRange, trimSpeakerClip, reelText, reelOutline } from "../lib/reel.js";

const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`; };

export default function ReelCard({ projectId, tl, setTimeline, lyrics, songVersion, audioUrl, totalSec, segments, bookendUrls = {}, endCard = {}, meta = {}, talkMeta = {} }) {
  const reel = tl.reel || {};
  const setReel = (patch) => setTimeline((p) => ({ ...p, reel: { ...((p && p.reel) || {}), ...patch } }));

  // ---- the song part: the first chorus ----
  const auto = useMemo(() => previewWindow({}, lyrics, songVersion && songVersion.sync, totalSec), [lyrics, songVersion && songVersion.sync, totalSec]); // eslint-disable-line react-hooks/exhaustive-deps
  const win = previewWindow(tl, lyrics, songVersion && songVersion.sync, totalSec);
  const setWin = (start, end) => setTimeline((p) => ({ ...p, preview: { start: Math.max(0, Math.round(start * 10) / 10), end: Math.max(0, Math.round(end * 10) / 10) } }));
  const songLen = win ? Math.max(0, win.end - win.start) : 0;

  // ---- the speaker part: a piece of the closing clip (or the opening clip) ----
  const be = tl.bookends || {};
  const kind = be.post && bookendUrls.post ? "post" : be.pre && bookendUrls.pre ? "pre" : "";
  const clip = kind ? be[kind] : null;
  const clipSrc = kind ? bookendUrls[kind] : "";
  const clipLen = clipLength(clip);
  const order = reel.order || "first";
  const range = reel.range && Number(reel.range.to) > Number(reel.range.from) ? reel.range : defaultSpeakerRange(clip);
  const speakerLen = order !== "none" && clip && range ? Math.max(0, Math.min(clipLen, range.to) - range.from) : 0;

  const frame = reel.frame || "fill";
  const showTitle = reel.title !== false;
  const logo = reel.logo !== false;
  const outline = reelOutline({ speakerLen, speakerOrder: order, songLen, logoSec: logo ? 3 : 0 });

  // ---- listening / watching the pieces ----
  const audioRef = useRef(null);
  const vidRef = useRef(null);
  const stopAt = useRef({ a: 0, v: 0 });
  function listen() {
    const a = audioRef.current;
    if (!a || !win) return;
    stopAt.current.a = win.end;
    a.currentTime = win.start;
    a.play().catch(() => {});
  }
  function watchSpeaker() {
    const v = vidRef.current;
    if (!v || !clip || !range) return;
    const base = Math.max(0, Number(clip.in) || 0);
    stopAt.current.v = base + range.to;
    v.currentTime = base + range.from;
    v.play().catch(() => {});
  }

  // ---- render ----
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const jobRef = useRef(null);
  const canvasRef = useRef(null);
  const [url, setUrl] = useState("");
  const out = reel.render || null;
  useEffect(() => {
    let u = "", alive = true;
    (async () => {
      if (!out || !out.mediaKey) { setUrl(""); return; }
      const rec = await getMedia(out.mediaKey);
      if (!alive) return;
      if (!rec) { setUrl(""); return; }
      u = URL.createObjectURL(rec.blob);
      setUrl(u);
    })();
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [out && out.mediaKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const songTitle = (meta && meta.songTitle) || "";
  const blocker = !audioUrl || !totalSec ? "Add the finished song first (the Song step)."
    : !segments.length ? "No scenes with images yet."
    : !win ? "The first chorus wasn't found — sync the lyrics on the Song step (and label the chorus [Chorus]), or type the start and end below."
    : !outline.fitsShorts ? `The Reel would be ${Math.round(outline.total)} s — keep it under ${SHORTS_MAX} s.`
    : "";

  async function renderReel() {
    setErr("");
    if (blocker) { setErr(blocker); return; }
    if (isRendering()) { setErr("Another video is rendering right now — wait for it to finish."); return; }
    if (!pickRenderMime()) { setErr("This browser can't record video — use Chrome or Edge."); return; }
    const speaker = order !== "none" && clip && clipSrc && range ? trimSpeakerClip(clip, clipSrc, range) : null;
    const talk = talkMeta || {};
    const plan = {
      width: REEL_W, height: REEL_H, fps: 30, bitrate: 8_000_000,
      audioUrl, totalSec, segments,
      lyricsOverlay: true, lyricsMode: tl.lyricsMode || "one", lyricsSize: tl.lyricsSize || "large",
      watermark: "",
      bookends: { pre: order === "first" ? speaker : null, post: order === "after" ? speaker : null },
      qaIntro: null, introLead: 0,
      songFrom: win.start, songTo: win.end,
      frame,
      header: showTitle ? { title: songTitle || talk.title || "", subtitle: talk.title ? `Inspired by “${talk.title}”${talk.speaker ? ` · ${talk.speaker}` : ""}` : (talk.speaker || "") } : null,
      endLogo: logo ? { src: "/end-logo.webp", seconds: 3, fade: 0.6, lines: [endCard.site || "conferenceconcert.netlify.app", endCard.youtube ? `▶ ${endCard.youtube}` : ""] } : null,
    };
    setBusy(true); setPct(0); setMsg("Getting ready…");
    const job = renderMusicVideo(plan, { previewCanvas: canvasRef.current, onProgress: (p, m) => { setPct(p); setMsg(m); }, onStatus: setMsg });
    jobRef.current = job;
    try {
      const { blob, ext, mime } = await job.promise;
      const mediaKey = `${projectId}:reel:${Date.now().toString(36)}`;
      await putMedia(mediaKey, blob, { ext, mime, kind: "reel" });
      setReel({ render: { mediaKey, ext, mime, createdAt: Date.now(), sizeMB: +(blob.size / 1048576).toFixed(1), seconds: outline.total } });
      setMsg(`Done — ${(blob.size / 1048576).toFixed(1)} MB ${ext.toUpperCase()}, ${Math.round(outline.total)} s.`);
    } catch (e) {
      setErr(`Reel: ${e.message || e}`);
      setMsg("");
    } finally {
      setBusy(false);
      jobRef.current = null;
    }
  }
  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(songTitle || "song").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-reel.${(out && out.ext) || "mp4"}`;
    a.click();
  }

  // ---- post text ----
  const text = useMemo(() => reelText({ songTitle, talk: talkMeta || {}, site: endCard.site || "conferenceconcert.netlify.app" }), [songTitle, talkMeta, endCard.site]);
  const [copied, setCopied] = useState("");
  const copy = async (t, k) => { try { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1600); } catch { setErr("Couldn't copy — select the text and copy it by hand."); } };
  const copyRow = (k, label, value, rows = 0) => (
    <label className="field" style={{ margin: "8px 0" }}>
      <span className="lbl" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(value, k)}>{copied === k ? "Copied ✓" : "📋 Copy"}</button>
      </span>
      {rows ? <textarea readOnly value={value} style={{ minHeight: rows * 18 }} /> : <input type="text" readOnly value={value} />}
    </label>
  );

  const num = (v, set, opts = {}) => <input type="number" step="0.1" min="0" value={Number.isFinite(v) ? v : 0} onChange={(e) => set(Number(e.target.value) || 0)} style={{ width: 90 }} {...opts} />;

  return (
    <div className="video-card reel-card" style={{ marginTop: 14 }}>
      <div className="panel-head">
        <h3>📱 Reel / Short — vertical, for Facebook and YouTube <span className="chip">9:16</span></h3>
        <div className="row" style={{ gap: 8 }}>
          {!busy ? (
            <button className="btn btn-primary" onClick={renderReel} disabled={Boolean(blocker)} title={blocker || "Render the vertical Reel / Short"}>{out ? "Render the Reel again" : "Render the Reel"}</button>
          ) : (
            <button className="btn btn-ghost" onClick={() => jobRef.current && jobRef.current.cancel()}>Cancel</button>
          )}
        </div>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        {outline.parts.map((p) => `${{ speaker: "the speaker", chorus: "the first chorus", logo: "the logo" }[p.key]} (${Math.round(p.sec)} s)`).join(" → ") || "Nothing to show yet"}
        {outline.total ? ` · about ${Math.round(outline.total)} s` : ""}
        {outline.total ? (outline.fitsFacebook ? " · fits Facebook Reels and YouTube Shorts" : outline.fitsShorts ? ` · too long for a Facebook Reel (${FB_REEL_MAX} s) — fine for a YouTube Short` : "") : ""}
      </p>

      <div className="reel-grid">
        <div className="music-card reel-part">
          <h4>♪ The song — first chorus {win ? <span className="chip ok">{win.source === "manual" ? "set by hand" : "found from the lyric sync"}</span> : <span className="chip warn">not found</span>}</h4>
          {win ? (
            <p className="note" style={{ margin: "0 0 8px" }}>{fmt(win.start)} → {fmt(win.end)} ({Math.round(songLen)} s). This is also the song's <strong>preview</strong> in the Conference Concert library.</p>
          ) : (
            <p className="note" style={{ margin: "0 0 8px" }}>Sync the lyrics on the Song step (with the chorus labelled <code>[Chorus]</code>) and the first chorus is found automatically — or type where it starts and ends.</p>
          )}
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label className="row" style={{ gap: 6 }}><span className="note" style={{ margin: 0 }}>Starts at</span>{num(win ? win.start : 0, (v) => setWin(v, win ? Math.max(v + 3, win.end) : v + 30))}<span className="note" style={{ margin: 0 }}>s</span></label>
            <label className="row" style={{ gap: 6 }}><span className="note" style={{ margin: 0 }}>ends at</span>{num(win ? win.end : 0, (v) => setWin(win ? win.start : Math.max(0, v - 30), v))}<span className="note" style={{ margin: 0 }}>s</span></label>
            <button className="btn btn-ghost btn-sm" onClick={listen} disabled={!win || !audioUrl}>▶ Listen</button>
            {win && win.source === "manual" && auto && <button className="btn btn-ghost btn-sm" onClick={() => setTimeline((p) => ({ ...p, preview: null }))}>↺ Back to the first chorus ({fmt(auto.start)}–{fmt(auto.end)})</button>}
          </div>
          {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" onTimeUpdate={(e) => { if (stopAt.current.a && e.currentTarget.currentTime >= stopAt.current.a) { e.currentTarget.pause(); stopAt.current.a = 0; } }} style={{ display: "none" }} />}
        </div>

        <div className="music-card reel-part">
          <h4>🎙 The speaker {clip ? <span className="chip ok">from the {kind === "post" ? "closing" : "opening"} clip</span> : <span className="chip">no clip yet</span>}</h4>
          {!clip ? (
            <p className="note" style={{ margin: 0 }}>Choose the closing clip from the talk video on the Finishing touches step — a piece of it opens the Reel.</p>
          ) : (
            <>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <select value={order} onChange={(e) => setReel({ order: e.target.value })}>
                  <option value="first">Before the chorus</option>
                  <option value="after">After the chorus</option>
                  <option value="none">Leave the speaker out</option>
                </select>
                {order !== "none" && range && (
                  <>
                    <label className="row" style={{ gap: 6 }}><span className="note" style={{ margin: 0 }}>from</span>{num(range.from, (v) => setReel({ range: { from: Math.min(v, clipLen - 0.5), to: Math.max(range.to, v + 0.5) } }))}</label>
                    <label className="row" style={{ gap: 6 }}><span className="note" style={{ margin: 0 }}>to</span>{num(range.to, (v) => setReel({ range: { from: range.from, to: Math.min(clipLen, Math.max(range.from + 0.5, v)) } }))}<span className="note" style={{ margin: 0 }}>s of {Math.round(clipLen)} s</span></label>
                    <button className="btn btn-ghost btn-sm" onClick={watchSpeaker}>▶ Watch</button>
                    {reel.range && <button className="btn btn-ghost btn-sm" onClick={() => setReel({ range: null })}>↺ Default</button>}
                  </>
                )}
              </div>
              {order !== "none" && <video ref={vidRef} src={clipSrc} playsInline preload="metadata" className="reel-speaker" onTimeUpdate={(e) => { if (stopAt.current.v && e.currentTarget.currentTime >= stopAt.current.v) { e.currentTarget.pause(); stopAt.current.v = 0; } }} />}
              <p className="note" style={{ margin: "6px 0 0" }}>Its captions come along, timed to the words.</p>
            </>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="note" style={{ margin: 0 }}>Picture</span>
          <select value={frame} onChange={(e) => setReel({ frame: e.target.value })}>
            <option value="fill">Fill the screen (follows your camera paths)</option>
            <option value="fit">Whole picture, soft blurred edges</option>
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={showTitle} onChange={(e) => setReel({ title: e.target.checked })} /><span className="note" style={{ margin: 0 }}>Song title at the top</span></label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={logo} onChange={(e) => setReel({ logo: e.target.checked })} /><span className="note" style={{ margin: 0 }}>End on the logo (3 s)</span></label>
      </div>

      {blocker && !busy && <p className="note" style={{ color: "var(--warning)" }}>{blocker}</p>}
      {err && <p className="note" style={{ color: "var(--danger)" }}>{err}</p>}

      <div className="reel-stage">
        <canvas ref={canvasRef} className="reel-canvas" style={{ display: busy ? "block" : "none" }} />
        {(busy || msg) && (
          <div className="status-line">
            {busy && <span className="spinner" />}
            <span>{msg}</span>
            {busy && <div className="progress"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>}
          </div>
        )}
        {busy && <p className="note">Renders in real time — keep this tab open and in front.</p>}
        {url && !busy && (
          <div className="reel-final">
            <video src={url} controls playsInline className="reel-video" />
            <div className="reel-post">
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={download}>⬇ Download the Reel{out && out.sizeMB ? ` (${out.sizeMB} MB)` : ""}</button>
                <a className="btn btn-primary" href="https://www.youtube.com/upload" target="_blank" rel="noopener noreferrer">▶ YouTube Shorts upload</a>
                <a className="btn btn-primary" href="https://www.facebook.com/reels/create" target="_blank" rel="noopener noreferrer">f Create a Facebook Reel</a>
              </div>
              <p className="note">YouTube makes any vertical video under 3 minutes a Short. Upload it on the <strong>ConferenceAsAConcert</strong> channel, and on Facebook post it as a Reel from the Page.</p>
              {copyRow("st", `YouTube Shorts title (${text.shortsTitle.length}/100)`, text.shortsTitle)}
              {copyRow("sd", "YouTube Shorts description", text.shortsDescription, 7)}
              {copyRow("fb", "Facebook Reel caption", text.facebookCaption, 7)}
              <button className="btn btn-ghost btn-sm" onClick={() => copy(`${text.shortsTitle}\n\n${text.shortsDescription}\n\n— Facebook —\n${text.facebookCaption}`, "all")}>{copied === "all" ? "Copied ✓" : "📋 Copy all"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
