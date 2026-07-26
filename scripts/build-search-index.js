// scripts/build-search-index.js
//
// Builds public/search-index.json — a compact full-text index of every
// General Conference talk, powering the "AI topic search" mode (free-text
// topics like "exaltation", not limited to the Church's curated topic list).
//
// Two stages, both resumable:
//   1. Fetch each talk's text into data/talk-texts/ (one JSON per talk,
//      gitignored — a local cache, re-used on later runs so refreshing after
//      a new conference only fetches the new talks).
//   2. Tokenize (shared tokenizer in src/lib/search-text.js), score terms by
//      tf-idf with a title boost, keep each talk's top terms, and write the
//      index as term -> [[talkIndex, weight 1..15], ...].
//
// Run AFTER build-talk-index.js (it reads public/talks-index.json and the
// index refers to talks by their position in that file):
//   node scripts/build-search-index.js
//
// The first run fetches ~4,000 pages politely (~45 min). Later runs are
// fast — only new talks are fetched.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokenize } from "../src/lib/search-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TALKS_PATH = join(__dirname, "..", "public", "talks-index.json");
const OUT_PATH = join(__dirname, "..", "public", "search-index.json");
const CACHE_DIR = join(__dirname, "..", "data", "talk-texts");
const UA = "ConferenceAsAConcert/1.0 (search index builder)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheName(uri) {
  // /study/general-conference/2025/10/51bednar -> 2025-10-51bednar.json
  return uri.split("/study/general-conference/")[1].replace(/\//g, "-") + ".json";
}

function stripHtml(html) {
  return (html || "")
    .replace(/<sup[^>]*>.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;|&rsquo;|&apos;/g, "’").replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Same body-extraction approach as netlify/functions/fetch-talk.js: scope to
// the article, drop figures, collect every <p>.
function extractText(html) {
  let scope = html;
  const artStart = html.search(/<article\b/i);
  const artEnd = html.search(/<\/article>/i);
  if (artStart !== -1 && artEnd > artStart) scope = html.slice(artStart, artEnd);
  const cleaned = scope
    .replace(/<figure[\s\S]*?<\/figure>/gi, " ")
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, " ");
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const t = stripHtml(m[1]);
    if (t && t.length > 1 && !/^Notes?$/i.test(t)) out.push(t);
  }
  return out.join("\n");
}

async function fetchTalkText(talk) {
  const url = `https://www.churchofjesuschrist.org${talk.uri}?lang=eng`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const text = extractText(html);
      if (!text || text.length < 200) throw new Error("extracted text too short");
      return text;
    } catch (e) {
      if (attempt === 1) throw e;
      await sleep(1500);
    }
  }
}

async function main() {
  const talksIdx = JSON.parse(await readFile(TALKS_PATH, "utf8"));
  const talks = talksIdx.talks;
  await mkdir(CACHE_DIR, { recursive: true });

  // ---- stage 1: ensure every talk's text is cached locally ----
  let fetched = 0, cached = 0, failed = 0;
  for (let i = 0; i < talks.length; i++) {
    const t = talks[i];
    const file = join(CACHE_DIR, cacheName(t.uri));
    try {
      await access(file);
      cached++;
      continue;
    } catch {}
    try {
      const text = await fetchTalkText(t);
      await writeFile(file, JSON.stringify({ uri: t.uri, title: t.title, speaker: t.speaker, text }));
      fetched++;
      if (fetched % 50 === 0) console.log(`  fetched ${fetched} (${i + 1}/${talks.length})`);
    } catch (e) {
      failed++;
      console.log(`  FAILED ${t.uri}: ${e.message}`);
    }
    await sleep(120); // be polite
  }
  console.log(`Texts: ${cached} cached, ${fetched} fetched, ${failed} failed`);

  // ---- stage 2: build the index ----
  console.log("Indexing…");
  const perTalk = new Array(talks.length).fill(null);
  const df = new Map(); // term -> number of talks containing it

  for (let i = 0; i < talks.length; i++) {
    const t = talks[i];
    let doc;
    try {
      doc = JSON.parse(await readFile(join(CACHE_DIR, cacheName(t.uri)), "utf8"));
    } catch {
      continue; // no text — talk just won't be searchable
    }
    const tf = new Map();
    for (const term of tokenize(doc.text)) tf.set(term, (tf.get(term) || 0) + 1);
    // Title terms get a strong boost — a talk titled "Exaltation" should
    // outrank one that mentions the word twice in passing.
    for (const term of tokenize(t.title)) tf.set(term, (tf.get(term) || 0) + 12);
    perTalk[i] = tf;
    for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }

  const N = talks.length;
  const TOP_TERMS = 140;
  const postings = new Map(); // term -> [[i, w], ...]

  for (let i = 0; i < talks.length; i++) {
    const tf = perTalk[i];
    if (!tf) continue;
    const scored = [];
    for (const [term, f] of tf) {
      const d = df.get(term) || 1;
      if (d < 2 && f < 3) continue; // hapax noise
      const idf = Math.log(1 + N / d);
      scored.push([term, (1 + Math.log(f)) * idf]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const kept = scored.slice(0, TOP_TERMS);
    const max = kept.length ? kept[0][1] : 1;
    for (const [term, s] of kept) {
      const w = Math.max(1, Math.round((s / max) * 15));
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([i, w]);
    }
  }

  const index = {
    generatedAt: new Date().toISOString(),
    talkCount: N, // guard: must match talks-index.json
    termCount: postings.size,
    terms: Object.fromEntries(postings),
  };
  await writeFile(OUT_PATH, JSON.stringify(index));
  const kb = Math.round(JSON.stringify(index).length / 1024);
  console.log(`Wrote ${postings.size} terms for ${N} talks to ${OUT_PATH} (~${kb} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
