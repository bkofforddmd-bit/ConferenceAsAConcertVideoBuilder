// netlify/functions/sync.js
//
// Cross-device sync for listening positions ("Continue listening" shelf),
// keyed by a private sync code instead of user accounts. Storage is Netlify
// Blobs — included with Netlify sites, no extra services.
//
//   POST {action:"create", state}        -> {code, state}   new code, stores state
//   POST {action:"sync", code, state}    -> {state}          merge + return
//
// The server owns the merge so two devices can't clobber each other:
// per-playlist newest-wins (by updatedAt), deletions carry timestamps
// (tombstones) so removing a card on one device removes it everywhere, and
// the playback-speed preference rides along.
//
// When Blobs isn't available (local dev without Netlify credentials), an
// in-memory store keeps the whole flow testable; data then lives only as
// long as the dev process.

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = await import("@netlify/blobs"));
} catch {
  getStoreFn = null;
}

const memStore = new Map(); // local-dev fallback

async function readState(code) {
  if (getStoreFn) {
    try {
      const store = getStoreFn("listen-sync");
      return await store.get(code, { type: "json" });
    } catch (e) {
      if (!process.env.NETLIFY) return memStore.get(code) || null;
      throw e;
    }
  }
  return memStore.get(code) || null;
}

async function writeState(code, state) {
  if (getStoreFn) {
    try {
      const store = getStoreFn("listen-sync");
      await store.setJSON(code, state);
      return;
    } catch (e) {
      if (!process.env.NETLIFY) { memStore.set(code, state); return; }
      throw e;
    }
  }
  memStore.set(code, state);
}

// Friendly, hard-to-guess codes: three words + four digits
// (~10^9 combinations; the data at stake is listening positions).
const WORDS = [
  "amber","anchor","aspen","autumn","beacon","birch","bridge","brook","canyon","cedar",
  "cliff","cloud","comet","coral","creek","dawn","delta","desert","ember","fable",
  "falcon","fern","field","flint","forest","garden","glacier","grove","harbor","haven",
  "hollow","island","juniper","lantern","ledge","linden","lumen","maple","meadow","mesa",
  "mountain","north","oak","ocean","orchard","otter","pebble","pine","prairie","quartz",
  "raven","ridge","river","saffron","sage","sequoia","shore","sierra","spruce","stone",
  "summit","sunset","thicket","timber","trail","tundra","valley","violet","walnut","willow",
];

function makeCode() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}

const normalizeState = (s) => ({
  bookmarks: (s && typeof s.bookmarks === "object" && s.bookmarks) || {},
  deleted: (s && typeof s.deleted === "object" && s.deleted) || {},
  quotes: (s && typeof s.quotes === "object" && s.quotes) || {},
  quotesDeleted: (s && typeof s.quotesDeleted === "object" && s.quotesDeleted) || {},
  listened: (s && typeof s.listened === "object" && s.listened) || {},
  journal: (s && typeof s.journal === "object" && s.journal) || {},
  journalDeleted: (s && typeof s.journalDeleted === "object" && s.journalDeleted) || {},
  speed: s && typeof s.speed === "number" ? s.speed : null,
  speedUpdatedAt: (s && s.speedUpdatedAt) || 0,
});

// Newest-wins merge of two sync states.
function mergeStates(a, b) {
  const A = normalizeState(a);
  const B = normalizeState(b);
  // Deletions: keep the newest tombstone per playlist id.
  const deleted = { ...A.deleted };
  for (const [id, ts] of Object.entries(B.deleted)) {
    if (!deleted[id] || ts > deleted[id]) deleted[id] = ts;
  }
  // Bookmarks: newest updatedAt wins; a newer tombstone beats the bookmark.
  const bookmarks = {};
  for (const src of [A.bookmarks, B.bookmarks]) {
    for (const [id, bm] of Object.entries(src)) {
      if (!bm || typeof bm !== "object") continue;
      const existing = bookmarks[id];
      if (!existing || (bm.updatedAt || 0) > (existing.updatedAt || 0)) bookmarks[id] = bm;
    }
  }
  for (const [id, ts] of Object.entries(deleted)) {
    if (bookmarks[id] && ts >= (bookmarks[id].updatedAt || 0)) delete bookmarks[id];
  }
  // Quotes: same newest-wins + tombstone rules as bookmarks.
  const quotesDeleted = { ...A.quotesDeleted };
  for (const [id, ts] of Object.entries(B.quotesDeleted)) {
    if (!quotesDeleted[id] || ts > quotesDeleted[id]) quotesDeleted[id] = ts;
  }
  const quotes = {};
  for (const src of [A.quotes, B.quotes]) {
    for (const [id, q] of Object.entries(src)) {
      if (!q || typeof q !== "object") continue;
      const existing = quotes[id];
      if (!existing || (q.updatedAt || 0) > (existing.updatedAt || 0)) quotes[id] = q;
    }
  }
  for (const [id, ts] of Object.entries(quotesDeleted)) {
    if (quotes[id] && ts >= (quotes[id].updatedAt || 0)) delete quotes[id];
  }
  // Listening history: pure union — hearing a talk is never un-heard.
  // Keep the newest listen date and the highest listen count per talk.
  const listened = { ...A.listened };
  for (const [uri, rec] of Object.entries(B.listened)) {
    if (!rec || typeof rec !== "object") continue;
    const e = listened[uri];
    listened[uri] = {
      at: !e || String(rec.at || "") > String(e.at || "") ? rec.at : e.at,
      n: Math.max((e && e.n) || 0, rec.n || 1),
    };
  }
  // Becoming journal: same newest-wins + tombstone rules as quotes.
  const journalDeleted = { ...A.journalDeleted };
  for (const [id, ts] of Object.entries(B.journalDeleted)) {
    if (!journalDeleted[id] || ts > journalDeleted[id]) journalDeleted[id] = ts;
  }
  const journal = {};
  for (const src of [A.journal, B.journal]) {
    for (const [id, e] of Object.entries(src)) {
      if (!e || typeof e !== "object") continue;
      const existing = journal[id];
      if (!existing || (e.updatedAt || 0) > (existing.updatedAt || 0)) journal[id] = e;
    }
  }
  for (const [id, ts] of Object.entries(journalDeleted)) {
    if (journal[id] && ts >= (journal[id].updatedAt || 0)) delete journal[id];
  }
  // Speed preference: newest change wins.
  const speedNewer = (B.speedUpdatedAt || 0) > (A.speedUpdatedAt || 0) ? B : A;
  return {
    bookmarks,
    deleted,
    quotes,
    quotesDeleted,
    listened,
    journal,
    journalDeleted,
    speed: speedNewer.speed,
    speedUpdatedAt: speedNewer.speedUpdatedAt,
    savedAt: Date.now(),
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;

  try {
    if (action === "create") {
      // Invent an unused code and store the device's current state under it.
      let code = "";
      for (let i = 0; i < 5; i++) {
        code = makeCode();
        if (!(await readState(code))) break;
      }
      const state = mergeStates(body.state, null);
      await writeState(code, state);
      return json({ code, state });
    }

    if (action === "sync") {
      const code = String(body.code || "").trim().toLowerCase();
      if (!/^[a-z]+-[a-z]+-[a-z]+-\d{4}$/.test(code)) {
        return json({ error: "That doesn't look like a sync code (word-word-word-1234)." }, 400);
      }
      const remote = await readState(code);
      if (remote === null || remote === undefined) {
        return json({ error: "Sync code not found. Check the spelling, or create a new code on your other device." }, 404);
      }
      const merged = mergeStates(remote, body.state);
      await writeState(code, merged);
      return json({ state: merged });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({
      error:
        "Sync storage isn't available. If this is a fresh deploy, Netlify Blobs may need a moment (or enabling) — try again shortly.",
      detail: String(e && e.message),
    }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
