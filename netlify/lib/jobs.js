// netlify/lib/jobs.js
//
// Tiny job store for work that outlives a normal function call (scene image
// generation runs 30–90 s; synchronous Netlify functions get cut off well
// before that). A background function writes the job's progress and result
// here; a status function reads it back for the browser.
//
// Netlify Blobs when deployed; an in-memory Map for local development.

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = await import("@netlify/blobs"));
} catch {
  getStoreFn = null;
}
const mem = new Map();
const STORE = "studio-jobs";

export async function jobGet(id) {
  if (getStoreFn) {
    try {
      return await getStoreFn(STORE).get(id, { type: "json" });
    } catch (e) {
      if (!process.env.NETLIFY) return mem.get(id) || null;
      throw e;
    }
  }
  return mem.get(id) || null;
}

export async function jobSet(id, value) {
  const rec = { ...value, updatedAt: Date.now() };
  if (getStoreFn) {
    try {
      await getStoreFn(STORE).setJSON(id, rec);
      return;
    } catch (e) {
      if (!process.env.NETLIFY) { mem.set(id, rec); return; }
      throw e;
    }
  }
  mem.set(id, rec);
}

// Large payloads (reference images in, generated images out) live in a second
// store as base64 text, so job records and function requests stay small:
// background functions only accept ~256 KB of request body, and buffered
// function responses top out at 6 MB.
const BLOB_STORE = "studio-images";
const memBlobs = new Map();

export async function blobGetText(key) {
  if (getStoreFn) {
    try {
      return await getStoreFn(BLOB_STORE).get(key, { type: "text" });
    } catch (e) {
      if (!process.env.NETLIFY) return memBlobs.get(key) || null;
      throw e;
    }
  }
  return memBlobs.get(key) || null;
}

export async function blobSetText(key, text) {
  if (getStoreFn) {
    try {
      await getStoreFn(BLOB_STORE).set(key, text);
      return;
    } catch (e) {
      if (!process.env.NETLIFY) { memBlobs.set(key, text); return; }
      throw e;
    }
  }
  memBlobs.set(key, text);
}

export async function blobDelete(key) {
  if (getStoreFn) {
    try { await getStoreFn(BLOB_STORE).delete(key); return; } catch {}
  }
  memBlobs.delete(key);
}

export function validJobId(id) {
  return typeof id === "string" && /^[a-z0-9_-]{8,80}$/i.test(id);
}
