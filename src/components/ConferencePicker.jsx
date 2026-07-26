// src/components/ConferencePicker.jsx
//
// Step 0 of the studio: choose a talk — or just listen. Three ways in:
//
//   • Search by speaker — type a name and see every General Conference talk
//     that person has given, across all years (static /talks-index.json).
//   • By topic — pick one of the Church's ~335 curated conference topics,
//     optionally limit the timeframe (a president's era or a custom year
//     range), and get a playlist of every matching talk
//     (static /topics-index.json).
//   • Browse by conference — the original Year → Session → Speaker cascade.
//
// Listening: any list can play straight through, newest→oldest or
// oldest→newest, auto-advancing between talks. Every playlist's position
// (current talk + seconds in) is auto-saved in the browser, and the
// "Continue listening" shelf resumes any of them right where you left off.
//
// Choosing "Make song →" still calls /.netlify/functions/fetch-talk and
// hands the text to the Lyric Creator, unchanged.

import React, { useEffect, useMemo, useRef, useState } from "react";

const YEARS = [];
for (let y = new Date().getFullYear(); y >= 1971; y--) YEARS.push(String(y));

const monthName = (m) => (String(m) === "10" ? "October" : "April");
const officialUrl = (uri) => `https://www.churchofjesuschrist.org${uri}?lang=eng`;

// A few well-known names to nudge first-time searchers.
const EXAMPLE_SPEAKERS = ["Bednar", "Holland", "Nelson", "Uchtdorf", "Eyring"];

// Conference-number helper: April 1995 -> 199504, for range comparisons.
const confNum = (year, month) => Number(year) * 100 + Number(month);

// Church presidencies, expressed as the conferences that fell within each —
// the online archive starts April 1971. `to: null` = present.
const PRESIDENCIES = [
  { key: "jfsmith", label: "Pres. Joseph Fielding Smith (1971–1972)", from: 197104, to: 197204 },
  { key: "lee", label: "Pres. Harold B. Lee (1972–1973)", from: 197210, to: 197310 },
  { key: "kimball", label: "Pres. Spencer W. Kimball (1974–1985)", from: 197404, to: 198510 },
  { key: "benson", label: "Pres. Ezra Taft Benson (1986–1994)", from: 198604, to: 199404 },
  { key: "hunter", label: "Pres. Howard W. Hunter (1994)", from: 199410, to: 199410 },
  { key: "hinckley", label: "Pres. Gordon B. Hinckley (1995–2007)", from: 199504, to: 200710 },
  { key: "monson", label: "Pres. Thomas S. Monson (2008–2017)", from: 200804, to: 201710 },
  { key: "nelson", label: "Pres. Russell M. Nelson (2018–present)", from: 201804, to: null },
];

// Some topic names arrive all-lowercase from the source page (its CSS
// capitalizes them visually) — do the same normalization here.
function prettyTopicName(name) {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- saved listening positions ("Continue listening") ----
const BM_KEY = "cac-listen-bookmarks";
const DEL_KEY = "cac-listen-deleted"; // tombstones so deletions sync too
const SYNC_CODE_KEY = "cac-sync-code";
function loadBookmarksFromStorage() {
  try {
    const o = JSON.parse(localStorage.getItem(BM_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function loadDeletedFromStorage() {
  try {
    const o = JSON.parse(localStorage.getItem(DEL_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function fmtTime(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function ConferencePicker({ onTalkLoaded }) {
  const [mode, setMode] = useState("speaker"); // "speaker" | "topic" | "browse"

  // ---- talk being fetched for Make song (shared by all modes) ----
  const [loadingUri, setLoadingUri] = useState("");
  const [talkError, setTalkError] = useState("");

  // ---- speaker-search state ----
  const [index, setIndex] = useState(null);       // { talks: [...] } | null
  const [indexState, setIndexState] = useState("loading"); // loading | ready | error
  const [query, setQuery] = useState("");

  // ---- topic state ----
  const [topicsIdx, setTopicsIdx] = useState(null);   // { talkCount, topics } | null
  const [topicsState, setTopicsState] = useState("idle"); // idle | loading | ready | error
  const [topicQuery, setTopicQuery] = useState("");
  const [topicSlug, setTopicSlug] = useState(null);
  const [tfKey, setTfKey] = useState("all");          // "all" | presidency key | "custom"
  const [tfFrom, setTfFrom] = useState("1990");
  const [tfTo, setTfTo] = useState("1994");

  // ---- listen-queue (playlist) state ----
  // player: {id, label, queue, idx, order, spec} — spec is enough to rebuild
  // the queue later for resume (kind: 'speaker'|'topic' + its parameters).
  const [player, setPlayer] = useState(null);
  const [playerStatus, setPlayerStatus] = useState("idle"); // idle | loading | playing | error
  const [playerError, setPlayerError] = useState("");
  const audioRef = useRef(null);
  const audioUrlCache = useRef(new Map()); // talk.uri -> mp3 url ("" = no audio)
  const playerRef = useRef(null);
  useEffect(() => { playerRef.current = player; }, [player]);

  // ---- saved positions (bookmarks) ----
  const [bookmarks, setBookmarks] = useState(loadBookmarksFromStorage);
  const lastBmSaveRef = useRef(0);

  function persistBookmarks(next) {
    setBookmarks(next);
    try { localStorage.setItem(BM_KEY, JSON.stringify(next)); } catch {}
    schedulePush();
  }

  // Snapshot the current playlist position into its bookmark.
  function writeBookmark(secondsOverride) {
    const p = playerRef.current;
    const el = audioRef.current;
    if (!p || !p.id) return;
    const t = p.queue[p.idx];
    if (!t) return;
    const bm = {
      id: p.id,
      label: p.label,
      order: p.order,
      spec: p.spec,
      uri: t.uri,
      idx: p.idx,
      total: p.queue.length,
      seconds: secondsOverride !== undefined ? secondsOverride : (el ? el.currentTime : 0),
      talkTitle: t.title,
      talkWhen: `${monthName(t.month)} ${t.year}`,
      updatedAt: Date.now(),
    };
    persistBookmarks({ ...loadBookmarksFromStorage(), [bm.id]: bm });
  }

  function removeBookmark(id) {
    const next = { ...loadBookmarksFromStorage() };
    delete next[id];
    // Leave a dated tombstone so the deletion wins on other devices too.
    try {
      const del = loadDeletedFromStorage();
      del[id] = Date.now();
      localStorage.setItem(DEL_KEY, JSON.stringify(del));
    } catch {}
    persistBookmarks(next);
    // Removing the card of the playlist that's playing also stops it —
    // otherwise the auto-save would quietly recreate the card.
    const p = playerRef.current;
    if (p && p.id === id) closePlayer(true);
  }

  // ---- cross-device sync (private code + /sync function) ----
  const [syncCode, setSyncCode] = useState(() => {
    try { return localStorage.getItem(SYNC_CODE_KEY) || ""; } catch { return ""; }
  });
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncInput, setSyncInput] = useState("");
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | working | ok | error
  const [syncError, setSyncError] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const syncCodeRef = useRef(syncCode);
  useEffect(() => { syncCodeRef.current = syncCode; }, [syncCode]);
  const syncBusyRef = useRef(false);
  const pushTimerRef = useRef(null);

  function gatherSyncState() {
    let speedAt = 0;
    try { speedAt = parseInt(localStorage.getItem("cac-listen-speed-at") || "0", 10) || 0; } catch {}
    return {
      bookmarks: loadBookmarksFromStorage(),
      deleted: loadDeletedFromStorage(),
      speed: speedRef.current,
      speedUpdatedAt: speedAt,
    };
  }

  // Apply the server's merged state locally (without re-scheduling a push).
  function applySyncState(state) {
    if (!state) return;
    try { localStorage.setItem(BM_KEY, JSON.stringify(state.bookmarks || {})); } catch {}
    try { localStorage.setItem(DEL_KEY, JSON.stringify(state.deleted || {})); } catch {}
    setBookmarks(state.bookmarks || {});
    let localSpeedAt = 0;
    try { localSpeedAt = parseInt(localStorage.getItem("cac-listen-speed-at") || "0", 10) || 0; } catch {}
    if (
      typeof state.speed === "number" &&
      SPEEDS.includes(state.speed) &&
      (state.speedUpdatedAt || 0) > localSpeedAt
    ) {
      speedRef.current = state.speed;
      setSpeed(state.speed);
      const el = audioRef.current;
      if (el) el.playbackRate = state.speed;
      try {
        localStorage.setItem("cac-listen-speed", String(state.speed));
        localStorage.setItem("cac-listen-speed-at", String(state.speedUpdatedAt || 0));
      } catch {}
    }
  }

  async function runSync(codeOverride) {
    const code = (codeOverride || syncCodeRef.current || "").trim().toLowerCase();
    if (!code || syncBusyRef.current) return false;
    syncBusyRef.current = true;
    setSyncStatus("working");
    setSyncError("");
    try {
      const res = await fetch("/.netlify/functions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", code, state: gatherSyncState() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncStatus("error");
        setSyncError(data.error || "Sync failed.");
        return false;
      }
      applySyncState(data.state);
      setSyncStatus("ok");
      setLastSyncAt(Date.now());
      return true;
    } catch {
      setSyncStatus("error");
      setSyncError("Network problem while syncing.");
      return false;
    } finally {
      syncBusyRef.current = false;
    }
  }

  // Push soon after local changes — at most one request per 10 seconds even
  // while auto-saves stream in during playback.
  function schedulePush() {
    if (!syncCodeRef.current || pushTimerRef.current) return;
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      runSync();
    }, 10000);
  }

  async function createSyncCode() {
    setSyncStatus("working");
    setSyncError("");
    try {
      const res = await fetch("/.netlify/functions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", state: gatherSyncState() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncStatus("error");
        setSyncError(data.error || "Couldn’t create a sync code.");
        return;
      }
      setSyncCode(data.code);
      syncCodeRef.current = data.code;
      try { localStorage.setItem(SYNC_CODE_KEY, data.code); } catch {}
      applySyncState(data.state);
      setSyncStatus("ok");
      setLastSyncAt(Date.now());
    } catch {
      setSyncStatus("error");
      setSyncError("Network problem while creating the code.");
    }
  }

  async function connectSyncCode() {
    const code = syncInput.trim().toLowerCase();
    if (!code) return;
    const ok = await runSync(code);
    if (ok) {
      setSyncCode(code);
      syncCodeRef.current = code;
      try { localStorage.setItem(SYNC_CODE_KEY, code); } catch {}
      setSyncInput("");
    }
  }

  function disconnectSync() {
    setSyncCode("");
    syncCodeRef.current = "";
    try { localStorage.removeItem(SYNC_CODE_KEY); } catch {}
    setSyncStatus("idle");
    setSyncError("");
  }

  // Sync on arrival, and whenever the tab regains focus (that's the moment
  // you switch from laptop to phone or back).
  useEffect(() => {
    if (syncCodeRef.current) runSync();
    let lastFocusSync = Date.now();
    const onFocus = () => {
      if (!syncCodeRef.current) return;
      if (Date.now() - lastFocusSync < 10000) return;
      lastFocusSync = Date.now();
      runSync();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Playback speed. Browsers reset playbackRate whenever a new src loads, so
  // startPlayback re-applies speedRef after every track change; persisted so
  // the preference survives reloads.
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
    try {
      localStorage.setItem("cac-listen-speed", String(next));
      localStorage.setItem("cac-listen-speed-at", String(Date.now()));
    } catch {}
    schedulePush();
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

  // Topics load lazily, the first time they're needed.
  const topicsPromiseRef = useRef(null);
  function loadTopics() {
    if (topicsPromiseRef.current) return topicsPromiseRef.current;
    setTopicsState("loading");
    topicsPromiseRef.current = (async () => {
      try {
        const res = await fetch("/topics-index.json", { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        data.topics = (data.topics || []).map((t) => ({ ...t, name: prettyTopicName(t.name) }));
        data.topics.sort((a, b) => a.name.localeCompare(b.name));
        setTopicsIdx(data);
        setTopicsState("ready");
        return data;
      } catch {
        setTopicsState("error");
        topicsPromiseRef.current = null;
        return null;
      }
    })();
    return topicsPromiseRef.current;
  }
  useEffect(() => {
    if (mode === "topic" && !topicsIdx) loadTopics();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- topic derivations ----
  const topicMatches = useMemo(() => {
    if (!topicsIdx) return [];
    const q = topicQuery.trim().toLowerCase();
    const list = q
      ? topicsIdx.topics.filter((t) => t.name.toLowerCase().includes(q))
      : topicsIdx.topics;
    return list.slice(0, 40);
  }, [topicsIdx, topicQuery]);

  const selectedTopic = useMemo(
    () => (topicsIdx && topicSlug ? topicsIdx.topics.find((t) => t.slug === topicSlug) : null),
    [topicsIdx, topicSlug]
  );

  // Current timeframe as numeric conference bounds (inclusive).
  const timeframe = useMemo(() => {
    if (tfKey === "all") return { from: 0, to: 999912, label: "all years", key: "all" };
    if (tfKey === "custom") {
      const f = parseInt(tfFrom, 10);
      const t = parseInt(tfTo, 10);
      const from = Number.isFinite(f) ? f * 100 : 0;
      const to = Number.isFinite(t) ? t * 100 + 12 : 999912;
      return { from, to, label: `${tfFrom || "…"}–${tfTo || "…"}`, key: `${tfFrom}-${tfTo}` };
    }
    const p = PRESIDENCIES.find((x) => x.key === tfKey);
    if (!p) return { from: 0, to: 999912, label: "all years", key: "all" };
    return { from: p.from, to: p.to ?? 999912, label: p.label, key: p.key };
  }, [tfKey, tfFrom, tfTo]);

  // Resolve a topic (by slug) + numeric bounds into a newest-first talk list.
  function topicTalksFor(slug, fromNum, toNum, data) {
    const src = data || topicsIdx;
    if (!src || !index) return [];
    const topic = src.topics.find((t) => t.slug === slug);
    if (!topic) return [];
    const talks = [];
    for (const i of topic.t) {
      const talk = index.talks[i];
      if (!talk) continue; // topics file out of step with talks file — skip
      const n = confNum(talk.year, talk.month);
      if (n < fromNum || n > toNum) continue;
      talks.push(talk);
    }
    talks.sort((a, b) => confNum(b.year, b.month) - confNum(a.year, a.month));
    return talks;
  }

  const topicTalks = useMemo(
    () => (selectedTopic ? topicTalksFor(selectedTopic.slug, timeframe.from, timeframe.to) : []),
    [selectedTopic, timeframe, index, topicsIdx] // eslint-disable-line react-hooks/exhaustive-deps
  );

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

  // Load a talk's text and hand it to the parent (the Make-song flow).
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

  // Start (or resume) playback of queue[idx]. startAt seeks into the first
  // track (used by resume). On missing audio, slides forward to the next
  // talk that has a recording.
  async function startPlayback({ id, label, queue, idx, order, spec, startAt = 0 }) {
    if (idx < 0 || idx >= queue.length) {
      setPlayerStatus("idle");
      return;
    }
    // Switching away from another playlist? Save its exact spot first.
    const prev = playerRef.current;
    if (prev && prev.id !== id) writeBookmark();
    setPlayer({ id, label, queue, idx, order, spec });
    setPlayerStatus("loading");
    setPlayerError("");
    for (let i = idx; i < queue.length; i++) {
      const url = await getAudioUrl(queue[i]);
      if (url) {
        setPlayer({ id, label, queue, idx: i, order, spec });
        playerRef.current = { id, label, queue, idx: i, order, spec };
        const el = audioRef.current;
        if (el) {
          el.src = url;
          el.playbackRate = speedRef.current;
          const seekTo = i === idx ? startAt : 0;
          if (seekTo > 1) {
            el.addEventListener(
              "loadedmetadata",
              () => { try { el.currentTime = seekTo; } catch {} },
              { once: true }
            );
          }
          try {
            await el.play();
            setPlayerStatus("playing");
          } catch {
            // Autoplay was blocked — leave the track loaded and paused; the
            // user can press play on the bar's controls.
            setPlayerStatus("playing");
          }
        }
        writeBookmark(i === idx ? startAt : 0);
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
    const p = playerRef.current;
    if (!p) return;
    const next = p.idx + delta;
    if (next < 0 || next >= p.queue.length) return;
    startPlayback({ ...p, idx: next });
  }

  // A talk finished. Advance — or, at the end of the queue, celebrate: the
  // playlist is done, so its saved position is cleared.
  function handleEnded() {
    const p = playerRef.current;
    if (!p) return;
    if (p.idx + 1 < p.queue.length) {
      playerStep(1);
    } else {
      const next = { ...loadBookmarksFromStorage() };
      delete next[p.id];
      persistBookmarks(next);
      closePlayer(true);
    }
  }

  // Ongoing auto-save: every few seconds of listening, remember the spot.
  function handleTimeUpdate() {
    const now = Date.now();
    if (now - lastBmSaveRef.current < 5000) return;
    lastBmSaveRef.current = now;
    writeBookmark();
  }

  function closePlayer(skipBookmark) {
    if (!skipBookmark) writeBookmark(); // closing keeps your place
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setPlayer(null);
    playerRef.current = null;
    setPlayerStatus("idle");
    setPlayerError("");
  }

  // ---- queue starters ----

  // Speaker queue. If this exact playlist (speaker + direction) has a saved
  // position, the group button resumes it instead of starting over.
  function startSpeakerQueue(group, order) {
    const queue = order === "newest" ? group.talks : [...group.talks].reverse();
    const id = `sp|${group.speaker}|${order}`;
    const bm = bookmarks[id];
    if (bm) {
      resumeBookmark(bm);
      return;
    }
    startPlayback({
      id,
      label: group.speaker,
      queue,
      idx: 0,
      order,
      spec: { kind: "speaker", speaker: group.speaker },
    });
  }

  // Per-talk ▶: play this talk, then continue through the list in the given
  // order (defaults to newest→oldest).
  function listenFromTalk(group, talk) {
    const order = "newest";
    const queue = group.talks;
    const idx = Math.max(0, queue.findIndex((t) => t.uri === talk.uri));
    startPlayback({
      id: `sp|${group.speaker}|${order}`,
      label: group.speaker,
      queue,
      idx,
      order,
      spec: { kind: "speaker", speaker: group.speaker },
    });
  }

  function startTopicQueue(order) {
    if (!selectedTopic || !topicTalks.length) return;
    const queue = order === "newest" ? topicTalks : [...topicTalks].reverse();
    const id = `tp|${selectedTopic.slug}|${timeframe.key}|${order}`;
    const bm = bookmarks[id];
    if (bm) {
      resumeBookmark(bm);
      return;
    }
    startPlayback({
      id,
      label: `${selectedTopic.name} · ${timeframe.label}`,
      queue,
      idx: 0,
      order,
      spec: {
        kind: "topic",
        slug: selectedTopic.slug,
        from: timeframe.from,
        to: timeframe.to,
        tfLabel: timeframe.label,
        tfKey: timeframe.key,
        name: selectedTopic.name,
      },
    });
  }

  function listenFromTopicTalk(talk) {
    if (!selectedTopic) return;
    const order = "newest";
    const idx = Math.max(0, topicTalks.findIndex((t) => t.uri === talk.uri));
    startPlayback({
      id: `tp|${selectedTopic.slug}|${timeframe.key}|${order}`,
      label: `${selectedTopic.name} · ${timeframe.label}`,
      queue: topicTalks,
      idx,
      order,
      spec: {
        kind: "topic",
        slug: selectedTopic.slug,
        from: timeframe.from,
        to: timeframe.to,
        tfLabel: timeframe.label,
        tfKey: timeframe.key,
        name: selectedTopic.name,
      },
    });
  }

  // Rebuild a saved playlist from its spec and pick up where it left off.
  async function resumeBookmark(bm) {
    if (!index) return;
    let queue = [];
    if (bm.spec.kind === "speaker") {
      const talks = index.talks.filter((t) => t.speaker === bm.spec.speaker);
      queue = bm.order === "newest" ? talks : talks.reverse();
    } else if (bm.spec.kind === "topic") {
      const data = topicsIdx || (await loadTopics());
      if (!data) {
        setTalkError("Couldn’t load the topic index to resume that playlist.");
        return;
      }
      const talks = topicTalksFor(bm.spec.slug, bm.spec.from, bm.spec.to, data);
      queue = bm.order === "newest" ? talks : talks.reverse();
    }
    if (!queue.length) return;
    // Find the saved talk by its link — robust even after the index gains
    // new conferences; fall back to the saved position, then the start.
    let idx = queue.findIndex((t) => t.uri === bm.uri);
    let startAt = Math.max(0, (bm.seconds || 0) - 3); // rewind 3s for context
    if (idx < 0) {
      idx = Math.min(bm.idx || 0, queue.length - 1);
      startAt = 0;
    }
    startPlayback({
      id: bm.id,
      label: bm.label,
      queue,
      idx,
      order: bm.order,
      spec: bm.spec,
      startAt,
    });
  }

  const nowPlaying = player ? player.queue[player.idx] : null;

  // Continue-listening shelf: most recent first; hide the one that's
  // actively playing (its live position is on the player bar already).
  const shelf = useMemo(() => {
    return Object.values(bookmarks)
      .filter((bm) => !player || bm.id !== player.id)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [bookmarks, player]);

  const activeSession =
    sessions && sessionIdx != null ? sessions[sessionIdx] : null;
  const busy = Boolean(loadingUri);

  // Shared renderer for a listenable talk row.
  function talkRow(t, { subtitle, onListen }) {
    const isLoading = loadingUri === t.uri;
    return (
      <div className="picker-talk static" key={t.uri}>
        <span className="picker-talk-speaker">{subtitle}</span>
        <span className="picker-talk-title">{t.title}</span>
        <span className="picker-talk-actions">
          <button
            className="picker-talk-listen"
            title="Listen from this talk onward"
            onClick={onListen}
          >
            {nowPlaying && nowPlaying.uri === t.uri ? "♪ Playing" : "▶ Listen"}
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
  }

  // Listen buttons for a queue source; shows "Resume" when a saved position
  // exists for that direction.
  function listenButtons(makeId, onStart) {
    return (
      <span className="picker-listen-btns">
        {["newest", "oldest"].map((order) => {
          const bm = bookmarks[makeId(order)];
          const arrow = order === "newest" ? "newest → oldest" : "oldest → newest";
          return (
            <button
              key={order}
              className="picker-listen-btn"
              title={
                bm
                  ? `Resume at “${bm.talkTitle}” (${fmtTime(bm.seconds)} in)`
                  : `Play every talk in a row, ${arrow}`
              }
              onClick={() => onStart(order)}
            >
              {bm ? `▶ Resume (${bm.idx + 1} of ${bm.total})` : `▶ Listen: ${arrow}`}
            </button>
          );
        })}
      </span>
    );
  }

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
          className={`picker-mode-btn ${mode === "topic" ? "active" : ""}`}
          onClick={() => setMode("topic")}
        >
          By topic
        </button>
        <button
          className={`picker-mode-btn ${mode === "browse" ? "active" : ""}`}
          onClick={() => setMode("browse")}
        >
          Browse by conference
        </button>
      </div>

      {/* ------------------- SYNC DEVICES ------------------- */}
      <div className="sync-row">
        <button
          className={`sync-toggle ${syncCode ? "connected" : ""}`}
          onClick={() => setSyncOpen(!syncOpen)}
          title="Share your listening spots between your laptop and phone"
        >
          ⇄ {syncCode ? `Synced across devices` : "Sync devices"}
          {syncStatus === "working" ? " · syncing…" : ""}
        </button>
        {syncOpen && (
          <div className="sync-panel">
            {syncCode ? (
              <>
                <p className="note" style={{ margin: "0 0 10px" }}>
                  This device shares its listening spots under the code below.
                  Enter the same code on your other device and both shelves stay
                  in step — newest position wins.
                </p>
                <div className="sync-code-line">
                  <span className="sync-code">{syncCode}</span>
                  <button
                    className="picker-example-chip"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(syncCode); } catch {}
                    }}
                  >
                    Copy
                  </button>
                  <button className="picker-example-chip" onClick={() => runSync()}>
                    Sync now
                  </button>
                  <button className="picker-example-chip" onClick={disconnectSync}>
                    Disconnect this device
                  </button>
                </div>
                {lastSyncAt > 0 && (
                  <span className="sync-when">
                    Last synced {new Date(lastSyncAt).toLocaleTimeString()}
                  </span>
                )}
              </>
            ) : (
              <>
                <p className="note" style={{ margin: "0 0 10px" }}>
                  Keep your Continue-listening shelf the same on your laptop and
                  phone — no account needed. Create a code on one device, then
                  enter it on the other.
                </p>
                <div className="sync-actions">
                  <button className="btn" onClick={createSyncCode}>
                    Create sync code
                  </button>
                  <span className="sync-or">— or —</span>
                  <input
                    type="text"
                    className="picker-search-input sync-input"
                    placeholder="word-word-word-1234"
                    value={syncInput}
                    onChange={(e) => setSyncInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") connectSyncCode(); }}
                  />
                  <button className="btn" onClick={connectSyncCode} disabled={!syncInput.trim()}>
                    Connect
                  </button>
                </div>
              </>
            )}
            {syncError && <div className="picker-error">{syncError}</div>}
          </div>
        )}
      </div>

      {talkError && <div className="picker-error">{talkError}</div>}

      {/* ------------------- CONTINUE LISTENING ------------------- */}
      {shelf.length > 0 && (
        <div className="resume-shelf">
          <div className="resume-shelf-title">Continue listening</div>
          {shelf.map((bm) => (
            <div className="resume-card" key={bm.id}>
              <button
                className="resume-card-main"
                title="Pick up right where you left off"
                onClick={() => resumeBookmark(bm)}
              >
                <span className="resume-card-label">▶ {bm.label}</span>
                <span className="resume-card-sub">
                  {bm.talkTitle} · {bm.talkWhen}
                </span>
                <span className="resume-card-pos">
                  talk {bm.idx + 1} of {bm.total} · {fmtTime(bm.seconds)} in ·{" "}
                  {bm.order === "newest" ? "newest → oldest" : "oldest → newest"}
                </span>
              </button>
              <button
                className="resume-card-x"
                title="Remove this saved spot"
                onClick={() => removeBookmark(bm.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ------------------- SEARCH BY SPEAKER ------------------- */}
      {mode === "speaker" && (
        <div className="picker-speaker">
          <p className="note">
            Type a speaker’s name to see every General Conference talk they’ve
            given, newest first. Listen straight through, or pick one to turn
            into a song.
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
                    {listenButtons(
                      (order) => `sp|${g.speaker}|${order}`,
                      (order) => startSpeakerQueue(g, order)
                    )}
                  </div>
                  <div className="picker-talks">
                    {g.talks.map((t) =>
                      talkRow(t, {
                        subtitle: `${monthName(t.month)} ${t.year}`,
                        onListen: () => listenFromTalk(g, t),
                      })
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ------------------- BY TOPIC ------------------- */}
      {mode === "topic" && (
        <div className="picker-topic">
          <p className="note">
            Pick one of the Church’s conference topics to build a playlist of
            every talk on that subject — optionally limited to a president’s
            era or a span of years.
          </p>

          {topicsState === "loading" && (
            <p className="note" style={{ fontStyle: "italic" }}>
              Loading the topic index…
            </p>
          )}
          {topicsState === "error" && (
            <div className="picker-error">
              Couldn’t load the topic index. Refresh the page to try again.
            </div>
          )}

          {topicsState === "ready" && !selectedTopic && (
            <>
              <label className="picker-field" style={{ width: "100%" }}>
                <span className="picker-label">Topic</span>
                <input
                  type="text"
                  className="picker-search-input"
                  placeholder="e.g. faith, repentance, temples…"
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="topic-chips">
                {topicMatches.map((t) => (
                  <button
                    key={t.slug}
                    className="picker-example-chip"
                    onClick={() => setTopicSlug(t.slug)}
                  >
                    {t.name}
                    <span className="topic-chip-count">{t.t.length}</span>
                  </button>
                ))}
                {topicMatches.length === 0 && (
                  <p className="note">No topics match “{topicQuery.trim()}”.</p>
                )}
              </div>
            </>
          )}

          {selectedTopic && (
            <>
              <div className="topic-selected">
                <span className="picker-group-name">{selectedTopic.name}</span>
                <button
                  className="picker-example-chip"
                  onClick={() => { setTopicSlug(null); setTopicQuery(""); }}
                >
                  ← change topic
                </button>
              </div>

              <div className="topic-timeframe">
                <label className="picker-field">
                  <span className="picker-label">Timeframe</span>
                  <select
                    className="picker-select"
                    value={tfKey}
                    onChange={(e) => setTfKey(e.target.value)}
                  >
                    <option value="all">All years (1971–present)</option>
                    {PRESIDENCIES.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                    <option value="custom">Custom year range…</option>
                  </select>
                </label>
                {tfKey === "custom" && (
                  <>
                    <label className="picker-field">
                      <span className="picker-label">From</span>
                      <select
                        className="picker-select"
                        value={tfFrom}
                        onChange={(e) => setTfFrom(e.target.value)}
                      >
                        {[...YEARS].reverse().map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </label>
                    <label className="picker-field">
                      <span className="picker-label">To</span>
                      <select
                        className="picker-select"
                        value={tfTo}
                        onChange={(e) => setTfTo(e.target.value)}
                      >
                        {YEARS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>

              <div className="picker-group-head">
                <span className="picker-result-count" style={{ margin: 0 }}>
                  {topicTalks.length} talk{topicTalks.length === 1 ? "" : "s"}
                  {" · "}{timeframe.label}
                </span>
                {topicTalks.length > 0 &&
                  listenButtons(
                    (order) => `tp|${selectedTopic.slug}|${timeframe.key}|${order}`,
                    (order) => startTopicQueue(order)
                  )}
              </div>

              {topicTalks.length === 0 && (
                <p className="note">
                  No talks on this topic in that timeframe — try widening it.
                </p>
              )}

              <div className="picker-talks">
                {topicTalks.map((t) =>
                  talkRow(t, {
                    subtitle: `${t.speaker} · ${monthName(t.month)} ${t.year}`,
                    onListen: () => listenFromTopicTalk(t),
                  })
                )}
              </div>
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
            <span className="listen-speaker">{player.label}</span>
            <span className="listen-title">{nowPlaying.title}</span>
            <span className="listen-when">
              {player.spec.kind === "topic" ? `${nowPlaying.speaker} · ` : ""}
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
            onEnded={handleEnded}
            onTimeUpdate={handleTimeUpdate}
            onPause={() => writeBookmark()}
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
          <button
            className="listen-btn listen-close"
            title="Stop listening (your spot is saved)"
            onClick={() => closePlayer()}
          >
            ✕
          </button>
        </div>
      </div>
    </section>
  );
}
