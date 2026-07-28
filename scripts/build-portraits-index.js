// scripts/build-portraits-index.js
//
// Builds public/portraits-index.json: speaker name -> portrait image URL.
//
// Sources, in order of preference:
//   1. The General Conference speakers directory
//      (churchofjesuschrist.org/study/general-conference/speakers) — ships
//      official portraits for the current First Presidency and Quorum of the
//      Twelve, plus the canonical name + slug for every GC speaker (~575).
//   2. BYU Speeches (speeches.byu.edu/speakers/{slug}) — keeps a portrait on
//      each speaker page, and most general authorities of the last 70 years
//      have spoken there. Matched by the same name slug.
//
// Speakers found in neither place simply get no entry — the app shows an
// initials avatar instead. Re-run after each conference (fast: only fetches
// BYU pages for names not already in the existing index).
//
//   node scripts/build-portraits-index.js            # incremental
//   node scripts/build-portraits-index.js --full     # refetch everyone

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "portraits-index.json");
const FULL = process.argv.includes("--full");
const UA = { headers: { Accept: "text/html", "User-Agent": "ConferenceAsAConcert/1.0" } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeInitialState(html) {
  const m = html.match(/__INITIAL_STATE__="([A-Za-z0-9+/=]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function fetchSpeakerDirectory() {
  const res = await fetch(
    "https://www.churchofjesuschrist.org/study/general-conference/speakers?lang=eng",
    UA
  );
  if (!res.ok) throw new Error(`speakers directory responded ${res.status}`);
  const state = decodeInitialState(await res.text());
  const sections = state?.library?.["/eng/general-conference/speakers"]?.sections || [];
  const bySlug = new Map();
  for (const sec of sections) {
    for (const entry of sec.entries || []) {
      for (const item of [entry, ...(entry.items || [])]) {
        const uri = item?.uri || "";
        const m = uri.match(/\/speakers\/([a-z0-9-]+)$/);
        if (!m || !item.title) continue;
        const prev = bySlug.get(m[1]);
        // Keep the entry that has an official portrait, if any does.
        if (!prev || (!prev.src && item.src)) {
          bySlug.set(m[1], { name: item.title, slug: m[1], src: item.src || "" });
        }
      }
    }
  }
  return [...bySlug.values()];
}

async function byuPortrait(slug) {
  const res = await fetch(`https://speeches.byu.edu/speakers/${slug}/`, {
    headers: { "User-Agent": "Mozilla/5.0 (ConferenceAsAConcert crawler)" },
  });
  if (!res.ok) return "";
  const html = await res.text();
  // Portraits live under /wp-content/uploads/ — some in /jpg/, some in dated
  // folders. Skip site chrome (share cards, favicons, logos, banners).
  for (const m of html.matchAll(
    /https:\/\/[a-z0-9.]+cloudfront\.net\/wp-content\/uploads\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp)/gi
  )) {
    if (!/sharecard|favicon|logo|banner|icon|placeholder/i.test(m[0])) return m[0];
  }
  return "";
}

(async () => {
  let existing = {};
  if (!FULL && fs.existsSync(OUT)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT, "utf8")).portraits || {};
    } catch {}
  }

  console.log("Fetching the GC speakers directory…");
  const speakers = await fetchSpeakerDirectory();
  console.log(`  ${speakers.length} speakers listed.`);

  const portraits = {};
  let official = 0;
  for (const s of speakers) {
    if (s.src) {
      portraits[s.name] = s.src;
      official++;
    }
  }
  console.log(`  ${official} official portraits (current leadership).`);

  const rest = speakers.filter((s) => !portraits[s.name]);
  let hits = 0, kept = 0, misses = 0;
  for (const [i, s] of rest.entries()) {
    if (existing[s.name]) {
      portraits[s.name] = existing[s.name];
      kept++;
      continue;
    }
    try {
      const url = await byuPortrait(s.slug);
      if (url) {
        portraits[s.name] = url;
        hits++;
      } else misses++;
    } catch {
      misses++;
    }
    if ((i + 1) % 50 === 0) console.log(`  BYU: ${i + 1}/${rest.length} checked…`);
    await sleep(250);
  }
  console.log(`  BYU portraits: ${hits} new, ${kept} kept from last run, ${misses} without.`);

  fs.writeFileSync(
    OUT,
    JSON.stringify({ builtAt: new Date().toISOString(), count: Object.keys(portraits).length, portraits })
  );
  console.log(`Wrote ${OUT} — ${Object.keys(portraits).length} portraits for ${speakers.length} speakers.`);
})();
