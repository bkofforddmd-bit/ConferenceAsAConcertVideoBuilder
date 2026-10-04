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

export function validJobId(id) {
  return typeof id === "string" && /^[a-z0-9_-]{8,80}$/i.test(id);
}
