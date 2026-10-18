// src/campus/FollowUps.jsx — administrator "Follow-ups" tab (Phase 4).
// Students who explicitly opted in to "email me when my song is ready". The
// email is sent from the administrator's own email app (✉ opens a ready-made
// message with the student's song-page link), then marked sent here. Opt-outs
// erase the address at once; the retention policy erases the rest on schedule.
import React, { useEffect, useState } from "react";
import { adminApi, songPageUrl } from "./campus-api.js";

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const STATUS = { waiting: "waiting", sent: "sent ✓", "opted-out": "opted out", deleted: "erased", expired: "erased (policy)" };

function message(f, purpose) {
  const hi = f.firstName ? `Hi ${f.firstName},` : "Hi,";
  const title = f.songTitle || f.talk || "your song";
  const link = f.shareCode ? songPageUrl(f.shareCode) : "";
  const subject = purpose === "video" ? `The music video for "${title}" is ready` : `Your song "${title}" is ready`;
  const body = [
    hi, "",
    purpose === "video"
      ? `Thanks again for sharing your favorite conference talk with us on campus. The music video for "${title}" is ready:`
      : `Thanks again for sharing your favorite conference talk with us on campus. Your song "${title}"${f.talk ? `, inspired by "${f.talk}",` : ""} is ready to hear:`,
    link, "",
    "You asked us to send this when it was ready. We won't email you again except for the music video (if you asked about that too). Reply \"stop\" and we won't contact you again.",
    "", "Conference as a Concert",
  ].join("\n");
  return { subject, body };
}

export default function FollowUps() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState("open");
  const [copied, setCopied] = useState("");
  const load = () => adminApi.followups().then((r) => { setList(r.followups); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = (p, ok) => p.then(() => { setMsg(ok); load(); }).catch((e) => setErr(e.message));
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1600); } catch {} };

  if (!list) return err ? <div className="c-err">{err}</div> : <p className="c-note"><span className="c-spinner" />Loading…</p>;
  const open = list.filter((f) => f.status === "waiting");
  const shown = show === "open" ? open : list;
  return (
    <div>
      <p className="c-note">Students who asked to be emailed when their song (or music video) is ready. Send from your own email app with ✉, then tap "Mark sent". Each student gets at most the emails they asked for.</p>
      <div className="c-tabs" style={{ marginTop: 0 }}>
        <button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>To send ({open.length})</button>
        <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All ({list.length})</button>
      </div>
      {err && <div className="c-err">{err}</div>}
      {msg && <div className="c-ok">{msg}</div>}
      {shown.length === 0 && <p className="c-note">{show === "open" ? "Nobody is waiting for an email." : "No follow-up requests yet."}</p>}
      {shown.map((f) => {
        const sentPurposes = (f.sent || []).map((x) => x.purpose);
        const next = (f.purposes || ["song"]).find((p) => !sentPurposes.includes(p)) || "song";
        const m = message(f, next);
        return (
          <div key={f.sessionId} className={`c-card ${f.status === "waiting" ? (f.songReady ? "ok" : "") : ""}`}>
            <div className="c-row" style={{ justifyContent: "space-between" }}>
              <div><b>{f.talk || "—"}</b>{f.songTitle && f.songTitle !== f.talk ? <> · “{f.songTitle}”</> : null}<br /><span className="c-note">Ref <span className="c-ref">{f.ref || "—"}</span> · opted in {when(f.at)} · wants: {(f.purposes || ["song"]).join(" + ")}</span></div>
              <span className="c-note">{STATUS[f.status] || f.status}</span>
            </div>
            {f.email ? <p style={{ margin: "8px 0" }}>{f.firstName ? `${f.firstName} · ` : ""}<b>{f.email}</b> <button className="btn btn-ghost btn-sm" onClick={() => copy(f.email, `e-${f.sessionId}`)}>{copied === `e-${f.sessionId}` ? "Copied ✓" : "📋 Copy"}</button></p> : <p className="c-note">Contact details erased{f.erasedAt ? ` ${when(f.erasedAt)}` : ""}.</p>}
            {f.status === "waiting" && (
              <>
                <p className="c-note" style={{ margin: "4px 0" }}>{f.songReady ? `✓ The song page has a song (${f.songFrom}).` : "⏳ The song page doesn't have a song yet — attach one (📱 on the worker's recent sessions) or publish it to the library first."}</p>
                <div className="c-row">
                  <a className="c-btn primary" href={`mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`}>✉ Email about the {next}</a>
                  <button className="c-btn ghost" onClick={() => copy(`${m.subject}\n\n${m.body}`, `m-${f.sessionId}`)}>{copied === `m-${f.sessionId}` ? "Copied ✓" : "📋 Copy message"}</button>
                </div>
                <div className="c-row">
                  <button className="c-btn" onClick={() => act(adminApi.followupUpdate(f.sessionId, "sent", next), `Marked the ${next} email as sent.`)}>✓ Mark the {next} email sent</button>
                  <button className="c-btn danger" onClick={() => act(adminApi.followupUpdate(f.sessionId, "opted-out"), "Opted out — the email address is erased.")}>Student said stop</button>
                </div>
              </>
            )}
            {f.status !== "waiting" && f.email && (
              <div className="c-row">
                <button className="c-btn ghost" onClick={() => act(adminApi.followupUpdate(f.sessionId, "waiting"), "Reopened.")}>Reopen</button>
                <button className="c-btn danger" onClick={() => act(adminApi.followupDelete(f.sessionId), "Contact details erased.")}>Erase contact now</button>
              </div>
            )}
            <details><summary className="c-note">History</summary>{(f.history || []).map((h, i) => <div key={i} className="c-note">{when(h.at)} — {h.what}</div>)}<div className="c-note" style={{ marginTop: 6 }}>Agreed to (version {f.optInVersion}): “{f.optInText}”</div></details>
          </div>
        );
      })}
    </div>
  );
}
