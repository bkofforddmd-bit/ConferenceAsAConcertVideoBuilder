// src/campus/SongPage.jsx — the student's public song page at /song/<code>,
// opened from the QR code on the thank-you screen. No sign-in. Shows the song
// title, the talk it came from, the song itself (or "on its way"), the lyrics,
// and a quick rating. Nothing about the student or the worker is ever loaded.
import React, { useEffect, useState } from "react";
import { shareApi } from "./campus-api.js";
import { Stars } from "./Phase4Parts.jsx";
import "./campus.css";

export default function SongPage({ code }) {
  const [page, setPage] = useState(null);
  const [err, setErr] = useState("");
  const [showLyrics, setShowLyrics] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(() => { try { return localStorage.getItem(`rated-${code}`) === "1"; } catch { return false; } });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    shareApi.get(code).then((r) => { setPage(r.page); document.title = `${r.page.title} · Conference as a Concert`; }).catch((e) => setErr(e.message));
  }, [code]);

  async function sendRating() {
    setBusy(true);
    try {
      await shareApi.feedback(code, rating, comment);
      setRated(true);
      try { localStorage.setItem(`rated-${code}`, "1"); } catch {}
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="campus">
      <main className="campus-body" style={{ padding: 0, maxWidth: "none" }}>
        <div className="c-hero c-song-hero">
          <div className="c-hero-sky" aria-hidden="true"><div className="c-hero-rays" /><div className="c-hero-glow" /><div className="c-hero-clouds" /><div className="c-hero-ridge" /><div className="c-hero-bokeh" /></div>
          <div className="c-hero-content" style={{ width: "100%" }}>
            <div className="c-song-kicker">Conference as a Concert</div>
            {!page && !err && <p className="c-hero-line"><span className="c-spinner" />Loading your song…</p>}
            {err && !page && (
              <>
                <h1 className="c-hero-title" style={{ fontSize: "clamp(32px, 9vw, 52px)" }}>Song not found</h1>
                <p className="c-hero-line">{err} Check the link, or find more songs at the Conference Concert library.</p>
                <a className="c-hero-btn" href="https://conferenceconcert.netlify.app">Visit Conference as a Concert ›</a>
              </>
            )}
            {page && (
              <>
                <h1 className="c-hero-title" style={{ fontSize: "clamp(34px, 10vw, 60px)" }}>{page.title}</h1>
                <div className="c-hero-rule" aria-hidden="true"><span /><i /><span /></div>
                {page.talk && <p className="c-hero-line" style={{ marginBottom: 16 }}>Inspired by “{page.talk.title}”<br /><small>{page.talk.speaker} · General Conference</small></p>}

                {page.song ? (
                  <div className="c-song-player">
                    {page.song.kind === "video" && <video src={page.song.url} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 12, background: "#000" }} />}
                    {page.song.kind === "audio" && <audio src={page.song.url} controls preload="metadata" style={{ width: "100%" }} />}
                    {page.song.kind === "link" && <a className="c-hero-btn" href={page.song.url} target="_blank" rel="noopener noreferrer">▶ Listen to your song</a>}
                    {page.song.fromLibrary && page.song.title && page.song.title !== page.title && <p className="c-note" style={{ color: "#dbe6f5" }}>Now in the library as “{page.song.title}”.</p>}
                  </div>
                ) : (
                  <div className="c-song-player"><p className="c-hero-line" style={{ fontSize: 18, margin: 0 }}>🎶 Your song is still being finished.<br /><small>Save this page and check back soon.</small></p></div>
                )}

                {page.lyrics && (
                  <div style={{ marginTop: 16 }}>
                    <button className="btn btn-ghost" onClick={() => setShowLyrics((v) => !v)}>{showLyrics ? "Hide the lyrics" : "📜 Show the lyrics"}</button>
                    {showLyrics && <div className="c-lyrics" style={{ textAlign: "left", marginTop: 10, background: "rgba(0,0,0,0.35)" }}>{page.lyrics}</div>}
                  </div>
                )}

                <div className="c-share" style={{ marginTop: 22 }}>
                  {rated ? (
                    <div className="c-share-title">Thanks for rating your song! 💛</div>
                  ) : (
                    <>
                      <div className="c-share-title">How do you like your song?</div>
                      <Stars value={rating} onChange={setRating} />
                      {rating > 0 && (
                        <>
                          <label className="c-field" style={{ textAlign: "left" }}><span className="lbl">Comment (optional — please leave out your name)</span><textarea value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 60 }} /></label>
                          <button className="c-btn primary" style={{ textAlign: "center" }} disabled={busy} onClick={sendRating}>{busy ? "Sending…" : "Send"}</button>
                        </>
                      )}
                      {err && <div className="c-err">{err}</div>}
                    </>
                  )}
                </div>

                <p className="c-hero-link" style={{ marginTop: 20 }}>
                  {page.talk && page.talk.url && <><a href={page.talk.url} target="_blank" rel="noopener noreferrer">Read the talk ↗</a> · </>}
                  <a href="https://conferenceconcert.netlify.app" target="_blank" rel="noopener noreferrer">More conference songs ↗</a>
                </p>
                <p className="c-note" style={{ color: "#c9d6ea" }}>Higher ground through holier sound.</p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
