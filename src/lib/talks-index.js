// src/lib/talks-index.js
//
// Loads the static talk list (public/talks-index.json) and, when a conference
// newer than the file has already been published on churchofjesuschrist.org,
// tops it up live through the list-conference function. The static file is
// rebuilt by `node scripts/build-talk-index.js` after each conference; this
// top-up means the app still finds the newest talks (speaker search, the
// "choose the talk" picker in the Video step, …) in the days or weeks before
// that rebuild is deployed.
//
// Live talks are APPENDED, never inserted at the front: the topics and search
// indexes refer to talks by their position in the static file, so existing
// positions must not move. `staticCount` is the static file's talk count for
// consumers that validate those companion indexes against it.

const CONFERENCE_MONTHS = ["04", "10"];
let cached = null;

// The conferences that should exist as of `now`, newest first (up to `max`).
export function expectedConferences(now = new Date(), max = 4) {
  const out = [];
  let year = now.getFullYear();
  let m = now.getMonth() + 1; // 1–12
  // Talks are posted on the site the weekend of conference; allow the
  // first days of the month to count the conference as published.
  let month = m >= 10 ? "10" : m >= 4 ? "04" : null;
  if (!month) { year -= 1; month = "10"; }
  while (out.length < max) {
    out.push({ year: String(year), month });
    if (month === "10") month = "04";
    else { month = "10"; year -= 1; }
  }
  return out;
}

function conferenceKey(t) { return `${t.year}-${t.month}`; }

export function flattenSessions(sessions, year, month) {
  const talks = [];
  const seen = new Set();
  for (const s of sessions || []) {
    for (const t of s.talks || []) {
      if (!t || !t.slug || seen.has(t.slug)) continue;
      if (!t.speaker) continue; // session headers / business items
      if (/(sustaining|solemn-assembly|auditing|audit-report|statistical-report|church-officers|the-sustaining-of|report-of-the|^contents$)/i.test(t.slug)) continue;
      seen.add(t.slug);
      talks.push({ title: t.title, speaker: t.speaker, slug: t.slug, uri: t.uri || `/study/general-conference/${year}/${month}/${t.slug}`, year: String(year), month: String(month), live: true });
    }
  }
  return talks;
}

async function fetchConferenceLive(year, month) {
  const res = await fetch("/.netlify/functions/list-conference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, month }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return flattenSessions(data && data.sessions, year, month);
}

// Returns the index object: { generatedAt, talkCount, staticCount, talks, liveConferences }.
// Never throws because of the live top-up — a conference that isn't posted
// yet simply isn't added.
export function loadTalksIndex() {
  if (cached) return cached;
  cached = (async () => {
    const res = await fetch("/talks-index.json", { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const talks = Array.isArray(data.talks) ? data.talks : [];
    data.talks = talks;
    data.staticCount = talks.length;
    data.liveConferences = [];
    const have = new Set(talks.map(conferenceKey));
    const missing = expectedConferences().filter((c) => !have.has(conferenceKey(c)));
    for (const c of missing) {
      try {
        const extra = await fetchConferenceLive(c.year, c.month);
        if (extra.length) {
          talks.push(...extra);
          data.liveConferences.push(c);
        }
      } catch {}
    }
    data.talkCount = talks.length;
    return data;
  })();
  cached.catch(() => { cached = null; });
  return cached;
}

// Newest conference first; stable otherwise.
export function byConferenceDesc(a, b) {
  return (Number(b.year) - Number(a.year)) || String(b.month).localeCompare(String(a.month));
}
