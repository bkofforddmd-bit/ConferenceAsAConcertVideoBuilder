// src/campus/AdminPanel.jsx — Phase 1 administrator panel: workers and
// invitations, the release text (versioned, legal-review flag), settings
// (MelodyCraft address, default campus), consent lookup by session id, and a
// plain list of sessions, (Phase 2) hours & payroll, and (Phase 3) analytics
// and the video retention policy.
import React, { useEffect, useState } from "react";
import { adminApi } from "./campus-api.js";
import HoursAdmin from "./HoursAdmin.jsx";
import Analytics from "./Analytics.jsx";
import Retention from "./Retention.jsx";

export default function AdminPanel({ user }) {
  const [tab, setTab] = useState("analytics");
  return (
    <div>
      <h1>Administrator</h1>
      <div className="c-tabs">
        {[["analytics", "Analytics"], ["workers", "Workers"], ["hours", "Hours & payroll"], ["sessions", "Sessions"], ["lookup", "Consent lookup"], ["retention", "Retention"], ["consent", "Release text"], ["settings", "Settings"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "workers" && <Workers me={user} />}
      {tab === "consent" && <ConsentText />}
      {tab === "settings" && <Settings />}
      {tab === "lookup" && <Lookup />}
      {tab === "sessions" && <Sessions />}
      {tab === "hours" && <HoursAdmin />}
      {tab === "analytics" && <Analytics />}
      {tab === "retention" && <Retention />}
      <p className="c-note" style={{ marginTop: 24 }}>Coming next: Phase 4 (QR code sharing, extra student feedback, better recording references, follow-ups where the student opted in).</p>
    </div>
  );
}

function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const reload = () => fn().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, err, reload, setErr];
}

function Workers({ me }) {
  const [data, err, reload, setErr] = useLoad(adminApi.workers);
  const [f, setF] = useState({ email: "", name: "", role: "worker" });
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  async function invite(e) {
    e.preventDefault();
    try { const r = await adminApi.invite(f); setLink(r.link); setF({ email: "", name: "", role: "worker" }); reload(); } catch (e2) { setErr(e2.message); }
  }
  return (
    <div>
      <form onSubmit={invite} className="c-card">
        <h2>Invite a worker</h2>
        <label className="c-field"><span className="lbl">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="c-field"><span className="lbl">Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
        <label className="c-field"><span className="lbl">Role</span><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="worker">Worker</option><option value="admin">Administrator</option></select></label>
        <button className="c-btn primary" type="submit">Create invitation link</button>
        {link && (
          <div className="c-card ok">
            <p>Send this link to the person (text or email). It works once and lets them choose a password — for a new account or a forgotten one:</p>
            <code className="c-code">{link}</code>
            <button type="button" className="c-btn" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }}>{copied ? "Copied ✓" : "Copy link"}</button>
          </div>
        )}
      </form>
      {err && <div className="c-err">{err}</div>}
      {data && (
        <>
          <h2>Accounts</h2>
          <table className="c-table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}<br /><span className="c-note">{w.email}</span></td>
                  <td>{w.id === me.id ? "admin (you)" : <select value={w.role} onChange={(e) => adminApi.setRole(w.id, e.target.value).then(reload).catch((e2) => setErr(e2.message))}><option value="worker">worker</option><option value="admin">admin</option></select>}</td>
                  <td>{w.active ? "active" : "deactivated"}</td>
                  <td>{w.id !== me.id && <>
                    <button className="btn btn-ghost btn-sm" onClick={() => adminApi.setActive(w.id, !w.active).then(reload).catch((e2) => setErr(e2.message))}>{w.active ? "Deactivate" : "Reactivate"}</button>{" "}
                    <button className="btn btn-ghost btn-sm" title="Makes a one-time link that lets this person choose a new password" onClick={() => adminApi.invite({ email: w.email, name: w.name, role: w.role }).then((r) => { setLink(r.link); reload(); window.scrollTo({ top: 0, behavior: "smooth" }); }).catch((e2) => setErr(e2.message))}>Reset link</button>
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.invites.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Open invitations</h2>
              <table className="c-table">
                <tbody>
                  {data.invites.map((i) => <tr key={i.code}><td>{i.name || "—"}<br /><span className="c-note">{i.email}</span></td><td>{i.role}</td><td><button className="btn btn-ghost btn-sm" onClick={() => adminApi.revokeInvite(i.code).then(reload)}>Revoke</button></td></tr>)}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ConsentText() {
  const [data, err, reload, setErr] = useLoad(adminApi.consentText);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { if (data) setText(data.text); }, [data]);
  if (!data) return err ? <div className="c-err">{err}</div> : <p className="c-note">Loading…</p>;
  return (
    <div>
      <div className={`c-card ${data.reviewed ? "ok" : "warn"}`}>
        <p style={{ margin: 0 }}><strong>Version {data.version}</strong> · {data.reviewed ? "marked as legally reviewed" : "DRAFT — not yet reviewed by an attorney. Do not rely on it for public use of recordings until it is."}{data.isDefault ? " · built-in starting text" : ""}</p>
        <label className="c-row" style={{ gap: 10, marginTop: 8 }}><input type="checkbox" checked={Boolean(data.reviewed)} onChange={(e) => adminApi.setConsentReviewed(e.target.checked).then(reload).catch((e2) => setErr(e2.message))} /> This version has been reviewed by legal counsel</label>
      </div>
      <p className="c-note">Every consent record keeps the exact text and version the participant accepted, so editing never changes past records. Saving creates a new version.</p>
      <textarea className="c-release" style={{ width: "100%", minHeight: "50vh", maxHeight: "none", boxSizing: "border-box" }} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="c-err">{err}</div>}
      {msg && <div className="c-ok">{msg}</div>}
      <button className="c-btn primary" onClick={() => adminApi.setConsentText(text, false).then(() => { setMsg("Saved as a new version (marked not yet reviewed)."); reload(); }).catch((e2) => setErr(e2.message))}>Save as new version</button>
    </div>
  );
}

function Settings() {
  const [data, err, reload, setErr] = useLoad(adminApi.settings);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return err ? <div className="c-err">{err}</div> : <p className="c-note">Loading…</p>;
  return (
    <div className="c-card">
      <label className="c-field"><span className="lbl">MelodyCraft AI address (opens in a new window on the song step)</span><input value={f.melodyCraftUrl} onChange={(e) => setF({ ...f, melodyCraftUrl: e.target.value })} /></label>
      <p className="c-note">Please confirm this is the site you use — listings differ. It must start with https://.</p>
      <label className="c-field"><span className="lbl">Default campus</span><input value={f.defaultCampus} onChange={(e) => setF({ ...f, defaultCampus: e.target.value })} /></label>
      <label className="c-field"><span className="lbl">Mark an open session unfinished after (minutes)</span><input type="number" min="10" value={f.abandonAfterMinutes} onChange={(e) => setF({ ...f, abandonAfterMinutes: Number(e.target.value) })} /></label>
      {err && <div className="c-err">{err}</div>}
      {msg && <div className="c-ok">{msg}</div>}
      <button className="c-btn primary" onClick={() => adminApi.setSettings(f).then(() => { setMsg("Saved."); reload(); }).catch((e2) => setErr(e2.message))}>Save settings</button>
    </div>
  );
}

function Lookup() {
  const [id, setId] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  async function find(e) { e && e.preventDefault(); setErr(""); try { setRes(await adminApi.consentLookup(id.trim())); } catch (e2) { setRes(null); setErr(e2.message); } }
  const c = res && res.consent;
  return (
    <div>
      <form onSubmit={find} className="c-card">
        <label className="c-field"><span className="lbl">Session id</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="cs_…" /></label>
        <button className="c-btn primary" type="submit">Find the consent record</button>
        {err && <div className="c-err">{err}</div>}
      </form>
      {res && (
        <div className={`c-card ${c && c.withdrawn ? "warn" : ""}`}>
          {!c && <p>No consent record for this session (the student may not have reached the consent step).</p>}
          {c && (
            <>
              <table className="c-table"><tbody>
                <tr><td>Choice</td><td>{c.choice}</td></tr>
                <tr><td>Name</td><td>{c.name || "—"}</td></tr>
                <tr><td>Email</td><td>{c.email || "—"}</td></tr>
                <tr><td>Adult</td><td>{c.adult ? "yes" : "no"}</td></tr>
                <tr><td>Accepted</td><td>{new Date(c.acceptedAt).toLocaleString()}</td></tr>
                <tr><td>Release version</td><td>{c.textVersion}{c.textReviewed ? " (reviewed)" : " (draft)"}</td></tr>
                <tr><td>Video reference</td><td>{c.videoRef || "—"}</td></tr>
                <tr><td>Withdrawn</td><td>{c.withdrawn ? `${new Date(c.withdrawn.at).toLocaleString()} — ${c.withdrawn.note || ""}` : "no"}</td></tr>
              </tbody></table>
              {res.clips && res.clips.length > 0 && (
                <div style={{ margin: "10px 0" }}>
                  <div className="c-note" style={{ marginBottom: 6 }}>Video clips recorded in the app ({res.clips.length}) — links work for an hour:</div>
                  {res.clips.map((k) => (
                    <div key={k.id} style={{ marginBottom: 8 }}>
                      <video src={k.url} controls playsInline preload="metadata" style={{ width: "100%", maxWidth: 360, borderRadius: 8, background: "#000" }} />
                      <div className="c-note" style={{ margin: 0 }}>{k.stage} · {k.durationSec ? `${Math.round(k.durationSec)} s · ` : ""}{(k.bytes / 1048576).toFixed(1)} MB · <a href={k.url} download style={{ color: "var(--sky)" }}>download</a></div>
                    </div>
                  ))}
                </div>
              )}
              {c.signaturePng && <img src={c.signaturePng} alt="signature" style={{ maxWidth: 320, width: "100%", background: "#fff", borderRadius: 8, margin: "8px 0" }} />}
              <details><summary>Release text as accepted</summary><div className="c-release" style={{ marginTop: 8 }}>{c.text}</div></details>
              {!c.withdrawn && (
                <div style={{ marginTop: 10 }}>
                  <label className="c-field"><span className="lbl">Withdrawal note (how the request came in)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
                  <button className="c-btn danger" onClick={() => adminApi.consentWithdraw(id.trim(), note).then(find).catch((e2) => setErr(e2.message))}>Record a consent withdrawal</button>
                </div>
              )}
            </>
          )}
          {res.session && <p className="c-note">Session: {res.session.status} · {res.session.talk ? res.session.talk.title : "no talk"} · started {new Date(res.session.startedAt).toLocaleString()}</p>}
        </div>
      )}
    </div>
  );
}

function Sessions() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, err, reload] = useLoad(() => adminApi.sessions(from, to), [from, to]);
  const list = (data && data.sessions) || [];
  const n = (f) => list.filter(f).length;
  return (
    <div>
      <div className="c-row"><label className="c-field" style={{ flex: 1 }}><span className="lbl">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="c-field" style={{ flex: 1 }}><span className="lbl">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      {err && <div className="c-err">{err}</div>}
      <div className="c-stats">
        <div className="c-stat"><b>{list.length}</b><span>approached</span></div>
        <div className="c-stat"><b>{n((s) => s.status === "completed" && s.participation !== "declined")}</b><span>participated</span></div>
        <div className="c-stat"><b>{n((s) => s.lyrics && s.lyrics.generated)}</b><span>lyrics</span></div>
        <div className="c-stat"><b>{n((s) => s.song && s.song.generated)}</b><span>songs</span></div>
      </div>
      <table className="c-table">
        <thead><tr><th>When</th><th>Talk</th><th>Result</th><th>Id</th></tr></thead>
        <tbody>
          {list.map((s) => <tr key={s.id}><td>{new Date(s.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td>{s.talk ? s.talk.title : "—"}</td><td>{s.status === "abandoned" ? "unfinished" : s.participation === "declined" ? "declined" : s.participation === "recorded" ? "recorded" : s.participation || "—"}{s.song && s.song.generated ? " · song" : s.lyrics && s.lyrics.generated ? " · lyrics" : ""}{s.clipCount ? ` · 🎥 ${s.clipCount}` : ""}</td><td><code className="c-code">{s.id}</code>{s.lyrics && s.lyrics.hasText && <> <a className="btn btn-ghost btn-sm" href={`/?campus=${s.id}`} target="_blank" rel="noopener noreferrer">🎬 Studio</a></>}</td></tr>)}
        </tbody>
      </table>
      <button className="c-btn ghost" onClick={reload}>Refresh</button>
    </div>
  );
}
