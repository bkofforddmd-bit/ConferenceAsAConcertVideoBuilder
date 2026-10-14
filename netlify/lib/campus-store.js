// netlify/lib/campus-store.js
//
// Document store for Campus Sessions (workers, sessions, consents, settings…).
// Netlify Blobs when deployed — the same storage the Studio already uses for
// jobs and sync — with an in-memory Map for local development and tests.
//
// Keys are "<kind>:<id>" so a kind can be listed by prefix. Scale here is
// a handful of workers and a few hundred sessions, which Blobs handles fine
// without a database.
//
// Blobs is always tried first. Only when the environment has no Blobs
// configuration at all (local `node` runs, tests) does the store switch to
// memory — it never guesses from an environment flag, because a wrong guess
// on the live site would leave every function instance with its own private
// memory (accounts that exist on one request and vanish on the next).

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = await import("@netlify/blobs"));
} catch {
  getStoreFn = null;
}

const STORE = "campus";
const mem = new Map();
let mode = getStoreFn ? "blobs" : "memory"; // "blobs" | "memory"
let consistency = "strong";

function store() {
  return getStoreFn(STORE, { consistency });
}

// True for the errors that mean "Blobs isn't set up here" (local dev/tests),
// as opposed to a real failure on the live site.
function blobsUnavailable(e) {
  const m = String((e && e.message) || e);
  return /MissingBlobsEnvironmentError|environment has not been configured|siteID|site ID|NETLIFY_BLOBS_CONTEXT|not been configured with a/i.test(m) && !/uncachedEdgeURL/i.test(m);
}
function strongUnsupported(e) {
  return /uncachedEdgeURL/i.test(String((e && e.message) || e));
}

async function withStore(op, fallback) {
  if (mode === "blobs") {
    try {
      return await op();
    } catch (e) {
      if (strongUnsupported(e)) { consistency = "eventual"; return await op(); }
      if (blobsUnavailable(e)) { mode = "memory"; return fallback(); }
      throw e;
    }
  }
  return fallback();
}

export async function docGet(key) {
  return withStore(
    () => store().get(key, { type: "json" }),
    () => (mem.has(key) ? JSON.parse(mem.get(key)) : null)
  );
}

export async function docSet(key, value) {
  return withStore(
    async () => { await store().setJSON(key, value); return value; },
    () => { mem.set(key, JSON.stringify(value)); return value; }
  );
}

export async function docDelete(key) {
  return withStore(
    () => store().delete(key),
    () => { mem.delete(key); }
  );
}

// All documents whose key starts with `prefix`, as an array of values.
export async function docList(prefix) {
  return withStore(
    async () => {
      const { blobs } = await store().list({ prefix });
      const out = [];
      for (const b of blobs) {
        const v = await store().get(b.key, { type: "json" });
        if (v) out.push(v);
      }
      return out;
    },
    () => { const out = []; for (const [k, v] of mem) if (k.startsWith(prefix)) out.push(JSON.parse(v)); return out; }
  );
}

// Where documents are going right now: "blobs" on the live site, "memory" locally.
export function storeMode() { return mode; }

export function newId(prefix = "") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const now = () => new Date().toISOString();

// Tests only: wipe the in-memory store.
export function _resetMemory() { mem.clear(); }
