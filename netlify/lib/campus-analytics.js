// netlify/lib/campus-analytics.js
//
// Phase 3 analytics for Campus Sessions — pure functions over session
// documents, so they can be tested without the store. Nothing here touches
// consent records: no participant names, emails or signatures ever reach the
// analytics or its exports.
//
// Counting rules (from the spec):
//   - Approached = every session started in the range (one student approached).
//   - Abandoned / still-open sessions are never counted as completed
//     experiences: participated, lyrics and songs count COMPLETED sessions only.
//   - Funnel: Approached → Participated → Lyrics generated → Song generated.
// Dates are local campus dates (America/Denver), same as payroll.

import { localDate } from "./campus-time.js";

const isDone = (s) => s.status === "completed";
const participated = (s) => isDone(s) && (s.participation === "recorded" || s.participation === "unrecorded");

export function metrics(list) {
  const done = list.filter(isDone);
  const part = done.filter(participated);
  const durs = done.map((s) => s.durationSec).filter((n) => Number.isFinite(n) && n > 0);
  const partDurs = part.map((s) => s.durationSec).filter((n) => Number.isFinite(n) && n > 0);
  return {
    approached: list.length,
    completed: done.length,
    abandoned: list.filter((s) => s.status === "abandoned").length,
    open: list.filter((s) => s.status === "active").length,
    declined: done.filter((s) => s.participation === "declined").length,
    participated: part.length,
    recorded: part.filter((s) => s.participation === "recorded").length,
    unrecorded: part.filter((s) => s.participation === "unrecorded").length,
    lyrics: part.filter((s) => s.lyrics && s.lyrics.generated).length,
    songs: part.filter((s) => s.song && s.song.generated).length,
    songsPlayed: part.filter((s) => s.song && s.song.played).length,
    melodyCraftOpened: part.filter((s) => s.song && s.song.opened).length,
    existingSong: part.filter((s) => s.songified && s.songified.existing).length,
    clips: list.reduce((t, s) => t + (s.clips || []).filter((c) => c.status === "ready").length, 0),
    avgDurationSec: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
    avgParticipatedDurationSec: partDurs.length ? Math.round(partDurs.reduce((a, b) => a + b, 0) / partDurs.length) : null,
  };
}

export function funnel(m) {
  const steps = [["approached", "Approached"], ["participated", "Participated"], ["lyrics", "Lyrics generated"], ["songs", "Song generated"]];
  return steps.map(([key, label], i) => {
    const n = m[key];
    const prev = i ? m[steps[i - 1][0]] : n;
    return { key, label, n, pctOfApproached: m.approached ? Math.round((n / m.approached) * 1000) / 10 : 0, pctOfPrev: prev ? Math.round((n / prev) * 1000) / 10 : 0 };
  });
}

// sessions: raw session docs. users: [{id,name,role}]. shifts: closed shift docs.
export function analyze(sessions, { from = "", to = "", workerId = "", users = [], shifts = [] } = {}) {
  const inRange = (iso) => { const d = localDate(iso); return (!from || d >= from) && (!to || d <= to); };
  let list = sessions.filter((s) => s.startedAt && inRange(s.startedAt));
  if (workerId) list = list.filter((s) => s.workerId === workerId);
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || "(removed worker)";
  const m = metrics(list);

  // reactions from students who took part (declined students have none)
  const reactions = {};
  for (const s of list.filter(participated)) { const k = s.reaction || "not_captured"; reactions[k] = (reactions[k] || 0) + 1; }

  // talks chosen
  const talks = new Map();
  for (const s of list) {
    if (!s.talk || !s.talk.uri) continue;
    const t = talks.get(s.talk.uri) || { uri: s.talk.uri, title: s.talk.title || "", speaker: s.talk.speaker || "", n: 0, participated: 0, lyrics: 0, songs: 0, existing: false };
    t.n += 1;
    if (participated(s)) { t.participated += 1; if (s.lyrics && s.lyrics.generated) t.lyrics += 1; if (s.song && s.song.generated) t.songs += 1; }
    if (s.songified && s.songified.existing) t.existing = true;
    talks.set(t.uri, t);
  }
  const talkList = [...talks.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title));
  // Unsongified = chosen by students, no library song when they picked it, and
  // no song generated in any session. (The page re-checks the live library.)
  const unsongified = talkList.filter((t) => !t.existing && t.songs === 0);

  // hours worked in the range (closed shifts), for per-hour comparisons
  const minutesBy = {};
  for (const sh of shifts) if (sh.status === "closed" && inRange(sh.in) && (!workerId || sh.workerId === workerId)) minutesBy[sh.workerId] = (minutesBy[sh.workerId] || 0) + (sh.minutes || 0);

  const workerIds = new Set([...list.map((s) => s.workerId), ...Object.keys(minutesBy)]);
  const byWorker = [...workerIds].map((id) => {
    const wm = metrics(list.filter((s) => s.workerId === id));
    const minutes = minutesBy[id] || 0;
    const hours = minutes / 60;
    return {
      workerId: id, name: nameOf(id), ...wm, minutes,
      approachedPerHour: hours ? Math.round((wm.approached / hours) * 10) / 10 : null,
      participatedPerHour: hours ? Math.round((wm.participated / hours) * 10) / 10 : null,
      participationRate: wm.approached ? Math.round((wm.participated / wm.approached) * 1000) / 10 : 0,
      songRate: wm.participated ? Math.round((wm.songs / wm.participated) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.participated - a.participated || b.approached - a.approached || a.name.localeCompare(b.name));

  const dates = new Map();
  for (const s of list) { const d = localDate(s.startedAt); if (!dates.has(d)) dates.set(d, []); dates.get(d).push(s); }
  const byDate = [...dates.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, l]) => ({ date, ...metrics(l) }));

  // session-level rows for the CSV — no participant details, no lyric text
  const rows = list.slice().sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)).map((s) => ({
    id: s.id, date: localDate(s.startedAt), startedAt: s.startedAt, endedAt: s.endedAt || "", durationSec: s.durationSec || "",
    worker: nameOf(s.workerId), campus: s.campus || "", status: s.status, participation: s.participation || "",
    talk: s.talk ? s.talk.title || "" : "", speaker: s.talk ? s.talk.speaker || "" : "", existingSong: Boolean(s.songified && s.songified.existing),
    lyrics: Boolean(s.lyrics && s.lyrics.generated), song: Boolean(s.song && s.song.generated), played: Boolean(s.song && s.song.played),
    reaction: s.reaction || "", clips: (s.clips || []).filter((c) => c.status === "ready").length,
  }));

  return { from, to, workerId, totals: m, funnel: funnel(m), reactions, talks: talkList.slice(0, 25), unsongified, byWorker, byDate, rows };
}
