// src/campus/Retention.jsx — Phase 3 retention & deletion policy for the
// video clips in the private R2 bucket: the policy, a preview of exactly
// which clips it would delete, a two-tap "delete now", an optional daily
// automatic run, and a log of every deletion. Consent and session records
// are never deleted here.
import React, { useEffect, useState } from "react";
import { analyticsApi } from "./campus-api.js";

const mb = (b) => `${((b || 0) / 1048576).toFixed(1)} MB`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default function Retention() {
  const [data, setData] = useState(null);
  const [f, setF] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const r = await analyticsApi.retention(); setData(r); setF({ clipRetentionDays: r.policy.clipRetentionDays, purgeWithdrawn: r.policy.purgeWithdrawn, autoPurge: r.policy.autoPurge }); setErr(""); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(""); setErr("");
    try { await analyticsApi.setRetention({ ...f, clipRetentionDays: Number(f.clipRetentionDays) }); setMsg("Policy saved. The list below shows what it would delete."); await load(); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  async function purge() {
    if (!armed) { setArmed(true); return; }
    setArmed(false); setBusy(true); setMsg(""); setErr("");
    try {
      const r = await analyticsApi.purge(data.candidates.map((c) => c.clipId));
      setMsg(`Deleted ${r.log.deleted} clip${r.log.deleted === 1 ? "" : "s"} (${mb(r.log.bytes)}).${r.failed.length ? ` ${r.failed.length} couldn't be deleted and were left as they were: ${r.failed[0].error}` : ""}`);
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (!data || !f) return err ? <div className="c-err">{err}</div> : <p className="c-note"><span className="c-spinner" />Loading…</p>;
  const c = data.candidates;
  const total = c.reduce((t, x) => t + x.bytes, 0);

  return (
    <div>
      <div className="c-stats">
        <div className="c-stat"><b>{data.storage.clips}</b><span>video clips stored</span></div>
        <div className="c-stat"><b>{mb(data.storage.bytes)}</b><span>in the private bucket</span></div>
      </div>
      <p className="c-note">Oldest clip: {day(data.storage.oldest)}.{!data.storageConfigured && " Video storage isn't set up on this site, so nothing can be deleted from here."}</p>

      <form className="c-card" onSubmit={save}>
        <h2>Retention policy for video clips</h2>
        <label className="c-field"><span className="lbl">Keep clips for (days) — 0 keeps them until deleted by hand</span><input type="number" min="0" max="3650" step="1" value={f.clipRetentionDays} onChange={(e) => setF({ ...f, clipRetentionDays: e.target.value })} /></label>
        <label className="c-check"><input type="checkbox" checked={f.purgeWithdrawn} onChange={(e) => setF({ ...f, purgeWithdrawn: e.target.checked })} /> Delete a session's clips once the student withdraws consent</label>
        <label className="c-check"><input type="checkbox" checked={f.autoPurge} onChange={(e) => setF({ ...f, autoPurge: e.target.checked })} /> Delete automatically once a day (otherwise only when you tap the button below)</label>
        <p className="c-note">Only the video files are deleted. Consent records (with the exact release text and signature), session records and lyrics are always kept. Clips already spliced into a published music video stay in that video.</p>
        {data.policy.updatedAt && <p className="c-note">Last changed {when(data.policy.updatedAt)}.</p>}
        <button className="c-btn primary" type="submit" disabled={busy}>Save policy</button>
      </form>

      {err && <div className="c-err">{err}</div>}
      {msg && <div className="c-ok">{msg}</div>}

      <div className={`c-card ${c.length ? "warn" : "ok"}`}>
        <h2>{c.length ? `${c.length} clip${c.length === 1 ? "" : "s"} due for deletion (${mb(total)})` : "Nothing is due for deletion"}</h2>
        {c.length > 0 && (
          <>
            <div className="c-scroll">
              <table className="c-table">
                <thead><tr><th>Session</th><th>Clip</th><th>Recorded</th><th>Size</th><th>Why</th></tr></thead>
                <tbody>{c.map((x) => <tr key={x.clipId}><td><code className="c-code">{x.sessionId}</code></td><td>{x.stage}{x.status === "uploading" ? " (unfinished upload)" : ""}</td><td>{day(x.at)}{x.ageDays != null ? <><br /><span className="c-note">{x.ageDays} days ago</span></> : null}</td><td>{mb(x.bytes)}</td><td>{x.reason}</td></tr>)}</tbody>
              </table>
            </div>
            <button className={`c-btn ${armed ? "danger" : "ghost"}`} onClick={purge} disabled={busy || !data.storageConfigured}>
              {busy ? "Deleting…" : armed ? `Tap again to permanently delete ${c.length} clip${c.length === 1 ? "" : "s"}` : `🗑 Delete these ${c.length} clip${c.length === 1 ? "" : "s"} now`}
            </button>
            <p className="c-note">Deleted files can't be recovered. The clip entries stay on each session marked "deleted", with the date and reason.</p>
          </>
        )}
      </div>

      <div className="c-card">
        <h2>Deletion log</h2>
        {data.log.length === 0 ? <p className="c-note">No deletions yet.</p> : (
          <table className="c-table">
            <tbody>{data.log.map((l) => <tr key={l.id}><td>{when(l.at)}</td><td>{l.trigger === "daily" ? "automatic" : "by an administrator"}</td><td>{l.deleted} deleted ({mb(l.bytes)}){l.failed ? ` · ${l.failed} failed` : ""}<br /><span className="c-note">{Object.entries(l.reasons || {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "nothing due"}</span></td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
