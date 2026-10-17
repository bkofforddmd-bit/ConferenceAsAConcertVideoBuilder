// src/campus/TimePanel.jsx — the worker's own timekeeping: a clock-in /
// clock-out button, hours today / this week / this month / all time, the
// month's shifts, correction requests, and an "email my hours" summary.
// Every timestamp comes from the server; the phone only shows them.
import React, { useEffect, useState } from "react";
import { timeApi } from "./campus-api.js";

export const fmtH = (m) => `${Math.floor((m || 0) / 60)}:${String((m || 0) % 60).padStart(2, "0")}`;
export const fmtMoney = (c) => `$${((c || 0) / 100).toFixed(2)}`;
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
const dt = (iso) => (iso ? new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");
// datetime-local wants "YYYY-MM-DDTHH:MM" in the phone's own zone.
const toLocalInput = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : "");
export const monthLabel = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" }); };
export const shiftMonth = (ym, by) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const thisMonthLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function TimePanel({ user, onBack }) {
  const [st, setSt] = useState(null);
  const [month, setMonth] = useState(thisMonthLocal());
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [forgot, setForgot] = useState(false);
  const [outAt, setOutAt] = useState("");
  const [fix, setFix] = useState(null); // { shiftId, in, out, note, reason }
  const [tick, setTick] = useState(0);

  async function load() {
    try { const [s, l] = await Promise.all([timeApi.status(), timeApi.shifts(month)]); setSt(s); setList(l); setErr(""); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (st && st.open) load(); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn, okMsg) {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); setMsg(okMsg); setNote(""); setForgot(false); setOutAt(""); await load(); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const open = st && st.open;

  return (
    <div>
      <div className="c-row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: "8px 0" }}>My hours</h1>
        {onBack && <button className="btn btn-ghost btn-sm" onClick={onBack}>← Home</button>}
      </div>
      {err && <div className="c-err">{err}</div>}
      {msg && <div className="c-ok">{msg}</div>}

      <div className={`c-card ${open ? "ok" : ""}`}>
        {open ? (
          <>
            <div className="c-worker-tag">Clocked in</div>
            <p style={{ fontSize: 20, margin: "6px 0" }}>Since {tm(open.in)} · <b>{fmtH(open.runningMinutes)}</b> so far{open.note ? ` · ${open.note}` : ""}</p>
            <label className="c-field"><span className="lbl">What you worked on (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wilk lobby, 14 students" /></label>
            {!forgot ? (
              <>
                <button className="c-btn danger" disabled={busy} onClick={() => act(() => timeApi.clockOut({ note }), "Clocked out.")}>■ Clock out now</button>
                <button className="c-btn ghost" type="button" onClick={() => { setForgot(true); setOutAt(toLocalInput(new Date().toISOString())); }}>Forgot to clock out earlier?</button>
              </>
            ) : (
              <>
                <label className="c-field"><span className="lbl">When did you actually stop?</span><input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} max={toLocalInput(new Date().toISOString())} /></label>
                <p className="c-note">The record will show that this end time was entered by hand.</p>
                <div className="c-row">
                  <button className="c-btn danger" disabled={busy || !outAt} onClick={() => act(() => timeApi.clockOut({ note, outAt: fromLocalInput(outAt) }), "Clocked out with the time you entered.")}>■ Clock out at that time</button>
                  <button className="c-btn ghost" type="button" onClick={() => setForgot(false)}>Cancel</button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="c-worker-tag">Not clocked in</div>
            <label className="c-field"><span className="lbl">Where / what (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wilk lobby" /></label>
            <button className="c-btn primary big" disabled={busy || !st} onClick={() => act(() => timeApi.clockIn(note), "Clocked in. Have a great shift!")}>▶ Clock in</button>
          </>
        )}
      </div>

      {st && (
        <div className="c-stats">
          <div className="c-stat"><b>{fmtH(st.today)}</b><span>today</span></div>
          <div className="c-stat"><b>{fmtH(st.week)}</b><span>this week</span></div>
          <div className="c-stat"><b>{fmtH(st.month)}</b><span>this month (pay period)</span></div>
          <div className="c-stat"><b>{fmtH(st.totalMinutes)}</b><span>all time</span></div>
          <div className="c-stat"><b>{st.interactions.sessions}</b><span>sessions completed</span></div>
          <div className="c-stat"><b>{st.interactions.lyrics} / {st.interactions.songs}</b><span>lyrics / songs</span></div>
        </div>
      )}
      {st && st.rate == null && <p className="c-note">Your hourly rate hasn't been entered yet — the administrator sets it. Your hours are still recorded.</p>}

      <div className="c-card">
        <div className="c-row" style={{ justifyContent: "space-between" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h2 style={{ margin: 0 }}>{monthLabel(month)}</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonthLocal()}>›</button>
        </div>
        {list && list.shifts.length === 0 && <p className="c-note">No shifts this month.</p>}
        {list && list.shifts.length > 0 && (
          <table className="c-table">
            <thead><tr><th>Day</th><th>In – out</th><th>Hours</th><th></th></tr></thead>
            <tbody>
              {list.shifts.map((s) => {
                const cx = list.corrections.find((c) => c.shiftId === s.id && c.status === "pending");
                const decided = list.corrections.filter((c) => c.shiftId === s.id && c.status !== "pending").slice(-1)[0];
                return (
                  <tr key={s.id}>
                    <td>{dt(s.in)}{s.note && <><br /><span className="c-note">{s.note}</span></>}</td>
                    <td>{tm(s.in)} – {s.status === "open" ? "…" : tm(s.out)}{s.endAdjusted && <span title="End time entered by hand"> ✎</span>}{s.corrected && <span title="Corrected by the administrator"> ✔︎</span>}</td>
                    <td>{s.status === "open" ? "open" : fmtH(s.minutes)}{s.approved && <span className="c-note" title="Approved by the administrator"> ✓</span>}</td>
                    <td>
                      {s.status === "closed" && !cx && !s.approved && <button className="btn btn-ghost btn-sm" onClick={() => setFix({ shiftId: s.id, in: toLocalInput(s.in), out: toLocalInput(s.out), note: s.note || "", reason: "" })}>Fix</button>}
                      {cx && <span className="c-note">correction pending</span>}
                      {!cx && decided && <span className="c-note">{decided.status}{decided.decisionNote ? ` — ${decided.decisionNote}` : ""}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {list && list.shifts.length > 0 && <p className="c-note">Month total: <b>{fmtH(list.shifts.filter((s) => s.status === "closed").reduce((t, s) => t + (s.minutes || 0), 0))}</b>. ✓ = approved by the administrator. Approved shifts can't be changed — ask the administrator.</p>}
        {list && list.shifts.length > 0 && <EmailSummary month={month} user={user} />}
      </div>

      {fix && (
        <div className="c-card warn">
          <h2>Request a correction</h2>
          <p className="c-note">The administrator reviews it. The original times stay in the record alongside your request.</p>
          <label className="c-field"><span className="lbl">Start</span><input type="datetime-local" value={fix.in} onChange={(e) => setFix({ ...fix, in: e.target.value })} /></label>
          <label className="c-field"><span className="lbl">End</span><input type="datetime-local" value={fix.out} onChange={(e) => setFix({ ...fix, out: e.target.value })} /></label>
          <label className="c-field"><span className="lbl">Work description</span><input value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} /></label>
          <label className="c-field"><span className="lbl">Why it needs correcting</span><textarea value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} placeholder="e.g. I forgot to clock out and left at 4:30" /></label>
          <div className="c-row">
            <button className="c-btn primary" disabled={busy} onClick={() => act(async () => { await timeApi.requestCorrection({ shiftId: fix.shiftId, in: fromLocalInput(fix.in), out: fromLocalInput(fix.out), note: fix.note, reason: fix.reason }); setFix(null); }, "Correction sent to the administrator.")}>Send request</button>
            <button className="c-btn ghost" onClick={() => setFix(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailSummary({ month, user }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  async function build() {
    try { const r = await timeApi.summary(month); setText(r.text); setErr(""); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { setText(""); }, [month]);
  if (!text) return <>{err && <div className="c-err">{err}</div>}<button className="c-btn ghost" onClick={build}>✉ Email my hours for {monthLabel(month)}</button></>;
  const subject = `Campus Sessions hours — ${user.name} — ${month}`;
  return (
    <div>
      <textarea className="c-release" readOnly value={text} style={{ width: "100%", minHeight: 160, boxSizing: "border-box" }} />
      <div className="c-row">
        <a className="c-btn primary" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>Open in my email app</a>
        <button className="c-btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); } catch {} }}>Copy</button>
      </div>
    </div>
  );
}
