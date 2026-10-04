// src/lib/lyric-sync.js
//
// Lyric sync, same model as Y-Mountain Music: a song take carries
//   sync: [[lineIndex, seconds], ...]
// — the moment each line of the FULL finalized lyrics starts. Set once with
// the tap-along editor on the Music step; the Video step derives every
// scene's start and per-line timing from it.

export function lyricLines(lyrics) {
  return String(lyrics || "").replace(/\r/g, "").split("\n");
}

export function isSectionLine(text) {
  return /^\s*\[[^\]]+\]\s*$/.test(text);
}

// Indices of lines that are actually sung (non-empty, not [Verse]/[Chorus]).
export function singableIndices(lines) {
  return lines
    .map((ln, i) => ({ i, text: ln.replace(/\s+$/, "") }))
    .filter((x) => x.text && !isSectionLine(x.text))
    .map((x) => x.i);
}

// Validated, time-sorted [[i, t], ...] or null when unusable (< 2 marks).
export function parseSync(lyrics, raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const n = lyricLines(lyrics).length;
  const out = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const i = p[0], t = p[1];
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    if (typeof t !== "number" || !isFinite(t) || t < 0) continue;
    out.push([i, t]);
  }
  if (out.length < 2) return null;
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

export function fmtStamp(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Map each storyboard scene's lyric lines onto the full lyrics' line indices
// (in order, so repeated choruses resolve to the right occurrence) and pull
// their times from the sync. Returns { starts, lineStarts, matched, total }.
//   starts:     { [sceneNumber]: seconds }          (first matched line)
//   lineStarts: { [sceneNumber]: [sec, ...] }       (one per scene line;
//                unmatched lines are interpolated between neighbours)
export function deriveSceneTiming(scenes, fullLyrics, sync, totalSec = 0) {
  const lines = lyricLines(fullLyrics);
  const timeByLine = new Map();
  for (const [i, t] of sync || []) timeByLine.set(i, t);
  const ordered = (scenes || []).slice().sort((a, b) => a.sceneNumber - b.sceneNumber);
  const starts = {};
  const lineStarts = {};
  let cursor = 0;
  let matched = 0, total = 0;

  for (const sc of ordered) {
    const sceneLines = String(sc.lyrics || "").split(/\n/).map((x) => x.trim()).filter((x) => x && !isSectionLine(x));
    const times = [];
    let sceneCursor = cursor;
    for (const text of sceneLines) {
      total++;
      const key = norm(text);
      let idx = -1;
      // exact match first, then a loose one (line starts with / contains), scanning forward
      for (let j = sceneCursor; j < lines.length && idx < 0; j++) if (norm(lines[j]) === key) idx = j;
      if (idx < 0 && key.length >= 8) {
        for (let j = sceneCursor; j < lines.length && idx < 0; j++) {
          const lj = norm(lines[j]);
          if (lj && (lj.startsWith(key) || key.startsWith(lj) || lj.includes(key))) idx = j;
        }
      }
      if (idx >= 0) {
        sceneCursor = idx + 1;
        const t = timeByLine.get(idx);
        times.push(typeof t === "number" ? t : null);
        if (typeof t === "number") matched++;
      } else {
        times.push(null);
      }
    }
    if (sceneCursor > cursor) cursor = sceneCursor;

    // Fill gaps by interpolating between known neighbours (or nudging off the edges).
    const filled = times.slice();
    for (let k = 0; k < filled.length; k++) {
      if (filled[k] != null) continue;
      let a = k - 1; while (a >= 0 && filled[a] == null) a--;
      let b = k + 1; while (b < filled.length && filled[b] == null) b++;
      if (a >= 0 && b < filled.length) filled[k] = filled[a] + ((filled[b] - filled[a]) * (k - a)) / (b - a);
      else if (a >= 0) filled[k] = filled[a] + 2.5 * (k - a);
      else if (b < filled.length) filled[k] = Math.max(0, filled[b] - 2.5 * (b - k));
    }
    if (filled.length && filled.every((x) => typeof x === "number")) {
      lineStarts[sc.sceneNumber] = filled.map((x) => Math.round(x * 100) / 100);
      starts[sc.sceneNumber] = Math.round(filled[0] * 10) / 10;
    }
  }
  // Scenes with no sung lines (or nothing matched) get placed between their neighbours.
  const nums = ordered.map((s) => s.sceneNumber);
  for (let k = 0; k < nums.length; k++) {
    if (starts[nums[k]] != null) continue;
    let a = k - 1; while (a >= 0 && starts[nums[a]] == null) a--;
    let b = k + 1; while (b < nums.length && starts[nums[b]] == null) b++;
    if (a >= 0 && b < nums.length) starts[nums[k]] = Math.round(((starts[nums[a]] + starts[nums[b]]) / 2) * 10) / 10;
    else if (a >= 0) starts[nums[k]] = Math.round((starts[nums[a]] + 4) * 10) / 10;
    else if (b < nums.length) starts[nums[k]] = Math.max(0, Math.round((starts[nums[b]] - 4) * 10) / 10);
  }
  return { starts, lineStarts, matched, total };
}
