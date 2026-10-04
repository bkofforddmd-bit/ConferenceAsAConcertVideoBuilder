// src/lib/project-store.js
//
// Named projects + large media (song audio, scene video clips, the rendered
// music video) live in IndexedDB — localStorage tops out around 5 MB, which
// base64 images already strain and audio/video would blow through.
//
//   projects store: { id, title, updatedAt, data }   (data = the same JSON
//                                                    shape "Save project" downloads)
//   media store:    { key, blob, type, meta, at }    (key = `${projectId}:${slot}`)
//
// Everything degrades gracefully: if IndexedDB is unavailable (private mode,
// old browser) the functions resolve to empty results instead of throwing.

const DB_NAME = "cac-studio";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects")) {
          const s = db.createObjectStore("projects", { keyPath: "id" });
          s.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("media")) {
          db.createObjectStore("media", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) {
      reject(e);
    }
  });
}

export function newProjectId() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// ---- projects ----

export async function listProjects() {
  const db = await openDb();
  if (!db) return [];
  const rows = await new Promise((resolve) => {
    const out = [];
    try {
      const t = db.transaction("projects", "readonly");
      const req = t.objectStore("projects").openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          const { id, title, updatedAt, summary } = c.value;
          out.push({ id, title, updatedAt, summary });
          c.continue();
        } else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveProject(id, title, data, summary = {}) {
  const db = await openDb();
  if (!db) return false;
  const row = { id, title: title || "Untitled project", updatedAt: Date.now(), summary, data };
  await tx(db, "projects", "readwrite", (s) => s.put(row));
  return true;
}

export async function loadProject(id) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("projects", "readonly").objectStore("projects").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteProject(id) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, "projects", "readwrite", (s) => s.delete(id));
  // Drop that project's media too.
  const keys = await listMediaKeys(id);
  for (const k of keys) await deleteMedia(k);
  return true;
}

// ---- media blobs ----

export async function putMedia(key, blob, meta = {}) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, "media", "readwrite", (s) => s.put({ key, blob, type: blob.type, meta, at: Date.now() }));
  return true;
}

export async function getMedia(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("media", "readonly").objectStore("media").get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteMedia(key) {
  const db = await openDb();
  if (!db) return false;
  await tx(db, "media", "readwrite", (s) => s.delete(key));
  return true;
}

export async function listMediaKeys(prefix = "") {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const out = [];
    try {
      const req = db.transaction("media", "readonly").objectStore("media").openKeyCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          if (!prefix || String(c.key).startsWith(prefix)) out.push(c.key);
          c.continue();
        } else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

// Rough storage usage for the Projects panel.
export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch {}
  return { usage: 0, quota: 0 };
}
