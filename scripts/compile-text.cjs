// talk-text.jsonl → public/talk-text/<decade>.json (full text per talk) + public/word-index.json
// (word → [[talkIdx, count]...]) for instant single-word trends; phrases verify against the text chunks.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const dir = path.join(ROOT, "data") + path.sep;
const pub = path.join(ROOT, "public") + path.sep;
fs.mkdirSync(dir, { recursive: true });

const idx = JSON.parse(fs.readFileSync(pub + "talks-index.json", "utf8"));
// Cache lines are keyed by uri (positions shift whenever a conference is added); fall back to the stored position for legacy lines.
const uriToIdx = new Map(idx.talks.map((t, i) => [t.uri, i]));
const pos = (r) => (r.uri && uriToIdx.has(r.uri) ? uriToIdx.get(r.uri) : r.i);

const lines = fs.readFileSync(dir + "talk-text.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byTalk = new Map();
for (const r of lines) if (!r.error && r.p) byTalk.set(pos(r), r.p.join("\n"));
console.log("talks with text", byTalk.size, "errors", lines.filter((r) => r.error).length);

// decade chunks
fs.mkdirSync(pub + "talk-text", { recursive: true });
const chunks = {};
for (const [i, text] of byTalk) { const d = Math.floor(Number(idx.talks[i].year) / 10) * 10; (chunks[d] = chunks[d] || {})[i] = text; }
let total = 0;
for (const [d, obj] of Object.entries(chunks)) { const s = JSON.stringify(obj); fs.writeFileSync(`${pub}talk-text/d${d}.json`, s); total += s.length; console.log("chunk", d, Object.keys(obj).length, "talks", (s.length / 1048576).toFixed(1), "MB"); }

process.exit(0); // text chunks only — a per-word index would be ~50 MB; phrase search scans the chunks client-side
const STOP = new Set("the a an and or but of to in on at for with by from as is are was were be been being it its this that these those we our us you your he she his her they their them i me my will shall can may might do does did not no so than then there here when where which who whom what how all any each every some such only own same too very just also into over under again further once up down out off about above below between through during before after because while until unless if have has had".split(" "));
const words = new Map();
const wordCount = {};
const norm = (t) => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ");
for (const [i, text] of byTalk) {
  const toks = norm(text).split(/\s+/).filter(Boolean);
  wordCount[i] = toks.length;
  const counts = new Map();
  for (const w of toks) { if (w.length < 2 || STOP.has(w)) continue; counts.set(w, (counts.get(w) || 0) + 1); }
  for (const [w, c] of counts) { if (!words.has(w)) words.set(w, []); words.get(w).push([i, c]); }
}
// drop hapax junk to keep it small (words used in only one talk once)
const out = {};
let kept = 0;
for (const [w, list] of words) { if (list.length === 1 && list[0][1] === 1 && !/^[a-z]+$/.test(w)) continue; out[w] = list; kept++; }
const wi = { generated: new Date().toISOString().slice(0, 10), talks: byTalk.size, wordCount, words: out };
const s = JSON.stringify(wi);
fs.writeFileSync(pub + "word-index.json", s);
console.log("word index:", kept, "words,", (s.length / 1048576).toFixed(1), "MB; text chunks total", (total / 1048576).toFixed(1), "MB");
