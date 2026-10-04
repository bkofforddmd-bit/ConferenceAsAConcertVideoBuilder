// src/components/MusicStudio.jsx
//
// Step 3 of the Create pipeline: turn the finalized lyrics into a sung song.
// Picks a provider (Google Lyria 3.5, or MiniMax via fal.ai), starts an async
// job through music-start, polls music-status, downloads the audio, and keeps
// it in the project (IndexedDB) so the Video step can time scenes to it.
//
// `song` state lives in App (persisted in the autosave):
//   { versions: [ { id, provider, title, style, vocals, mediaKey, mimeType,
//                   durationSec, createdAt } ], activeId }

import React, { useEffect, useRef, useState } from "react";
import { musicStart, musicStatus, pollJob, fetchMediaBlob } from "../lib/api.js";
import { putMedia, getMedia } from "../lib/project-store.js";
import { hasKey } from "../lib/keys.js";

const VOCAL_PRESETS = [
  "solo male baritone, soft choir joins on the chorus",
  "solo female vocal, warm and intimate",
  "male and female duet, harmonies on the chorus",
  "full choir with piano and strings",
  "youth choir, bright and hopeful",
  "instrumental only, no vocals",
];

function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return "";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export default function MusicStudio({ projectId, lyrics, styleBible, styleReference, title, song, setSong, config, onContinue }) {
  const providers = (config && config.providers && config.providers.music) || [];
  const serverKeys = (config && config.serverKeys) || {};
  const [provider, setProvider] = useState("lyria");
  const [styleDirection, setStyleDirection] = useState("");
  const [vocals, setVocals] = useState(VOCAL_PRESETS[0]);
  const [length, setLength] = useState("about 3 minutes");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const abortRef = useRef(null);
  const audioRef = useRef(null);

  // Suggest a style from the style bible's music direction the first time.
  useEffect(() => {
    if (styleDirection) return;
    const md = styleBible && styleBible.musicDirection;
    if (md && md.genre) {
      setStyleDirection([md.genre, Array.isArray(md.moods) ? md.moods.join(", ") : "", md.notes].filter(Boolean).join(". "));
    } else if (styleReference) {
      setStyleDirection(styleReference);
    }
  }, [styleBible, styleReference]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the active version's audio into an object URL.
  const active = (song && song.versions || []).find((v) => v.id === song.activeId) || null;
  useEffect(() => {
    let revoked = false;
    let url = "";
    (async () => {
      if (!active || !active.mediaKey) { setAudioUrl(""); return; }
      const rec = await getMedia(active.mediaKey);
      if (!rec || revoked) { setAudioUrl(""); return; }
      url = URL.createObjectURL(rec.blob);
      setAudioUrl(url);
    })();
    return () => { revoked = true; if (url) URL.revokeObjectURL(url); };
  }, [active && active.mediaKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  async function generate() {
    setError("");
    if (!lyrics || !lyrics.trim()) { setError("Finalize your lyrics first (step 2)."); return; }
    const needs = provider === "lyria" ? "gemini" : "fal";
    if (!hasKey(needs, serverKeys)) {
      setError(`This provider needs a ${needs === "gemini" ? "Google Gemini" : "fal.ai"} key. Add one under Settings → API keys.`);
      return;
    }
    setBusy(true);
    setElapsed(0);
    setStatus("Sending your lyrics to the studio…");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const { jobId } = await musicStart({ provider, lyrics, styleDirection, vocals, title, durationHint: length });
      setStatus("Composing and singing… this usually takes 1–3 minutes.");
      const result = await pollJob(musicStatus, jobId, {
        intervalMs: 6000,
        signal: ac.signal,
        onTick: (s) => {
          if (s.status === "queued") setStatus(`Waiting in the provider's queue${s.position != null ? ` (position ${s.position})` : ""}…`);
          else if (s.status === "running") setStatus("Composing and singing… this usually takes 1–3 minutes.");
        },
      });
      setStatus("Downloading the song…");
      const blob = await fetchMediaBlob(result.audioDataUrl || result.audioUrl);
      const id = "s_" + Date.now().toString(36);
      const mediaKey = `${projectId}:song:${id}`;
      await putMedia(mediaKey, blob, { provider, title });
      // Measure the duration so the timeline can be built.
      const durationSec = await new Promise((res) => {
        const a = document.createElement("audio");
        const u = URL.createObjectURL(blob);
        a.onloadedmetadata = () => { res(a.duration || 0); URL.revokeObjectURL(u); };
        a.onerror = () => { res(0); URL.revokeObjectURL(u); };
        a.src = u;
      });
      const version = { id, provider, title: title || "Untitled song", style: styleDirection, vocals, mediaKey, mimeType: result.mimeType || blob.type, durationSec, createdAt: Date.now(), sungLyrics: result.lyrics || "" };
      setSong((prev) => {
        const versions = [...((prev && prev.versions) || []), version];
        return { versions, activeId: id };
      });
      setStatus(`Done — ${fmtDur(durationSec)} song ready.`);
    } catch (e) {
      setError(e.message || String(e));
      setStatus("");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    if (abortRef.current) abortRef.current.abort();
  }

  function download() {
    if (!audioUrl || !active) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    const ext = (active.mimeType || "").includes("wav") ? "wav" : "mp3";
    a.download = `${(active.title || "song").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`;
    a.click();
  }

  const versions = (song && song.versions) || [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Music</h2>
        {active && <button className="btn btn-primary btn-sm" onClick={onContinue}>Continue → Storyboard</button>}
      </div>
      <p className="sub">
        Lift the lyrics into a sung song. Choose a studio, describe the sound, and generate — the song
        stays with this project and sets the timing for the video.
      </p>

      {!lyrics || !lyrics.trim() ? (
        <div className="talk-banner empty"><div className="talk-banner-text">
          <div className="talk-banner-title">No finalized lyrics yet</div>
          <div className="talk-banner-meta">Go back to step 2, finalize the lyrics, then return here.</div>
        </div></div>
      ) : null}

      <div className="music-grid">
        <div className="music-card">
          <h3>Direction</h3>
          <div className="provider-pick">
            {providers.map((p) => {
              const ok = hasKey(p.needs, serverKeys);
              return (
                <button
                  key={p.id}
                  className={`provider-btn${provider === p.id ? " active" : ""}${ok ? "" : " nokey"}`}
                  onClick={() => setProvider(p.id)}
                  title={ok ? p.note : `${p.note} Needs a key — see Settings.`}
                >
                  <strong>{p.name} {ok ? <span className="chip ok">ready</span> : <span className="chip warn">needs key</span>}</strong>
                  <small>{p.note}</small>
                </button>
              );
            })}
          </div>
          <label className="field">
            <span className="lbl">Sound / style</span>
            <textarea
              style={{ minHeight: 70 }}
              placeholder="e.g. cinematic worship ballad, piano and strings, slow build to a soaring chorus"
              value={styleDirection}
              onChange={(e) => setStyleDirection(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="lbl">Voices</span>
            <input type="text" list="vocal-presets" value={vocals} onChange={(e) => setVocals(e.target.value)} />
            <datalist id="vocal-presets">
              {VOCAL_PRESETS.map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>
          <label className="field">
            <span className="lbl">Length</span>
            <select value={length} onChange={(e) => setLength(e.target.value)}>
              <option>about 2 minutes</option>
              <option>about 3 minutes</option>
              <option>about 4 minutes</option>
            </select>
          </label>
          <div className="row">
            <button className="btn btn-primary" onClick={generate} disabled={busy || !lyrics}>
              {busy && <span className="spinner" />}
              {busy ? `Generating… ${elapsed}s` : versions.length ? "Generate another version" : "Generate the song"}
            </button>
            {busy && <button className="btn btn-ghost" onClick={cancel}>Cancel</button>}
          </div>
          {status && (
            <div className="status-line">
              <span>{status}</span>
              {busy && <div className="progress indeterminate"><span /></div>}
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <p className="note">
            Generation runs on the provider's servers; you can switch tabs but keep this page open. Lyrics
            are sent exactly as finalized — labels like [Verse 1] and [Chorus] guide the structure.
          </p>
        </div>

        <div className="music-card">
          <h3>Your song</h3>
          {active && audioUrl ? (
            <div className="song-player">
              <div className="song-title">{active.title}</div>
              <div className="song-meta">
                {fmtDur(active.durationSec)} · {active.provider === "lyria" ? "Google Lyria 3.5" : "MiniMax Music"}
                {active.vocals ? ` · ${active.vocals}` : ""}
              </div>
              <audio ref={audioRef} controls src={audioUrl} />
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={download}>Download audio</button>
              </div>
            </div>
          ) : (
            <p className="note">No song yet. Set the direction and generate — the player appears here.</p>
          )}
          {versions.length > 1 && (
            <div className="song-versions">
              {versions.slice().reverse().map((v, i) => (
                <div className={`song-version${v.id === song.activeId ? " active" : ""}`} key={v.id}>
                  <span>Take {versions.length - i}</span>
                  <span className="song-meta">{fmtDur(v.durationSec)} · {v.vocals}</span>
                  {v.id !== song.activeId && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setSong((p) => ({ ...p, activeId: v.id }))}>Use this take</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <h3 style={{ marginTop: 16 }}>Lyrics being sung</h3>
          <div className="lyrics-preview">{lyrics || "—"}</div>
        </div>
      </div>
    </section>
  );
}
