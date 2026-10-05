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

// A scene's lyric text as sung lines: newlines, or " / " and " | " separators
// (the storyboard AI sometimes joins lines that way), labels and blanks dropped.
export function sceneLineList(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n|\s+\/\s+|\s+\|\s+/)
    .map((x) => x.trim())
    .filter((x) => x && !isSectionLine(x));
}

// How evenly the storyboard's scenes share the sung lines. A lopsided split
// (one scene holding a huge share) makes that scene sit on screen for most of
// the song once timing follows the lyrics.
export function lyricBalance(scenes, fullLyrics) {
  const ordered = (scenes || []).slice().sort((a, b) => a.sceneNumber - b.sceneNumber);
  const counts = ordered.map((sc) => ({ scene: sc.sceneNumber, lines: sceneLineList(sc.lyrics).length }));
  const sung = singableIndices(lyricLines(fullLyrics)).length;
  const total = counts.reduce((a, c) => a + c.lines, 0);
  const max = counts.reduce((m, c) => (c.lines > m.lines ? c : m), { scene: null, lines: 0 });
  const avg = counts.length ? total / counts.length : 0;
  const lopsided = counts.length >= 3 && total >= 6 && (max.lines > 2.5 * avg || max.lines / total > 0.4);
  const sparse = sung > 0 && total < sung * 0.6; // scenes only quote a few lines each
  return { counts, sung, total, max, avg, lopsided, sparse };
}

// Split the sung lines into n contiguous, near-even runs. Cuts prefer stanza
// breaks (blank line / [Section] label) within a line of the ideal cut.
export function partitionLyrics(fullLyrics, n) {
  const lines = lyricLines(fullLyrics);
  const sung = singableIndices(lines);
  n = Math.max(1, Math.min(n, sung.length));
  if (!sung.length) return new Array(n).fill("");
  // positions (in sung order) after which a stanza break follows
  const breakAfter = new Set();
  sung.forEach((li, k) => {
    const next = lines[li + 1];
    if (next != null && (!next.trim() || isSectionLine(next))) breakAfter.add(k);
  });
  const cuts = [0];
  const minRun = Math.max(1, Math.floor(sung.length / n));
  for (let i = 1; i < n; i++) {
    const prev = cuts[cuts.length - 1];
    // share the REMAINING lines evenly among the remaining scenes
    const ideal = prev + Math.round((sung.length - prev) / (n - i + 1));
    let best = ideal;
    for (const cand of [ideal, ideal + 1, ideal - 1]) {
      if (cand - prev >= minRun && cand < sung.length && breakAfter.has(cand - 1)) { best = cand; break; }
    }
    best = Math.max(prev + 1, Math.min(sung.length - (n - i), best));
    cuts.push(best);
  }
  cuts.push(sung.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push(sung.slice(cuts[i], cuts[i + 1]).map((li) => lines[li].trim()).join("\n"));
  return out;
}

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
    const sceneLines = sceneLineList(sc.lyrics);
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
