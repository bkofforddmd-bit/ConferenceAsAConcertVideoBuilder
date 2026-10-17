// src/campus/HoursAdmin.jsx — the administrator's "Hours & payroll" tab:
// pending corrections, hourly rates with effective dates, the monthly payroll
// table (approve a worker's month, mark paid, CSV, print), and every shift
// of the month with per-shift approval.
import React, { useEffect, useState } from "react";
import { timeApi } from "./campus-api.js";
import { fmtH, fmtMoney, monthLabel, shiftMonth } from "./TimePanel.jsx";

const thisMonthLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
const dts = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default function HoursAdmin() {
  const [month, setMonth] = useState(thisMonthLocal());
  const [pay, setPay] = useState(null);
  const [cx, setCx] = useState([]);
  const [rates, setRates] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [rateForm, setRateForm] = useState({ workerId: "", dollars: "", effective: new Date().toISOString().slice(0, 10) });
  const [showShifts, setShowShifts] = useState(false);

  async function load() {
    try {
      const [p, c, r, s] = await Promise.all([timeApi.payroll(month), timeApi.corrections(), timeApi.rates(), timeApi.allShifts(month)]);
      setPay(p); setCx(c.corrections); setRates(r); setShifts(s.shifts); setErr("");
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn, ok) => fn().then(() => { setMsg(ok || ""); setErr(""); load(); }).catch((e) => setErr(e.message));

  function csv() {
    if (!pay) return;
    const rows = [["Month", "Worker", "Email", "Shifts", "Approved hours", "Approved minutes", "All minutes", "Rate ($/h)", "Gross ($)", "Status", "Paid at"]];
    for (const r of pay.rows) rows.push([pay.month, r.name, r.email, r.shifts, (r.approvedMinutes / 60).toFixed(2), r.approvedMinutes, r.allMinutes, r.rateCents == null ? "" : (r.rateCents / 100).toFixed(2), (r.grossCents / 100).toFixed(2), r.status, r.paidAt || ""]);
    rows.push([]);
    rows.push(["Date", "Worker", "In", "Out", "Minutes", "Approved", "Note", "Shift id"]);
    for (const s of shifts.filter((x) => x.status === "closed").sort((a, b) => (a.in < b.in ? -1 : 1))) rows.push([s.in.slice(0, 10), s.workerName, s.in, s.out, s.minutes, s.approved ? "yes" : "no", s.note || "", s.id]);
    const text = rows.map((r) => r.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `campus-payroll-${pay.month}.csv`;
    a.click();
  }

  return (
    <div>
      <div className="c-row" style={{ justifyContent: "space-between" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <h2 style={{ margin: 0 }}>{monthLabel(month)} <span className="c-note">(pay period)</span></h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      {err && <div className="c-err">{err}</div>}
      {msg && <div className="c-ok">{msg}</div>}

      {cx.length > 0 && (
        <div className="c-card warn">
          <h2>Correction requests ({cx.length})</h2>
          {cx.map((c) => <Correction key={c.id} c={c} onDecide={(approve, note) => run(() => timeApi.decideCorrection(c.id, approve, note), approve ? "Correction applied." : "Correction rejected.")} />)}
        </div>
      )}

      <div className="c-card">
        <h2>Payroll</h2>
        <p className="c-note">Only approved shifts are paid. Gross = approved minutes × the rate in force on each shift's date, to the cent.</p>
        {pay && (
          <table className="c-table">
            <thead><tr><th>Worker</th><th>Approved / all</th><th>Rate</th><th>Gross</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {pay.rows.map((r) => (
                <tr key={r.workerId}>
                  <td>{r.name}<br /><span className="c-note">{r.shifts} shift{r.shifts === 1 ? "" : "s"}{r.pending ? ` · ${r.pending} correction pending` : ""}</span></td>
                  <td>{fmtH(r.approvedMinutes)} / {fmtH(r.allMinutes)}</td>
                  <td>{r.rateCents == null ? <span className="c-err">no rate</span> : `${fmtMoney(r.rateCents)}/h`}{r.missingRate && <span className="c-err" title="Some shifts fall before the first rate's effective date"> !</span>}</td>
                  <td><b>{fmtMoney(r.grossCents)}</b></td>
                  <td>{r.status === "paid" ? <span style={{ color: "var(--success)" }}>paid {r.paidAt ? dts(r.paidAt) : ""}</span> : "open"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.approvedMinutes < r.allMinutes && <button className="btn btn-ghost btn-sm" onClick={() => run(() => timeApi.approveMonth(r.workerId, month, true), `Approved ${r.name}'s month.`)}>Approve all</button>}{" "}
                    {r.status !== "paid" ? <button className="btn btn-ghost btn-sm" disabled={!r.approvedMinutes} onClick={() => run(() => timeApi.markPaid(month, r.workerId, true), `Marked ${r.name} as paid.`)}>Mark paid</button> : <button className="btn btn-ghost btn-sm" onClick={() => run(() => timeApi.markPaid(month, r.workerId, false), "Reopened.")}>Undo paid</button>}
                  </td>
                </tr>
              ))}
              {pay.rows.length === 0 && <tr><td colSpan={6} className="c-note">No workers yet.</td></tr>}
            </tbody>
          </table>
        )}
        <div className="c-row">
          <button className="c-btn ghost" onClick={csv}>⬇ CSV for {monthLabel(month)}</button>
          <button className="c-btn ghost" onClick={() => window.print()}>🖨 Print this page</button>
        </div>
      </div>

      <div className="c-card">
        <h2>Hourly rates</h2>
        <p className="c-note">Rates are only visible here. A new rate applies from its effective date; earlier shifts keep the older rate.</p>
        {rates && (
          <table className="c-table">
            <tbody>
              {rates.workers.filter((w) => w.role === "worker" || (rates.rates[w.id] && rates.rates[w.id].rates.length)).map((w) => {
                const list = (rates.rates[w.id] || { rates: [] }).rates;
                return <tr key={w.id}><td>{w.name}</td><td>{list.length ? list.map((r) => <div key={r.effective}>{fmtMoney(r.cents)}/h from {r.effective}</div>) : <span className="c-note">no rate yet</span>}</td><td><button className="btn btn-ghost btn-sm" onClick={() => setRateForm({ ...rateForm, workerId: w.id })}>Set rate</button></td></tr>;
              })}
            </tbody>
          </table>
        )}
        {rateForm.workerId && (
          <form className="c-card" onSubmit={(e) => { e.preventDefault(); run(() => timeApi.setRate(rateForm.workerId, Math.round(Number(rateForm.dollars) * 100), rateForm.effective), "Rate saved.").then(() => setRateForm({ ...rateForm, workerId: "", dollars: "" })); }}>
            <label className="c-field"><span className="lbl">Hourly rate in dollars for {(rates.workers.find((w) => w.id === rateForm.workerId) || {}).name}</span><input type="number" step="0.01" min="0" value={rateForm.dollars} onChange={(e) => setRateForm({ ...rateForm, dollars: e.target.value })} required placeholder="15.00" /></label>
            <label className="c-field"><span className="lbl">Effective from</span><input type="date" value={rateForm.effective} onChange={(e) => setRateForm({ ...rateForm, effective: e.target.value })} required /></label>
            <div className="c-row"><button className="c-btn primary" type="submit">Save rate</button><button className="c-btn ghost" type="button" onClick={() => setRateForm({ ...rateForm, workerId: "" })}>Cancel</button></div>
          </form>
        )}
      </div>

      <div className="c-card">
        <h2>Shifts in {monthLabel(month)} <button className="btn btn-ghost btn-sm" onClick={() => setShowShifts(!showShifts)}>{showShifts ? "Hide" : `Show ${shifts.length}`}</button></h2>
        {showShifts && (
          <table className="c-table">
            <thead><tr><th>Worker</th><th>In – out</th><th>Hours</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>{s.workerName}</td>
                  <td>{dts(s.in)} – {s.status === "open" ? "open" : tm(s.out)}{s.endAdjusted ? " ✎" : ""}{s.corrected ? " ✔︎" : ""}</td>
                  <td>{s.status === "open" ? "—" : fmtH(s.minutes)}</td>
                  <td className="c-note">{s.note || ""}{s.audit && s.audit.length > 1 && <details><summary>history</summary>{s.audit.map((a, i) => <div key={i}>{dts(a.at)} — {a.what}{a.original ? ` (was ${tm(a.original.in)}–${tm(a.original.out)}, now ${tm(a.proposed.in)}–${tm(a.proposed.out)})` : ""}</div>)}</details>}</td>
                  <td>{s.status === "closed" && !s.pendingCorrection && <label className="c-note" style={{ whiteSpace: "nowrap" }}><input type="checkbox" checked={Boolean(s.approved)} onChange={(e) => run(() => timeApi.approveShift(s.id, e.target.checked))} /> approved</label>}{s.pendingCorrection && <span className="c-note">correction pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Correction({ c, onDecide }) {
  const [note, setNote] = useState("");
  return (
    <div className="c-card" style={{ margin: "8px 0" }}>
      <p style={{ margin: "0 0 6px" }}><b>{c.workerName}</b> · requested {dts(c.createdAt)}</p>
      <table className="c-table"><tbody>
        <tr><td>Original</td><td>{dts(c.original.in)} – {tm(c.original.out)}{c.original.note ? ` · ${c.original.note}` : ""}</td></tr>
        <tr><td>Proposed</td><td>{dts(c.proposed.in)} – {tm(c.proposed.out)}{c.proposed.note ? ` · ${c.proposed.note}` : ""}</td></tr>
        <tr><td>Reason</td><td>{c.reason}</td></tr>
      </tbody></table>
      <label className="c-field"><span className="lbl">Note to the worker (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="c-row">
        <button className="c-btn primary" onClick={() => onDecide(true, note)}>Approve</button>
        <button className="c-btn danger" onClick={() => onDecide(false, note)}>Reject</button>
      </div>
    </div>
  );
}
