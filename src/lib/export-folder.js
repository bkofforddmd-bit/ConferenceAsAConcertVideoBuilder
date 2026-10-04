// src/lib/export-folder.js
//
// "Save everything to my folder": writes a complete concert bundle into a
// folder the user picked once (Google Drive for Desktop, Dropbox, OneDrive,
// or any local folder) using the File System Access API (Chrome/Edge).
//
//   <Song title — YYYY-MM-DD>/
//     project.json          the same file "Download project .json" makes
//     lyrics.txt
//     images/00_Intro.png, 01_Scene1.png, …, 99_Outro.png
//     song.mp3 (or .wav)
//     video.mp4 (or .webm)
//
// The folder handle is shared with the Library's data folder (IndexedDB
// "cac-fs", key "dataFolder"), so one pick serves both.

const FS_DB = "cac-fs";

function idbHandle(op, value) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(FS_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("handles");
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("handles", op === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore("handles");
        const req = op === "get" ? store.get("dataFolder") : op === "set" ? store.put(value, "dataFolder") : store.delete("dataFolder");
        req.onsuccess = () => resolve(op === "get" ? req.result || null : true);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      };
    } catch {
      resolve(null);
    }
  });
}

export const folderSupported = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

// { status: "unsupported" | "none" | "prompt" | "granted", name, handle }
export async function getFolderState() {
  if (!folderSupported()) return { status: "unsupported", name: "", handle: null };
  const handle = await idbHandle("get");
  if (!handle) return { status: "none", name: "", handle: null };
  try {
    const perm = await handle.queryPermission({ mode: "readwrite" });
    return { status: perm === "granted" ? "granted" : "prompt", name: handle.name, handle };
  } catch {
    return { status: "prompt", name: handle.name, handle };
  }
}

export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbHandle("set", handle);
  return { status: "granted", name: handle.name, handle };
}

export async function reconnectFolder(handle) {
  const perm = await handle.requestPermission({ mode: "readwrite" });
  return perm === "granted";
}

export async function forgetFolder() {
  await idbHandle("delete");
}

export function safeName(s, fallback = "concert") {
  const t = String(s || "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return t || fallback;
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function extFor(mime, fallback) {
  const t = String(mime || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("webp")) return "webp";
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("aac") || t.includes("m4a")) return "m4a";
  return fallback;
}

// bundle = { title, projectJson, lyrics, images: [{ name, dataUrl }], song: Blob|null, video: Blob|null }
// Returns { folderName, files: [names], skipped: [names] }.
export async function exportBundle(root, bundle, onProgress = () => {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  const folderName = `${safeName(bundle.title)} — ${stamp}`;
  const dir = await root.getDirectoryHandle(folderName, { create: true });
  const files = [];
  const skipped = [];

  onProgress("Writing project.json…");
  await writeFile(dir, "project.json", new Blob([bundle.projectJson], { type: "application/json" }));
  files.push("project.json");

  if (bundle.lyrics && bundle.lyrics.trim()) {
    await writeFile(dir, "lyrics.txt", new Blob([bundle.lyrics], { type: "text/plain" }));
    files.push("lyrics.txt");
  }

  if (bundle.images && bundle.images.length) {
    const imgDir = await dir.getDirectoryHandle("images", { create: true });
    for (let i = 0; i < bundle.images.length; i++) {
      const im = bundle.images[i];
      onProgress(`Writing image ${i + 1} of ${bundle.images.length}…`);
      const blob = im.dataUrl.startsWith("data:") ? dataUrlToBlob(im.dataUrl) : null;
      if (!blob) { skipped.push(im.name); continue; }
      const name = `${im.name}.${extFor(blob.type, "png")}`;
      await writeFile(imgDir, name, blob);
      files.push(`images/${name}`);
    }
  }

  if (bundle.song) {
    onProgress("Writing the song…");
    const name = `song.${extFor(bundle.song.type, "mp3")}`;
    await writeFile(dir, name, bundle.song);
    files.push(name);
  } else skipped.push("song (none generated or uploaded yet)");

  if (bundle.video) {
    onProgress("Writing the video…");
    const name = `video.${extFor(bundle.video.type, "mp4")}`;
    await writeFile(dir, name, bundle.video);
    files.push(name);
  } else skipped.push("video (not rendered yet)");

  return { folderName, files, skipped };
}
