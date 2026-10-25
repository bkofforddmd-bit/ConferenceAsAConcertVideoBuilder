// src/lib/talk-companion.js
//
// The talk and the song side by side: every sung line of the lyrics tied to
// the talk paragraph it came from, the exact phrase it echoes, and (when the
// lyrics are synced) the moment it is sung. The Studio shows it as a split
// view and renders it as a split-screen video; the Conference Concert app gets
// the same map (no talk text: the app reads the talk itself from
// churchofjesuschrist.org and finds each paragraph again by its opening words).
//
// sources: the project's lyricSources ({ lines:[text], map:{ lineIdx:{ paragraphs:[i], phrase, confidence } } })
// sync:    [[fullLyricsLineIndex, seconds], ...]

import { lyricLines, isSectionLine, parseSync } from "./lyric-sync.js";

const STOP = new Set("the and that this with from your you our are was were for have has had not but all his her him she they them their there then than what when where which who will would shall should could into unto upon been being its it's i'm we're let me my mine thy thee thou yet very more most some such only also just like can may".split(" "));
const stem = (w) => w.replace(/(ings|ing|edly|ed|es|s)$/i, "");
export function tokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).map((w) => w.replace(/^'|'$/g, "")).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// The talk's paragraphs (same split the Studio uses everywhere).
export function talkParagraphs(talkText) {
  return String(talkText || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 20);
}

// A paragraph's "anchor": its first words, normalised; enough to find the same
// paragraph again in another copy of the talk.
export const anchorOf = (p) => norm(p).split(" ").slice(0, 10).join(" ");

// Paragraph(s) for a line by shared rare words (fallback when nothing traced it).
export function matchLineToParagraphs(line, paragraphs) {
  const docs = paragraphs.map((p) => tokens(p));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length || 1;
  const q = tokens(line);
  if (!q.length) return [];
  return docs.map((d, i) => {
    const set = new Set(d);
    let score = 0, hits = 0;
    for (const w of new Set(q)) if (set.has(w)) { hits++; score += Math.log(1 + N / (df.get(w) || 1)); }
    return { i, score, hits };
  }).filter((x) => x.hits > 0).sort((a, b) => b.score - a.score);
}

// Where in the paragraph the line's phrase sits: [start, end) character
// offsets. Uses the traced phrase when it's really in the paragraph, else the
// sentence sharing the most words with the line.
export function phraseRange(paragraph, line, phrase = "") {
  const p = String(paragraph || "");
  const ph = String(phrase || "").trim().replace(/^["“”']+|["“”'.,;:]+$/g, "");
  if (ph.length >= 6) {
    const at = p.toLowerCase().indexOf(ph.toLowerCase());
    if (at >= 0) return [at, at + ph.length];
  }
  const sentences = [];
  const re = /[^.!?]+[.!?]*["”’)]*\s*/g;
  let m;
  while ((m = re.exec(p))) { if (m[0].trim()) sentences.push([m.index, m.index + m[0].trimEnd().length]); if (m.index + m[0].length >= p.length) break; }
  const want = new Set(tokens(`${line} ${ph}`));
  let best = null, bs = 0;
  for (const [a, b] of sentences) {
    const hits = tokens(p.slice(a, b)).filter((w) => want.has(w)).length;
    if (hits > bs) { bs = hits; best = [a, b]; }
  }
  return best && bs > 0 ? best : null;
}

// Map stored source entries (keyed by the line text when they were made) onto
// the current sung lines, so later lyric edits don't orphan them.
export function resolveSources(sources, sungTexts) {
  if (!sources || !sources.map) return {};
  const stored = Array.isArray(sources.lines) ? sources.lines : null;
  if (!stored) return sources.map;
  const normed = stored.map(norm);
  const out = {};
  sungTexts.forEach((ln, li) => {
    let j = normed.indexOf(norm(ln));
    if (j < 0) {
      const t = new Set(tokens(ln));
      let best = -1, bs = 0;
      normed.forEach((sl, k) => { const tk = tokens(sl); const hits = tk.filter((w) => t.has(w)).length; const sc = hits / Math.max(1, Math.max(tk.length, t.size)); if (sc > bs) { bs = sc; best = k; } });
      if (bs >= 0.5) j = best;
    }
    if (j >= 0 && sources.map[j]) out[li] = sources.map[j];
  });
  return out;
}

// The whole map. Returns { lines:[{ i, text, section, t, p, phrase:[a,b]|null, ai }], paragraphs, traced, timed }.
export function buildCompanion({ lyrics, talkText, sources, sync }) {
  const all = lyricLines(lyrics);
  const paragraphs = talkParagraphs(talkText);
  const at = new Map(parseSync(lyrics, sync) || []);
  const sung = [];
  let section = "";
  all.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    if (isSectionLine(t)) { section = t.replace(/^\[|\]$/g, "").trim(); return; }
    sung.push({ i, text: t, section });
  });
  const traced = resolveSources(sources, sung.map((s) => s.text));
  let tracedCount = 0;
  const lines = sung.map((s, k) => {
    const tr = traced[k];
    let p = -1, phrase = "", ai = false;
    if (tr && Array.isArray(tr.paragraphs) && tr.paragraphs.length && tr.paragraphs[0] < paragraphs.length) { p = tr.paragraphs[0]; phrase = tr.phrase || ""; ai = true; tracedCount++; }
    else { const m = matchLineToParagraphs(s.text, paragraphs); if (m.length && m[0].hits >= 2) p = m[0].i; }
    const range = p >= 0 ? phraseRange(paragraphs[p], s.text, phrase) : null;
    return { i: s.i, text: s.text, section: s.section, t: at.has(s.i) ? at.get(s.i) : null, p, phrase: range, ai };
  });
  // a sung line with no mark of its own takes the time of the line before it
  let last = null;
  for (const l of lines) { if (l.t == null) l.t = last; else last = l.t; }
  return { lines, paragraphs, traced: tracedCount, timed: at.size > 0 };
}

// The compact form the Concert app stores: no talk text, just each line's
// paragraph (by number and by its opening words) and the phrase it echoes.
export function companionPayload(comp, { talkUrl = "", talkTitle = "", speaker = "" } = {}) {
  const used = new Set(comp.lines.map((l) => l.p).filter((p) => p >= 0));
  const anchors = {};
  for (const p of used) anchors[p] = anchorOf(comp.paragraphs[p]);
  return {
    v: 1, talkUrl, talkTitle, speaker,
    paragraphCount: comp.paragraphs.length,
    anchors,
    lines: comp.lines.map((l) => ({
      i: l.i, text: l.text.slice(0, 200), section: l.section.slice(0, 40), t: l.t == null ? null : Math.round(l.t * 100) / 100,
      p: l.p, phrase: l.p >= 0 && l.phrase ? comp.paragraphs[l.p].slice(l.phrase[0], l.phrase[1]).slice(0, 300) : "",
    })),
  };
}

// Which line is being sung at song time t (index into comp.lines), or -1.
export function lineAtTime(lines, t) {
  let k = -1;
  for (let j = 0; j < lines.length; j++) if (lines[j].t != null && lines[j].t <= t + 0.05) k = j;
  return k;
}
