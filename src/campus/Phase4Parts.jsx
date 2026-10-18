// src/campus/Phase4Parts.jsx — Phase 4 building blocks for Campus Sessions:
//   QrCode          a QR image for any link (drawn in the browser, no service)
//   SongShare       the student's song-page QR + link (thank-you screen, recent sessions)
//   StudentFeedback a few quick taps from the student, plus an optional comment
//   FollowUpOptIn   explicit, student-entered email opt-in (exact wording from the server)
//   SongAttach      worker: paste MelodyCraft's share link or upload the MP3
//   RecordingRefs   worker: log camera/phone footage (file names) against the session
//   Slate           full-screen card to film at the start of a recording
import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { sessionApi, songPageUrl, uploadSong } from "./campus-api.js";

export function QrCode({ text, size = 240, label }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#0b1a33", light: "#ffffff" } })
      .then((u) => { if (live) setSrc(u); }).catch(() => setSrc(""));
    return () => { live = false; };
  }, [text, size]);
  if (!src) return <div className="c-qr" style={{ width: size, height: size }} />;
  return <img className="c-qr" src={src} width={size} height={size} alt={label || "QR code"} />;
}

export function SongShare({ sessionId, code: initial, compact }) {
  const [code, setCode] = useState(initial || "");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (code) return;
    sessionApi.share(sessionId).then((r) => setCode(r.share.code)).catch((e) => setErr(e.message));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="c-note">{err}</p>;
  if (!code) return <p className="c-note"><span className="c-spinner" />Making your song link…</p>;
  const url = songPageUrl(code);
  return (
    <div className={`c-share ${compact ? "compact" : ""}`}>
      <div className="c-share-title">📱 Scan to keep your song</div>
      <QrCode text={url} size={compact ? 180 : 220} label="QR code for your song page" />
      <div className="c-share-url">{url.replace(/^https?:\/\//, "")}</div>
      <div className="c-row" style={{ justifyContent: "center", gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} }}>{copied ? "Copied ✓" : "📋 Copy link"}</button>
        {typeof navigator !== "undefined" && navigator.share && <button className="btn btn-ghost btn-sm" onClick={() => navigator.share({ title: "My Conference song", url }).catch(() => {})}>↗ Share</button>}
        <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noopener noreferrer">Open</a>
      </div>
      <p className="c-note" style={{ margin: "6px 0 0" }}>If the song isn't finished yet, the page says so — check back later. No sign-in, and nothing about you is on it.</p>
    </div>
  );
}

const STARS = [1, 2, 3, 4, 5];
export function Stars({ value, onChange, size = 34 }) {
  return (
    <div className="c-stars" role="radiogroup" aria-label="Rating">
      {STARS.map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} className={n <= (value || 0) ? "on" : ""} style={{ fontSize: size }} onClick={() => onChange(n)}>★</button>)}
    </div>
  );
}

function Choice({ label, value, onChange, options }) {
  return (
    <div style={{ margin: "10px 0" }}>
      <div className="c-fb-q">{label}</div>
      <div className="c-chips" style={{ justifyContent: "center", margin: "6px 0 0" }}>
        {options.map(([k, l]) => <button key={k} type="button" className={`c-chip ${value === k ? "on" : ""}`} onClick={() => onChange(value === k ? "" : k)}>{l}</button>)}
      </div>
    </div>
  );
}

export function StudentFeedback({ sessionId, initial }) {
  const [f, setF] = useState({ rating: 0, helped: "", more: "", share: "", comment: "", ...(initial || {}) });
  const [sent, setSent] = useState(Boolean(initial && initial.at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (sent) return <div className="c-share"><div className="c-share-title">Thanks for the feedback! 💛</div><button className="btn btn-ghost btn-sm" onClick={() => setSent(false)}>Change my answers</button></div>;
  return (
    <div className="c-share">
      <div className="c-share-title">Quick question or two (optional)</div>
      <div className="c-fb-q">How much did you enjoy this?</div>
      <Stars value={f.rating} onChange={(n) => setF({ ...f, rating: n })} />
      <Choice label="Did hearing the talk as a song help its message sink in?" value={f.helped} onChange={(v) => setF({ ...f, helped: v })} options={[["yes", "Yes"], ["somewhat", "Somewhat"], ["no", "Not really"]]} />
      <Choice label="Would you listen to more conference songs?" value={f.more} onChange={(v) => setF({ ...f, more: v })} options={[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]]} />
      <Choice label="Would you share your song with a friend?" value={f.share} onChange={(v) => setF({ ...f, share: v })} options={[["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]]} />
      <label className="c-field" style={{ textAlign: "left" }}><span className="lbl">Anything else? (please leave out your name)</span><textarea value={f.comment} maxLength={600} onChange={(e) => setF({ ...f, comment: e.target.value })} style={{ minHeight: 70 }} /></label>
      {err && <div className="c-err">{err}</div>}
      <button className="c-btn primary" disabled={busy || !(f.rating || f.helped || f.more || f.share || f.comment.trim())} onClick={async () => { setBusy(true); setErr(""); try { await sessionApi.feedback(sessionId, f); setSent(true); } catch (e) { setErr(e.message); } setBusy(false); }} style={{ textAlign: "center" }}>{busy ? "Sending…" : "Send"}</button>
    </div>
  );
}

export function FollowUpOptIn({ sessionId, text, already }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [video, setVideo] = useState(true);
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState(Boolean(already));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!text) return null;
  if (done) return <div className="c-share"><div className="c-share-title">✉️ You're on the list</div><p className="c-note" style={{ margin: 0 }}>We'll email the link when it's ready. Reply "stop" any time.</p></div>;
  if (!open) return <button className="c-btn ghost" style={{ textAlign: "center" }} onClick={() => setOpen(true)}>✉️ Email me when my song is ready (optional)</button>;
  return (
    <div className="c-share" style={{ textAlign: "left" }}>
      <div className="c-share-title" style={{ textAlign: "center" }}>✉️ Want an email when it's ready?</div>
      <label className="c-field"><span className="lbl">Your email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" inputMode="email" /></label>
      <label className="c-field"><span className="lbl">First name (optional, for the greeting)</span><input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" /></label>
      <label className="c-check"><input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} /> Also tell me if a music video is made</label>
      <label className="c-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {text}</label>
      {err && <div className="c-err">{err}</div>}
      <div className="c-row">
        <button className="c-btn primary" disabled={busy || !agree || !email.trim()} onClick={async () => { setBusy(true); setErr(""); try { await sessionApi.followup(sessionId, { email, firstName: first, agree, purposes: video ? ["song", "video"] : ["song"] }); setDone(true); } catch (e) { setErr(e.message); } setBusy(false); }}>{busy ? "Saving…" : "Yes, email me"}</button>
        <button className="c-btn ghost" onClick={() => setOpen(false)}>No thanks</button>
      </div>
    </div>
  );
}

export function SongAttach({ session, onSession, mediaOk }) {
  const [link, setLink] = useState(session.songLink || "");
  const [pct, setPct] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const ready = session.songFile && session.songFile.status === "ready";
  async function saveLink() {
    setErr(""); setMsg("");
    try { const r = await sessionApi.songLink(session.id, link.trim()); onSession && onSession(r.session); setMsg(link.trim() ? "Link saved — the song page plays it now." : "Link removed."); } catch (e) { setErr(e.message); }
  }
  async function upload(file) {
    if (!file) return;
    setErr(""); setMsg(""); setPct(0);
    try { await uploadSong(session.id, file, setPct); const r = await sessionApi.get(session.id); onSession && onSession(r.session); setMsg("Song uploaded — the song page plays it now."); } catch (e) { setErr(`Upload failed: ${e.message}`); }
    setPct(null);
  }
  return (
    <div>
      <p className="c-note" style={{ margin: "6px 0" }}>Put the finished song on the student's song page: paste MelodyCraft's share link, or upload the MP3. (If neither, the page finds the song once it's published to the Concert library for this talk.)</p>
      <label className="c-field"><span className="lbl">Song link (https://…)</span>
        <span className="c-row" style={{ flexWrap: "nowrap", gap: 8 }}><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste MelodyCraft's share link" style={{ flex: 1 }} /><button type="button" className="btn btn-ghost" onClick={saveLink}>Save</button></span>
      </label>
      {mediaOk && (
        <label className="c-btn" style={{ textAlign: "center", cursor: "pointer" }}>
          {pct != null ? `Uploading… ${Math.round(pct * 100)}%` : ready ? "🎵 Song uploaded ✓ — replace it" : "⬆ Upload the song file (MP3)"}
          <input type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => upload(e.target.files && e.target.files[0])} disabled={pct != null} />
        </label>
      )}
      {msg && <div className="c-ok">{msg}</div>}
      {err && <div className="c-err">{err}</div>}
    </div>
  );
}

const KINDS = [["phone", "Phone camera"], ["camera", "Separate camera"], ["other", "Other"]];
export function RecordingRefs({ session, onSession }) {
  const [f, setF] = useState({ kind: "phone", file: "", note: "" });
  const [err, setErr] = useState("");
  const list = session.recordings || [];
  async function add(e) {
    e.preventDefault(); setErr("");
    try { const r = await sessionApi.recordingAdd(session.id, f); onSession(r.session); setF({ ...f, file: "", note: "" }); } catch (e2) { setErr(e2.message); }
  }
  return (
    <div>
      <div className="c-note" style={{ margin: "4px 0" }}>Session reference <b className="c-ref">{session.ref}</b> — film the 🎬 slate at the start of each recording, then log the file here.</div>
      {list.length > 0 && (
        <table className="c-table" style={{ margin: "6px 0" }}>
          <tbody>{list.map((x) => <tr key={x.id}><td>{(KINDS.find((k) => k[0] === x.kind) || [, x.kind])[1]}</td><td><b>{x.file}</b>{x.note && <><br /><span className="c-note">{x.note}</span></>}</td><td><button type="button" className="btn btn-ghost btn-sm" onClick={() => sessionApi.recordingRemove(session.id, x.id).then((r) => onSession(r.session)).catch((e) => setErr(e.message))}>Remove</button></td></tr>)}</tbody>
        </table>
      )}
      <form onSubmit={add} className="c-row" style={{ alignItems: "flex-end" }}>
        <label className="c-field" style={{ flex: "1 1 120px", margin: "4px 0" }}><span className="lbl">Device</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="c-field" style={{ flex: "2 1 160px", margin: "4px 0" }}><span className="lbl">File name / clip #</span><input value={f.file} onChange={(e) => setF({ ...f, file: e.target.value })} placeholder="e.g. IMG_0412.MOV" /></label>
        <label className="c-field" style={{ flex: "2 1 160px", margin: "4px 0" }}><span className="lbl">Note (optional)</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. wide shot, testimony" /></label>
        <button className="btn btn-ghost" type="submit" disabled={!f.file.trim()} style={{ marginBottom: 6 }}>＋ Add</button>
      </form>
      {err && <div className="c-err">{err}</div>}
    </div>
  );
}

export function Slate({ session, onClose }) {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  const ok = session.participation === "recorded";
  return (
    <div className="c-slate" onClick={onClose} role="dialog" aria-label="Recording slate">
      <div className="c-slate-small">CONFERENCE AS A CONCERT · CAMPUS SESSIONS</div>
      <div className="c-slate-ref">{session.ref}</div>
      <div className="c-slate-time">{t.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</div>
      {session.talk && <div className="c-slate-talk">“{session.talk.title}” — {session.talk.speaker}</div>}
      <div className={`c-slate-auth ${ok ? "ok" : "no"}`}>{ok ? "✓ Recording authorized (signed release)" : "✕ Recording NOT authorized — do not film"}</div>
      <div className="c-slate-small">Tap anywhere to close</div>
    </div>
  );
}
