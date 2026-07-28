// src/components/ProgressBoard.jsx
//
// 🏆 Progress: gamified visualization of the listener's journey through
// General Conference. Three lenses:
//   • Playlists in progress (position bars from the Continue-listening shelf)
//   • The whole body of conference talks — the "conference wall": one cell
//     per conference since 1971, glowing as it's completed; totals + streak
//   • The words of the apostles — per-apostle coverage bars across the
//     First Presidency and Quorum of the Twelve
// A talk counts as heard when its audio finished (or ≥92% was played).
// Clicking a conference cell queues that conference's talks — including a
// "finish what's left" nudge.

import React, { useMemo, useState } from "react";
import { APOSTLES } from "./AiTools.jsx";

const monthName = (m) => (String(m) === "10" ? "October" : "April");
const confNum = (y, m) => Number(y) * 100 + Number(m);

function Bar({ pct, label }) {
  return (
    <div className="prog-bar" title={label}>
      <div className="prog-bar-fill" style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} />
    </div>
  );
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// Consecutive-day listening streak ending today or yesterday.
function computeStreak(dates) {
  if (!dates.size) return 0;
  const today = new Date(new Date().toDateString()).getTime();
  let cursor = today;
  if (!dates.has(cursor)) {
    cursor -= 86400000; // streak may end yesterday and still be alive
    if (!dates.has(cursor)) return 0;
  }
  let streak = 0;
  while (dates.has(cursor)) {
    streak++;
    cursor -= 86400000;
  }
  return streak;
}

// One journal entry card: read, edit in place, play the talk, delete.
function JournalEntryCard({ e, onUpdate, onDelete, startUrisQueue, nowPlayingUri }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.text);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="journal-card">
      {editing ? (
        <>
          <textarea className="studio-input" value={text} onChange={(ev) => setText(ev.target.value)} />
          <div className="quote-actions" style={{ marginTop: 8 }}>
            <button
              className="picker-talk-listen"
              onClick={() => { onUpdate(e.id, text); setEditing(false); }}
            >
              ✓ Save
            </button>
            <button className="picker-talk-listen" onClick={() => { setText(e.text); setEditing(false); }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="journal-card-text">{e.text}</p>
          <div className="quote-cite">
            After “{e.title}” — <strong>{e.speaker}</strong>, {e.when} General Conference ·{" "}
            {new Date(e.at).toLocaleDateString()}
          </div>
          <div className="quote-actions">
            <button
              className="picker-talk-listen"
              onClick={() =>
                startUrisQueue({ id: `quote|${e.uri}`, label: e.title, uris: [e.uri], order: "newest" })
              }
            >
              {nowPlayingUri === e.uri ? "♪ Playing" : "▶ Hear it again"}
            </button>
            <button className="picker-talk-listen" onClick={() => setEditing(true)}>✎ Edit</button>
            {confirmDel ? (
              <button className="quote-del confirm" onClick={() => onDelete(e.id)}>Really delete?</button>
            ) : (
              <button
                className="quote-del"
                onClick={() => { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); }}
              >
                ✕
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function ProgressBoard({ index, listened, bookmarks, startUrisQueue, journal = [], onUpdateEntry, onDeleteEntry, nowPlayingUri }) {
  const [wallDecade, setWallDecade] = useState("all");
  const [journalQuery, setJournalQuery] = useState("");

  const stats = useMemo(() => {
    if (!index) return null;
    const talks = index.talks;
    const indexUris = new Set(talks.map((t) => t.uri));
    const heardUris = new Set([...Object.keys(listened)].filter((u) => indexUris.has(u)));

    // conference wall
    const confs = new Map(); // "1998-04" -> {year, month, total, heard, uris}
    for (const t of talks) {
      const key = `${t.year}-${t.month}`;
      if (!confs.has(key)) confs.set(key, { year: t.year, month: t.month, total: 0, heard: 0, uris: [] });
      const c = confs.get(key);
      c.total++;
      c.uris.push(t.uri);
      if (heardUris.has(t.uri)) c.heard++;
    }
    const wall = [...confs.values()].sort((a, b) => confNum(a.year, a.month) - confNum(b.year, b.month));
    const fullConfs = wall.filter((c) => c.heard === c.total).length;

    // apostles
    const bySpeaker = new Map();
    for (const t of talks) {
      if (!bySpeaker.has(t.speaker)) bySpeaker.set(t.speaker, { total: 0, heard: 0, uris: [] });
      const s = bySpeaker.get(t.speaker);
      s.total++;
      s.uris.push(t.uri);
      if (heardUris.has(t.uri)) s.heard++;
    }
    const apostles = APOSTLES.map(([name, from, to]) => ({
      name,
      serving: to === 9999,
      ...(bySpeaker.get(name) || { total: 0, heard: 0, uris: [] }),
    }))
      .filter((a) => a.total > 0)
      .sort((a, b) => b.heard / b.total - a.heard / a.total || b.total - a.total);
    const apTotal = apostles.reduce((n, a) => n + a.total, 0);
    const apHeard = apostles.reduce((n, a) => n + a.heard, 0);
    const fullSpeakers = apostles.filter((a) => a.heard === a.total && a.total >= 5).length;

    // streak + dates
    const dayset = new Set(
      Object.values(listened)
        .map((r) => r && r.at && new Date(new Date(r.at).toDateString()).getTime())
        .filter(Boolean)
    );
    const streak = computeStreak(dayset);

    // decades heard from
    const decadesHeard = new Set(
      talks.filter((t) => heardUris.has(t.uri)).map((t) => Math.floor(Number(t.year) / 10) * 10)
    );

    return {
      heard: heardUris.size,
      total: talks.length,
      wall,
      fullConfs,
      apostles,
      apTotal,
      apHeard,
      fullSpeakers,
      streak,
      listeningDays: dayset.size,
      decadesHeard: decadesHeard.size,
      heardUris,
    };
  }, [index, listened]);

  const playlists = useMemo(
    () =>
      Object.values(bookmarks || {})
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [bookmarks]
  );

  const shownEntries = useMemo(() => {
    const q = journalQuery.trim().toLowerCase();
    if (!q) return journal;
    return journal.filter((e) =>
      [e.text, e.speaker, e.title].join(" ").toLowerCase().includes(q)
    );
  }, [journal, journalQuery]);

  if (!stats) return <p className="note">Loading the talk archive…</p>;

  const pct = stats.total ? stats.heard / stats.total : 0;
  const talksJournaled = new Set(journal.map((e) => e.uri)).size;

  const badges = [
    { e: "✍️", label: "First journal entry", got: journal.length >= 1 },
    { e: "📔", label: "10 entries", got: journal.length >= 10 },
    { e: "📚", label: "50 entries", got: journal.length >= 50 },
    { e: "🕊", label: "100 entries", got: journal.length >= 100 },
    { e: "🌱", label: "First talk heard", got: stats.heard >= 1 },
    { e: "🔟", label: "10 talks", got: stats.heard >= 10 },
    { e: "🌟", label: "50 talks", got: stats.heard >= 50 },
    { e: "💯", label: "100 talks", got: stats.heard >= 100 },
    { e: "🏔", label: "500 talks", got: stats.heard >= 500 },
    { e: "👑", label: "1,000 talks", got: stats.heard >= 1000 },
    { e: "📅", label: "A full conference", got: stats.fullConfs >= 1 },
    { e: "🎓", label: "Every talk by one apostle", got: stats.fullSpeakers >= 1 },
    { e: "🔥", label: "7-day streak", got: stats.streak >= 7 },
    { e: "⚡", label: "30-day streak", got: stats.streak >= 30 },
    { e: "🕰", label: "Heard from every decade", got: stats.decadesHeard >= 6 },
  ];

  const decades = ["all", ...new Set(stats.wall.map((c) => `${Math.floor(Number(c.year) / 10) * 10}s`))];
  const wallShown =
    wallDecade === "all"
      ? stats.wall
      : stats.wall.filter((c) => `${Math.floor(Number(c.year) / 10) * 10}s` === wallDecade);

  function playConference(c) {
    const unheard = c.uris.filter((u) => !stats.heardUris.has(u));
    // c.uris are in the conference's session order (Saturday morning first).
    // The player treats "oldest" as reverse-of-canonical, so hand it the
    // reversed list — the reversal restores session order for playback.
    startUrisQueue({
      id: `conf|${c.year}-${c.month}`,
      label: `${monthName(c.month)} ${c.year} Conference${unheard.length && unheard.length < c.total ? " · what's left" : ""}`,
      uris: [...c.uris].reverse(),
      order: "oldest",
      startUri: unheard.length ? unheard[0] : undefined,
    });
  }

  return (
    <div className="picker-progress">
      {/* ---- Becoming: the point of it all ---- */}
      <p className="note">
        The talks teach the mind and will of God; the invitation is to
        <em> become</em>. Hearing is the journey — this journal is the
        destination: the changes you commit to make.
      </p>
      <div className="prog-headline">
        <div className="prog-big">
          <span className="prog-number">{journal.length.toLocaleString()}</span>
          <span className="prog-of">
            {" "}journal {journal.length === 1 ? "entry" : "entries"} · {talksJournaled} talk
            {talksJournaled === 1 ? "" : "s"} that changed you
          </span>
        </div>
        <div className="prog-substats">
          <span>🎧 {stats.heard.toLocaleString()} of {stats.total.toLocaleString()} talks heard ({(pct * 100).toFixed(1)}%)</span>
          {stats.streak > 0 && <span>🔥 {stats.streak}-day streak</span>}
          <span>📅 {stats.fullConfs} of {stats.wall.length} conferences completed</span>
          <span>🗓 {stats.listeningDays} listening day{stats.listeningDays === 1 ? "" : "s"}</span>
        </div>
      </div>

      {/* ---- the Becoming journal ---- */}
      <h3 className="prog-h">My Becoming journal</h3>
      {journal.length === 0 ? (
        <p className="note">
          While a talk plays, tap ✍️ on the player (or the 🌱 nudge when a talk
          ends) and answer one question: <em>“What did I learn that I need to
          apply to my life to become more like Christ?”</em> Your answers gather
          here.
        </p>
      ) : (
        <>
          {journal.length > 4 && (
            <input
              type="text"
              className="picker-search-input"
              style={{ marginBottom: 10 }}
              placeholder="Search your journal…"
              value={journalQuery}
              onChange={(e) => setJournalQuery(e.target.value)}
            />
          )}
          {shownEntries.map((e) => (
            <JournalEntryCard
              key={e.id}
              e={e}
              onUpdate={onUpdateEntry}
              onDelete={onDeleteEntry}
              startUrisQueue={startUrisQueue}
              nowPlayingUri={nowPlayingUri}
            />
          ))}
        </>
      )}

      {/* ---- milestones ---- */}
      <div className="prog-badges">
        {badges.map((b) => (
          <span key={b.label} className={`prog-badge ${b.got ? "got" : ""}`} title={b.label}>
            {b.e} {b.label}
          </span>
        ))}
      </div>

      {/* ---- playlists in progress ---- */}
      {playlists.length > 0 && (
        <>
          <h3 className="prog-h">Playlists in progress</h3>
          {playlists.map((bm) => (
            <div className="prog-playlist" key={bm.id}>
              <span className="prog-playlist-label">{bm.label}</span>
              <Bar pct={(bm.idx + 1) / bm.total} label={`talk ${bm.idx + 1} of ${bm.total}`} />
              <span className="prog-playlist-n">{bm.idx + 1}/{bm.total}</span>
            </div>
          ))}
        </>
      )}

      {/* ---- the conference wall ---- */}
      <h3 className="prog-h">The conference wall <span className="prog-hint">— every conference since 1971; tap one to listen (it queues what you haven't heard)</span></h3>
      <div className="topic-chips" style={{ marginBottom: 8 }}>
        {decades.map((d) => (
          <button
            key={d}
            className={`picker-example-chip ${wallDecade === d ? "active-chip" : ""}`}
            onClick={() => setWallDecade(d)}
          >
            {d === "all" ? "All years" : d}
          </button>
        ))}
      </div>
      <div className="prog-wall">
        {wallShown.map((c) => {
          const frac = c.total ? c.heard / c.total : 0;
          return (
            <button
              key={`${c.year}-${c.month}`}
              className={`prog-cell ${frac === 1 ? "full" : ""}`}
              style={{ "--fill": frac }}
              title={`${monthName(c.month)} ${c.year} — ${c.heard} of ${c.total} heard`}
              onClick={() => playConference(c)}
            >
              <span className="prog-cell-year">{String(c.year).slice(2)}{c.month === "04" ? "a" : "o"}</span>
            </button>
          );
        })}
      </div>

      {/* ---- the words of the apostles ---- */}
      <h3 className="prog-h">
        The words of the apostles
        <span className="prog-hint"> — your journey through each one's conference talks ({stats.apHeard.toLocaleString()} of {stats.apTotal.toLocaleString()} heard)</span>
      </h3>
      <Bar pct={stats.apTotal ? stats.apHeard / stats.apTotal : 0} label={`${stats.apHeard} of ${stats.apTotal}`} />
      <div className="prog-apostles">
        {stats.apostles.map((a) => (
          <div className="prog-apostle" key={a.name}>
            <button
              className="prog-apostle-name"
              title={`Listen to ${a.name}'s talks (oldest first)`}
              onClick={() =>
                startUrisQueue({
                  id: `sp|${a.name}|oldest`,
                  label: a.name,
                  uris: a.uris,
                  order: "oldest",
                })
              }
            >
              {a.serving ? "★ " : ""}{a.name}
            </button>
            <Bar pct={a.total ? a.heard / a.total : 0} label={`${a.heard} of ${a.total}`} />
            <span className="prog-apostle-n">
              {a.heard}/{a.total}{a.heard === a.total && a.total > 0 ? " ✓" : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        ★ = serving today. Listening history starts now — talks you finished
        before this feature existed aren't counted (listen again — it's good
        for the soul).
      </p>
    </div>
  );
}
