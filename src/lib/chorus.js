// src/lib/chorus.js
//
// Where the first chorus is sung, from the lyric sync. The chorus is the
// "preview" of a song: the Concert library plays it as the song's preview,
// and the vertical Reel / Short uses it as its music.
//
// Finding the chorus: the first [Chorus] label (not a pre-chorus) and the sung
// lines under it, up to the next label. Lyrics without labels fall back to
// the first stanza whose words repeat most (the same rule the Concert app's
// games use).
//
// sync: [[lineIndex, seconds], ...] (see lyric-sync.js); totalSec: song length.
// Returns { start, end, first, last, source: "label" | "repeat" } or null.

import { lyricLines, isSectionLine, parseSync } from "./lyric-sync.js";

const LEAD_IN = 0.4;   // start a hair before the first word so it isn't clipped
const TAIL = 0.3;      // and end a hair before the next section's first word

const normLine = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

// Line indices [first, last] of the first chorus, or null.
export function firstChorusLines(lyrics) {
  const lines = lyricLines(lyrics);
  const sung = (i) => lines[i] != null && lines[i].trim() && !isSectionLine(lines[i]);
  // 1) a [Chorus] label
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[\s*([^\]]*)\]\s*$/.exec(lines[i]);
    if (!m || !/^(?:(?:first|1st|main|final|last)\s+)?chorus\b/i.test(m[1].trim())) continue;
    let first = -1, last = -1;
    for (let j = i + 1; j < lines.length && !isSectionLine(lines[j]); j++) {
      if (sung(j)) { if (first < 0) first = j; last = j; }
    }
    if (first >= 0) return { first, last, source: "label" };
  }
  // 2) the stanza that repeats most
  const stanzas = [];
  let cur = null;
  lines.forEach((ln, i) => {
    if (!ln.trim() || isSectionLine(ln)) { cur = null; return; }
    if (!cur) { cur = { first: i, last: i, words: [] }; stanzas.push(cur); }
    cur.last = i;
    cur.words.push(normLine(ln));
  });
  const keyOf = (s) => s.words.join(" ");
  const counts = {};
  for (const s of stanzas) if (s.words.length >= 2) counts[keyOf(s)] = (counts[keyOf(s)] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (max < 2) return null;
  const hit = stanzas.find((s) => s.words.length >= 2 && counts[keyOf(s)] === max);
  return hit ? { first: hit.first, last: hit.last, source: "repeat" } : null;
}

// Seconds of the first chorus in the song, from the sync.
export function firstChorusWindow(lyrics, rawSync, totalSec = 0) {
  const sync = parseSync(lyrics, rawSync);
  const span = firstChorusLines(lyrics);
  if (!sync || !span) return null;
  const at = new Map(sync);
  // the chorus's first timed line (a missing mark falls to the next timed one)
  let startT = null;
  for (let i = span.first; i <= span.last && startT == null; i++) if (at.has(i)) startT = at.get(i);
  if (startT == null) return null;
  // it ends where the next sung line after the chorus starts…
  const lines = lyricLines(lyrics);
  let endT = null;
  for (let i = span.last + 1; i < lines.length && endT == null; i++) if (at.has(i) && at.get(i) > startT) endT = at.get(i) - TAIL;
  // …or, when the chorus closes the song, a line's length after its last line.
  if (endT == null) {
    const lastT = [...at.entries()].filter(([i]) => i >= span.first && i <= span.last).reduce((m, [, t]) => Math.max(m, t), startT);
    const times = [...at.entries()].filter(([i]) => i >= span.first && i <= span.last).map(([, t]) => t).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, k) => t - times[k]).filter((g) => g > 0);
    const lineLen = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 4;
    endT = lastT + Math.max(2.5, Math.min(8, lineLen * 1.2));
    if (totalSec > 0) endT = Math.min(endT, totalSec);
  }
  const start = Math.max(0, startT - LEAD_IN);
  if (!(endT > start + 3)) return null;
  return { start: Math.round(start * 10) / 10, end: Math.round(endT * 10) / 10, first: span.first, last: span.last, source: span.source };
}

// The preview window to use: a hand-set one wins, then the first chorus,
// then nothing (the caller decides a fallback).
export function previewWindow(timeline, lyrics, rawSync, totalSec = 0) {
  const p = timeline && timeline.preview;
  if (p && Number(p.end) > Number(p.start)) return { start: Number(p.start), end: Number(p.end), source: "manual" };
  return firstChorusWindow(lyrics, rawSync, totalSec);
}
