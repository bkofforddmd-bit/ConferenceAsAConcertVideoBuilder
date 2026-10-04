// src/components/ConcertPublish.jsx
//
// "Publish to Conference Concert" — one click sends the finished song (audio,
// lyrics, talk details, lyric timings) to the Conference Concert library.
// Everything is prefilled from the project; the band password is remembered
// in this browser.

import React, { useEffect, useState } from "react";
import { getMedia } from "../lib/project-store.js";
import { parseSync } from "../lib/lyric-sync.js";
import { publishToConcert, updateConcertEntry, uploadVideoOnly, findLibraryEntry, conferenceLabel, syncToLyricTimings, loadConcertPassword, saveConcertPassword, CONCERT_SITE } from "../lib/concert.js";

export default function ConcertPublish({ song, lyrics, talkMeta, meta, styleBible, styleReference, render }) {
  const hasVideo = Boolean(render && render.mediaKey);
  const [includeVideo, setIncludeVideo] = useState(true);
  const [youtube, setYoutube] = useState("");
  const active = (song && song.versions || []).find((v) => v.id === song.activeId) || null;
  const sync = active ? parseSync(lyrics, active.sync) : null;
  const [pw, setPw] = useState(loadConcertPassword);
  const [showPw, setShowPw] = useState(false);
  const [f, setF] = useState({
    title: (meta && meta.songTitle) || (active && active.title) || "",
    talk: (talkMeta && talkMeta.title) || "",
    speaker: (meta && meta.speaker) || (talkMeta && talkMeta.speaker) || "",
    // The library groups songs by this field as "April 2008" — the conference, not the session name.
    session: conferenceLabel(talkMeta),
    talkUrl: (talkMeta && talkMeta.sourceUrl) || "",
    // Left blank on purpose: the Studio's style text describes the lyric
    // direction, not necessarily how the finished recording sounds.
    style: "",
    theme: "",
    blurb: "",
  });
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [existing, setExisting] = useState(null); // entry already in the library with this title/speaker

  // Is this song already in the library? (public catalog, no password)
  useEffect(() => {
    let alive = true;
    if (!f.title) { setExisting(null); return; }
    findLibraryEntry(f.title, f.speaker).then((e) => { if (alive) setExisting(e); });
    return () => { alive = false; };
  }, [f.title, f.speaker, done]);

  async function updateDetails() {
    const target = done || existing;
    if (!target || !target.id) return;
    setError("");
    if (!pw.trim()) { setError("Enter the Conference Concert band password."); return; }
    setBusy(true);
    setStep("Updating the library entry…");
    try {
      saveConcertPassword(pw.trim());
      const lyricTimings = sync ? syncToLyricTimings(lyrics, sync) : null;
      // Send the rendered video too when the entry doesn't have one yet (or the render is newer).
      let videoUrl = "";
      if (hasVideo && includeVideo && !youtube.trim() && !target.videoUrl) {
        const vrec = await getMedia(render.mediaKey);
        if (vrec && vrec.blob) videoUrl = await uploadVideoOnly({ password: pw.trim(), title: f.title, video: vrec.blob, onStep: setStep });
      }
      setStep("Updating the library entry…");
      const entry = await updateConcertEntry({
        password: pw.trim(),
        id: target.id,
        song: { ...f, youtube: youtube.trim(), videoUrl, lyrics, duration: (active && active.durationSec) || target.duration || 0, lyricTimings },
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

  // Prefill follows the project if the title/speaker arrive later.
  useEffect(() => {
    setF((p) => ({
      ...p,
      title: p.title || (meta && meta.songTitle) || (active && active.title) || "",
      speaker: p.speaker || (meta && meta.speaker) || (talkMeta && talkMeta.speaker) || "",
      talk: p.talk || (talkMeta && talkMeta.title) || "",
      session: p.session || conferenceLabel(talkMeta),
    }));
  }, [meta && meta.songTitle, meta && meta.speaker, talkMeta && talkMeta.title, talkMeta && talkMeta.conferenceMonthYear]); // eslint-disable-line react-hooks/exhaustive-deps

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
      let videoBlob = null;
      if (hasVideo && includeVideo && !youtube.trim()) {
        const vrec = await getMedia(render.mediaKey);
        if (vrec && vrec.blob) videoBlob = vrec.blob;
      }
      const entry = await publishToConcert({
        password: pw.trim(),
        song: { ...f, youtube: youtube.trim(), lyrics, duration: active.durationSec || 0, lyricTimings },
        audio: rec.blob,
        video: videoBlob,
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
          <label className="field" style={{ margin: 0 }}><span className="lbl">Conference (month &amp; year) <span className="note" style={{ margin: 0, display: "inline" }}>— the library groups by this</span></span><input type="text" value={f.session} onChange={up("session")} placeholder="October 2025" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Talk link</span><input type="text" value={f.talkUrl} onChange={up("talkUrl")} /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Musical style (optional)</span><input type="text" value={f.style} onChange={up("style")} placeholder="Leave blank, or describe the actual sound" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Theme (optional)</span><input type="text" value={f.theme} onChange={up("theme")} placeholder="e.g. Faith, Endurance" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">Blurb (optional)</span><input type="text" value={f.blurb} onChange={up("blurb")} placeholder="One sentence about the song" /></label>
          <label className="field" style={{ margin: 0 }}><span className="lbl">YouTube link (optional)</span><input type="text" value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="Paste once the video is on YouTube — it then plays instead of the file" /></label>
          <label className="row" style={{ gap: 8, alignSelf: "end" }} title={hasVideo ? "Upload the rendered MP4 so the library plays the music video" : "Render the video on the Video step first"}>
            <input type="checkbox" checked={hasVideo && includeVideo && !youtube.trim()} disabled={!hasVideo || Boolean(youtube.trim())} onChange={(e) => setIncludeVideo(e.target.checked)} />
            <span className="note" style={{ margin: 0 }}>
              Also publish the music video{hasVideo ? ` (${render.sizeMB || "?"} MB ${String(render.ext || "mp4").toUpperCase()})` : " — no render yet"}
              {youtube.trim() ? " · skipped: the YouTube link will play instead" : ""}
            </span>
          </label>
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
        {(done || existing) ? (
          <>
            <button className="btn btn-primary" onClick={updateDetails} disabled={busy} style={{ alignSelf: "flex-end" }} title="Re-send the details, lyrics and timing to the entry already in the library (the audio stays)">
              {busy && <span className="spinner" />}
              {busy ? "Working…" : "Update details in the library"}
            </button>
            <button className="btn btn-ghost" onClick={publish} disabled={busy || !active} style={{ alignSelf: "flex-end" }} title="Add a second copy with the current take's audio">
              Publish as a new song
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={publish} disabled={busy || !active} style={{ alignSelf: "flex-end" }}>
            {busy && <span className="spinner" />}
            {busy ? "Publishing…" : "Publish song"}
          </button>
        )}
      </div>
      {existing && !done && (
        <p className="note" style={{ color: "var(--sky)" }}>
          Already in the library as "{existing.title}" ({existing.session || "no conference set"}, {existing.speaker || "no speaker"}{existing.videoUrl ? ", has video" : existing.youtube ? ", has YouTube" : ", no video"}). "Update details" fixes it in place{hasVideo && !existing.videoUrl && !existing.youtube ? " and adds the video" : ""}.
        </p>
      )}
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
