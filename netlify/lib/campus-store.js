// netlify/lib/campus-store.js
//
// Document store for Campus Sessions (workers, sessions, consents, settings…).
// Netlify Blobs when deployed — the same storage the Studio already uses for
// jobs and sync — with an in-memory Map for local development and tests.
//
// Keys are "<kind>:<id>" so a kind can be listed by prefix. Scale here is
// a handful of workers and a few hundred sessions, which Blobs handles fine
// without a database.

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = await import("@netlify/blobs"));
} catch {
  getStoreFn = null;
}

const STORE = "campus";
const mem = new Map();
let useMem = !process.env.NETLIFY;

function store() {
  return getStoreFn(STORE, { consistency: "strong" });
}

export async function docGet(key) {
  if (!useMem && getStoreFn) {
    try { return await store().get(key, { type: "json" }); } catch (e) { if (process.env.NETLIFY) throw e; useMem = true; }
  }
  return mem.has(key) ? JSON.parse(mem.get(key)) : null;
}

export async function docSet(key, value) {
  if (!useMem && getStoreFn) {
    try { await store().setJSON(key, value); return value; } catch (e) { if (process.env.NETLIFY) throw e; useMem = true; }
  }
  mem.set(key, JSON.stringify(value));
  return value;
}

export async function docDelete(key) {
  if (!useMem && getStoreFn) {
    try { await store().delete(key); return; } catch (e) { if (process.env.NETLIFY) throw e; useMem = true; }
  }
  mem.delete(key);
}

// All documents whose key starts with `prefix`, as an array of values.
export async function docList(prefix) {
  if (!useMem && getStoreFn) {
    try {
      const { blobs } = await store().list({ prefix });
      const out = [];
      for (const b of blobs) {
        const v = await store().get(b.key, { type: "json" });
        if (v) out.push(v);
      }
      return out;
    } catch (e) { if (process.env.NETLIFY) throw e; useMem = true; }
  }
  const out = [];
  for (const [k, v] of mem) if (k.startsWith(prefix)) out.push(JSON.parse(v));
  return out;
}

export function newId(prefix = "") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const now = () => new Date().toISOString();

// Tests only: wipe the in-memory store.
export function _resetMemory() { mem.clear(); }
