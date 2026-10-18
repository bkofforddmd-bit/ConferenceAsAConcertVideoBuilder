// netlify/lib/campus-share.js
//
// Phase 4 helpers for Campus Sessions:
//   - a short, human-friendly session reference ("K7Q-4MX") shown on screen and
//     on the recording slate, so camera footage can be matched to a session;
//   - a random share code for the student's public song page (/song/<code>),
//     indexed as share:<code> -> { sessionId }. The code carries nothing about
//     the student;
//   - resolving which song the share page should play.
//   - the exact follow-up opt-in wording (kept with every opt-in).

import { randomBytes } from "node:crypto";
import { docGet, docSet, now } from "./campus-store.js";

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
function pickChars(n, alphabet) {
  const bytes = randomBytes(n * 2);
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[bytes.readUInt16BE(i * 2) % alphabet.length];
  return out;
}
export function refCode() { const c = pickChars(6, REF_ALPHABET); return `${c.slice(0, 3)}-${c.slice(3)}`; }
export const normRef = (r) => String(r || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export function shareCode() { return pickChars(10, "abcdefghijkmnpqrstuvwxyz23456789"); }

export function ensureRef(s) {
  if (s.ref) return false;
  s.ref = refCode();
  return true;
}

// Gives a participating session a share code (and its index entry).
export async function ensureShare(s) {
  if (s.share && s.share.code) return false;
  if (!s.participation || s.participation === "declined") return false;
  let code = shareCode();
  for (let i = 0; i < 5 && (await docGet(`share:${code}`)); i++) code = shareCode();
  s.share = { code, createdAt: now(), views: 0, disabled: false };
  await docSet(`share:${code}`, { sessionId: s.id, createdAt: s.share.createdAt });
  return true;
}

// ---- the Concert library (public catalog), cached per function instance ----
let libCache = { at: 0, songs: [] };
export async function librarySongs(fetchImpl = fetch) {
  if (Date.now() - libCache.at < 10 * 60000 && libCache.songs.length) return libCache.songs;
  try {
    const r = await fetchImpl("https://conferenceconcert.netlify.app/.netlify/functions/data", { headers: { accept: "application/json" } });
    const d = await r.json();
    const songs = (d && (d.songs || (d.catalog && d.catalog.songs))) || [];
    libCache = { at: Date.now(), songs };
    return songs;
  } catch { return libCache.songs; }
}
export function _resetLibraryCache() { libCache = { at: 0, songs: [] }; }
const talkKey = (u) => { const m = /general-conference\/(\d{4})\/(\d{2})\/([a-z0-9-]+)/i.exec(String(u || "")); return m ? `${m[1]}/${m[2]}/${m[3]}`.toLowerCase() : ""; };

// Which song should the share page play? Order: a link the worker pasted
// (e.g. MelodyCraft's share link) → the MP3 the worker uploaded → the library
// song the student heard → a library song for this talk published since.
export async function resolveSong(s, { signedSongUrl, fetchImpl } = {}) {
  if (s.songLink) return { kind: "link", url: s.songLink, title: (s.lyrics && s.lyrics.title) || (s.talk && s.talk.title) || "" };
  if (s.songFile && s.songFile.status === "ready" && signedSongUrl) return { kind: "audio", url: signedSongUrl(s.songFile.key), title: (s.lyrics && s.lyrics.title) || (s.talk && s.talk.title) || "" };
  if (s.songified && s.songified.existing && !s.songified.newInterpretation && s.songified.audioUrl) return { kind: "audio", url: s.songified.audioUrl, title: s.songified.libraryTitle || "" };
  const key = s.talk && talkKey(s.talk.uri || s.talk.sourceUrl);
  if (key) {
    const songs = (await librarySongs(fetchImpl)).filter((x) => talkKey(x.talkUrl) === key && (x.audioUrl || x.videoUrl));
    songs.sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
    const x = songs[0];
    if (x) return { kind: x.videoUrl ? "video" : "audio", url: x.videoUrl || x.audioUrl, audioUrl: x.audioUrl || "", title: x.title || "", fromLibrary: true };
  }
  return null;
}

// ---- follow-up opt-in (the exact words the student agrees to) ----
export const FOLLOWUP_VERSION = 1;
export const FOLLOWUP_TEXT = "Yes, email me a link to my song when it's ready (and to the music video if one is made). " +
  "Conference as a Concert will use this email only for that, at most two emails, will never share it, and will delete it afterward. " +
  "Reply \"stop\" at any time and you won't hear from us again.";
export const FOLLOWUP_PURPOSES = ["song", "video"];

export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(String(e || "").trim());
