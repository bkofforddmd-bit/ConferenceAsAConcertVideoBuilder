// src/components/ConcertPublish.jsx
//
// "Publish to Conference Concert" — one click sends the finished song (audio,
// lyrics, talk details, lyric timings) to the Conference Concert library.
// Everything is prefilled from the project; the band password is remembered
// in this browser.

import React, { useEffect, useMemo, useState } from "react";
import { getMedia } from "../lib/project-store.js";
import { parseSync, fmtStamp } from "../lib/lyric-sync.js";
import { previewWindow } from "../lib/chorus.js";
import { buildCompanion, companionPayload } from "../lib/talk-companion.js";
import AttachFile from "./AttachFile.jsx";
import { publishToConcert, updateConcertEntry, uploadVideoOnly, saveCompanion, findLibraryEntry, conferenceLabel, syncToLyricTimings, loadConcertPassword, saveConcertPassword, CONCERT_SITE } from "../lib/concert.js";

export default function ConcertPublish({ song, timeline = null, talkText = "", sources = null, lyrics, talkMeta, meta, styleBible, styleReference, render, missing = {}, onAttachVideo, onAttachSong }) {
  const hasVideo = Boolean(render && render.mediaKey);
  const [includeVideo, setIncludeVideo] = useState(true);
  // The vertical Reel / Short (Render step). Sent with the song; on an update it
  // is sent when the library doesn't have one yet (or when ticked to replace it).
  const reel = timeline && timeline.reel && timeline.reel.render && timeline.reel.render.mediaKey ? timeline.reel.render : null;
  const [sendReelPick, setSendReel] = useState(null);
  const [youtube, setYoutube] = useState("");
  const active = (song && song.versions || []).find((v) => v.id === song.activeId) || null;
  const sync = active ? parseSync(lyrics, active.sync) : null;
  // The talk & lyrics side by side (no talk text is sent: the Concert app reads the talk itself).
  const companion = useMemo(() => {
    if (!talkText || !lyrics) return null;
    const c = buildCompanion({ lyrics, talkText, sources, sync: active && active.sync });
    const found = c.lines.filter((l) => l.p >= 0).length;
    return found ? { found, total: c.lines.length, data: companionPayload(c, { talkUrl: (talkMeta && talkMeta.sourceUrl) || "", talkTitle: (talkMeta && talkMeta.title) || "", speaker: (talkMeta && talkMeta.speaker) || "" }) } : null;
  }, [talkText, lyrics, sources, active && active.sync, talkMeta]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sendCompanion, setSendCompanion] = useState(true);
  async function sendTalkView(id) {
    if (!companion || !sendCompanion || !id) return;
    setStep("Adding the talk & lyrics side by side…");
    await saveCompanion({ password: pw.trim(), id, data: companion.data });
  }
  // The library's preview plays the first chorus (or the window set on the Reel card).
  const preview = active ? previewWindow(timeline, lyrics, active.sync, active.durationSec || 0) : null;
  const previewFields = preview ? { previewStart: Math.floor(preview.start), previewEnd: Math.ceil(preview.end) } : {};
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
  const libReel = Boolean((done && done.reelUrl) || (existing && existing.reelUrl));
  const sendReel = Boolean(reel) && (sendReelPick == null ? !libReel : sendReelPick);
  async function reelBlob() {
    const r = await getMedia(reel.mediaKey);
    if (!r || !r.blob) throw new Error("The Reel isn't in this browser's storage — render it again on the Render step, or untick \"Also publish the Reel\".");
    return r.blob;
  }

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
        if (!vrec || !vrec.blob) throw new Error("The music video isn't in this browser's storage. Attach the video file above, or untick \"Also publish the music video\".");
        videoUrl = await uploadVideoOnly({ password: pw.trim(), title: f.title, video: vrec.blob, onStep: setStep });
      }
      let reelUrl = "";
      if (sendReel) reelUrl = await uploadVideoOnly({ password: pw.trim(), title: f.title, video: await reelBlob(), suffix: "-reel", label: "Reel", onStep: setStep });
      setStep("Updating the library entry…");
      const entry = await updateConcertEntry({
        password: pw.trim(),
        id: target.id,
        song: { ...f, ...previewFields, youtube: youtube.trim(), videoUrl, reelUrl, lyrics, duration: (active && active.durationSec) || target.duration || 0, lyricTimings },
      });
      await sendTalkView(entry.id || target.id);
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
      if (!rec || !rec.blob) throw new Error("The song's audio isn't in this browser's storage. Attach the song file above, or upload it on the Music step.");
      saveConcertPassword(pw.trim());
      const lyricTimings = sync ? syncToLyricTimings(lyrics, sync) : null;
      let videoBlob = null;
      if (hasVideo && includeVideo && !youtube.trim()) {
        const vrec = await getMedia(render.mediaKey);
        if (!vrec || !vrec.blob) throw new Error("The music video isn't in this browser's storage. Attach the video file above, or untick \"Also publish the music video\".");
        videoBlob = vrec.blob;
      }
      const entry = await publishToConcert({
        password: pw.trim(),
        song: { ...f, ...previewFields, youtube: youtube.trim(), lyrics, duration: active.durationSec || 0, lyricTimings },
        audio: rec.blob,
        video: videoBlob,
        reel: sendReel ? await reelBlob() : null,
        onStep: setStep,
      });
      await sendTalkView(entry.id);
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
      <h3>Publish to Conference Concert {active ? (missing.song ? <span className="chip warn">song file missing</span> : <span className="chip ok">song ready</span>) : <span className="chip">needs a song</span>}{sync ? <span className="chip ok" style={{ marginLeft: 6 }}>lyrics synced</span> : null}{hasVideo ? (missing.video ? <span className="chip warn" style={{ marginLeft: 6 }}>video file missing</span> : <span className="chip ok" style={{ marginLeft: 6 }}>video ready</span>) : null}{reel ? <span className="chip ok" style={{ marginLeft: 6 }}>Reel ready</span> : null}</h3>
      <p className="note" style={{ marginTop: 0 }}>
        Sends the finished song to the Conference Concert library at {CONCERT_SITE.replace("https://", "")}: the audio,
        the lyrics with their sung-line timing, and the talk details. Same result as the band upload form there, prefilled.
      </p>
      <p className="note" style={{ marginTop: 0 }}>
        <strong>Preview:</strong> {preview
          ? <>the library plays the {preview.source === "manual" ? "part you set on the Reel card" : "first chorus"}, {fmtStamp(preview.start)} → {fmtStamp(preview.end)}.</>
          : <>the first 20 seconds — sync the lyrics on the Song step and the preview becomes the first chorus.</>}
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
          <label className="row" style={{ gap: 8, alignSelf: "end" }} title={reel ? "Upload the vertical Reel / Short so it can be posted to Facebook and YouTube from the Conference Concert app" : "Make the Reel on the Render step first"}>
            <input type="checkbox" checked={sendReel} disabled={!reel} onChange={(e) => setSendReel(e.target.checked)} />
            <span className="note" style={{ margin: 0 }}>
              {libReel ? "Replace the Reel in the library" : "Also publish the Reel / Short"}{reel ? ` (${reel.sizeMB || "?"} MB, vertical)` : " — no Reel yet (Render step)"}
              {libReel && !sendReel ? " · the library already has one" : ""}
            </span>
          </label>
          <label className="row" style={{ gap: 8, alignSelf: "end" }} title={companion ? "Adds a 'read the talk beside the lyrics' view to the song in Conference Concert" : "Needs the talk text and lyrics lines found in it (see the side-by-side card above)"}>
            <input type="checkbox" checked={Boolean(companion) && sendCompanion} disabled={!companion} onChange={(e) => setSendCompanion(e.target.checked)} />
            <span className="note" style={{ margin: 0 }}>
              Also publish the talk &amp; lyrics side by side{companion ? ` (${companion.found} of ${companion.total} lines found in the talk)` : " — nothing matched yet"}
            </span>
          </label>
        </div>
      </div>

      {(missing.song || missing.video) && (
        <div className="music-card" style={{ margin: "10px 0 0", borderColor: "var(--warning)" }}>
          <div className="note" style={{ margin: 0 }}>
            <strong>Files to attach on this computer.</strong> A project .json carries the details only — the song and
            the video stay in the browser that made them. Attach the copies you saved and the publish will include them.
          </div>
          {missing.song && onAttachSong && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="note" style={{ margin: 0 }}>Song audio{active ? ` ("${active.title}")` : ""}:</span>
              <AttachFile className="btn btn-primary btn-sm" label="Attach the song file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" onFile={onAttachSong} />
            </div>
          )}
          {missing.video && onAttachVideo && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="note" style={{ margin: 0 }}>Music video{render && render.sizeMB ? ` (about ${render.sizeMB} MB)` : ""}:</span>
              <AttachFile className="btn btn-primary btn-sm" label="Attach the video file" accept="video/*,.mp4,.webm,.mov" onFile={onAttachVideo} />
            </div>
          )}
        </div>
      )}
      {!hasVideo && onAttachVideo && (
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="note" style={{ margin: 0 }}>Have the finished movie as a file (made on your phone or elsewhere)?</span>
          <AttachFile className="btn btn-ghost btn-sm" label="Attach a video file" accept="video/*,.mp4,.webm,.mov" onFile={onAttachVideo} />
        </div>
      )}

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
      {(done || existing) && (
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a className="btn btn-primary" href={`${CONCERT_SITE}/?song=${encodeURIComponent((done || existing).id)}`} target="_blank" rel="noopener noreferrer">
            📣 Post it to YouTube &amp; Facebook from Conference Concert ↗
          </a>
          <span className="note" style={{ margin: 0 }}>Opens this song there; in band mode its Publish kit has the YouTube text, the Facebook post, the Reel poster and the paste-back boxes.</span>
        </div>
      )}
      {(done || existing) && companion && (
        <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <a className="btn btn-ghost" href={`${CONCERT_SITE}/?song=${encodeURIComponent((done || existing).id)}&talk=1`} target="_blank" rel="noopener noreferrer">📖 Open the talk &amp; lyrics view ↗</a>
          <button className="btn btn-ghost btn-sm" onClick={() => { try { navigator.clipboard.writeText(`${CONCERT_SITE}/?song=${encodeURIComponent((done || existing).id)}&talk=1`); setStep(""); } catch {} }}>📋 Copy the link to share</button>
          <span className="note" style={{ margin: 0 }}>{done ? "" : "Publish or update to send the latest version."}</span>
        </div>
      )}
    </div>
  );
}
