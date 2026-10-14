// src/campus/TalkSearch.jsx — "What was your favorite talk from October 2026
// General Conference?" Big tappable list of that conference's talks, searched
// by speaker, title, session or topic. Reuses the Studio's talk index (with
// its live top-up), the conference listing for session names, and the topic
// index for keyword matches.
import React, { useEffect, useMemo, useState } from "react";
import { loadTalksIndex, expectedConferences } from "../lib/talks-index.js";
import { conferenceSessions } from "./campus-api.js";

// The conference the experiment is about. Defaults to the most recent one.
export const CONFERENCE = { year: "2026", month: "10", label: "October 2026" };

export default function TalkSearch({ library, onPick }) {
  const [talks, setTalks] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [idx, sessions] = await Promise.all([loadTalksIndex(), conferenceSessions(CONFERENCE.year, CONFERENCE.month)]);
        const sessionOf = new Map();
        for (const s of sessions) for (const t of s.talks || []) sessionOf.set(t.slug, s.title);
        let topicsOf = new Map();
        try {
          const tp = await (await fetch("/topics-index.json", { cache: "force-cache" })).json();
          if (tp && tp.talkCount === idx.staticCount) {
            for (const topic of tp.topics || []) for (const i of topic.t || []) { if (!topicsOf.has(i)) topicsOf.set(i, []); topicsOf.get(i).push(topic.name); }
          }
        } catch {}
        const list = [];
        idx.talks.forEach((t, i) => {
          if (t.year !== CONFERENCE.year || t.month !== CONFERENCE.month) return;
          if (/sustaining|audit|statistical|solemn assembly/i.test(`${t.slug} ${t.title}`)) return;
          list.push({ ...t, session: sessionOf.get(t.slug) || "", topics: topicsOf.get(i) || [] });
        });
        if (alive) setTalks(list);
      } catch (e) {
        if (alive) setErr("Couldn't load the talk list — check the connection and try again.");
      }
    })();
    return () => { alive = false; };
  }, []);

  const results = useMemo(() => {
    if (!talks) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return talks;
    return talks.filter((t) => {
      const hay = `${t.title} ${t.speaker} ${t.session} ${t.topics.join(" ")}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [talks, q]);

  const songFor = (t) => library && (library.byUri.get(t.uri) || library.byTitle.get(library.norm(t.title)));

  return (
    <div>
      <label className="c-field">
        <span className="lbl">Search</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="speaker, title, session or topic…" autoFocus inputMode="search" />
      </label>
      {err && <div className="c-err">{err}</div>}
      {!talks && !err && <p className="c-note"><span className="c-spinner" />Loading the {CONFERENCE.label} talks…</p>}
      <div className="c-list">
        {results.map((t) => {
          const song = songFor(t);
          return (
            <button key={t.uri} className="c-talk" onClick={() => onPick(t, song || null)}>
              {song && <span className="tag">♪ has a song</span>}
              <div className="t">{t.title}</div>
              <div className="s">{t.speaker}{t.session ? ` · ${t.session.replace(/ Session$/i, "")}` : ""}</div>
            </button>
          );
        })}
        {talks && !results.length && <p className="c-note">No talk matches that. Try the speaker's last name.</p>}
      </div>
    </div>
  );
}
