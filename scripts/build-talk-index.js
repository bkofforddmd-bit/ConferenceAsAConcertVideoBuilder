// scripts/build-talk-index.js
//
// Builds public/talks-index.json — a flat list of every General Conference
// talk (title + speaker + link) from 1971 to the present. This powers the
// "Search by speaker" feature in the Choose-a-Talk step: the browser loads
// this static file and filters it instantly, with no per-search network calls.
//
// Source: the public conference pages on churchofjesuschrist.org. Each page
// lists its talks as <a href=".../{year}/{month}/{slug}"> links whose title
// lives in an `itemTitle` block and whose speaker lives in a `subtitle`
// paragraph. Session headers and the "Contents" entry have no subtitle, so
// they fall out naturally. This is the same content the app's
// list-conference function reads — just gathered across every conference and
// frozen into one file.
//
// Run it after each April/October conference to refresh the index:
//   node scripts/build-talk-index.js
//
// It is polite: one page at a time, a short pause between pages, one retry.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "public", "talks-index.json");
const TOPICS_OUT_PATH = join(__dirname, "..", "public", "topics-index.json");

const FIRST_YEAR = 1971; // start of the modern online archive
const MONTHS = ["04", "10"]; // April, October
const UA = "ConferenceAsAConcert/1.0 (talk index builder)";

// Slugs that are conference business, not talks — drop them from the index.
const NON_TALK = /(sustaining|solemn-assembly|auditing|audit-report|statistical-report|church-officers|the-sustaining-of|report-of-the|^contents$)/i;

function stripHtml(html) {
  return (html || "")
    .replace(/<sup[^>]*>.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&rsquo;|&apos;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse one conference page's HTML into a list of talks.
function parseConference(html, year, month) {
  const talks = [];
  const seen = new Set();
  // Each talk is an <a ...>…</a> whose href points at this conference's slug.
  const anchorRe = /<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const base = `/study/general-conference/${year}/${month}/`;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2];
    if (!href.includes(base)) continue;
    // slug = the path segment after the conference base, minus any ?query.
    const after = href.split(base)[1] || "";
    const slug = after.split(/[?#]/)[0];
    if (!slug || slug.includes("/")) continue; // sub-paths / session pages
    if (seen.has(slug)) continue;
    // Speaker lives in the subtitle paragraph. No subtitle → not a talk
    // (session header, "Contents", etc.).
    const subM = inner.match(/class="subtitle-[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    if (!subM) continue;
    const speaker = stripHtml(subM[1]);
    if (!speaker) continue;
    // Title is the first <span> inside the itemTitle block.
    const titleM = inner.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    const title = stripHtml(titleM ? titleM[1] : inner);
    if (!title) continue;
    if (NON_TALK.test(slug)) continue;
    seen.add(slug);
    talks.push({
      title,
      speaker,
      slug,
      uri: `${base}${slug}`,
      year: String(year),
      month,
    });
  }
  return talks;
}

async function fetchConference(year, month) {
  const url = `https://www.churchofjesuschrist.org/study/general-conference/${year}/${month}?lang=eng`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (res.status === 404) return { talks: [], missing: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      return { talks: parseConference(html, year, month), missing: false };
    } catch (e) {
      if (attempt === 1) return { talks: [], error: e.message };
      await sleep(1500);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const currentYear = new Date().getFullYear();
  const all = [];
  const summary = [];
  let emptyStreak = 0;

  for (let year = currentYear; year >= FIRST_YEAR; year--) {
    for (const month of MONTHS) {
      const { talks, missing, error } = await fetchConference(year, month);
      const label = `${year}/${month}`;
      if (error) {
        summary.push(`${label}: ERROR ${error}`);
      } else if (missing || talks.length === 0) {
        // Future/nonexistent conference — silently skip, but note it.
        summary.push(`${label}: (none)`);
      } else {
        all.push(...talks);
        summary.push(`${label}: ${talks.length}`);
        process.stdout.write(`  ${label}: ${talks.length} talks\n`);
      }
      await sleep(250); // be polite
    }
  }

  // Newest conferences first; stable within a conference (source order).
  all.sort((a, b) => (b.year - a.year) || (b.month.localeCompare(a.month)));

  const speakers = new Set(all.map((t) => t.speaker));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: "churchofjesuschrist.org general conference",
    talkCount: all.length,
    speakerCount: speakers.size,
    talks: all,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload));
  console.log(`\nWrote ${all.length} talks (${speakers.size} distinct speaker names) to ${OUT_PATH}`);
  const bednar = all.filter((t) => /bednar/i.test(t.speaker)).length;
  console.log(`Sanity check — talks with "Bednar" in speaker: ${bednar}`);

  await buildTopicsIndex(all);
}

// ---------------------------------------------------------------------------
// Topic index: the Church curates ~335 General Conference topic pages
// (/study/general-conference/topics/{slug}) each listing every related talk
// across the archive. We crawl them and store, per topic, the positions of
// its talks in the talks array above (indices keep the file ~10x smaller
// than repeating URI strings). talkCount is embedded so the app can detect
// a topics file that's out of step with talks-index.json.
// ---------------------------------------------------------------------------

async function fetchHtml(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 1) throw e;
      await sleep(1500);
    }
  }
}

async function buildTopicsIndex(allTalks) {
  console.log("\nBuilding topic index…");
  const listingUrl = "https://www.churchofjesuschrist.org/study/general-conference/topics?lang=eng";
  const listing = await fetchHtml(listingUrl);

  // Topic links: <a href=".../study/general-conference/topics/{slug}?lang=eng">…Name…</a>
  const topics = [];
  const seen = new Set();
  const linkRe = /<a\b[^>]*?href="([^"]*\/study\/general-conference\/topics\/([a-z0-9-]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(listing)) !== null) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const name = stripHtml(m[3]) || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    topics.push({ slug, name });
  }
  console.log(`  found ${topics.length} topics`);

  // Map uri -> index into the talks array for compact storage.
  const uriToIdx = new Map(allTalks.map((t, i) => [t.uri, i]));

  const out = [];
  for (const topic of topics) {
    try {
      const html = await fetchHtml(
        `https://www.churchofjesuschrist.org/study/general-conference/topics/${topic.slug}?lang=eng`
      );
      const idxs = new Set();
      const talkRe = /\/study\/general-conference\/(\d{4})\/(\d{2})\/([a-z0-9-]+)/g;
      let tm;
      while ((tm = talkRe.exec(html)) !== null) {
        const uri = `/study/general-conference/${tm[1]}/${tm[2]}/${tm[3]}`;
        const idx = uriToIdx.get(uri);
        if (idx !== undefined) idxs.add(idx);
      }
      if (idxs.size) {
        out.push({ name: topic.name, slug: topic.slug, t: [...idxs].sort((a, b) => a - b) });
        process.stdout.write(`  ${topic.slug}: ${idxs.size}\n`);
      }
    } catch (e) {
      console.log(`  ${topic.slug}: ERROR ${e.message}`);
    }
    await sleep(200);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "churchofjesuschrist.org general conference topics",
    talkCount: allTalks.length, // guard: must match talks-index.json
    topicCount: out.length,
    topics: out,
  };
  await writeFile(TOPICS_OUT_PATH, JSON.stringify(payload));
  console.log(`\nWrote ${out.length} topics to ${TOPICS_OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
