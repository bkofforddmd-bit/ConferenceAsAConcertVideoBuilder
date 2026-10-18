// src/campus/Analytics.jsx — Phase 3 administrator analytics: engagement
// dashboard, Approached → Participated → Lyrics → Song funnel, worker
// comparisons (with hours from timekeeping), results by date, most-chosen
// talks, talks still without a song, and CSV exports. No participant names,
// emails or signatures appear anywhere here or in the exports.
import React, { useEffect, useMemo, useState } from "react";
import { analyticsApi, libraryByTalk } from "./campus-api.js";

// Local campus dates (America/Denver), matching the server's day boundaries.
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
const campusDay = (d = new Date()) => fmtDay.format(d);
const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
function presetRange(k) {
  const today = campusDay();
  if (k === "today") return [today, today];
  if (k === "week") { const [y, m, d] = today.split("-").map(Number); const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return [addDays(today, -dow), today]; }
  if (k === "month") return [today.slice(0, 8) + "01", today];
  if (k === "30") return [addDays(today, -29), today];
  return ["", ""];
}
const PRESETS = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["30", "Last 30 days"], ["all", "All time"]];

const mmss = (sec) => (sec == null ? "—" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`);
const hm = (min) => `${Math.floor((min || 0) / 60)}h ${(min || 0) % 60}m`;
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const REACTIONS = { positive: "😊 Positive", neutral: "😐 Neutral", negative: "🙁 Negative", not_captured: "— Not captured" };

function downloadCsv(name, rows) {
  const text = rows.map((r) => r.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function Analytics() {
  const [preset, setPreset] = useState("month");
  const [[from, to], setRange] = useState(presetRange("month"));
  const [workerId, setWorkerId] = useState("");
  const [data, setData] = useState(null);
  const [lib, setLib] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try { setData(await analyticsApi.overview({ from, to, workerId })); setErr(""); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  useEffect(() => { load(); }, [from, to, workerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { libraryByTalk().then(setLib); }, []);

  // Talks students chose that still have no song — re-checked against the live library.
  const unsongified = useMemo(() => {
    if (!data) return [];
    return data.unsongified.map((t) => ({ ...t, nowInLibrary: Boolean(lib && (lib.byUri.has(t.uri) || lib.byTitle.has(lib.norm(t.title)))) }));
  }, [data, lib]);

  const tag = `${from || "start"}_to_${to || "today"}${workerId ? "_one-worker" : ""}`;
  const t = data && data.totals;
  const maxDay = data ? Math.max(1, ...data.byDate.map((d) => d.approached)) : 1;

  return (
    <div>
      <div className="c-tabs" style={{ marginTop: 0 }}>
        {PRESETS.map(([k, l]) => <button key={k} className={preset === k ? "on" : ""} onClick={() => { setPreset(k); setRange(presetRange(k)); }}>{l}</button>)}
      </div>
      <div className="c-row">
        <label className="c-field" style={{ flex: "1 1 140px", margin: "4px 0" }}><span className="lbl">From</span><input type="date" value={from} onChange={(e) => { setPreset("custom"); setRange([e.target.value, to]); }} /></label>
        <label className="c-field" style={{ flex: "1 1 140px", margin: "4px 0" }}><span className="lbl">To</span><input type="date" value={to} onChange={(e) => { setPreset("custom"); setRange([from, e.target.value]); }} /></label>
        <label className="c-field" style={{ flex: "1 1 180px", margin: "4px 0" }}><span className="lbl">Worker</span>
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">All workers</option>
            {data && data.workers.map((w) => <option key={w.id} value={w.id}>{w.name}{w.active ? "" : " (deactivated)"}</option>)}
          </select>
        </label>
      </div>
      {err && <div className="c-err">{err}</div>}
      {busy && !data && <p className="c-note"><span className="c-spinner" />Loading…</p>}

      {t && (
        <>
          <div className="c-stats c-stats-wide">
            <Stat n={t.approached} l="approached" />
            <Stat n={t.participated} l="participated" sub={pct(t.participated, t.approached)} />
            <Stat n={t.declined} l="declined" />
            <Stat n={t.recorded} l="authorized recording" />
            <Stat n={t.unrecorded} l="took part, no recording" />
            <Stat n={t.lyrics} l="lyrics generated" />
            <Stat n={t.songs} l="songs generated" />
            <Stat n={mmss(t.avgParticipatedDurationSec)} l="avg. time (participated)" />
            <Stat n={t.abandoned + t.open} l="unfinished (not counted)" />
          </div>

          <div className="c-card">
            <h2>Conversion funnel</h2>
            {data.funnel.map((f, i) => (
              <div key={f.key} className="c-funnel-row">
                <div className="c-funnel-label">{f.label}</div>
                <div className="c-funnel-track"><div className="c-funnel-bar" style={{ width: `${Math.max(f.pctOfApproached, f.n ? 2 : 0)}%` }} /></div>
                <div className="c-funnel-n"><b>{f.n}</b> <span className="c-note">{i ? `${f.pctOfPrev}% of previous` : ""}</span></div>
              </div>
            ))}
            <p className="c-note">Participated, lyrics and songs count completed sessions only. Unfinished sessions count as an approach, never as a completed experience.</p>
          </div>

          <div className="c-card">
            <h2>Workers</h2>
            <div className="c-scroll">
              <table className="c-table">
                <thead><tr><th>Worker</th><th>Hours</th><th>Approached</th><th>Participated</th><th>Lyrics</th><th>Songs</th><th>Avg. time</th><th>Per hour</th></tr></thead>
                <tbody>
                  {data.byWorker.map((w) => (
                    <tr key={w.workerId}>
                      <td>{w.name}</td>
                      <td>{hm(w.minutes)}</td>
                      <td>{w.approached}</td>
                      <td>{w.participated} <span className="c-note">({w.participationRate}%)</span></td>
                      <td>{w.lyrics}</td>
                      <td>{w.songs} <span className="c-note">({w.songRate}%)</span></td>
                      <td>{mmss(w.avgParticipatedDurationSec)}</td>
                      <td>{w.approachedPerHour == null ? "—" : <>{w.approachedPerHour} approached<br /><span className="c-note">{w.participatedPerHour} participated</span></>}</td>
                    </tr>
                  ))}
                  {data.byWorker.length === 0 && <tr><td colSpan={8} className="c-note">No sessions or shifts in this range.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="c-note">Hours come from clocked shifts in the same dates. Song % is songs out of students who participated.</p>
          </div>

          <div className="c-card">
            <h2>By date</h2>
            {data.byDate.length === 0 && <p className="c-note">No sessions in this range.</p>}
            {data.byDate.map((d) => (
              <div key={d.date} className="c-funnel-row">
                <div className="c-funnel-label">{new Date(d.date + "T12:00:00Z").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</div>
                <div className="c-funnel-track" title={`${d.approached} approached, ${d.participated} participated, ${d.songs} songs`}>
                  <div className="c-funnel-bar faint" style={{ width: `${(d.approached / maxDay) * 100}%` }} />
                  <div className="c-funnel-bar" style={{ width: `${(d.participated / maxDay) * 100}%`, marginTop: -14 }} />
                </div>
                <div className="c-funnel-n"><b>{d.participated}</b>/{d.approached} <span className="c-note">· {d.lyrics} lyrics · {d.songs} songs</span></div>
              </div>
            ))}
            {data.byDate.length > 0 && <p className="c-note">Dark bar = participated, light bar = approached.</p>}
          </div>

          {data.engagement && (
            <div className="c-card">
              <h2>Student feedback & song pages</h2>
              <div className="c-stats c-stats-wide">
                <Stat n={data.engagement.feedback.avgRating == null ? "—" : `${data.engagement.feedback.avgRating} ★`} l={`avg. rating (${data.engagement.feedback.answered} answered)`} />
                <Stat n={data.engagement.songPages.opened} l={`song pages opened (of ${data.engagement.songPages.created})`} sub={`${data.engagement.songPages.views} total visits`} />
                <Stat n={data.engagement.songPages.avgRating == null ? "—" : `${data.engagement.songPages.avgRating} ★`} l={`song-page rating (${data.engagement.songPages.ratings})`} />
                <Stat n={data.engagement.followUps.optedIn} l="asked for an email" sub={`${data.engagement.followUps.waiting} waiting · ${data.engagement.followUps.sent} sent`} />
              </div>
              <table className="c-table">
                <tbody>
                  <tr><td>Song helped the message sink in</td><td>{fbLine(data.engagement.feedback.helped, { yes: "yes", somewhat: "somewhat", no: "not really" })}</td></tr>
                  <tr><td>Would listen to more</td><td>{fbLine(data.engagement.feedback.more, { yes: "yes", maybe: "maybe", no: "no" })}</td></tr>
                  <tr><td>Would share with a friend</td><td>{fbLine(data.engagement.feedback.share, { yes: "yes", maybe: "maybe", no: "no" })}</td></tr>
                  <tr><td>Ratings</td><td>{[5, 4, 3, 2, 1].map((n) => `${n}★ ${data.engagement.feedback.ratings[n] || 0}`).join(" · ")}</td></tr>
                </tbody>
              </table>
              {data.comments && data.comments.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary>Student comments ({data.comments.length})</summary>
                  {data.comments.map((c, i) => <div key={i} className="c-card" style={{ padding: 10, margin: "6px 0" }}>“{c.comment}”<div className="c-note" style={{ margin: 0 }}>{c.rating ? `${"★".repeat(c.rating)} · ` : ""}{c.talk} · {c.where} · {c.date}{c.ref ? ` · ${c.ref}` : ""}</div></div>)}
                </details>
              )}
            </div>
          )}

          <div className="c-card">
            <h2>Student reactions</h2>
            <div className="c-row">
              {Object.keys(REACTIONS).map((k) => <span key={k} className="c-chip">{REACTIONS[k]}: <b>{data.reactions[k] || 0}</b></span>)}
            </div>
          </div>

          <div className="c-card">
            <h2>Most-chosen talks</h2>
            {data.talks.length === 0 ? <p className="c-note">No talks chosen yet in this range.</p> : (
              <div className="c-scroll">
                <table className="c-table">
                  <thead><tr><th>Talk</th><th>Chosen</th><th>Lyrics</th><th>Songs</th><th></th></tr></thead>
                  <tbody>{data.talks.map((k) => <tr key={k.uri}><td>{k.title}<br /><span className="c-note">{k.speaker}</span></td><td>{k.n}</td><td>{k.lyrics}</td><td>{k.songs}</td><td className="c-note">{k.existing ? "had a library song" : ""}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="c-card">
            <h2>Talks students chose that still have no song ({unsongified.filter((u) => !u.nowInLibrary).length})</h2>
            <p className="c-note">Chosen in this range, no song in the Concert library when chosen, and no song made in a session.{lib && !lib.offline ? " Checked against the live library just now." : " (Couldn't reach the library to re-check.)"}</p>
            {unsongified.length === 0 ? <p className="c-note">None — every chosen talk has a song.</p> : (
              <table className="c-table">
                <tbody>{unsongified.map((k) => <tr key={k.uri} style={k.nowInLibrary ? { opacity: 0.5 } : undefined}><td>{k.title}<br /><span className="c-note">{k.speaker}</span></td><td>{k.n} student{k.n === 1 ? "" : "s"}</td><td className="c-note">{k.nowInLibrary ? "now in the library ✓" : ""}</td></tr>)}</tbody>
              </table>
            )}
          </div>

          <div className="c-card">
            <h2>Exports (CSV)</h2>
            <p className="c-note">For the dates and worker selected above. No participant names, emails or signatures are included. (Student comments are anonymous, but they're the students' own words.)</p>
            <div className="c-row">
              <button className="c-btn ghost" onClick={() => downloadCsv(`campus-summary_${tag}.csv`, [
                ["From", from || "(all)"], ["To", to || "(all)"], ["Worker", workerId ? (data.workers.find((w) => w.id === workerId) || {}).name : "All"], [],
                ["Measure", "Count"], ...Object.entries(t).map(([k, v]) => [k, v == null ? "" : v]), [],
                ["Funnel step", "Count", "% of approached", "% of previous"], ...data.funnel.map((f) => [f.label, f.n, f.pctOfApproached, f.pctOfPrev]), [],
                ["Reaction", "Count"], ...Object.entries(data.reactions),
              ])}>⬇ Summary & funnel</button>
              <button className="c-btn ghost" onClick={() => downloadCsv(`campus-by-worker_${tag}.csv`, [
                ["Worker", "Hours", "Approached", "Declined", "Participated", "Participation %", "Recorded", "Without recording", "Lyrics", "Songs", "Song %", "Avg seconds (participated)", "Approached per hour", "Participated per hour", "Unfinished"],
                ...data.byWorker.map((w) => [w.name, (w.minutes / 60).toFixed(2), w.approached, w.declined, w.participated, w.participationRate, w.recorded, w.unrecorded, w.lyrics, w.songs, w.songRate, w.avgParticipatedDurationSec ?? "", w.approachedPerHour ?? "", w.participatedPerHour ?? "", w.abandoned + w.open]),
              ])}>⬇ By worker</button>
              <button className="c-btn ghost" onClick={() => downloadCsv(`campus-by-date_${tag}.csv`, [
                ["Date", "Approached", "Declined", "Participated", "Recorded", "Without recording", "Lyrics", "Songs", "Avg seconds (participated)", "Unfinished"],
                ...data.byDate.map((d) => [d.date, d.approached, d.declined, d.participated, d.recorded, d.unrecorded, d.lyrics, d.songs, d.avgParticipatedDurationSec ?? "", d.abandoned + d.open]),
              ])}>⬇ By date</button>
              <button className="c-btn ghost" onClick={() => downloadCsv(`campus-talks_${tag}.csv`, [
                ["Talk", "Speaker", "Chosen", "Participated", "Lyrics", "Songs", "Had library song", "Still no song", "Link"],
                ...data.talks.map((k) => [k.title, k.speaker, k.n, k.participated, k.lyrics, k.songs, k.existing ? "yes" : "no", unsongified.some((u) => u.uri === k.uri && !u.nowInLibrary) ? "yes" : "no", `https://www.churchofjesuschrist.org${k.uri}`]),
              ])}>⬇ Talks</button>
              <button className="c-btn ghost" onClick={() => downloadCsv(`campus-sessions_${tag}.csv`, [
                ["Session id", "Reference", "Date", "Started", "Ended", "Seconds", "Worker", "Campus", "Status", "Participation", "Talk", "Speaker", "Had library song", "Lyrics", "Song", "Song played", "Reaction", "Clips", "Recording refs", "Rating", "Helped", "Want more", "Would share", "Song page", "Song page visits", "Song page ratings", "Follow-up"],
                ...data.rows.map((r) => [r.id, r.ref, r.date, r.startedAt, r.endedAt, r.durationSec, r.worker, r.campus, r.status, r.participation, r.talk, r.speaker, r.existingSong ? "yes" : "no", r.lyrics ? "yes" : "no", r.song ? "yes" : "no", r.played ? "yes" : "no", r.reaction, r.clips, r.recordings, r.rating, r.helped, r.more, r.wouldShare, r.songPage ? "yes" : "no", r.songPageViews, r.songPageRatings, r.followUp]),
              ])}>⬇ Every session</button>
              <button className="c-btn ghost" disabled={!data.comments || !data.comments.length} onClick={() => downloadCsv(`campus-comments_${tag}.csv`, [
                ["Date", "Where", "Rating", "Talk", "Reference", "Comment"],
                ...data.comments.map((c) => [c.date, c.where, c.rating || "", c.talk, c.ref, c.comment]),
              ])}>⬇ Student comments</button>
            </div>
          </div>
          <button className="c-btn ghost" onClick={load} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
        </>
      )}
    </div>
  );
}

function fbLine(t, labels) {
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  if (!total) return "—";
  return Object.keys(labels).map((k) => `${labels[k]} ${t[k] || 0} (${Math.round(((t[k] || 0) / total) * 100)}%)`).join(" · ");
}

function Stat({ n, l, sub }) {
  return <div className="c-stat"><b>{n}</b><span>{l}</span>{sub && <div className="c-note" style={{ margin: 0 }}>{sub}</div>}</div>;
}
