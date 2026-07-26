// src/components/ConferencePicker.jsx
//
// Step 0 of the studio: choose a talk. Two ways to find one:
//
//   • Search by speaker — type a name (e.g. "David A. Bednar") and see every
//     General Conference talk that person has given, across all years. Backed
//     by the static /talks-index.json (built by scripts/build-talk-index.js),
//     so filtering is instant with no network calls.
//   • Browse by conference — the original Year → Session → Speaker cascade,
//     powered by /.netlify/functions/list-conference.
//
// Either way, choosing a talk calls /.netlify/functions/fetch-talk to pull the
// text, then onTalkLoaded(...) and the parent moves to the Lyric Creator.

import React, { useEffect, useMemo, useRef, useState } from "react";

const YEARS = [];
for (let y = new Date().getFullYear(); y >= 1971; y--) YEARS.push(String(y));

const monthName = (m) => (String(m) === "10" ? "October" : "April");
const officialUrl = (uri) => `https://www.churchofjesuschrist.org${uri}?lang=eng`;

// A few well-known names to nudge first-time searchers.
const EXAMPLE_SPEAKERS = ["Bednar", "Holland", "Nelson", "Uchtdorf", "Eyring"];

export default function ConferencePicker({ onTalkLoaded }) {
  const [mode, setMode] = useState("speaker"); // "speaker" | "browse"

  // ---- talk being fetched (shared by both modes) ----
  const [loadingUri, setLoadingUri] = useState("");
  const [talkError, setTalkError] = useState("");

  // ---- speaker-search state ----
  const [index, setIndex] = useState(null);       // { talks: [...] } | null
  const [indexState, setIndexState] = useState("loading"); // loading | ready | error
  const [query, setQuery] = useState("");

  // ---- listen-queue (playlist) state ----
  // queue: the talks to play, already in play order. idx: current position.
  const [player, setPlayer] = useState(null); // {speaker, queue, idx, order} | null
  const [listenOrder, setListenOrder] = useState("newest"); // preferred direction
  const [playerStatus, setPlayerStatus] = useState("idle"); // idle | loading | playing | error
  const [playerError, setPlayerError] = useState("");
  const audioRef = useRef(null);
  const audioUrlCache = useRef(new Map()); // talk.uri -> mp3 url ("" = no audio)

  // Playback speed. Browsers reset playbackRate whenever a new src loads, so
  // playIndex re-applies speedRef after every track change; the ref keeps the
  // current value visible inside those async callbacks. Persisted so the
  // preference survives reloads.
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const [speed, setSpeed] = useState(() => {
    try {
      const s = parseFloat(localStorage.getItem("cac-listen-speed"));
      return SPEEDS.includes(s) ? s : 1;
    } catch {
      return 1;
    }
  });
  const speedRef = useRef(speed);

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speedRef.current) + 1) % SPEEDS.length];
    speedRef.current = next;
    setSpeed(next);
    const el = audioRef.current;
    if (el) el.playbackRate = next;
    try { localStorage.setItem("cac-listen-speed", String(next)); } catch {}
  }

  // ---- browse-by-conference state ----
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("04");
  const [sessions, setSessions] = useState(null);
  const [sessionIdx, setSessionIdx] = useState(null);
  const [phase, setPhase] = useState("idle");     // idle | listing | listed
  const [browseError, setBrowseError] = useState("");

  // Load the speaker index once (small static file, cached by the browser).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/talks-index.json", { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        setIndex(data);
        setIndexState("ready");
      } catch {
        if (alive) setIndexState("error");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Group matching talks by speaker. Talks in the index are already sorted
  // newest-first, so each speaker's list comes out newest-first too.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!index || q.length < 2) return null;
    const byName = new Map();
    for (const t of index.talks) {
      if (!t.speaker.toLowerCase().includes(q)) continue;
      if (!byName.has(t.speaker)) byName.set(t.speaker, []);
      byName.get(t.speaker).push(t);
    }
    const groups = [...byName.entries()]
      .map(([speaker, talks]) => ({ speaker, talks }))
      .sort((a, b) => a.speaker.localeCompare(b.speaker));
    const total = groups.reduce((n, g) => n + g.talks.length, 0);
    return { groups, total };
  }, [index, query]);

  async function loadConference() {
    setPhase("listing");
    setBrowseError("");
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
        setBrowseError(data.error || "Could not load that conference.");
        setPhase("idle");
        return;
      }
      setSessions(data.sessions);
      setSessionIdx(data.sessions.length === 1 ? 0 : null);
      setPhase("listed");
    } catch {
      setBrowseError("Network problem loading the conference. Try again.");
      setPhase("idle");
    }
  }

  // Load a talk's text and hand it to the parent. Works for both a browse
  // talk (year/month come from the dropdowns) and a speaker-search talk
  // (year/month/session ride along on the talk object).
  async function chooseTalk(talk) {
    const talkYear = talk.year || year;
    const talkMonth = talk.month || month;
    const talkSession = talk.year
      ? ""
      : (sessions && sessionIdx != null ? sessions[sessionIdx].title : "");
    setLoadingUri(talk.uri);
    setTalkError("");
    try {
      const res = await fetch("/.netlify/functions/fetch-talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: talk.uri }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTalkError(data.error || "Could not load that talk.");
        setLoadingUri("");
        return;
      }
      const text = (data.paragraphs || []).join("\n\n");
      onTalkLoaded({
        text,
        title: data.title || talk.title || "",
        speaker: data.speaker || talk.speaker || "",
        speakerTitle: data.speakerTitle || "",
        year: talkYear,
        month: talkMonth,
        session: talkSession,
        sourceUrl: data.sourceUrl || officialUrl(talk.uri),
      });
    } catch {
      setTalkError("Network problem loading the talk. Try again.");
      setLoadingUri("");
    }
  }

  // ---- listening: resolve a talk's official MP3 (cached per session) ----
  async function getAudioUrl(talk) {
    const cached = audioUrlCache.current.get(talk.uri);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch("/.netlify/functions/fetch-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: talk.uri }),
      });
      const data = await res.json();
      const url = res.ok ? data.audioUrl || "" : "";
      audioUrlCache.current.set(talk.uri, url);
      return url;
    } catch {
      return ""; // network hiccup — treat as unavailable, don't cache
    }
  }

  // Start listening to `talks` (already in play order) at position `idx`.
  function startQueue(speaker, talks, idx, order) {
    setListenOrder(order);
    setPlayer({ speaker, queue: talks, idx, order });
    playIndex(talks, idx, speaker, order);
  }

  // Per-talk ▶: play this talk, then continue through the speaker's list in
  // the last-chosen direction (newest→oldest by default).
  function listenFromTalk(group, talk) {
    const queue = listenOrder === "newest" ? group.talks : [...group.talks].reverse();
    const idx = queue.findIndex((t) => t.uri === talk.uri);
    startQueue(group.speaker, queue, Math.max(0, idx), listenOrder);
  }

  // Load and play queue[idx]; on missing audio, slide forward to the next
  // talk that has a recording (rare, but some very old items lack audio).
  async function playIndex(queue, idx, speaker, order) {
    if (idx < 0 || idx >= queue.length) {
      setPlayerStatus("idle");
      return;
    }
    setPlayerStatus("loading");
    setPlayerError("");
    for (let i = idx; i < queue.length; i++) {
      const url = await getAudioUrl(queue[i]);
      if (url) {
        setPlayer({ speaker, queue, idx: i, order });
        const el = audioRef.current;
        if (el) {
          el.src = url;
          el.playbackRate = speedRef.current;
          try {
            await el.play();
            setPlayerStatus("playing");
          } catch {
            // Autoplay was blocked — leave the loaded track paused; the user
            // can press play on the bar's controls.
            setPlayerStatus("playing");
          }
        }
        // Quietly resolve the next track's URL so auto-advance is seamless.
        if (queue[i + 1]) getAudioUrl(queue[i + 1]);
        return;
      }
      setPlayerError(`No recording for “${queue[i].title}” — skipped.`);
    }
    setPlayerStatus("error");
    setPlayerError("Ran out of talks with audio recordings.");
  }

  function playerStep(delta) {
    if (!player) return;
    const next = player.idx + delta;
    if (next < 0 || next >= player.queue.length) return;
    playIndex(player.queue, next, player.speaker, player.order);
  }

  function closePlayer() {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setPlayer(null);
    setPlayerStatus("idle");
    setPlayerError("");
  }

  const nowPlaying = player ? player.queue[player.idx] : null;

  const activeSession =
    sessions && sessionIdx != null ? sessions[sessionIdx] : null;
  const busy = Boolean(loadingUri);

  return (
    <section className="panel">
      <h2 className="panel-title">Choose a talk</h2>

      <div className="picker-mode">
        <button
          className={`picker-mode-btn ${mode === "speaker" ? "active" : ""}`}
          onClick={() => setMode("speaker")}
        >
          Search by speaker
        </button>
        <button
          className={`picker-mode-btn ${mode === "browse" ? "active" : ""}`}
          onClick={() => setMode("browse")}
        >
          Browse by conference
        </button>
      </div>

      {talkError && <div className="picker-error">{talkError}</div>}

      {/* ------------------- SEARCH BY SPEAKER ------------------- */}
      {mode === "speaker" && (
        <div className="picker-speaker">
          <p className="note">
            Type a speaker’s name to see every General Conference talk they’ve
            given, newest first. Pick one to turn it into a song — or open it to
            read.
          </p>

          <label className="picker-field" style={{ width: "100%" }}>
            <span className="picker-label">Speaker</span>
            <input
              type="text"
              className="picker-search-input"
              placeholder="e.g. David A. Bednar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              disabled={indexState !== "ready"}
            />
          </label>

          {indexState === "loading" && (
            <p className="note" style={{ fontStyle: "italic" }}>
              Loading the talk archive…
            </p>
          )}
          {indexState === "error" && (
            <div className="picker-error">
              Couldn’t load the talk archive. Refresh the page to try again.
            </div>
          )}

          {indexState === "ready" && query.trim().length < 2 && (
            <div className="picker-examples">
              <span className="note" style={{ border: "none", padding: 0, margin: 0 }}>
                Try:
              </span>
              {EXAMPLE_SPEAKERS.map((name) => (
                <button
                  key={name}
                  className="picker-example-chip"
                  onClick={() => setQuery(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {results && results.groups.length === 0 && (
            <p className="note">No speakers match “{query.trim()}”.</p>
          )}

          {results && results.groups.length > 0 && (
            <>
              <p className="picker-result-count">
                {results.total} talk{results.total === 1 ? "" : "s"} by{" "}
                {results.groups.length} speaker
                {results.groups.length === 1 ? "" : "s"}
              </p>
              {results.groups.map((g) => (
                <div className="picker-speaker-group" key={g.speaker}>
                  <div className="picker-group-head">
                    <span className="picker-group-name">{g.speaker}</span>
                    <span className="picker-chip-count">{g.talks.length}</span>
                    <span className="picker-listen-btns">
                      <button
                        className="picker-listen-btn"
                        title="Play every talk in a row, starting with the most recent"
                        onClick={() => startQueue(g.speaker, g.talks, 0, "newest")}
                      >
                        ▶ Listen: newest → oldest
                      </button>
                      <button
                        className="picker-listen-btn"
                        title="Play every talk in a row, starting with the earliest"
                        onClick={() =>
                          startQueue(g.speaker, [...g.talks].reverse(), 0, "oldest")
                        }
                      >
                        ▶ Oldest → newest
                      </button>
                    </span>
                  </div>
                  <div className="picker-talks">
                    {g.talks.map((t) => {
                      const isLoading = loadingUri === t.uri;
                      return (
                        <div className="picker-talk static" key={t.uri}>
                          <span className="picker-talk-speaker">
                            {monthName(t.month)} {t.year}
                          </span>
                          <span className="picker-talk-title">{t.title}</span>
                          <span className="picker-talk-actions">
                            <button
                              className="picker-talk-listen"
                              title="Listen from this talk onward"
                              onClick={() => listenFromTalk(g, t)}
                            >
                              {nowPlaying && nowPlaying.uri === t.uri
                                ? "♪ Playing"
                                : "▶ Listen"}
                            </button>
                            <a
                              className="picker-talk-read"
                              href={officialUrl(t.uri)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Read ↗
                            </a>
                            <button
                              className="picker-talk-make"
                              onClick={() => chooseTalk(t)}
                              disabled={busy}
                            >
                              {isLoading ? "Loading…" : "Make song →"}
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ------------------- BROWSE BY CONFERENCE ------------------- */}
      {mode === "browse" && (
        <div className="picker-browse">
          <p className="note">
            Pick the conference, open a session, and choose a speaker.
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

            <button className="btn" onClick={loadConference} disabled={phase === "listing"}>
              {phase === "listing" ? "Loading…" : "Load conference"}
            </button>
          </div>

          {browseError && <div className="picker-error">{browseError}</div>}

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
                const isLoading = loadingUri === t.uri;
                return (
                  <button
                    key={t.slug}
                    className="picker-talk"
                    onClick={() => chooseTalk(t)}
                    disabled={busy}
                  >
                    <span className="picker-talk-speaker">{t.speaker || "Speaker"}</span>
                    <span className="picker-talk-title">{t.title}</span>
                    <span className="picker-talk-go">
                      {isLoading ? "Loading…" : "Make song →"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------- LISTEN BAR (playlist player) ------------------- */}
      {/* Always mounted so the <audio> element (and playback) survives
          re-renders; hidden until a queue is started. */}
      <div className="listen-bar" style={{ display: player ? "flex" : "none" }}>
        {nowPlaying && (
          <div className="listen-info">
            <span className="listen-speaker">{player.speaker}</span>
            <span className="listen-title">{nowPlaying.title}</span>
            <span className="listen-when">
              {monthName(nowPlaying.month)} {nowPlaying.year}
              {" · "}{player.idx + 1} of {player.queue.length}
              {" · "}{player.order === "newest" ? "newest → oldest" : "oldest → newest"}
              {playerStatus === "loading" ? " · loading…" : ""}
            </span>
            {playerError && <span className="listen-note">{playerError}</span>}
          </div>
        )}
        <div className="listen-controls">
          <button
            className="listen-btn"
            title="Previous talk"
            onClick={() => playerStep(-1)}
            disabled={!player || player.idx === 0}
          >
            ⏮
          </button>
          <audio
            ref={audioRef}
            controls
            preload="none"
            className="listen-audio"
            onEnded={() => playerStep(1)}
          />
          <button
            className="listen-btn"
            title="Next talk"
            onClick={() => playerStep(1)}
            disabled={!player || player.idx >= player.queue.length - 1}
          >
            ⏭
          </button>
          <button
            className="listen-btn listen-speed"
            title="Playback speed — click to change"
            onClick={cycleSpeed}
          >
            {speed}×
          </button>
          <button className="listen-btn listen-close" title="Stop listening" onClick={closePlayer}>
            ✕
          </button>
        </div>
      </div>
    </section>
  );
}
