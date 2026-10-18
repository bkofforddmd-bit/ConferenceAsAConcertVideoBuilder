// src/campus/SessionFlow.jsx — one campus interaction, start to thank-you.
//
//   talk → (songified check) → consent → existing-song | lyrics → song → outcome → done
//
// Student-facing screens show the progress "Your Favorite Talk → Your Lyrics
// → Your Song" and no admin controls; worker-only screens carry a WORKER tag.
// Every step is saved on the server as it happens, so a closed browser can
// resume from the home screen.
import React, { useEffect, useRef, useState } from "react";
import { sessionApi, fetchTalk, libraryByTalk } from "./campus-api.js";
import { generateLyrics } from "../lib/api.js";
import TalkSearch, { CONFERENCE } from "./TalkSearch.jsx";
import SignaturePad from "./SignaturePad.jsx";
import { firstName } from "./CampusApp.jsx";
import { guessTitle } from "./title.js";
import MelodyCraftPicker from "../components/MelodyCraftPicker.jsx";
import { downloadCampusProject } from "../lib/campus-import.js";
import VideoRecorder from "./VideoRecorder.jsx";
import { mediaApi } from "./campus-api.js";
import { SongShare, StudentFeedback, FollowUpOptIn, SongAttach, RecordingRefs, Slate } from "./Phase4Parts.jsx";

const MOODS = ["Hopeful", "Peaceful", "Joyful", "Reflective", "Energetic", "Reverent"];
const GENRES = ["Pop", "Acoustic", "Worship", "Hip-hop", "Country", "Cinematic", "Folk"];

export default function SessionFlow({ id, config, onLeave, onConfigRefresh }) {
  const [s, setS] = useState(null);
  const [library, setLibrary] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [lyricsText, setLyricsText] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [reference, setReference] = useState("");
  const [clips, setClips] = useState([]);
  const [mediaOk, setMediaOk] = useState(false);
  // Video storage configured on the site? (The recorder only shows when it is.)
  useEffect(() => { mediaApi.status().then((r) => setMediaOk(Boolean(r.configured))).catch(() => setMediaOk(false)); }, []);
  // Clips already recorded for this session (after a resume).
  useEffect(() => {
    if (!s || s.participation !== "recorded" || !mediaOk) return;
    mediaApi.list(id).then((r) => setClips(r.clips || [])).catch(() => {});
  }, [s && s.participation, mediaOk, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const canRecord = Boolean(s && s.participation === "recorded" && mediaOk);
  const recorder = (stage, compact) => (canRecord ? <VideoRecorder sessionId={id} stage={stage} clips={clips} onClips={setClips} compact={compact} questions={config && config.settings && config.settings.questions} /> : null);
  const [mc, setMc] = useState({ genres: [], moods: [] });
  const [talkText, setTalkText] = useState("");
  const [firstNameOf, setFirstNameOf] = useState("");
  const [slate, setSlate] = useState(false);

  useEffect(() => {
    sessionApi.get(id).then((r) => { setS(r.session); if (r.session.lyrics && r.session.lyrics.text) setLyricsText(r.session.lyrics.text); if (r.session.lyrics && r.session.lyrics.title) setSongTitle(r.session.lyrics.title); if (r.session.lyrics && r.session.lyrics.reference) setReference(r.session.lyrics.reference); if (r.session.lyrics && r.session.lyrics.melodyCraft) setMc(r.session.lyrics.melodyCraft); }).catch((e) => setErr(e.message));
    libraryByTalk().then(setLibrary);
  }, [id]);

  async function patch(p) {
    const r = await sessionApi.update(id, p);
    setS(r.session);
    return r.session;
  }
  const guard = async (label, fn) => { setBusy(label); setErr(""); try { return await fn(); } catch (e) { setErr(e.message); } finally { setBusy(""); } };

  if (err && !s) return <div className="c-card warn"><p className="c-err">{err}</p><button className="c-btn ghost" onClick={onLeave}>Back</button></div>;
  if (!s) return <p className="c-note"><span className="c-spinner" />Loading the session…</p>;
  const screen = renderScreen();
  const slateOn = s.participation === "recorded" && s.ref;
  return (
    <>
      {screen}
      {slateOn && !slate && <button type="button" className="c-slate-btn" onClick={() => setSlate(true)} title="Show the slate to film at the start of a recording">🎬 Slate · {s.ref}</button>}
      {slate && <Slate session={s} onClose={() => setSlate(false)} />}
    </>
  );

  function renderScreen() {
  if (s.status !== "active" && s.step !== "done") return <div className="c-card"><p>This session is closed ({s.status}).</p><button className="c-btn primary" onClick={onLeave}>Back to home</button></div>;

  const progress = (on) => (
    <div className="c-progress">
      {[["talk", "Your Favorite Talk"], ["lyrics", "Your Lyrics"], ["song", "Your Song"]].map(([k, label], i) => {
        const order = ["talk", "lyrics", "song"];
        const cls = k === on ? "on" : order.indexOf(k) < order.indexOf(on) ? "done" : "";
        return <React.Fragment key={k}>{i > 0 && <span className="arrow">→</span>}<span className={`st ${cls}`}>{label}</span></React.Fragment>;
      })}
    </div>
  );

  // After picking a talk that already has a song: play it, or make a new interpretation.
  if (s._askExisting && s.songified && s.songified.existing) {
    return (
      <div>
        {progress("talk")}
        <h1>"{s.talk.title}" already has a song! 🎶</h1>
        <p className="lead">{s.talk.speaker}'s talk was turned into "{s.songified.libraryTitle}".</p>
        {s.songified.audioUrl && <audio controls src={s.songified.audioUrl} style={{ width: "100%", margin: "8px 0" }} onPlay={() => patch({ songified: { ...s.songified, playedExisting: true } }).catch(() => {})} />}
        <button className="c-btn primary" onClick={() => guard("go", async () => { await patch({ songified: { ...s.songified, newInterpretation: false }, step: "consent" }); })}>Listen together & share a reaction</button>
        <button className="c-btn ghost" onClick={() => guard("go", async () => { await patch({ songified: { ...s.songified, newInterpretation: true }, step: "consent" }); })}>Write a brand-new interpretation<small>Only if the student asks for their own take</small></button>
        <button className="c-btn ghost" onClick={() => patch({ step: "talk" })}>← Pick a different talk</button>
      </div>
    );
  }

  // ---------------- talk ----------------
  if (s.step === "talk") {
    return (
      <div>
        {progress("talk")}
        <h1>What was your favorite talk from {CONFERENCE.label} General Conference?</h1>
        {library && library.offline && <p className="c-note">Couldn't reach the song library — "has a song" tags may be missing.</p>}
        <TalkSearch library={library} onPick={(t, song) => guard("talk", async () => {
          await patch({ talk: { uri: t.uri, title: t.title, speaker: t.speaker, session: t.session, year: t.year, month: t.month, sourceUrl: `https://www.churchofjesuschrist.org${t.uri}?lang=eng` }, songified: song ? { existing: true, libraryId: song.id, libraryTitle: song.title, audioUrl: song.audioUrl || "" } : { existing: false }, step: song ? "talk" : "consent" });
          if (song) setS((p) => ({ ...p, _askExisting: true }));
        })} />
        {err && <div className="c-err">{err}</div>}
        <button className="c-btn ghost" onClick={() => guard("leave", async () => { await sessionApi.abandon(id, "Left at talk choice"); onLeave(); })}>✕ Cancel this session</button>
      </div>
    );
  }

  // ---------------- consent ----------------
  if (s.step === "consent") {
    return <ConsentScreen s={s} config={config} busy={busy} err={err} onBack={() => patch({ step: "talk" })} onSubmit={(p) => guard("consent", async () => {
      const r = await sessionApi.consent(id, p);
      setFirstNameOf(firstName(p.name));
      setS(r.session);
    })} />;
  }

  // ---------------- existing song ----------------
  if (s.step === "existing") {
    return (
      <div>
        <button type="button" className="c-back" onClick={() => patch({ step: "talk" })}>← Back</button>
        {progress("song")}
        <h1>Your Song 🎧</h1>
        <p className="lead">"{s.songified.libraryTitle}" — inspired by {s.talk.speaker}'s talk.</p>
        {s.songified.audioUrl ? <audio controls src={s.songified.audioUrl} style={{ width: "100%", margin: "8px 0" }} onPlay={() => patch({ songified: { ...s.songified, playedExisting: true } }).catch(() => {})} /> : <p className="c-note">The library has this song but no audio link was found.</p>}
        <div className="c-card">
          <p className="lead" style={{ margin: 0 }}>“What did you think of hearing your favorite conference message turned into music?”</p>
        </div>
        {recorder("song-reaction")}
        <button className="c-btn primary" onClick={() => patch({ step: "outcome" })}>Finish</button>
      </div>
    );
  }

  // ---------------- lyrics ----------------
  if (s.step === "lyrics") {
    return <LyricsScreen s={s} busy={busy} err={err} lyricsText={lyricsText} setLyricsText={setLyricsText} talkText={talkText} setTalkText={setTalkText}
      reference={reference} setReference={setReference}
      onGenerate={(opts) => guard("lyrics", async () => {
        if (opts.reference !== undefined) setReference(opts.reference);
        let text = talkText;
        if (!text) { const t = await fetchTalk(s.talk.uri); text = t.text || ""; setTalkText(text); }
        const styleBits = [opts.reference && `in the spirit of ${opts.reference}`, opts.genre && `${opts.genre} style`, opts.mood && `${opts.mood.toLowerCase()} mood`, opts.message && `center the song on this message from the talk: "${opts.message}"`].filter(Boolean).join("; ");
        const r = lyricsText && opts.regenerate
          ? await generateLyrics({ talkText: text, currentLyrics: lyricsText, revisionRequest: "Write a completely fresh take with different images and a different hook" + (styleBits ? `; ${styleBits}` : ""), styleReference: styleBits })
          : await generateLyrics({ talkText: text, styleReference: styleBits });
        setLyricsText(r.lyrics || "");
        // Campus songs are named after the talk (editable on the song step).
        const title = (s.talk && s.talk.title) || guessTitle(r.lyrics || "");
        setSongTitle(title);
        await patch({ lyrics: { generated: true, regenerated: (s.lyrics.regenerated || 0) + (opts.regenerate ? 1 : 0), accepted: false, mood: opts.mood || "", genre: opts.genre || "", message: opts.message || "", title, text: r.lyrics || "", reference: opts.reference || "" } });
      })}
      recorder={recorder("lyrics-reaction")}
      recorderFirst={recorder("favorite-talk")}
      onBack={() => patch({ step: "talk" })}
      onAccept={(edited) => guard("accept", () => patch({ lyrics: { accepted: true, edited: Boolean(edited), text: lyricsText }, step: "song" }))}
      onFinish={(edited) => guard("finish", () => patch({ lyrics: { accepted: true, edited: Boolean(edited), text: lyricsText }, step: "outcome" }))}
    />;
  }

  // ---------------- song (MelodyCraft) ----------------
  if (s.step === "song") {
    const url = (config && config.settings && config.settings.melodyCraftUrl) || "https://melodycraft.app";
    return (
      <div>
        <button type="button" className="c-back" onClick={() => patch({ step: "lyrics" })}>← Back to the lyrics</button>
        {progress("song")}
        <h1>Let's Hear Your Song! 🎵</h1>
        <p className="lead">Copy the title and the lyrics, then open MelodyCraft AI and paste them in to make the song.</p>
        <div className="c-card" style={{ padding: 12 }}>
          <MelodyCraftPicker
            compact
            reference={reference}
            onReference={(r) => { setReference(r); patch({ lyrics: { reference: r } }).catch(() => {}); }}
            value={mc}
            onChange={(v) => { setMc(v); patch({ lyrics: { melodyCraft: { genres: v.genres || [], moods: v.moods || [] } } }).catch(() => {}); }}
            lyrics={lyricsText}
            talkTitle={s.talk ? s.talk.title : ""}
            moodHint={(s.lyrics && s.lyrics.mood) || ""}
            btnClass="btn btn-ghost"
            primaryClass="btn btn-primary"
          />
        </div>
        <label className="c-field">
          <span className="lbl">Song title</span>
          <span className="c-row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input value={songTitle} onChange={(e) => setSongTitle(e.target.value)} onBlur={() => patch({ lyrics: { title: songTitle } }).catch(() => {})} placeholder="Give the song a name" style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" style={{ whiteSpace: "nowrap" }} onClick={async () => { try { await navigator.clipboard.writeText(songTitle); setErr(""); } catch { setErr("Couldn't copy the title — select it and copy by hand."); } }}>📋 Copy title</button>
          </span>
        </label>
        <div className="c-row">
          <button className="c-btn" onClick={async () => { try { await navigator.clipboard.writeText(lyricsText); setErr(""); } catch { setErr("Couldn't copy — long-press the lyrics below to copy them."); } }}>📋 Copy lyrics</button>
          <button className="c-btn primary" onClick={() => { window.open(url, "_blank", "noopener"); patch({ song: { opened: true } }).catch(() => {}); }}>🎶 Open MelodyCraft AI</button>
        </div>
        {lyricsText && <div className="c-lyrics" style={{ fontSize: 15, maxHeight: "30vh", overflow: "auto" }}>{lyricsText}</div>}
        <div className="c-card">
          <p className="lead" style={{ margin: 0 }}>“What did you think of hearing your favorite conference message turned into music?”</p>
        </div>
        {recorder("song-reaction")}
        <div className="c-card worker">
          <div className="c-worker-tag">Worker</div>
          <label className="c-row" style={{ fontSize: 17, gap: 10 }}><input type="checkbox" checked={Boolean(s.song.generated)} onChange={(e) => patch({ song: { generated: e.target.checked } })} /> The song was generated in MelodyCraft</label>
          <label className="c-row" style={{ fontSize: 17, gap: 10 }}><input type="checkbox" checked={Boolean(s.song.played)} onChange={(e) => patch({ song: { played: e.target.checked } })} /> The student listened to it</label>
        </div>
        {err && <div className="c-err">{err}</div>}
        <button className="c-btn primary" onClick={() => patch({ step: "outcome" })}>Finish</button>
      </div>
    );
  }

  // ---------------- outcome (worker only) ----------------
  if (s.step === "outcome") {
    const backTo = s.participation === "declined" ? "" : s.song && (s.song.opened || s.song.generated) ? "song" : s.lyrics && s.lyrics.generated ? "lyrics" : s.songified && s.songified.existing && !s.songified.newInterpretation ? "existing" : "talk";
    return <OutcomeScreen s={s} onSession={setS} busy={busy} err={err} onBack={backTo ? () => patch({ step: backTo }) : null} onComplete={(o) => guard("complete", async () => { const r = await sessionApi.complete(id, o); setS(r.session); })} onAbandon={() => guard("abandon", async () => { await sessionApi.abandon(id, "Marked unfinished by the worker"); onLeave(); })} />;
  }

  // ---------------- done ----------------
  const declined = s.participation === "declined";
  const line = s.song && s.song.generated ? "Your favorite talk is now a song."
    : s.lyrics && s.lyrics.generated ? "Your favorite talk has its own lyrics."
    : s.songified && s.songified.existing ? "Your favorite talk already lives as a song."
    : "Thanks for sharing your favorite talk.";
  return (
    <div className="c-hero">
      <div className="c-hero-sky" aria-hidden="true">
        <div className="c-hero-rays" />
        <div className="c-hero-glow" />
        <div className="c-hero-clouds" />
        <div className="c-hero-ridge" />
        <svg className="c-hero-staff" viewBox="0 0 1200 420" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke="#f3d9a4" strokeOpacity="0.55" strokeWidth="1.2">
            <path d="M-20 300 C 200 230, 380 380, 600 300 S 1000 220, 1220 300" />
            <path d="M-20 318 C 200 248, 380 398, 600 318 S 1000 238, 1220 318" />
            <path d="M-20 336 C 200 266, 380 416, 600 336 S 1000 256, 1220 336" />
            <path d="M-20 354 C 200 284, 380 434, 600 354 S 1000 274, 1220 354" />
            <path d="M-20 372 C 200 302, 380 452, 600 372 S 1000 292, 1220 372" />
          </g>
          <g fill="#f3d9a4" fillOpacity="0.8">
            <ellipse cx="150" cy="330" rx="13" ry="9" transform="rotate(-20 150 330)" /><rect x="160" y="270" width="3" height="62" />
            <ellipse cx="420" cy="372" rx="13" ry="9" transform="rotate(-20 420 372)" /><rect x="430" y="312" width="3" height="62" />
            <ellipse cx="760" cy="318" rx="13" ry="9" transform="rotate(-20 760 318)" /><rect x="770" y="258" width="3" height="62" />
            <ellipse cx="1040" cy="352" rx="13" ry="9" transform="rotate(-20 1040 352)" /><rect x="1050" y="292" width="3" height="62" />
            <ellipse cx="1068" cy="346" rx="13" ry="9" transform="rotate(-20 1068 346)" /><rect x="1078" y="286" width="3" height="62" /><rect x="1050" y="286" width="31" height="4" />
          </g>
        </svg>
        <div className="c-hero-bokeh" />
      </div>
      <div className="c-hero-content">
        <h1 className="c-hero-title">{declined ? "Thank You" : "Thank You!"}</h1>
        <div className="c-hero-rule" aria-hidden="true"><span /><i /><span /></div>
        <p className="c-hero-line">
          {declined ? "Thanks for your time today." : <>{firstNameOf ? `${firstNameOf}, ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line}</>}
          <br />
          Higher ground through holier sound.
        </p>
        {!declined && (
          <>
            <SongShare sessionId={s.id} code={s.share && s.share.code} />
            <StudentFeedback sessionId={s.id} initial={s.feedback} />
            <FollowUpOptIn sessionId={s.id} text={config && config.followUp && config.followUp.text} already={s.followUp && s.followUp.optedIn} />
          </>
        )}
        <button className="c-hero-btn" onClick={onLeave} style={{ marginTop: 10 }}>Start another session <span aria-hidden="true">›</span></button>
      </div>
      {!declined && (
        <details className="c-hero-worker" style={{ marginTop: 22 }}>
          <summary>Worker: put the finished song on the student's page</summary>
          <SongAttach session={s} onSession={setS} mediaOk={mediaOk} />
        </details>
      )}
      {s.participation === "recorded" && (
        <details className="c-hero-worker">
          <summary>Worker: recording references ({(s.recordings || []).length})</summary>
          <RecordingRefs session={s} onSession={setS} />
        </details>
      )}
      {canRecord && (
        <div className="c-hero-worker" style={{ marginTop: 22 }}>
          <div className="c-note" style={{ marginBottom: 6 }}>One more thing? A short testimony or a closing thought from the student.</div>
          {recorder("testimony")}
        </div>
      )}
      {s.lyrics && s.lyrics.generated && (
        <details className="c-hero-worker">
          <summary>Worker: turn this into a music video</summary>
          <p className="c-note" style={{ margin: "8px 0" }}>Open the Studio with this session's talk and lyrics (upload the MelodyCraft MP3 on the Music step, sync the lyrics, then storyboard and render).</p>
          <div className="c-row">
            <a className="c-btn" href={`/?campus=${s.id}`} target="_blank" rel="noopener noreferrer">🎬 Open in the Studio</a>
            <button className="c-btn ghost" onClick={() => downloadCampusProject(s.id).catch((e) => setErr(e.message))}>⬇ Download project .json</button>
          </div>
          {err && <div className="c-err">{err}</div>}
        </details>
      )}
    </div>
  );
  } // renderScreen
}

// ---------------------------------------------------------------------------
function ConsentScreen({ s, config, busy, err, onBack, onSubmit }) {
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(true);
  const [sig, setSig] = useState("");
  const [ack, setAck] = useState(false);
  const rel = (config && config.consent) || { version: "?", text: "The release text couldn't be loaded. Reconnect and try again." };
  const canSubmit = choice === "declined" || (choice === "recorded" ? adult && sig && name.trim() : choice === "unrecorded" ? (ack || sig) && name.trim() : false);
  return (
    <div>
      <h1>Before we start 🎬</h1>
      <p className="lead">Please read this, then choose how you'd like to take part.</p>
      <div className="c-release">{rel.text}</div>
      <p className="c-note">Release version {rel.version}{rel.reviewed ? "" : " · draft pending legal review"}</p>

      <label className="c-row" style={{ fontSize: 17, gap: 10, margin: "10px 0" }}><input type="checkbox" checked={adult} onChange={(e) => { setAdult(e.target.checked); if (!e.target.checked && choice === "recorded") setChoice(""); }} /> I am 18 or older</label>
      {!adult && <p className="c-note">Under 18? You're welcome to take part without being recorded.</p>}

      <button className={`c-btn ${choice === "recorded" ? "primary" : ""}`} disabled={!adult} onClick={() => setChoice("recorded")}>✅ I agree to participate and authorize video/audio recording and the uses described</button>
      <button className={`c-btn ${choice === "unrecorded" ? "primary" : ""}`} onClick={() => setChoice("unrecorded")}>🙂 I want to participate without being recorded</button>
      <button className={`c-btn ${choice === "declined" ? "primary" : ""}`} onClick={() => setChoice("declined")}>🚫 I decline participation</button>

      {(choice === "recorded" || choice === "unrecorded") && (
        <div className="c-card">
          <label className="c-field"><span className="lbl">Your name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="First and last name" /></label>
          <label className="c-field"><span className="lbl">Email (optional)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="So we can reach you about this recording" /></label>
          {choice === "recorded" ? (
            <>
              <span className="lbl" style={{ color: "var(--sky)", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>Sign with your finger</span>
              <SignaturePad value={sig} onChange={setSig} />
            </>
          ) : (
            <label className="c-row" style={{ fontSize: 16, gap: 10 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've read the release and choose to take part without being recorded</label>
          )}
        </div>
      )}
      {err && <div className="c-err">{err}</div>}
      <button className="c-btn primary big" disabled={!canSubmit || Boolean(busy)} onClick={() => onSubmit({ choice, name, email, adult, signaturePng: sig, acknowledged: ack })}>
        {busy ? "Saving…" : choice === "declined" ? "No problem — finish" : "Continue →"}
      </button>
      <button className="c-btn ghost" onClick={onBack}>← Back</button>
    </div>
  );
}

function LyricsScreen({ s, busy, err, lyricsText, setLyricsText, onGenerate, onAccept, onFinish, reference, setReference, recorder, recorderFirst, onBack }) {
  const [mood, setMood] = useState("");
  const [genre, setGenre] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(false);
  const progress = (
    <div className="c-progress"><span className="st done">Your Favorite Talk</span><span className="arrow">→</span><span className="st on">Your Lyrics</span><span className="arrow">→</span><span className="st">Your Song</span></div>
  );
  if (!lyricsText) {
    return (
      <div>
        <button type="button" className="c-back" onClick={onBack}>← Back to the talk</button>
        {progress}
        <h1>Your Lyrics ✍️</h1>
        <p className="lead">"{s.talk.title}" by {s.talk.speaker}. A few optional taps, then we write.</p>
        <span className="c-note">Mood</span>
        <div className="c-chips">{MOODS.map((m) => <button key={m} className={`c-chip ${mood === m ? "on" : ""}`} onClick={() => setMood(mood === m ? "" : m)}>{m}</button>)}</div>
        <span className="c-note">Style</span>
        <div className="c-chips">{GENRES.map((g) => <button key={g} className={`c-chip ${genre === g ? "on" : ""}`} onClick={() => setGenre(genre === g ? "" : g)}>{g}</button>)}</div>
        <label className="c-field"><span className="lbl">Favorite message from the talk (optional)</span><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. God’s love never gives up on us" /></label>
        <label className="c-field"><span className="lbl">Sound like a song or artist (optional)</span><input value={reference || ""} onChange={(e) => setReference(e.target.value)} placeholder='e.g. "Forrest Frank" or "Oceans by Hillsong"' /></label>
        {err && <div className="c-err">{err}</div>}
        <button className="c-btn primary big" disabled={Boolean(busy)} onClick={() => onGenerate({ mood, genre, message, reference })}>{busy ? <><span className="c-spinner" />Writing your lyrics… (about 30 seconds)</> : "✨ Write my lyrics"}</button>
        {recorderFirst && <div style={{ marginTop: 10 }}><p className="c-note" style={{ margin: "0 0 4px" }}>While the lyrics are being written (about 30 seconds) is a great moment to ask why it's their favorite talk.</p>{recorderFirst}</div>}
      </div>
    );
  }
  return (
    <div>
      <button type="button" className="c-back" onClick={onBack}>← Back to the talk</button>
      {progress}
      <h1>Your Lyrics 🎤</h1>
      {editing ? <textarea className="c-lyrics" style={{ width: "100%", minHeight: "40vh", boxSizing: "border-box" }} value={lyricsText} onChange={(e) => { setLyricsText(e.target.value); setEdited(true); }} /> : <div className="c-lyrics">{lyricsText}</div>}
      {err && <div className="c-err">{err}</div>}
      {recorder}
      <div className="c-row">
        <button className="c-btn" disabled={Boolean(busy)} onClick={() => onGenerate({ mood, genre, message, reference, regenerate: true })}>{busy === "lyrics" ? <><span className="c-spinner" />Rewriting…</> : "🔁 Try again"}</button>
        <button className="c-btn" onClick={() => setEditing((v) => !v)}>{editing ? "Done editing" : "✏️ Edit"}</button>
      </div>
      <button className="c-btn primary big" disabled={Boolean(busy)} onClick={() => onAccept(edited)}>Let's Hear Your Song! 🎵</button>
      <button className="c-btn ghost" disabled={Boolean(busy)} onClick={() => onFinish(edited)}>Finish with lyrics only</button>
    </div>
  );
}

function OutcomeScreen({ s, onSession, busy, err, onComplete, onAbandon, onBack }) {
  const [reaction, setReaction] = useState(s.reaction || "");
  const [captured, setCaptured] = useState(s.recordingCaptured === true || (s.recordings || []).length > 0);
  const [notes, setNotes] = useState(s.notes || "");
  const minutes = Math.round((Date.now() - Date.parse(s.startedAt)) / 60000);
  return (
    <div className="c-card worker">
      {onBack && <button type="button" className="c-back" onClick={onBack}>← Back</button>}
      <div className="c-worker-tag">Worker only</div>
      <h2>Wrap up ({minutes} min)</h2>
      <table className="c-table">
        <tbody>
          <tr><td>Participation</td><td>{s.participation === "recorded" ? "recorded ✓" : s.participation === "unrecorded" ? "without recording" : "declined"}</td></tr>
          <tr><td>Lyrics generated</td><td>{s.lyrics && s.lyrics.generated ? `yes${s.lyrics.regenerated ? ` (${s.lyrics.regenerated} rewrite${s.lyrics.regenerated === 1 ? "" : "s"})` : ""}` : "no"}</td></tr>
          <tr><td>Song generated</td><td>{s.song && s.song.generated ? "yes" : "no"}</td></tr>
          <tr><td>Recording authorized</td><td>{s.participation === "recorded" ? "yes" : "no"}</td></tr>
          {s.participation === "recorded" && <tr><td>Clips in the app</td><td>{(s.clips || []).filter((c) => c.status === "ready").length}</td></tr>}
        </tbody>
      </table>
      {s.participation !== "declined" && (
        <>
          <span className="c-note">Student reaction</span>
          <div className="c-chips">
            {[["positive", "😊 Positive"], ["neutral", "😐 Neutral"], ["negative", "🙁 Negative"], ["not_captured", "— Not captured"]].map(([k, l]) => <button key={k} className={`c-chip ${reaction === k ? "on" : ""}`} onClick={() => setReaction(k)}>{l}</button>)}
          </div>
        </>
      )}
      {s.participation === "recorded" && (
        <>
          <label className="c-row" style={{ fontSize: 17, gap: 10 }}><input type="checkbox" checked={captured} onChange={(e) => setCaptured(e.target.checked)} /> I recorded this on a camera or phone</label>
          {captured && <RecordingRefs session={s} onSession={onSession} />}
        </>
      )}
      <label className="c-field"><span className="lbl">Notes (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 70 }} /></label>
      {err && <div className="c-err">{err}</div>}
      <button className="c-btn primary big" disabled={Boolean(busy)} onClick={() => onComplete({ reaction: reaction || "not_captured", recordingCaptured: captured || (s.recordings || []).length > 0, notes })}>{busy ? "Saving…" : "Complete session ✓"}</button>
      <button className="c-btn ghost" disabled={Boolean(busy)} onClick={onAbandon}>Mark as unfinished (student left)</button>
    </div>
  );
}
