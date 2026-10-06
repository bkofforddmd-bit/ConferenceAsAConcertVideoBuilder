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
import { AiSearchMode, InsightsMode, buildExportHtml, safeFilename } from "./AiTools.jsx";
import QuoteBoard from "./QuoteBoard.jsx";
import TalkStudio, { buildOutlineHtml } from "./TalkStudio.jsx";
import ProgressBoard, { computeStreakData } from "./ProgressBoard.jsx";
import { cutClipToWav, fmtClock } from "../lib/audio-clip.js";
import { recordClipToVideo } from "../lib/video-clip.js";
import SpeakerFace from "./SpeakerFace.jsx";
import SonosButton from "./SonosButton.jsx";

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
export const PRESIDENCIES = [
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

// ---- listening history (which talks have been HEARD, for Progress) ----
const LISTENED_KEY = "cac-listened";
function loadListenedFromStorage() {
  try {
    const o = JSON.parse(localStorage.getItem(LISTENED_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

// ---- daily listening minutes (powers the days-in-a-row streak) ----
const LISTEN_DAYS_KEY = "cac-listen-days";
function loadListenDaysFromStorage() {
  try {
    const o = JSON.parse(localStorage.getItem(LISTEN_DAYS_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
const localDayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---- audio clips (metadata; the .wav bytes go to the data folder) ----
const CLIPS_KEY = "cac-clips";
function loadClipsFromStorage() {
  try {
    const a = JSON.parse(localStorage.getItem(CLIPS_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// ---- Becoming journal storage ----
const JOURNAL_KEY = "cac-journal";
const JOURNAL_DEL_KEY = "cac-journal-deleted";
function loadJournalFromStorage() {
  try {
    const a = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function loadJournalDeletedFromStorage() {
  try {
    const o = JSON.parse(localStorage.getItem(JOURNAL_DEL_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

// ---- quote board storage ----
const QUOTES_KEY = "cac-quotes";
const QUOTES_DEL_KEY = "cac-quotes-deleted";
function loadQuotesFromStorage() {
  try {
    const a = JSON.parse(localStorage.getItem(QUOTES_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function loadQuotesDeletedFromStorage() {
  try {
    const o = JSON.parse(localStorage.getItem(QUOTES_DEL_KEY) || "{}");
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

function orderText(order) {
  if (order === "oldest") return "oldest → newest";
  if (order === "ranked") return "AI ranking";
  if (order === "analysis") return "analysis order";
  return "newest → oldest";
}

// ---- local data folder (File System Access API, Chrome/Edge) ----
// Each user connects their OWN folder — Desktop, Google Drive, Dropbox,
// OneDrive, anywhere. The folder handle persists in IndexedDB per browser.
const FS_DB = "cac-fs";
function idbHandle(op, value) {
  return new Promise((resolve) => {
    const open = indexedDB.open(FS_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("handles", op === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("handles");
      const req =
        op === "get" ? store.get("dataFolder")
        : op === "set" ? store.put(value, "dataFolder")
        : store.delete("dataFolder");
      req.onsuccess = () => resolve(op === "get" ? req.result || null : true);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    };
  });
}

async function writeFolderFile(root, subdir, filename, contents) {
  const dir = await root.getDirectoryHandle(subdir, { create: true });
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(contents);
  await w.close();
}

// A shared-analysis link (/?analysis=abc123) opens straight into Insights.
function sharedAnalysisIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("analysis") || "";
  } catch {
    return "";
  }
}

// Bottom panel for snipping an audio clip from the playing talk.
function ClipPanel({ talk, audioRef, bottom, resolveMedia, onSaveClip, onClose }) {
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [name, setName] = useState(`${talk.speaker} — ${talk.title}`.slice(0, 80));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState(null); // {audio, video}
  const [recording, setRecording] = useState(false);
  const [recProgress, setRecProgress] = useState(0);
  const previewTimerRef = useRef(null);
  const recJobRef = useRef(null);
  const recMountRef = useRef(null);

  useEffect(() => () => { recJobRef.current?.cancel(); }, []);

  useEffect(() => {
    let alive = true;
    resolveMedia().then((m) => { if (alive) setMedia(m); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const videoUrl = media && ((media.video && (media.video.p720 || media.video.p1080 || media.video.p360)) || "");

  const now = () => (audioRef.current ? audioRef.current.currentTime : 0);
  const nudge = (which, d) => {
    if (which === "start") setStart((s) => Math.max(0, (s ?? 0) + d));
    else setEnd((s) => Math.max(0, (s ?? 0) + d));
  };

  function preview() {
    const el = audioRef.current;
    if (!el || start == null || end == null || end <= start) return;
    clearTimeout(previewTimerRef.current);
    el.currentTime = start;
    el.play().catch(() => {});
    previewTimerRef.current = setTimeout(() => { try { el.pause(); } catch {} }, (end - start) * 1000 / (el.playbackRate || 1));
  }

  async function save() {
    const el = audioRef.current;
    if (!el || start == null || end == null || end <= start || busy) return;
    setBusy(true);
    setStatus("");
    try {
      // Always cut from the MP3 (even in watch mode — the byte-rate math
      // that makes ranged fetching precise only holds for the audio file).
      const m = media || (await resolveMedia());
      if (!m.audio) throw new Error("couldn't resolve this talk's audio");
      const blob = await cutClipToWav(m.audio, start, end, el.duration || 0, setStatus);
      const ok = await onSaveClip({
        name: name.trim() || talk.title,
        start,
        end,
        blob,
        audioUrl: m.audio,
        videoUrl,
        duration: el.duration || 0,
      });
      setStatus(ok);
    } catch (e) {
      setStatus(`Couldn't cut the clip: ${e.message}`);
    }
    setBusy(false);
  }

  // Record the marked segment of the official video, in real time.
  async function saveVideo() {
    const el = audioRef.current;
    if (!el || start == null || end == null || end <= start || busy || recording) return;
    setStatus("");
    setRecording(true);
    setRecProgress(0);
    try { el.pause(); } catch {} // one soundtrack at a time
    try {
      const m = media || (await resolveMedia());
      const vUrl = (m.video && (m.video.p720 || m.video.p1080 || m.video.p360)) || "";
      if (!vUrl) throw new Error("no video is available for this talk");
      const job = recordClipToVideo({
        videoUrl: vUrl,
        startSec: start,
        endSec: end,
        container: recMountRef.current,
        onStatus: setStatus,
        onProgress: setRecProgress,
      });
      recJobRef.current = job;
      const { blob, ext } = await job.promise;
      const ok = await onSaveClip({
        name: name.trim() || talk.title,
        start,
        end,
        blob,
        ext,
        kind: "video",
        audioUrl: m.audio || "",
        videoUrl: vUrl,
        duration: el.duration || 0,
      });
      setStatus(ok);
    } catch (e) {
      setStatus(e.message === "cancelled" ? "Recording cancelled." : `Couldn't record the clip: ${e.message}`);
    }
    recJobRef.current = null;
    setRecording(false);
  }

  return (
    <div className="reader-panel journal-panel" style={{ bottom }}>
      <div className="reader-head">
        <span className="reader-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <SpeakerFace name={talk.speaker} size={26} /> ✂️ Clip — {talk.title}
        </span>
        <span className="reader-tools">
          <button className="resume-card-x" title="Close" onClick={() => { clearTimeout(previewTimerRef.current); onClose(); }}>✕</button>
        </span>
      </div>
      <div className="journal-body">
        <p className="note" style={{ marginTop: 0 }}>
          Let the talk play; mark where the clip should begin and end. Save it
          as an audio file (.wav) or record it as a video clip — either drops
          straight into a presentation.
        </p>
        <div className="clip-rows">
          <div className="clip-row">
            <button className="picker-example-chip" onClick={() => setStart(now())}>⏱ Mark start here</button>
            <span className="clip-time">{start == null ? "—" : fmtClock(start)}</span>
            {start != null && (
              <>
                <button className="picker-example-chip" onClick={() => nudge("start", -1)}>−1s</button>
                <button className="picker-example-chip" onClick={() => nudge("start", 1)}>+1s</button>
              </>
            )}
          </div>
          <div className="clip-row">
            <button className="picker-example-chip" onClick={() => setEnd(now())}>⏱ Mark end here</button>
            <span className="clip-time">{end == null ? "—" : fmtClock(end)}</span>
            {end != null && (
              <>
                <button className="picker-example-chip" onClick={() => nudge("end", -1)}>−1s</button>
                <button className="picker-example-chip" onClick={() => nudge("end", 1)}>+1s</button>
              </>
            )}
          </div>
        </div>
        {start != null && end != null && end > start && (
          <p className="note">Clip length: {fmtClock(end - start)}</p>
        )}
        <label className="picker-field" style={{ width: "100%" }}>
          <span className="picker-label">Clip name</span>
          <input type="text" className="picker-search-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="journal-actions">
          <button className="picker-talk-listen" onClick={preview} disabled={recording || start == null || end == null || end <= start}>
            ▶ Preview
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || recording || start == null || end == null || end <= start}>
            {busy ? "Cutting…" : "💾 Save audio clip (.wav)"}
          </button>
          {videoUrl && !recording && (
            <button
              className="btn btn-primary"
              onClick={saveVideo}
              disabled={busy || start == null || end == null || end <= start}
              title="Plays your marked segment once and records it into a video file (takes as long as the clip)"
            >
              🎥 Record video clip
            </button>
          )}
          {recording && (
            <button className="picker-talk-listen" onClick={() => recJobRef.current?.cancel()}>
              ✕ Cancel recording
            </button>
          )}
          {videoUrl && (
            <a
              className="picker-talk-read"
              href={`${videoUrl}?download=true`}
              target="_blank"
              rel="noopener noreferrer"
              title="Downloads the full official talk video (720p MP4)"
            >
              🎬 Full video (MP4) ↓
            </a>
          )}
        </div>
        <div ref={recMountRef} style={recording ? { marginTop: 10 } : { display: "none" }} />
        {recording && start != null && end != null && (
          <p className="note">
            🎥 Recording {fmtClock(Math.min(recProgress, end - start))} of {fmtClock(end - start)} — the
            clip plays through once while it records; keep this tab open.
          </p>
        )}
        {videoUrl && !recording && start != null && end != null && end > start && (
          <p className="note">
            🎥 records exactly {fmtClock(start)}–{fmtClock(end)} as its own
            video file. For the highest quality instead, download the full MP4
            and trim it in your slides app (PowerPoint: Playback → Trim Video).
          </p>
        )}
        {status && <p className="note">{status}</p>}
      </div>
    </div>
  );
}

// Bottom panel for writing a Becoming-journal entry about a talk.
function JournalPanel({ talk, entries, bottom, onSave, onClose }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div className="reader-panel journal-panel" style={{ bottom }}>
      <div className="reader-head">
        <span className="reader-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <SpeakerFace name={talk.speaker} size={26} /> 🌱 {talk.title}
        </span>
        <span className="reader-tools">
          <button className="resume-card-x" title="Close" onClick={onClose}>✕</button>
        </span>
      </div>
      <div className="journal-body">
        <p className="journal-prompt">
          What did I learn that I need to apply to my life to become more like Christ?
        </p>
        <textarea
          className="studio-input"
          autoFocus
          value={text}
          placeholder="Write the change you'll make…"
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
        />
        <div className="journal-actions">
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => {
              onSave(text);
              setText("");
              setSaved(true);
              setTimeout(() => setSaved(false), 3000);
            }}
          >
            {saved ? "✓ Recorded" : "🌱 Record in my journal"}
          </button>
          <span className="note" style={{ margin: 0 }}>
            — {talk.speaker}, {talk.when}
          </span>
        </div>
        {entries.length > 0 && (
          <div className="journal-prev">
            <div className="resume-shelf-title" style={{ marginTop: 14 }}>
              Earlier entries on this talk
            </div>
            {entries.map((e) => (
              <div key={e.id} className="journal-prev-entry">
                <p>{e.text}</p>
                <span className="studio-cite">{new Date(e.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConferencePicker({ onTalkLoaded }) {
  const [sharedAnalysisId] = useState(sharedAnalysisIdFromUrl);
  const [mode, setMode] = useState(sharedAnalysisId ? "insights" : "speaker"); // speaker | topic | ai | insights | browse

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

  // ---- listening history (powers the Progress board) ----
  const [listened, setListened] = useState(loadListenedFromStorage);
  const sessionMarkedRef = useRef(new Set());

  // Seconds of actual playback per local day (≥60s makes it a streak day).
  const [listenDays, setListenDays] = useState(loadListenDaysFromStorage);
  const dayAccumRef = useRef({ pending: 0, lastEvent: 0, lastFlush: 0 });
  const streakData = useMemo(() => computeStreakData(listenDays, listened), [listenDays, listened]);

  function trackListeningTime() {
    const now = Date.now();
    const acc = dayAccumRef.current;
    // timeupdate fires ~4×/s during playback; gaps >2s mean paused/seeking.
    if (acc.lastEvent && now - acc.lastEvent < 2000) acc.pending += (now - acc.lastEvent) / 1000;
    acc.lastEvent = now;
    if (acc.pending > 0 && now - acc.lastFlush > 15000) {
      acc.lastFlush = now;
      const days = loadListenDaysFromStorage();
      const key = localDayKey();
      days[key] = Math.round((days[key] || 0) + acc.pending);
      acc.pending = 0;
      try { localStorage.setItem(LISTEN_DAYS_KEY, JSON.stringify(days)); } catch {}
      setListenDays(days);
      schedulePush();
    }
  }

  // A talk counts as HEARD when its audio ends naturally or the listener
  // reaches ~92% of it. Marked once per session per talk; repeat listens on
  // later days bump the count.
  function markListened(uri) {
    if (!uri || sessionMarkedRef.current.has(uri)) return;
    sessionMarkedRef.current.add(uri);
    const cur = loadListenedFromStorage();
    const prev = cur[uri];
    cur[uri] = { at: new Date().toISOString(), n: prev ? (prev.n || 1) + 1 : 1 };
    try { localStorage.setItem(LISTENED_KEY, JSON.stringify(cur)); } catch {}
    setListened(cur);
    schedulePush();
  }

  // ---- audio clips state ----
  const [clips, setClips] = useState(loadClipsFromStorage);
  const [clipPanel, setClipPanel] = useState(null); // talk being clipped
  const [clipMsg, setClipMsg] = useState("");

  function persistClips(next) {
    setClips(next);
    try { localStorage.setItem(CLIPS_KEY, JSON.stringify(next)); } catch {}
  }

  function deleteClip(id) {
    persistClips(loadClipsFromStorage().filter((c) => c.id !== id));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Deliver a cut clip: into the data folder's "Audio clips" / "Video clips"
  // when connected, otherwise as a download. Records the clip's metadata
  // either way so it can be re-cut later from the shelf.
  async function deliverClip({ name, start, end, blob, ext, kind, audioUrl, videoUrl, duration }, talk, recordMeta = true) {
    const fileExt = ext || "wav";
    const folder = kind === "video" ? "Video clips" : "Audio clips";
    const filename = `${safeFilename(name)} [${fmtClock(start)}-${fmtClock(end)}].${fileExt}`;
    const sizeNote = blob.size > 1e6 ? ` (${(blob.size / 1e6).toFixed(1)} MB)` : "";
    let where;
    if (fsHandleRef.current && fsState.status === "granted") {
      try {
        await writeFolderFile(fsHandleRef.current, folder, filename, blob);
        where = `✓ Saved to “${fsState.name || "your data folder"}/${folder}/${filename}”${sizeNote}`;
      } catch {
        downloadBlob(blob, filename);
        where = `✓ Downloaded ${filename}${sizeNote} (folder write failed)`;
      }
    } else {
      downloadBlob(blob, filename);
      where = `✓ Downloaded ${filename}${sizeNote}`;
    }
    if (recordMeta && talk) {
      const rec = {
        id: `c${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        uri: talk.uri,
        title: talk.title,
        speaker: talk.speaker,
        when: talk.when || `${monthName(talk.month)} ${talk.year}`,
        name: name || talk.title,
        kind: kind || "audio",
        start,
        end,
        audioUrl,
        videoUrl: videoUrl || "",
        duration,
        at: new Date().toISOString(),
        updatedAt: Date.now(),
      };
      persistClips([rec, ...loadClipsFromStorage()]);
    }
    return where;
  }

  // Re-cut a saved clip from its metadata (fresh .wav, no app data needed).
  async function regenerateClip(meta) {
    setClipMsg(`Cutting “${meta.name}”…`);
    try {
      let audioUrl = meta.audioUrl;
      let duration = meta.duration;
      if (!audioUrl) {
        const res = await fetch("/.netlify/functions/fetch-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: meta.uri }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't resolve the audio.");
        audioUrl = data.audioUrl;
        duration = duration || 0;
      }
      const blob = await cutClipToWav(audioUrl, meta.start, meta.end, duration, (s) => setClipMsg(s));
      const where = await deliverClip(
        { name: meta.name, start: meta.start, end: meta.end, blob, audioUrl, duration },
        null,
        false
      );
      setClipMsg(where);
    } catch (e) {
      setClipMsg(`Couldn't cut the clip: ${e.message}`);
    }
    setTimeout(() => setClipMsg(""), 6000);
  }

  function openClipFor(talk) {
    if (!talk) return;
    setClipPanel({
      uri: talk.uri,
      title: talk.title,
      speaker: talk.speaker,
      when: talk.when || `${monthName(talk.month)} ${talk.year}`,
      month: talk.month,
      year: talk.year,
    });
    setReaderOpen(false);
    setJournalPanel(null);
  }

  // ---- Becoming journal state ----
  const [journal, setJournal] = useState(loadJournalFromStorage);
  const [journalPanel, setJournalPanel] = useState(null); // {uri,title,speaker,when} being journaled
  const [journalNudge, setJournalNudge] = useState(null); // just-finished talk, invite an entry
  const nudgeTimerRef = useRef(null);

  function persistJournal(next) {
    setJournal(next);
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(next)); } catch {}
    schedulePush();
  }

  function addJournalEntry(talk, text) {
    const t = String(text || "").trim();
    if (!t || !talk) return;
    const rec = {
      id: `j${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      uri: talk.uri,
      title: talk.title,
      speaker: talk.speaker,
      when: talk.when || `${monthName(talk.month)} ${talk.year}`,
      text: t,
      at: new Date().toISOString(),
      updatedAt: Date.now(),
    };
    persistJournal([rec, ...loadJournalFromStorage()]);
  }

  function updateJournalEntry(id, text) {
    persistJournal(
      loadJournalFromStorage().map((e) =>
        e.id === id ? { ...e, text: String(text || "").trim(), updatedAt: Date.now() } : e
      )
    );
  }

  function deleteJournalEntry(id) {
    try {
      const d = loadJournalDeletedFromStorage();
      d[id] = Date.now();
      localStorage.setItem(JOURNAL_DEL_KEY, JSON.stringify(d));
    } catch {}
    persistJournal(loadJournalFromStorage().filter((e) => e.id !== id));
  }

  function openJournalFor(talk) {
    if (!talk) return;
    setJournalPanel({
      uri: talk.uri,
      title: talk.title,
      speaker: talk.speaker,
      when: talk.when || `${monthName(talk.month)} ${talk.year}`,
    });
    setReaderOpen(false); // one bottom panel at a time
    setClipPanel(null);
    setJournalNudge(null);
  }

  // ---- quote board state ----
  const [quotes, setQuotes] = useState(loadQuotesFromStorage);
  const [quotePop, setQuotePop] = useState(null); // {top,left,text}
  const [quoteToast, setQuoteToast] = useState("");
  const [studioSeedId, setStudioSeedId] = useState("");

  function persistQuotes(next) {
    setQuotes(next);
    try { localStorage.setItem(QUOTES_KEY, JSON.stringify(next)); } catch {}
    schedulePush();
  }

  function deleteQuote(id) {
    try {
      const d = loadQuotesDeletedFromStorage();
      d[id] = Date.now();
      localStorage.setItem(QUOTES_DEL_KEY, JSON.stringify(d));
    } catch {}
    persistQuotes(loadQuotesFromStorage().filter((q) => q.id !== id));
  }

  function setQuoteTags(id, tags) {
    persistQuotes(
      loadQuotesFromStorage().map((q) =>
        q.id === id ? { ...q, tags, updatedAt: Date.now() } : q
      )
    );
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
      quotes: Object.fromEntries(loadQuotesFromStorage().map((q) => [q.id, q])),
      quotesDeleted: loadQuotesDeletedFromStorage(),
      listened: loadListenedFromStorage(),
      listenDays: loadListenDaysFromStorage(),
      journal: Object.fromEntries(loadJournalFromStorage().map((e) => [e.id, e])),
      journalDeleted: loadJournalDeletedFromStorage(),
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
    if (state.quotes) {
      const arr = Object.values(state.quotes).sort((a, b) =>
        String(b.savedAt || "").localeCompare(String(a.savedAt || ""))
      );
      try {
        localStorage.setItem(QUOTES_KEY, JSON.stringify(arr));
        localStorage.setItem(QUOTES_DEL_KEY, JSON.stringify(state.quotesDeleted || {}));
      } catch {}
      setQuotes(arr);
    }
    if (state.listened) {
      try { localStorage.setItem(LISTENED_KEY, JSON.stringify(state.listened)); } catch {}
      setListened(state.listened);
    }
    if (state.listenDays) {
      try { localStorage.setItem(LISTEN_DAYS_KEY, JSON.stringify(state.listenDays)); } catch {}
      setListenDays(state.listenDays);
    }
    if (state.journal) {
      const arr = Object.values(state.journal).sort((a, b) =>
        String(b.at || "").localeCompare(String(a.at || ""))
      );
      try {
        localStorage.setItem(JOURNAL_KEY, JSON.stringify(arr));
        localStorage.setItem(JOURNAL_DEL_KEY, JSON.stringify(state.journalDeleted || {}));
      } catch {}
      setJournal(arr);
    }
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

  // ---- follow-along reader (talk text scrolls with the audio) ----
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerDoc, setReaderDoc] = useState(null); // {uri,title,paragraphs,status}
  const [readerPara, setReaderPara] = useState(-1);
  const [readerOffset, setReaderOffset] = useState(0); // manual sync nudge (s)
  const [audioDuration, setAudioDuration] = useState(0);
  const [barH, setBarH] = useState(96);
  const readerCacheRef = useRef(new Map()); // uri -> {title, paragraphs}
  const readerBodyRef = useRef(null);
  const paraRefs = useRef([]);
  const userScrollAtRef = useRef(0);
  const barRef = useRef(null);

  // Lines that appear in the printed text but aren't spoken in the audio
  // (kicker summary + its scripture cite, byline, office) — dropping them
  // keeps the timing model honest. Returns the spoken paragraphs plus the
  // print-only summary so the reader can still show it, clearly labeled.
  function splitSpokenParagraphs(paragraphs, speakerName, kicker) {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const kickerNorm = norm(kicker);
    let cite = "";
    const spoken = (paragraphs || []).filter((p, i) => {
      const s = p.trim();
      if (!s) return false;
      if (/^By\s+(President|Elder|Sister|Brother|Bishop)\b/i.test(s)) return false;
      if (/^Of the (Quorum of the Twelve Apostles|Seventy)/i.test(s)) return false;
      if (/^(First|Second) Counselor in the First Presidency/i.test(s)) return false;
      if (/^(President of The Church|Presiding Bishop|Acting President of the Quorum)/i.test(s)) return false;
      if (speakerName && s === speakerName) return false;
      // Front matter only: the summary paragraph and its bare "(Alma 41:7)"
      // style citation are printed, never read aloud.
      if (i < 6) {
        if (kickerNorm && norm(s) === kickerNorm) return false;
        if (/^\([^()]{1,60}\)$/.test(s)) { cite = cite || s; return false; }
      }
      return true;
    });
    const summary = kicker ? `${kicker}${cite ? ` ${cite}` : ""}` : "";
    return { spoken, summary };
  }

  async function loadReaderDoc(talk) {
    const cached = readerCacheRef.current.get(talk.uri);
    if (cached) {
      setReaderDoc({ ...cached, uri: talk.uri, status: "ready" });
      return;
    }
    setReaderDoc({ uri: talk.uri, title: talk.title, paragraphs: [], status: "loading" });
    try {
      const res = await fetch("/.netlify/functions/fetch-talk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: talk.uri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load the talk text.");
      const { spoken, summary } = splitSpokenParagraphs(
        data.paragraphs,
        data.speakerName || talk.speaker,
        (data.kicker || "").trim()
      );
      const doc = {
        title: data.title || talk.title,
        paragraphs: spoken,
        summary,
      };
      readerCacheRef.current.set(talk.uri, doc);
      setReaderDoc({ ...doc, uri: talk.uri, status: "ready" });
    } catch (e) {
      setReaderDoc({ uri: talk.uri, title: talk.title, paragraphs: [], status: "error" });
    }
  }

  // Load the text whenever the reader is open and the track changes.
  const readerUri = readerOpen && player ? player.queue[player.idx]?.uri : null;
  useEffect(() => {
    if (!readerUri || !player) return;
    setReaderPara(-1);
    paraRefs.current = [];
    loadReaderDoc(player.queue[player.idx]);
  }, [readerUri]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the reader panel sitting exactly on top of the listen bar.
  useEffect(() => {
    const measure = () => {
      if (barRef.current) setBarH(barRef.current.offsetHeight + 6);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [player, readerOpen]);

  // Paragraph start times: proportional to word count across the audio
  // duration (talks are delivered at a steady pace), with a small lead-in
  // plus the user's manual nudge.
  const paraStarts = useMemo(() => {
    const paras = readerDoc && readerDoc.status === "ready" ? readerDoc.paragraphs : null;
    if (!paras || !paras.length || !audioDuration || !isFinite(audioDuration)) return null;
    const words = paras.map((p) => p.split(/\s+/).length);
    const total = words.reduce((a, b) => a + b, 0) || 1;
    const lead = 2 + readerOffset;
    const usable = Math.max(30, audioDuration - lead - 2);
    const starts = [];
    let cum = 0;
    for (const w of words) {
      starts.push(lead + (cum / total) * usable);
      cum += w;
    }
    return starts;
  }, [readerDoc, audioDuration, readerOffset]);
  const paraStartsRef = useRef(null);
  useEffect(() => { paraStartsRef.current = paraStarts; }, [paraStarts]);
  const readerParaRef = useRef(-1);
  useEffect(() => { readerParaRef.current = readerPara; }, [readerPara]);

  // Called from the audio element's timeupdate: move the highlight.
  function updateReaderPosition(t) {
    const starts = paraStartsRef.current;
    if (!readerOpen || !starts) return;
    let idx = 0;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= t + 0.25) idx = i;
      else break;
    }
    if (idx !== readerParaRef.current) setReaderPara(idx);
  }

  // Auto-scroll the highlighted paragraph to the middle of the panel —
  // unless the user scrolled manually in the last few seconds.
  useEffect(() => {
    if (readerPara < 0) return;
    if (Date.now() - userScrollAtRef.current < 6000) return;
    const el = paraRefs.current[readerPara];
    const box = readerBodyRef.current;
    if (!el || !box) return;
    box.scrollTo({
      top: el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
      behavior: "smooth",
    });
  }, [readerPara]);

  function seekToParagraph(i) {
    const el = audioRef.current;
    const starts = paraStartsRef.current;
    if (!el || !starts || starts[i] === undefined) return;
    el.currentTime = Math.max(0, starts[i]);
    el.play().catch(() => {});
  }

  // Highlighting text in the reader offers a "Save quote" chip; saving files
  // the passage on the Quote board with its citation.
  function handleReaderSelection() {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { setQuotePop(null); return; }
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < 8 || text.length > 2000) { setQuotePop(null); return; }
      const body = readerBodyRef.current;
      if (!body) return;
      const range = sel.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) { setQuotePop(null); return; }
      const rect = range.getBoundingClientRect();
      const panel = body.closest(".reader-panel");
      if (!panel) return;
      const pRect = panel.getBoundingClientRect();
      setQuotePop({
        top: Math.max(8, rect.top - pRect.top - 40),
        left: Math.min(Math.max(rect.left - pRect.left + rect.width / 2, 80), pRect.width - 80),
        text,
      });
    }, 10);
  }

  function saveQuoteFromSelection() {
    const p = playerRef.current;
    if (!quotePop || !p) return;
    const t = p.queue[p.idx];
    const rec = {
      id: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      text: quotePop.text,
      uri: t.uri,
      title: (readerDoc && readerDoc.title) || t.title,
      speaker: t.speaker,
      when: `${monthName(t.month)} ${t.year}`,
      tags: [],
      savedAt: new Date().toISOString(),
      updatedAt: Date.now(),
    };
    persistQuotes([rec, ...loadQuotesFromStorage()]);
    setQuotePop(null);
    try { window.getSelection().removeAllRanges(); } catch {}
    setQuoteToast("✓ Saved to the Quote board");
    setTimeout(() => setQuoteToast(""), 2500);
  }

  // ---- backup & restore (a .json with everything this device knows) ----
  const BACKUP_KEYS = [
    "cac-listen-bookmarks",
    "cac-listen-deleted",
    "cac-listen-speed",
    "cac-listen-speed-at",
    "cac-sync-code",
    "cac-analyses",
    "cac-quotes",
    "cac-quotes-deleted",
    "cac-talk-drafts",
    "cac-listened",
    "cac-listen-days",
    "cac-journal",
    "cac-journal-deleted",
    "cac-clips",
  ];
  const backupFileRef = useRef(null);
  const [backupMsg, setBackupMsg] = useState("");

  function makeBackupPayload() {
    const data = {};
    for (const k of BACKUP_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) data[k] = v;
      } catch {}
    }
    return {
      app: "conference-as-a-concert-listening",
      version: 1,
      savedAt: new Date().toISOString(),
      data,
    };
  }

  function downloadBackup() {
    const payload = makeBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `conference-concert-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setBackupMsg("Backup downloaded — keep it somewhere safe (it includes your analyses).");
    setTimeout(() => setBackupMsg(""), 6000);
  }

  const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

  // Merge a backup into this device (newest wins; nothing is blindly
  // overwritten), then reload so every part of the app picks it up.
  async function restoreBackup(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.app !== "conference-as-a-concert-listening" || !payload.data) {
        setBackupMsg("That file doesn't look like a listening backup from this app.");
        return;
      }
      const inc = payload.data;

      // Listening spots: per-playlist newest-wins, honoring deletions.
      const curBm = loadBookmarksFromStorage();
      const incBm = parseJson(inc["cac-listen-bookmarks"] || "{}", {});
      const curDel = loadDeletedFromStorage();
      const incDel = parseJson(inc["cac-listen-deleted"] || "{}", {});
      const deleted = { ...curDel };
      for (const [id, ts] of Object.entries(incDel)) {
        if (!deleted[id] || ts > deleted[id]) deleted[id] = ts;
      }
      const merged = { ...curBm };
      for (const [id, bm] of Object.entries(incBm)) {
        if (!merged[id] || (bm.updatedAt || 0) > (merged[id].updatedAt || 0)) merged[id] = bm;
      }
      for (const [id, ts] of Object.entries(deleted)) {
        if (merged[id] && ts >= (merged[id].updatedAt || 0)) delete merged[id];
      }
      localStorage.setItem("cac-listen-bookmarks", JSON.stringify(merged));
      localStorage.setItem("cac-listen-deleted", JSON.stringify(deleted));

      // Analyses: union by id, newest first.
      const curAn = parseJson(localStorage.getItem("cac-analyses") || "[]", []);
      const incAn = parseJson(inc["cac-analyses"] || "[]", []);
      const byId = new Map();
      for (const a of [...curAn, ...incAn]) {
        if (a && a.localId && !byId.has(a.localId)) byId.set(a.localId, a);
      }
      const analyses = [...byId.values()]
        .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
        .slice(0, 30);
      localStorage.setItem("cac-analyses", JSON.stringify(analyses));

      // Quotes: union by id (newest edit wins), deletions honored.
      const curQ = parseJson(localStorage.getItem("cac-quotes") || "[]", []);
      const incQ = parseJson(inc["cac-quotes"] || "[]", []);
      const curQD = parseJson(localStorage.getItem("cac-quotes-deleted") || "{}", {});
      const incQD = parseJson(inc["cac-quotes-deleted"] || "{}", {});
      const qDel = { ...curQD };
      for (const [id, ts] of Object.entries(incQD)) {
        if (!qDel[id] || ts > qDel[id]) qDel[id] = ts;
      }
      const qById = new Map();
      for (const q of [...curQ, ...incQ]) {
        if (!q || !q.id) continue;
        const e = qById.get(q.id);
        if (!e || (q.updatedAt || 0) > (e.updatedAt || 0)) qById.set(q.id, q);
      }
      for (const [id, ts] of Object.entries(qDel)) {
        const q = qById.get(id);
        if (q && ts >= (q.updatedAt || 0)) qById.delete(id);
      }
      localStorage.setItem(
        "cac-quotes",
        JSON.stringify(
          [...qById.values()].sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
        )
      );
      localStorage.setItem("cac-quotes-deleted", JSON.stringify(qDel));

      // Talk drafts: union by id, newest edit wins.
      const curD = parseJson(localStorage.getItem("cac-talk-drafts") || "[]", []);
      const incD = parseJson(inc["cac-talk-drafts"] || "[]", []);
      const dById = new Map();
      for (const d of [...curD, ...incD]) {
        if (!d || !d.id) continue;
        const e = dById.get(d.id);
        if (!e || (d.updatedAt || 0) > (e.updatedAt || 0)) dById.set(d.id, d);
      }
      localStorage.setItem(
        "cac-talk-drafts",
        JSON.stringify(
          [...dById.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 10)
        )
      );

      // Becoming journal: union by id (newest edit wins), deletions honored.
      const curJ = parseJson(localStorage.getItem("cac-journal") || "[]", []);
      const incJ = parseJson(inc["cac-journal"] || "[]", []);
      const curJD = parseJson(localStorage.getItem("cac-journal-deleted") || "{}", {});
      const incJD = parseJson(inc["cac-journal-deleted"] || "{}", {});
      const jDel = { ...curJD };
      for (const [id, ts] of Object.entries(incJD)) {
        if (!jDel[id] || ts > jDel[id]) jDel[id] = ts;
      }
      const jById = new Map();
      for (const e of [...curJ, ...incJ]) {
        if (!e || !e.id) continue;
        const x = jById.get(e.id);
        if (!x || (e.updatedAt || 0) > (x.updatedAt || 0)) jById.set(e.id, e);
      }
      for (const [id, ts] of Object.entries(jDel)) {
        const e = jById.get(id);
        if (e && ts >= (e.updatedAt || 0)) jById.delete(id);
      }
      localStorage.setItem(
        "cac-journal",
        JSON.stringify([...jById.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))))
      );
      localStorage.setItem("cac-journal-deleted", JSON.stringify(jDel));

      // Listening history: pure union (never un-heard).
      const curL = parseJson(localStorage.getItem("cac-listened") || "{}", {});
      const incL = parseJson(inc["cac-listened"] || "{}", {});
      for (const [uri, rec] of Object.entries(incL)) {
        const e = curL[uri];
        curL[uri] = {
          at: !e || String(rec.at || "") > String(e.at || "") ? rec.at : e.at,
          n: Math.max((e && e.n) || 0, (rec && rec.n) || 1),
        };
      }
      localStorage.setItem("cac-listened", JSON.stringify(curL));

      // Audio clips metadata: union by id, newest edit wins.
      const curC = parseJson(localStorage.getItem("cac-clips") || "[]", []);
      const incC = parseJson(inc["cac-clips"] || "[]", []);
      const cById = new Map();
      for (const c of [...curC, ...incC]) {
        if (!c || !c.id) continue;
        const e = cById.get(c.id);
        if (!e || (c.updatedAt || 0) > (e.updatedAt || 0)) cById.set(c.id, c);
      }
      localStorage.setItem(
        "cac-clips",
        JSON.stringify([...cById.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))))
      );

      // Daily listening seconds: per-day maximum.
      const curLD = parseJson(localStorage.getItem("cac-listen-days") || "{}", {});
      const incLD = parseJson(inc["cac-listen-days"] || "{}", {});
      for (const [d, s] of Object.entries(incLD)) {
        curLD[d] = Math.max(curLD[d] || 0, s || 0);
      }
      localStorage.setItem("cac-listen-days", JSON.stringify(curLD));

      // Speed preference: newer change wins.
      const incAt = parseInt(inc["cac-listen-speed-at"] || "0", 10) || 0;
      const curAt = parseInt(localStorage.getItem("cac-listen-speed-at") || "0", 10) || 0;
      if (inc["cac-listen-speed"] && incAt > curAt) {
        localStorage.setItem("cac-listen-speed", inc["cac-listen-speed"]);
        localStorage.setItem("cac-listen-speed-at", String(incAt));
      }

      // Sync code: adopt only if this device doesn't have one (an active
      // pairing on this device wins over the backup's).
      if (inc["cac-sync-code"] && !localStorage.getItem("cac-sync-code")) {
        localStorage.setItem("cac-sync-code", inc["cac-sync-code"]);
      }

      setBackupMsg("Backup loaded — refreshing…");
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setBackupMsg("Couldn't read that backup file.");
    } finally {
      e.target.value = "";
    }
  }

  // ---- local data folder: each user connects their own archive location ----
  const [fsState, setFsState] = useState({ status: "loading", name: "" });
  const [fsMsg, setFsMsg] = useState("");
  const fsHandleRef = useRef(null);

  useEffect(() => {
    (async () => {
      if (!window.showDirectoryPicker) {
        setFsState({ status: "unsupported", name: "" });
        return;
      }
      const handle = await idbHandle("get");
      if (!handle) {
        setFsState({ status: "none", name: "" });
        return;
      }
      fsHandleRef.current = handle;
      try {
        const perm = await handle.queryPermission({ mode: "readwrite" });
        setFsState({ status: perm === "granted" ? "granted" : "prompt", name: handle.name });
      } catch {
        setFsState({ status: "prompt", name: handle.name });
      }
    })();
  }, []);

  async function connectDataFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      fsHandleRef.current = handle;
      await idbHandle("set", handle);
      setFsState({ status: "granted", name: handle.name });
      setFsMsg(`Connected — archives will be saved into “${handle.name}”.`);
    } catch {}
  }

  async function reconnectDataFolder() {
    const handle = fsHandleRef.current;
    if (!handle) return;
    try {
      const perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        setFsState({ status: "granted", name: handle.name });
        setFsMsg("Reconnected.");
      }
    } catch {}
  }

  async function forgetDataFolder() {
    await idbHandle("delete");
    fsHandleRef.current = null;
    setFsState({ status: "none", name: "" });
    setFsMsg("");
  }

  function buildQuotesDocHtml(list) {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = list
      .map(
        (q) =>
          `<blockquote>“${esc(q.text)}”<span class="cite">— ${esc(q.speaker)}, “${esc(q.title)},” ${esc(q.when)} General Conference${
            (q.tags || []).length ? ` · <em>${esc(q.tags.join(", "))}</em>` : ""
          }</span></blockquote>`
      )
      .join("\n");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quote board</title>
<style>body{font-family:Georgia,serif;color:#1a1a1a;max-width:7.5in;margin:0 auto;padding:24px;line-height:1.6;font-size:12pt}
h1{font-size:18pt;margin:0 0 4px}.meta{color:#666;font-size:10pt;margin:0 0 16px}
blockquote{margin:0 0 16px;padding:10px 16px;border-left:3px solid #b9923c;background:#faf7ef;font-style:italic}
blockquote .cite{display:block;margin-top:6px;font-style:normal;font-size:10pt;color:#555}</style></head><body>
<h1>Quote board</h1><p class="meta">${list.length} quotes · exported ${new Date().toLocaleDateString()}</p>
${rows}</body></html>`;
  }

  // Write everything the app knows into the connected folder, organized
  // into subfolders. Word-format .doc files carry the readable copies.
  async function saveArchive() {
    const root = fsHandleRef.current;
    if (!root || fsState.status !== "granted") return;
    setFsMsg("Saving…");
    let files = 0;
    try {
      const payload = JSON.stringify(makeBackupPayload(), null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      await writeFolderFile(root, "Backups", `backup-${stamp}.json`, payload);
      await writeFolderFile(root, "Backups", "backup-latest.json", payload);
      files += 2;

      const qs = loadQuotesFromStorage();
      if (qs.length) {
        await writeFolderFile(root, "Quote board", "Quote board.doc", "﻿" + buildQuotesDocHtml(qs));
        await writeFolderFile(root, "Quote board", "quotes.json", JSON.stringify(qs, null, 2));
        files += 2;
      }

      const jl = loadJournalFromStorage();
      if (jl.length) {
        const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const rows = jl
          .map(
            (e) =>
              `<div class="entry"><p>${esc(e.text).split(/\n+/).join("</p><p>")}</p>` +
              `<span class="cite">After “${esc(e.title)}” — ${esc(e.speaker)}, ${esc(e.when)} General Conference · ${new Date(e.at).toLocaleDateString()}</span></div>`
          )
          .join("\n");
        const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Becoming journal</title>
<style>body{font-family:Georgia,serif;color:#1a1a1a;max-width:7.5in;margin:0 auto;padding:24px;line-height:1.6;font-size:12pt}
h1{font-size:18pt;margin:0 0 4px}.meta{color:#666;font-size:10pt;margin:0 0 16px}
.entry{margin:0 0 18px;padding:12px 16px;border-left:3px solid #b9923c;background:#faf7ef}
.entry .cite{display:block;margin-top:6px;font-size:10pt;color:#555;font-style:italic}</style></head><body>
<h1>Becoming journal</h1><p class="meta">What I will apply to become more like Christ · ${jl.length} entries · exported ${new Date().toLocaleDateString()}</p>
${rows}</body></html>`;
        await writeFolderFile(root, "Becoming journal", "Becoming journal.doc", "﻿" + doc);
        await writeFolderFile(root, "Becoming journal", "journal.json", JSON.stringify(jl, null, 2));
        files += 2;
      }

      let analyses = [];
      try { analyses = JSON.parse(localStorage.getItem("cac-analyses") || "[]"); } catch {}
      for (const a of analyses) {
        await writeFolderFile(
          root,
          "Analyses",
          `${safeFilename(a.label)}.doc`,
          "﻿" + buildExportHtml(a.label, a.essay, a.items)
        );
        files++;
      }

      let drafts = [];
      try { drafts = JSON.parse(localStorage.getItem("cac-talk-drafts") || "[]"); } catch {}
      for (const d of drafts) {
        await writeFolderFile(
          root,
          "Talk drafts",
          `${safeFilename(`Talk - ${d.emulate}`)}-${String(d.id).slice(-4)}.doc`,
          "﻿" + buildOutlineHtml(d)
        );
        files++;
      }

      setFsMsg(`✓ Saved ${files} files into “${fsState.name || "your data folder"}” (Backups, Quote board, Analyses, Talk drafts).`);
    } catch (e) {
      setFsMsg(`Couldn't save: ${e && e.message ? e.message : "unknown error"}`);
    }
  }

  // Quiet safety net: refresh the latest backup file once a minute while
  // the app is open and a folder is connected.
  useEffect(() => {
    if (fsState.status !== "granted") return;
    const id = setInterval(async () => {
      const root = fsHandleRef.current;
      if (!root) return;
      try {
        await writeFolderFile(
          root,
          "Backups",
          "backup-latest.json",
          JSON.stringify(makeBackupPayload(), null, 2)
        );
      } catch {}
    }, 60000);
    return () => clearInterval(id);
  }, [fsState.status]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- listening: resolve a talk's official media (cached per session) ----
  // Each cache entry holds { audio: mp3Url, video: {p360,p720,p1080} }.
  async function resolveMedia(talk) {
    const cached = audioUrlCache.current.get(talk.uri);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch("/.netlify/functions/fetch-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: talk.uri }),
      });
      const data = await res.json();
      if (res.ok) {
        const entry = { audio: data.audioUrl || "", video: data.video || {} };
        audioUrlCache.current.set(talk.uri, entry);
        return entry;
      }
      // Only a definitive "no recording exists" (404) is worth remembering;
      // transient failures (rate limits, hiccups) must stay retryable.
      if (res.status === 404) audioUrlCache.current.set(talk.uri, { audio: "", video: {} });
      return { audio: "", video: {} };
    } catch {
      return { audio: "", video: {} }; // network hiccup — don't cache
    }
  }
  async function getAudioUrl(talk) {
    return (await resolveMedia(talk)).audio;
  }
  const bestVideo = (v) => (v && (v.p720 || v.p1080 || v.p360)) || "";

  // ---- watch mode: play the official video instead of audio-only ----
  const [watchOpen, setWatchOpen] = useState(false);
  const watchOpenRef = useRef(false);
  useEffect(() => { watchOpenRef.current = watchOpen; }, [watchOpen]);

  // Swap the media element's source, preserving position and play state.
  function swapSrc(url) {
    const el = audioRef.current;
    if (!el || !url || el.currentSrc === url) return;
    const t = el.currentTime;
    const playing = !el.paused;
    el.src = url;
    el.playbackRate = speedRef.current;
    el.addEventListener("loadedmetadata", () => { try { el.currentTime = t; } catch {} }, { once: true });
    if (playing) el.play().catch(() => {});
  }

  async function toggleWatch() {
    const p = playerRef.current;
    if (!p) return;
    const media = await resolveMedia(p.queue[p.idx]);
    if (watchOpen) {
      setWatchOpen(false);
      if (media.audio) swapSrc(media.audio);
      return;
    }
    const v = bestVideo(media.video);
    if (!v) {
      setPlayerError("No video is available for this talk — audio continues.");
      return;
    }
    setPlayerError("");
    // The reader stays open — read along while the video plays.
    setJournalPanel(null);
    setClipPanel(null);
    setWatchOpen(true);
    swapSrc(v);
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
      const media = await resolveMedia(queue[i]);
      const url = media.audio;
      if (url) {
        setPlayer({ id, label, queue, idx: i, order, spec });
        playerRef.current = { id, label, queue, idx: i, order, spec };
        const el = audioRef.current;
        if (el) {
          // In watch mode, prefer the talk's video (fall back to audio).
          el.src = (watchOpenRef.current && bestVideo(media.video)) || url;
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
    const finished = p.queue[p.idx];
    markListened(finished && finished.uri);
    // The moment of becoming: invite a journal entry about the talk that
    // just ended (a quiet chip, not an interruption — playback continues).
    if (finished) {
      setJournalNudge({
        uri: finished.uri,
        title: finished.title,
        speaker: finished.speaker,
        when: `${monthName(finished.month)} ${finished.year}`,
      });
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => setJournalNudge(null), 25000);
    }
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
  // Also drives the follow-along reader's paragraph highlight.
  function handleTimeUpdate(e) {
    const t = e.target.currentTime || 0;
    updateReaderPosition(t);
    trackListeningTime();
    const dur = e.target.duration;
    if (dur && isFinite(dur) && dur > 60 && t / dur > 0.92) {
      const p = playerRef.current;
      if (p) markListened(p.queue[p.idx] && p.queue[p.idx].uri);
    }
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
    setReaderOpen(false);
    setReaderDoc(null);
    setReaderPara(-1);
    setWatchOpen(false);
    setClipPanel(null);
    setJournalPanel(null);
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

  // ---- generic playlists (AI search results, analysis talk sets) ----
  const uriMap = useMemo(
    () => new Map(((index && index.talks) || []).map((t) => [t.uri, t])),
    [index]
  );

  // Start (or resume) a playlist defined by an explicit list of talk links.
  // `uris` come in their canonical order (newest-first, or AI-ranked);
  // order "oldest" plays them reversed.
  function startUrisQueue({ id, label, uris, order = "newest", startUri }) {
    const bm = bookmarks[id];
    if (bm && !startUri) {
      resumeBookmark(bm);
      return;
    }
    let queue = uris.map((u) => uriMap.get(u)).filter(Boolean);
    if (order === "oldest") queue = [...queue].reverse();
    if (!queue.length) return;
    const idx = startUri ? Math.max(0, queue.findIndex((t) => t.uri === startUri)) : 0;
    startPlayback({ id, label, queue, idx, order, spec: { kind: "uris", uris, label } });
  }

  // Rebuild a saved playlist from its spec and pick up where it left off.
  async function resumeBookmark(bm) {
    if (!index) return;
    let queue = [];
    if (bm.spec.kind === "speaker") {
      const talks = index.talks.filter((t) => t.speaker === bm.spec.speaker);
      queue = bm.order === "newest" ? talks : talks.reverse();
    } else if (bm.spec.kind === "uris") {
      queue = (bm.spec.uris || []).map((u) => uriMap.get(u)).filter(Boolean);
      if (bm.order === "oldest") queue = [...queue].reverse();
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
          <SonosButton className="picker-talk-listen" talk={t.uri} small />
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
          className={`picker-mode-btn ${mode === "ai" ? "active" : ""}`}
          onClick={() => setMode("ai")}
        >
          ✨ AI search
        </button>
        <button
          className={`picker-mode-btn ${mode === "insights" ? "active" : ""}`}
          onClick={() => setMode("insights")}
        >
          📈 Insights
        </button>
        <button
          className={`picker-mode-btn ${mode === "quotes" ? "active" : ""}`}
          onClick={() => setMode("quotes")}
        >
          💬 Quotes{quotes.length ? ` (${quotes.length})` : ""}
        </button>
        <button
          className={`picker-mode-btn ${mode === "studio" ? "active" : ""}`}
          onClick={() => setMode("studio")}
        >
          🎙 Talk builder
        </button>
        <button
          className={`picker-mode-btn ${mode === "progress" ? "active" : ""}`}
          onClick={() => setMode("progress")}
        >
          🌱 Becoming
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

            <div className="sync-backup">
              <span className="picker-label">Backup</span>
              <div className="sync-actions" style={{ marginTop: 6 }}>
                <button className="picker-example-chip" onClick={downloadBackup}>
                  ⬇ Download backup (.json)
                </button>
                <button
                  className="picker-example-chip"
                  onClick={() => backupFileRef.current && backupFileRef.current.click()}
                >
                  Load backup…
                </button>
                <input
                  ref={backupFileRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={restoreBackup}
                />
              </div>
              {backupMsg && <span className="sync-when">{backupMsg}</span>}
              <span className="sync-when">
                One file with your analyses, listening spots, sync code, and settings —
                load it on any computer (or after a cleared browser) to pick up where
                you left off. Loading merges; it never wipes what's already here.
              </span>
            </div>

            <div className="sync-backup">
              <span className="picker-label">Data folder</span>
              {fsState.status === "unsupported" && (
                <span className="sync-when">
                  Direct folder saving needs Chrome or Edge on a computer. (The
                  Download-backup button above works everywhere.)
                </span>
              )}
              {fsState.status === "none" && (
                <>
                  <div className="sync-actions" style={{ marginTop: 6 }}>
                    <button className="picker-example-chip" onClick={connectDataFolder}>
                      📁 Choose my data folder…
                    </button>
                  </div>
                  <span className="sync-when">
                    Pick any folder on your computer — a Desktop folder, or one
                    inside Google Drive, Dropbox, or OneDrive for automatic cloud
                    backup. The app will save your archives there: backups (.json),
                    analyses and talk drafts (Word), and your Quote board. Each
                    person using the app chooses their own location.
                  </span>
                </>
              )}
              {fsState.status === "prompt" && (
                <>
                  <div className="sync-actions" style={{ marginTop: 6 }}>
                    <button className="picker-example-chip" onClick={reconnectDataFolder}>
                      🔓 Reconnect “{fsState.name || "your data folder"}”
                    </button>
                    <button className="picker-example-chip" onClick={forgetDataFolder}>Forget</button>
                  </div>
                  <span className="sync-when">
                    Your folder is remembered — the browser just needs one click to
                    re-allow saving after a restart.
                  </span>
                </>
              )}
              {fsState.status === "granted" && (
                <>
                  <div className="sync-actions" style={{ marginTop: 6 }}>
                    <button className="btn btn-primary" style={{ padding: "8px 16px", fontSize: 14 }} onClick={saveArchive}>
                      💾 Save everything now
                    </button>
                    <span className="sync-when" style={{ margin: 0 }}>✓ Saving to “{fsState.name || "your data folder"}”</span>
                    <button className="picker-example-chip" onClick={forgetDataFolder}>Forget folder</button>
                  </div>
                  <span className="sync-when">
                    Writes Backups (.json), your Quote board (Word + data), every
                    analysis, and every talk draft into tidy subfolders. A fresh
                    backup-latest.json is also kept updated automatically while the
                    app is open. (PDFs still print from their own buttons — the Word
                    copies land here.)
                  </span>
                </>
              )}
              {fsMsg && <span className="sync-when">{fsMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {talkError && <div className="picker-error">{talkError}</div>}

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

      {/* ------------------- AI SEARCH ------------------- */}
      {mode === "ai" && (
        <AiSearchMode
          index={index}
          startUrisQueue={startUrisQueue}
          listenButtons={listenButtons}
          nowPlayingUri={nowPlaying ? nowPlaying.uri : null}
          chooseTalk={chooseTalk}
          loadingUri={loadingUri}
        />
      )}

      {/* ------------------- INSIGHTS ------------------- */}
      {mode === "insights" && (
        <InsightsMode
          index={index}
          presidencies={PRESIDENCIES}
          startUrisQueue={startUrisQueue}
          nowPlayingUri={nowPlaying ? nowPlaying.uri : null}
          chooseTalk={chooseTalk}
          loadingUri={loadingUri}
          sharedId={sharedAnalysisId}
        />
      )}

      {/* ------------------- QUOTE BOARD ------------------- */}
      {mode === "quotes" && (
        <QuoteBoard
          quotes={quotes}
          onDelete={deleteQuote}
          onSetTags={setQuoteTags}
          startUrisQueue={startUrisQueue}
          nowPlayingUri={nowPlaying ? nowPlaying.uri : null}
          onUseInTalk={(q) => { setStudioSeedId(q.id); setMode("studio"); }}
        />
      )}
      {mode === "quotes" && (
        <div className="clip-shelf">
          <h3 className="prog-h">
            🎬 Clips
            <span className="prog-hint"> — snipped with ✂️ on the player; audio + video clips for presentations</span>
          </h3>
          {clipMsg && <p className="note">{clipMsg}</p>}
          {clips.length === 0 ? (
            <p className="note">
              While a talk plays, tap ✂️ on the player, mark the start and end
              of the passage, and save — the clip lands in your data folder
              (or Downloads) and is listed here for re-cutting anytime.
            </p>
          ) : (
            clips.map((c) => (
              <div className="quote-card quote-with-face" key={c.id}>
                <SpeakerFace name={c.speaker} size={44} />
                <div className="quote-body">
                <p className="quote-text" style={{ fontStyle: "normal", marginTop: 0 }}>{c.kind === "video" ? "🎥" : "🎬"} {c.name}</p>
                <div className="quote-cite">
                  {fmtClock(c.start)}–{fmtClock(c.end)} ({fmtClock(c.end - c.start)}) of “{c.title}” —{" "}
                  <strong>{c.speaker}</strong>, {c.when} General Conference
                </div>
                <div className="quote-actions">
                  <button className="picker-talk-listen" onClick={() => regenerateClip(c)}>
                    ⬇ WAV
                  </button>
                  {c.videoUrl && (
                    <a
                      className="picker-talk-read"
                      href={`${c.videoUrl}?download=true`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Official talk video (MP4) — trim to ${fmtClock(c.start)}–${fmtClock(c.end)} in your slides app`}
                    >
                      🎬 MP4 ↓
                    </a>
                  )}
                  <button
                    className="picker-talk-listen"
                    onClick={() =>
                      startUrisQueue({ id: `quote|${c.uri}`, label: c.title, uris: [c.uri], order: "newest" })
                    }
                  >
                    ▶ Play talk
                  </button>
                  <button className="quote-del" onClick={() => deleteClip(c.id)}>✕</button>
                </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ------------------- TALK BUILDER ------------------- */}
      {mode === "studio" && (
        <TalkStudio key={studioSeedId || "studio"} quotes={quotes} seedQuoteId={studioSeedId} />
      )}

      {/* ------------------- BECOMING ------------------- */}
      {mode === "progress" && (
        <ProgressBoard
          index={index}
          listened={listened}
          listenDays={listenDays}
          bookmarks={bookmarks}
          startUrisQueue={startUrisQueue}
          journal={journal}
          onUpdateEntry={updateJournalEntry}
          onDeleteEntry={deleteJournalEntry}
          nowPlayingUri={nowPlaying ? nowPlaying.uri : null}
        />
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

      {/* ------------------- CONTINUE LISTENING (last section) --- */}
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
                  {orderText(bm.order)}
                </span>
                <span className="prog-bar resume-card-bar">
                  <span
                    className="prog-bar-fill"
                    style={{ width: `${Math.round(((bm.idx + 1) / Math.max(1, bm.total)) * 100)}%` }}
                  />
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

      {/* ------------------- FOLLOW-ALONG READER ------------------- */}
      {readerOpen && player && nowPlaying && (
        <div
          className={`reader-panel${watchOpen ? " with-video" : ""}`}
          style={{ bottom: barH }}
          onWheel={() => { userScrollAtRef.current = Date.now(); }}
          onTouchMove={() => { userScrollAtRef.current = Date.now(); }}
        >
          <div className="reader-head">
            <span className="reader-title">{(readerDoc && readerDoc.title) || nowPlaying.title}</span>
            <span className="reader-tools">
              <button
                className="picker-example-chip"
                title="Highlight running early? Push the text later."
                onClick={() => setReaderOffset((o) => o + 5)}
              >
                +5s
              </button>
              <button
                className="picker-example-chip"
                title="Highlight running late? Pull the text earlier."
                onClick={() => setReaderOffset((o) => o - 5)}
              >
                −5s
              </button>
              {readerOffset !== 0 && (
                <span className="reader-offset">sync {readerOffset > 0 ? "+" : ""}{readerOffset}s</span>
              )}
              <button className="resume-card-x" title="Close the reader" onClick={() => setReaderOpen(false)}>
                ✕
              </button>
            </span>
          </div>
          {readerDoc && readerDoc.status === "loading" && (
            <p className="note" style={{ margin: "12px 16px" }}>Loading the talk text…</p>
          )}
          {readerDoc && readerDoc.status === "error" && (
            <p className="note" style={{ margin: "12px 16px" }}>Couldn't load this talk's text.</p>
          )}
          {readerDoc && readerDoc.status === "ready" && (
            <div
              className="reader-body"
              ref={readerBodyRef}
              onMouseUp={handleReaderSelection}
              onTouchEnd={handleReaderSelection}
            >
              {readerDoc.summary && (
                <div className="reader-kicker">
                  <span className="reader-kicker-tag">Printed summary — not part of the audio</span>
                  <p>{readerDoc.summary}</p>
                </div>
              )}
              {readerDoc.paragraphs.map((p, i) => (
                <p
                  key={i}
                  ref={(el) => { paraRefs.current[i] = el; }}
                  className={`reader-para ${i === readerPara ? "current" : ""}`}
                  title="Tap to play from this paragraph — or highlight text to save a quote"
                  onClick={() => { if (!quotePop) seekToParagraph(i); }}
                >
                  {p}
                </p>
              ))}
            </div>
          )}
          {quotePop && (
            <button
              className="quote-pop"
              style={{ top: quotePop.top, left: quotePop.left }}
              onClick={saveQuoteFromSelection}
            >
              💬 Save quote
            </button>
          )}
          {quoteToast && <div className="quote-toast">{quoteToast}</div>}
        </div>
      )}

      {/* ------------------- AUDIO CLIP PANEL ------------------- */}
      {clipPanel && player && (
        <ClipPanel
          talk={clipPanel}
          audioRef={audioRef}
          bottom={barH}
          resolveMedia={() => resolveMedia(clipPanel)}
          onSaveClip={(clip) => deliverClip(clip, clipPanel)}
          onClose={() => setClipPanel(null)}
        />
      )}

      {/* ------------------- BECOMING JOURNAL PANEL ------------------- */}
      {journalPanel && (
        <JournalPanel
          talk={journalPanel}
          entries={journal.filter((e) => e.uri === journalPanel.uri)}
          bottom={barH}
          onSave={(text) => {
            addJournalEntry(journalPanel, text);
          }}
          onClose={() => setJournalPanel(null)}
        />
      )}

      {/* End-of-talk nudge: the moment to record what to apply. */}
      {journalNudge && !journalPanel && (
        <button
          className="journal-nudge"
          style={{ bottom: barH + 8 }}
          onClick={() => openJournalFor(journalNudge)}
        >
          🌱 “{journalNudge.title.slice(0, 44)}{journalNudge.title.length > 44 ? "…" : ""}” just ended —
          what will you apply?
        </button>
      )}

      {/* ------------------- LISTEN BAR (playlist player) ------------------- */}
      {/* Always mounted so the <audio> element (and playback) survives
          re-renders; hidden until a queue is started. */}
      <div className="listen-bar" ref={barRef} style={{ display: player ? "flex" : "none" }}>
        {nowPlaying && (
          <div className="listen-info" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SpeakerFace name={nowPlaying.speaker || player.label} size={44} />
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="listen-speaker">
              {player.label}
              {streakData.current >= 2 && (
                <span className="listen-streak" title={`${streakData.current} days of listening in a row`}>
                  🔥{streakData.current}
                </span>
              )}
            </span>
            <span className="listen-title">{nowPlaying.title}</span>
            <span className="listen-when">
              {nowPlaying.speaker && nowPlaying.speaker !== player.label
                ? `${nowPlaying.speaker} · `
                : ""}
              {monthName(nowPlaying.month)} {nowPlaying.year} General Conference
              {" · "}{player.idx + 1} of {player.queue.length}
              {" · "}{orderText(player.order)}
              {playerStatus === "loading" ? " · loading…" : ""}
            </span>
            {playerError && <span className="listen-note">{playerError}</span>}
            </div>
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
          <video
            ref={audioRef}
            controls
            playsInline
            preload="none"
            className={`listen-audio${watchOpen ? " listen-video-float" : ""}${watchOpen && readerOpen ? " with-reader" : ""}`}
            style={watchOpen ? { bottom: barH + 8 } : undefined}
            onEnded={handleEnded}
            onTimeUpdate={handleTimeUpdate}
            onPause={() => writeBookmark()}
            onLoadedMetadata={(e) => setAudioDuration(e.target.duration || 0)}
            onDurationChange={(e) => setAudioDuration(e.target.duration || 0)}
          />
          <button
            className={`listen-btn ${watchOpen ? "active" : ""}`}
            title="Watch the talk video (📺 on/off — audio keeps your place)"
            onClick={toggleWatch}
            disabled={!nowPlaying}
          >
            📺
          </button>
          <button
            className={`listen-btn listen-reader-btn ${readerOpen ? "active" : ""}`}
            title="Follow along — the talk text scrolls with the audio"
            onClick={() => { setJournalPanel(null); setReaderOpen(!readerOpen); }}
          >
            📖
          </button>
          <button
            className={`listen-btn ${journalPanel ? "active" : ""}`}
            title="Becoming journal — what will you apply from this talk?"
            onClick={() => (journalPanel ? setJournalPanel(null) : openJournalFor(nowPlaying))}
            disabled={!nowPlaying}
          >
            ✍️
          </button>
          <button
            className={`listen-btn ${clipPanel ? "active" : ""}`}
            title="Snip an audio clip from this talk (saves a .wav for presentations)"
            onClick={() => (clipPanel ? setClipPanel(null) : openClipFor(nowPlaying))}
            disabled={!nowPlaying}
          >
            ✂️
          </button>
          <button
            className="listen-btn"
            title="That would make a good song! Load this talk into the Lyric Creator"
            onClick={() => nowPlaying && chooseTalk(nowPlaying)}
            disabled={!nowPlaying || busy}
          >
            {nowPlaying && loadingUri === nowPlaying.uri ? "…" : "🎵"}
          </button>
          {player && (
            <SonosButton
              className="listen-btn"
              label="🔊"
              title="Play this list on the house Sonos, from this talk onward (home Wi-Fi only)"
              talks={player.queue.slice(player.idx, player.idx + 40).map((t) => t.uri)}
            />
          )}
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
