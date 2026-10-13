// v2 of the scripture index: footnoted citations (citations.jsonl) PLUS
//   - unmarked quotations found by matching talk text against the scriptures (scriptures.jsonl + talk-text.jsonl)
//   - people mentioned in the body ("President Kimball taught", "Elder Maxwell", "Joseph Smith said")
// Each ref gains a 5th element: 0 = cited (footnote/anchor), 1 = quoted in the text without a citation.
// Each talk gains q (footnote people) and m (people mentioned in the text).
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const dir = path.join(ROOT, "data") + path.sep;
const pub = path.join(ROOT, "public") + path.sep;
fs.mkdirSync(dir, { recursive: true });

const base = JSON.parse(fs.readFileSync(dir + "scripture-index.v1.json", "utf8"));
const idx = JSON.parse(fs.readFileSync(pub + "talks-index.json", "utf8"));
// Cache lines are keyed by uri (positions shift whenever a conference is added); fall back to the stored position for legacy lines.
const uriToIdx = new Map(idx.talks.map((t, i) => [t.uri, i]));
const pos = (r) => (r.uri && uriToIdx.has(r.uri) ? uriToIdx.get(r.uri) : r.i);

const bookIdx = new Map(base.books.map((b, i) => [b.key, i]));
const readJsonl = (f) => fs.existsSync(dir + f) ? fs.readFileSync(dir + f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ---- talk text ----
const text = new Map();
for (const r of readJsonl("talk-text.jsonl")) if (!r.error && r.p) text.set(pos(r), r.p.join("\n"));
console.log("talk texts", text.size);

// ---- scripture shingles (8-word windows → verse) ----
const normWords = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
const N = 8;
const shingle = new Map(); // key → [bookIdx, chapter, verse]
const shingleVerses = new Map(); // key → number of distinct verses containing it
let verses = 0;
for (const ch of readJsonl("scriptures.jsonl")) {
  if (ch.error || !bookIdx.has(ch.key)) continue;
  for (const [v, t] of ch.verses || []) {
    verses++;
    const w = normWords(t);
    const seenHere = new Set();
    for (let i = 0; i + N <= w.length; i++) {
      const k = w.slice(i, i + N).join(" ");
      if (seenHere.has(k)) continue; seenHere.add(k);
      shingleVerses.set(k, (shingleVerses.get(k) || 0) + 1);
      if (!shingle.has(k)) shingle.set(k, [bookIdx.get(ch.key), ch.chapter, v]);
    }
  }
}
// drop phrases shared by several verses ("and it came to pass that…") — they can't identify a quotation
let ambiguous = 0;
for (const [k, n] of shingleVerses) if (n > 2) { shingle.delete(k); ambiguous++; }
// drop phrases that are simply conference boilerplate (the Church's name, the closing "in the name of Jesus Christ, amen"):
// anything that appears in more than 1% of talks
const talkFreq = new Map();
for (const [, body] of text) {
  const w = normWords(body); const seen = new Set();
  for (let i = 0; i + N <= w.length; i++) { const k = w.slice(i, i + N).join(" "); if (shingle.has(k) && !seen.has(k)) { seen.add(k); talkFreq.set(k, (talkFreq.get(k) || 0) + 1); } }
}
let boiler = 0;
for (const [k, n] of talkFreq) if (n > Math.max(10, text.size * 0.01)) { shingle.delete(k); boiler++; }
console.log("verses", verses, "shingles", shingle.size, "| dropped ambiguous", ambiguous, "boilerplate", boiler);

// ---- people patterns for the body text ----
const PRES = [["Joseph Smith", 1830, 1844], ["Brigham Young", 1847, 1877], ["John Taylor", 1880, 1887], ["Wilford Woodruff", 1889, 1898], ["Lorenzo Snow", 1898, 1901], ["Joseph F. Smith", 1901, 1918], ["Heber J. Grant", 1918, 1945], ["George Albert Smith", 1945, 1951], ["David O. McKay", 1951, 1970], ["Joseph Fielding Smith", 1970, 1972], ["Harold B. Lee", 1972, 1973], ["Spencer W. Kimball", 1973, 1985], ["Ezra Taft Benson", 1985, 1994], ["Howard W. Hunter", 1994, 1995], ["Gordon B. Hinckley", 1995, 2008], ["Thomas S. Monson", 2008, 2018], ["Russell M. Nelson", 2018, 2026], ["Dallin H. Oaks", 2026, 2100]];
const people = base.people.slice();
const peopleIdx = new Map(people.map((p, i) => [p, i]));
const addPerson = (n) => { if (!peopleIdx.has(n)) { peopleIdx.set(n, people.length); people.push(n); } return peopleIdx.get(n); };
for (const [n] of PRES) addPerson(n);
// surname → candidate full names (from every known person)
const bySurname = new Map();
for (const p of people) { const sur = p.split(" ").pop(); if (!bySurname.has(sur)) bySurname.set(sur, []); bySurname.get(sur).push(p); }
const fullRe = people.map((p) => [p, new RegExp("(^|[^A-Za-z])" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "(?![A-Za-z])")]);
const titleRe = /\b(President|Elder|Sister|Brother|Bishop|Prophet)\s+([A-Z][A-Za-z'-]+)\b/g;
function mentions(talkIdx, body) {
  const year = Number(idx.talks[talkIdx].year);
  const self = String(idx.talks[talkIdx].speaker || "").replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "");
  const found = new Set();
  for (const [p, re] of fullRe) if (p !== self && re.test(body)) found.add(p);
  let m;
  titleRe.lastIndex = 0;
  while ((m = titleRe.exec(body))) {
    const title = m[1], sur = m[2];
    const cands = (bySurname.get(sur) || []).filter((p) => p !== self);
    if (!cands.length) continue;
    let pick = null;
    if (cands.length === 1) pick = cands[0];
    else if (title === "President" || title === "Prophet") {
      // the Church President of that era, if his surname matches; else the only candidate who was ever President
      const era = PRES.find(([n, a, b]) => n.split(" ").pop() === sur && year >= a && year <= b);
      pick = era ? era[0] : (cands.filter((c) => PRES.some(([n]) => n === c)).length === 1 ? cands.find((c) => PRES.some(([n]) => n === c)) : null);
    }
    if (pick) found.add(pick);
  }
  return [...found].map((p) => peopleIdx.get(p));
}

// ---- build v2 talks ----
const talks = base.talks.map(([i, refs, q]) => {
  const refs2 = refs.map((r) => [r[0], r[1], r[2], r[3], 0]);
  const body = text.get(i);
  let m = [];
  if (body) {
    // unmarked quotations: consecutive matching shingles → one verse hit; skip verses already cited
    const cited = new Set(refs.map((r) => `${r[0]}:${r[1]}:${r[2]}`));
    const w = normWords(body);
    const seen = new Map(); // verse key → run length
    for (let k = 0; k + N <= w.length; k++) {
      const hit = shingle.get(w.slice(k, k + N).join(" "));
      if (!hit) continue;
      const key = hit.join(":");
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [key, runs] of seen) {
      if (runs < 3) continue; // at least 10 consecutive words of the verse
      const [b, c, v] = key.split(":").map(Number);
      const already = refs.some((r) => r[0] === b && r[1] === c && r[2] && v >= r[2] && v <= (r[3] || r[2]));
      if (already || cited.has(key)) continue;
      refs2.push([b, c, v, 0, 1]);
    }
    m = mentions(i, body).filter((pi) => !q.includes(pi));
  }
  return [i, refs2, q, m];
});
const quoted = talks.reduce((a, t) => a + t[1].filter((r) => r[4] === 1).length, 0);
const mentioned = talks.reduce((a, t) => a + t[3].length, 0);
const out = { ...base, version: 2, people, talks, note: base.note + " v2: refs carry a 5th flag (0 cited, 1 quoted in the text without a citation, found by matching 9+ consecutive words of a verse); m = people mentioned in the talk's own words (by full name, or title + surname resolved by era)." };
fs.writeFileSync(pub + "scripture-index.json", JSON.stringify(out));
console.log("v2 written: unmarked quotations", quoted, "| text mentions", mentioned, "| people", people.length, "| bytes", fs.statSync(pub + "scripture-index.json").size);
