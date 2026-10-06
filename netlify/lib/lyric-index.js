// netlify/lib/lyric-index.js
//
// The lyric generator writes the song while reading the talk, so it can say
// where every line came from. It appends a small block after the lyrics:
//
//   ===SOURCES===
//   1: 3 | "the focus of our lives"
//   2: 3,4 | "regardless of what is happening"
//   3: - |
//
// n = the nth SUNG line (section labels and blank lines don't count),
// p = talk paragraph numbers (1-based, as numbered in the prompt), and the
// quoted phrase is the talk wording the line echoes. These helpers split the
// talk the same way the browser does, and parse the block back out.

export function splitParagraphs(talkText) {
  return String(talkText || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 20);
}

export function sungLines(lyrics) {
  return String(lyrics || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]+\]$/.test(l));
}

// Returns { lyrics, map } — lyrics with the block removed; map keyed by
// 0-based sung-line index → { paragraphs: [0-based...], phrase, confidence }.
export function parseSourcesBlock(text, paragraphCount) {
  const raw = String(text || "");
  const m = raw.match(/\n\s*=+\s*SOURCES\s*=+\s*\n?/i);
  if (!m) return { lyrics: raw.trim(), map: null };
  const lyrics = raw.slice(0, m.index).trim();
  const block = raw.slice(m.index + m[0].length);
  const map = {};
  for (const line of block.split("\n")) {
    const mm = line.match(/^\s*(\d+)\s*[:.)]\s*([^|]*)\|?\s*(.*)$/);
    if (!mm) continue;
    const n = parseInt(mm[1], 10) - 1;
    const ps = mm[2].split(/[,\s]+/).map((x) => parseInt(x, 10) - 1).filter((x) => Number.isInteger(x) && x >= 0 && (!paragraphCount || x < paragraphCount));
    const phrase = mm[3].trim().replace(/^["“”']+|["“”']+$/g, "").trim();
    if (n >= 0) map[n] = { paragraphs: ps, phrase: phrase.slice(0, 200), confidence: ps.length ? 0.9 : 0 };
  }
  return { lyrics, map };
}
