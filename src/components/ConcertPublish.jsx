// src/components/ConcertPublish.jsx
//
// "Publish to Conference Concert" — one click sends the finished song (audio,
// lyrics, talk details, lyric timings) to the Conference Concert library.
// Everything is prefilled from the project; the band password is remembered
// in this browser.

import React, { useEffect, useState } from "react";
import { getMedia } from "../lib/project-store.js";
import { parseSync } from "../lib/lyric-sync.js";
import { publishToConcert, syncToLyricTimings, loadConcertPassword, saveConcertPassword, CONCERT_SITE } from "../lib/concert.js";

export default function ConcertPublish({ song, lyrics, talkMeta, meta, styleBible, styleReference }) {
  const active = (song && song.versions || []).find((v) => v.id === song.activeId) || null;
  const sync = active ? parseSync(lyrics, active.sync) : null;
  const [pw, setPw] = useState(loadConcertPassword);
  const [showPw, setShowPw] = useState(false);
  const [f, setF] = useState({
    title: (meta && meta.songTitle) || (active && active.title) || "",
    talk: (talkMeta && talkMeta.title) || "",
    speaker: (meta && meta.speaker) || (talkMeta && talkMeta.speaker) || "",
    session: (meta && meta.session) || (talkMeta && talkMeta.session) || "",
    talkUrl: (talkMeta && talkMeta.sourceUrl) || "",
    style: (active && active.style) || (styleBible && styleBible.musicDirection && styleBible.musicDirection.genre) || styleReference || "",
    theme: "",
    blurb: "",
  });
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  // Prefill follows the project if the title/speaker arrive later.
  useEffect(() => {
    setF((p) => ({
      ...p,
      title: p.title || (meta && meta.songTitle) || (active && active.title) || "",
      speaker: p.speaker || (meta && meta.speaker) || (talkMeta && talkMeta.speaker) || "",
      talk: p.talk || (talkMeta && talkMeta.title) || "",
    }));
  }, [meta && meta.songTitle, meta && meta.speaker, talkMeta && talkMeta.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const up = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function publish() {
    setError("");
    setDone(null);
    if (!active || !active.mediaKey) { setError("Generate or upload a song first (step 3)."); return; }
    if (!f.title.trim()) { setError("Give the song a title."); return; }
    if (!pw.trim()) { setError("Enter the Conference Concert band password."); return; }
    setBusy(true);
    try {
      const rec = await getMedia(active.mediaKey);
      if (!rec || !rec.blob) throw new Error("The song's audio isn't in this browser's storage. Re-open the project where it was made, or upload the file on the Music step.");
      saveConcertPassword(pw.trim());
      const lyricTimings = sync ? syncToLyricTimings(lyrics, sync) : null;
      const entry = await publishToConcert({
        password: pw.trim(),
        song: { ...f, lyrics, duration: active.durationSec || 0, lyricTimings },
        audio: rec.blob,
        onStep: setStep,
      });
      setDone(entry);
      setStep("");
    } catch (e) {
      setError(e.message || String(e));
      setStep("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="music-card" style={{ marginBottom: 16 }}>
      <h3>Publish to Conference Concert {active ? <span className="chip ok">song ready</span> : <span className="chip">needs a song</span>}{sync ? <span className="chip ok" style={{ marginLeft: 6 }}>lyrics synced</span> : null}</h3>
      <p className="note" style={{ marginTop: 0 }}>
        Sends the finished song to the Conference Concert library at {CONCERT_SITE.replace("https://", "")}: the audio,
        the lyrics with their sung-line timing, and the talk details. Same result as the band upload form there, prefilled.
      </p>

      <div className="settings-grid">
        <div className="settings-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Song title</span><input type="text" value={f.title} onChange={up("title")} /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Speaker</span><input type="text" value={f.speaker} onChange={up("speaker")} placeholder="Elder …" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Talk</span><input type="text" value={f.talk} onChange={up("talk")} /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Session</span><input type="text" value={f.session} onChange={up("session")} placeholder="e.g. Sunday Morning Session" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Talk link</span><input type="text" value={f.talkUrl} onChange={up("talkUrl")} /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Musical style</span><input type="text" value={f.style} onChange={up("style")} /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Theme (optional)</span><input type="text" value={f.theme} onChange={up("theme")} placeholder="e.g. Faith, Endurance" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Blurb (optional)</span><input type="text" value={f.blurb} onChange={up("blurb")} placeholder="One sentence about the song" /></label>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <label className="field" style={{ margin: 0, flex: "1 1 220px", maxWidth: 360 }}>
          <span className="lbl">Band password</span>
          <span className="row" style={{ gap: 6 }}>
            <input type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPw(!showPw)}>{showPw ? "Hide" : "Show"}</button>
          </span>
        </label>
        <button className="btn btn-primary" onClick={publish} disabled={busy || !active} style={{ alignSelf: "flex-end" }}>
          {busy && <span className="spinner" />}
          {busy ? "Publishing…" : "Publish song"}
        </button>
      </div>
      <p className="note">
        Take being sent: <strong>{active ? `${active.title} · ${Math.floor((active.durationSec || 0) / 60)}:${String(Math.floor((active.durationSec || 0) % 60)).padStart(2, "0")}` : "—"}</strong>
        {active && !sync ? " · no lyric sync yet (lyrics will auto-scroll instead of highlighting; tap ⏱ Sync lyrics on the Music step first if you want line-by-line timing)" : ""}
      </p>

      {step && <div className="status-line"><span className="spinner" /><span>{step}</span></div>}
      {error && <div className="error">{error}</div>}
      {done && (
        <div className="note" style={{ color: "var(--success)" }}>
          ✓ Published "{done.title}" to the Conference Concert library.{" "}
          <a href={CONCERT_SITE} target="_blank" rel="noopener noreferrer" style={{ color: "var(--sky)" }}>Open the library ↗</a>
        </div>
      )}
    </div>
  );
}
