// src/components/ConferencePicker.jsx
//
// Step 0 of the studio: choose a conference and speaker, and the talk text
// loads itself into the Lyric Creator — no copying or pasting a link.
//
// Calls two Netlify Functions in this same site:
//   /.netlify/functions/list-conference  → sessions + speakers
//   /.netlify/functions/fetch-talk       → the chosen talk's text
//
// On success it calls onTalkLoaded({ text, title, speaker, sourceUrl }) and
// the parent moves the user to the Lyric Creator tab.

import React, { useState } from "react";

const YEARS = [];
for (let y = new Date().getFullYear(); y >= 1971; y--) YEARS.push(String(y));

export default function ConferencePicker({ onTalkLoaded }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("04");
  const [sessions, setSessions] = useState(null);
  const [sessionIdx, setSessionIdx] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | listing | listed | loadingTalk
  const [error, setError] = useState("");
  const [loadingSlug, setLoadingSlug] = useState("");

  async function loadConference() {
    setPhase("listing");
    setError("");
    setSessions(null);
    setSessionIdx(null);
    try {
      const res = await fetch("/.netlify/functions/list-conference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not load that conference.");
        setPhase("idle");
        return;
      }
      setSessions(data.sessions);
      setSessionIdx(data.sessions.length === 1 ? 0 : null);
      setPhase("listed");
    } catch {
      setError("Network problem loading the conference. Try again.");
      setPhase("idle");
    }
  }

  async function chooseTalk(talk) {
    setPhase("loadingTalk");
    setLoadingSlug(talk.slug);
    setError("");
    try {
      const res = await fetch("/.netlify/functions/fetch-talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: talk.uri }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not load that talk.");
        setPhase("listed");
        setLoadingSlug("");
        return;
      }
      const text = (data.paragraphs || []).join("\n\n");
      onTalkLoaded({
        text,
        title: data.title || talk.title || "",
        speaker: data.speaker || talk.speaker || "",
        sourceUrl: data.sourceUrl || talk.uri || "",
      });
    } catch {
      setError("Network problem loading the talk. Try again.");
      setPhase("listed");
      setLoadingSlug("");
    }
  }

  const activeSession =
    sessions && sessionIdx != null ? sessions[sessionIdx] : null;

  return (
    <section className="panel">
      <h2 className="panel-title">Choose a talk</h2>
      <p className="note">
        Pick the conference, open a session, and choose a speaker. The talk text
        loads straight into the Lyric Creator — no link to paste.
      </p>

      <div className="picker-controls">
        <label className="picker-field">
          <span className="picker-label">Year</span>
          <select
            className="picker-select"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setPhase("idle");
              setSessions(null);
            }}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <label className="picker-field">
          <span className="picker-label">Conference</span>
          <select
            className="picker-select"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPhase("idle");
              setSessions(null);
            }}
          >
            <option value="04">April</option>
            <option value="10">October</option>
          </select>
        </label>

        <button
          className="btn"
          onClick={loadConference}
          disabled={phase === "listing"}
        >
          {phase === "listing" ? "Loading…" : "Load conference"}
        </button>
      </div>

      {error && <div className="picker-error">{error}</div>}

      {sessions && (
        <div className="picker-sessions">
          {sessions.map((s, i) => (
            <button
              key={i}
              className={`picker-chip ${sessionIdx === i ? "active" : ""}`}
              onClick={() => setSessionIdx(i)}
            >
              {s.title}
              <span className="picker-chip-count">{s.talks.length}</span>
            </button>
          ))}
        </div>
      )}

      {sessions && sessionIdx == null && (
        <p className="note" style={{ fontStyle: "italic" }}>
          Pick a session above to see its speakers.
        </p>
      )}

      {activeSession && (
        <div className="picker-talks">
          {activeSession.talks.map((t) => {
            const isLoading = phase === "loadingTalk" && loadingSlug === t.slug;
            return (
              <button
                key={t.slug}
                className="picker-talk"
                onClick={() => chooseTalk(t)}
                disabled={phase === "loadingTalk"}
              >
                <span className="picker-talk-speaker">
                  {t.speaker || "Speaker"}
                </span>
                <span className="picker-talk-title">{t.title}</span>
                <span className="picker-talk-go">
                  {isLoading ? "Loading…" : "Make song →"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
