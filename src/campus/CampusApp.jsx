// src/campus/CampusApp.jsx — Campus Sessions mode (the /campus address).
// Sign-in, the worker's home screen, the session flow, and the administrator
// panel at /campus/admin. Separate from the public Studio: nothing here is
// linked from the normal pages, and every call is checked on the server.
import React, { useEffect, useState } from "react";
import Logo from "../components/Logo.jsx";
import { authApi, sessionApi, getToken, setToken } from "./campus-api.js";
import SessionFlow from "./SessionFlow.jsx";
import AdminPanel from "./AdminPanel.jsx";
import "./campus.css";

const ACTIVE_KEY = "campus-active-session";
const isAdminPath = () => /^\/campus\/admin\/?$/.test(window.location.pathname);
const inviteCode = () => { try { return new URLSearchParams(window.location.search).get("invite") || ""; } catch { return ""; } };

export default function CampusApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [config, setConfig] = useState(null);
  const [view, setView] = useState("home"); // home | session | admin
  const [sessionId, setSessionId] = useState(null);
  const [mine, setMine] = useState(null);
  const [err, setErr] = useState("");

  // Who's signed in?
  useEffect(() => {
    (async () => {
      // An invitation link always shows the create-account form, even if
      // someone else is signed in on this phone.
      if (inviteCode()) setToken("");
      if (getToken()) {
        try { const r = await authApi.me(); setUser(r.user); } catch { setToken(""); }
      }
      setChecking(false);
    })();
  }, []);

  async function refresh() {
    try {
      const [cfg, m] = await Promise.all([sessionApi.config(), sessionApi.mine()]);
      setConfig(cfg);
      setMine(m);
      setErr("");
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { if (user) refresh(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  function signOut() { setToken(""); setUser(null); setMine(null); setConfig(null); setView("home"); }

  async function startSession() {
    setErr("");
    try {
      const r = await sessionApi.start(config && config.settings ? config.settings.defaultCampus : "BYU Provo");
      try { localStorage.setItem(ACTIVE_KEY, r.session.id); } catch {}
      setSessionId(r.session.id);
      setView("session");
    } catch (e) { setErr(e.message); }
  }
  function resumeSession(id) { setSessionId(id); setView("session"); }
  function leaveSession() { try { localStorage.removeItem(ACTIVE_KEY); } catch {} setSessionId(null); setView("home"); refresh(); }

  if (checking) return <Shell><p className="c-note"><span className="c-spinner" />One moment…</p></Shell>;
  if (!user) return <Shell><SignIn onSignedIn={setUser} admin={isAdminPath()} /></Shell>;

  if (isAdminPath() || view === "admin") {
    if (user.role !== "admin") return <Shell user={user} onSignOut={signOut}><div className="c-card warn"><p>This page is for administrators. You're signed in as a worker.</p><a className="c-btn ghost" href="/campus">Go to Campus Sessions</a></div></Shell>;
    return <Shell user={user} onSignOut={signOut} onHome={() => { if (isAdminPath()) window.location.href = "/campus"; else setView("home"); }}><AdminPanel user={user} /></Shell>;
  }

  if (view === "session" && sessionId) {
    return <Shell user={user} onSignOut={signOut} compact><SessionFlow id={sessionId} config={config} onLeave={leaveSession} onConfigRefresh={refresh} /></Shell>;
  }

  return (
    <Shell user={user} onSignOut={signOut}>
      <h1>Hi, {firstName(user.name)} 👋</h1>
      <p className="lead">Ready to ask someone about their favorite talk?</p>
      {err && <div className="c-err">{err}</div>}
      {mine && mine.active && (
        <div className="c-card warn">
          <div className="c-worker-tag">Unfinished session</div>
          <p>A session from {new Date(mine.active.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} is still open{mine.active.talk ? ` (${mine.active.talk.title})` : ""}.</p>
          <div className="c-row">
            <button className="c-btn primary" onClick={() => resumeSession(mine.active.id)}>Resume it</button>
            <button className="c-btn ghost" onClick={async () => { try { await sessionApi.abandon(mine.active.id, "Closed from the home screen"); refresh(); } catch (e) { setErr(e.message); } }}>Close it as unfinished</button>
          </div>
        </div>
      )}
      <button className="c-btn primary big" onClick={startSession}>＋ New Campus Session</button>
      {mine && (
        <div className="c-stats">
          <div className="c-stat"><b>{mine.today.approached}</b><span>approached today</span></div>
          <div className="c-stat"><b>{mine.today.sessions}</b><span>completed today</span></div>
          <div className="c-stat"><b>{mine.today.lyrics}</b><span>lyrics today</span></div>
          <div className="c-stat"><b>{mine.today.songs}</b><span>songs today</span></div>
        </div>
      )}
      {config && config.consent && !config.consent.reviewed && (
        <p className="c-note">⚠ The release text (version {config.consent.version}) hasn't been marked as legally reviewed yet. Check with the administrator before public use of recordings.</p>
      )}
      {mine && mine.recent.length > 0 && (
        <div className="c-card">
          <h2>Recent sessions</h2>
          <table className="c-table">
            <tbody>
              {mine.recent.slice(0, 8).map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                  <td>{s.talk ? s.talk.title : "—"}</td>
                  <td>{s.status === "completed" ? (s.participation === "declined" ? "declined" : s.song && s.song.generated ? "song" : s.lyrics && s.lyrics.generated ? "lyrics" : "done") : "unfinished"}</td>
                  <td>{s.lyrics && s.lyrics.generated && s.lyrics.hasText && <a className="btn btn-ghost btn-sm" href={`/?campus=${s.id}`} target="_blank" rel="noopener noreferrer" title="Open this session's talk and lyrics in the Studio to make the music video">🎬 Studio</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {user.role === "admin" && <button className="c-btn ghost" onClick={() => setView("admin")}>⚙ Administrator panel</button>}
      <p className="c-note" style={{ marginTop: 20 }}>Clock in / clock out and your hours arrive in the next phase (timekeeping).</p>
    </Shell>
  );
}

function Shell({ children, user, onSignOut, onHome, compact }) {
  return (
    <div className="campus">
      <header className="campus-top">
        <a className="brand" href="/campus" onClick={(e) => { if (onHome) { e.preventDefault(); onHome(); } }} style={{ color: "inherit", textDecoration: "none" }}>
          <Logo size={compact ? 26 : 32} />
          <span><small>Conference as a Concert</small>Campus Sessions</span>
        </a>
        {user && <button className="btn btn-ghost btn-sm" onClick={onSignOut}>{compact ? "Sign out" : `${firstName(user.name)} · Sign out`}</button>}
      </header>
      <main className="campus-body">{children}</main>
    </div>
  );
}

function SignIn({ onSignedIn, admin }) {
  const code = inviteCode();
  const [mode, setMode] = useState(code ? "invite" : "login");
  const [status, setStatus] = useState(null);
  const [invite, setInvite] = useState(null);
  const [f, setF] = useState({ email: "", password: "", name: "", secret: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const up = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    authApi.status().then(setStatus).catch(() => setStatus({ hasUsers: true }));
    if (code) authApi.inviteInfo(code).then(setInvite).catch((e) => setErr(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      let r;
      if (mode === "invite") r = await authApi.acceptInvite(code, f.password);
      else if (mode === "bootstrap") r = await authApi.bootstrap({ secret: f.secret, email: f.email, name: f.name, password: f.password });
      else r = await authApi.login(f.email, f.password);
      setToken(r.token);
      if (mode === "invite") window.history.replaceState({}, "", "/campus");
      onSignedIn(r.user);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  const showBootstrap = status && !status.hasUsers;
  return (
    <form onSubmit={submit} className="c-card">
      {mode === "invite" ? (
        <>
          <h1>Welcome{invite && invite.name ? `, ${firstName(invite.name)}` : ""}!</h1>
          <p className="lead">Choose a password for your Campus Sessions account{invite ? ` (${invite.email})` : ""}.</p>
          <label className="c-field"><span className="lbl">Password (8+ characters)</span><input type="password" value={f.password} onChange={up("password")} autoComplete="new-password" required minLength={8} /></label>
        </>
      ) : mode === "bootstrap" ? (
        <>
          <h1>{showBootstrap ? "Set up the first administrator" : "Reset the administrator password"}</h1>
          <p className="c-note">Needs the setup secret from the site's environment settings (CAMPUS_ADMIN_SECRET). Enter the administrator's email and a new password — the account keeps everything else. Workers get a new password from a fresh invitation link in the admin panel.</p>
          <label className="c-field"><span className="lbl">Setup secret</span><input type="password" value={f.secret} onChange={up("secret")} required /></label>
          <label className="c-field"><span className="lbl">Your name</span><input value={f.name} onChange={up("name")} required /></label>
          <label className="c-field"><span className="lbl">Email</span><input type="email" value={f.email} onChange={up("email")} required /></label>
          <label className="c-field"><span className="lbl">{showBootstrap ? "Password (8+ characters)" : "New password (8+ characters)"}</span><input type="password" value={f.password} onChange={up("password")} autoComplete="new-password" required minLength={8} /></label>
        </>
      ) : (
        <>
          <h1>{admin ? "Administrator sign-in" : "Worker sign-in"}</h1>
          <label className="c-field"><span className="lbl">Email</span><input type="email" value={f.email} onChange={up("email")} autoComplete="username" required /></label>
          <label className="c-field"><span className="lbl">Password</span><input type="password" value={f.password} onChange={up("password")} autoComplete="current-password" required /></label>
        </>
      )}
      {err && <div className="c-err">{err}</div>}
      <button className="c-btn primary" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "invite" ? "Create my account" : mode === "bootstrap" ? (showBootstrap ? "Create administrator" : "Reset password & sign in") : "Sign in"}</button>
      {mode === "login" && showBootstrap && <button type="button" className="c-btn ghost" onClick={() => setMode("bootstrap")}>First time here? Set up the administrator</button>}
      {mode === "login" && status && status.hasUsers && <button type="button" className="c-btn ghost" onClick={() => setMode("bootstrap")}>Forgot the administrator password? Reset it with the setup secret</button>}
      {mode === "bootstrap" && <button type="button" className="c-btn ghost" onClick={() => setMode("login")}>Back to sign-in</button>}
      <p className="c-note">Workers get their account from an invitation link sent by the administrator.</p>
    </form>
  );
}

export function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || "there"; }
