// src/campus/campus-api.js — calls for Campus Sessions mode. The sign-in
// token lives in localStorage on the worker's phone and goes out as a Bearer
// header; the server checks it on every call.

const BASE = "/.netlify/functions";
const TOKEN_KEY = "campus-token";

export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
export function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} }

async function call(fn, body) {
  const headers = { "content-type": "application/json" };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(`${BASE}/${fn}`, { method: "POST", headers, body: JSON.stringify(body || {}) });
  } catch {
    throw new Error("No connection — check the phone's signal and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `The server answered ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const authApi = {
  status: () => call("campus-auth", { action: "status" }),
  bootstrap: (p) => call("campus-auth", { action: "bootstrap", ...p }),
  login: (email, password) => call("campus-auth", { action: "login", email, password }),
  inviteInfo: (code) => call("campus-auth", { action: "invite-info", code }),
  acceptInvite: (code, password) => call("campus-auth", { action: "accept-invite", code, password }),
  me: () => call("campus-auth", { action: "me" }),
};

export const sessionApi = {
  config: () => call("campus-sessions", { action: "config" }),
  start: (campus) => call("campus-sessions", { action: "start", campus }),
  get: (id) => call("campus-sessions", { action: "get", id }),
  update: (id, patch) => call("campus-sessions", { action: "update", id, patch }),
  consent: (id, p) => call("campus-sessions", { action: "consent", id, ...p }),
  complete: (id, outcome) => call("campus-sessions", { action: "complete", id, outcome }),
  abandon: (id, reason) => call("campus-sessions", { action: "abandon", id, reason }),
  mine: () => call("campus-sessions", { action: "mine" }),
};

export const adminApi = {
  workers: () => call("campus-admin", { action: "workers" }),
  invite: (p) => call("campus-admin", { action: "invite", ...p }),
  revokeInvite: (code) => call("campus-admin", { action: "revoke-invite", code }),
  setActive: (userId, active) => call("campus-admin", { action: "set-active", userId, active }),
  setRole: (userId, role) => call("campus-admin", { action: "set-role", userId, role }),
  consentText: () => call("campus-admin", { action: "consent-text" }),
  setConsentText: (text, reviewed) => call("campus-admin", { action: "set-consent-text", text, reviewed }),
  setConsentReviewed: (reviewed) => call("campus-admin", { action: "set-consent-reviewed", reviewed }),
  settings: () => call("campus-admin", { action: "settings" }),
  setSettings: (p) => call("campus-admin", { action: "set-settings", ...p }),
  consentLookup: (sessionId) => call("campus-admin", { action: "consent-lookup", sessionId }),
  consentWithdraw: (sessionId, note) => call("campus-admin", { action: "consent-withdraw", sessionId, note }),
  sessions: (from, to) => call("campus-admin", { action: "sessions", from, to }),
};

export const timeApi = {
  status: () => call("campus-time", { action: "status" }),
  clockIn: (note) => call("campus-time", { action: "clock-in", note }),
  clockOut: (p) => call("campus-time", { action: "clock-out", ...p }),
  shifts: (month) => call("campus-time", { action: "shifts", month }),
  requestCorrection: (p) => call("campus-time", { action: "request-correction", ...p }),
  summary: (month) => call("campus-time", { action: "summary", month }),
  // administrator
  allShifts: (month, workerId) => call("campus-time", { action: "all-shifts", month, workerId }),
  corrections: () => call("campus-time", { action: "corrections" }),
  decideCorrection: (id, approve, note) => call("campus-time", { action: "decide-correction", id, approve, note }),
  approveShift: (shiftId, approved) => call("campus-time", { action: "approve-shift", shiftId, approved }),
  approveMonth: (workerId, month, approved) => call("campus-time", { action: "approve-month", workerId, month, approved }),
  rates: () => call("campus-time", { action: "rates" }),
  setRate: (workerId, cents, effective) => call("campus-time", { action: "set-rate", workerId, cents, effective }),
  payroll: (month) => call("campus-time", { action: "payroll", month }),
  markPaid: (month, workerId, paid, note) => call("campus-time", { action: "mark-paid", month, workerId, paid, note }),
};

export const analyticsApi = {
  overview: (p) => call("campus-analytics", { action: "overview", ...p }),
  retention: () => call("campus-analytics", { action: "retention" }),
  setRetention: (p) => call("campus-analytics", { action: "set-retention", ...p }),
  purge: (clipIds) => call("campus-analytics", { action: "purge", clipIds }),
};

export const mediaApi = {
  status: () => call("campus-media", { action: "status" }),
  signUpload: (sessionId, stage, mime, bytes) => call("campus-media", { action: "sign-upload", sessionId, stage, mime, bytes }),
  confirm: (sessionId, clipId, bytes, durationSec) => call("campus-media", { action: "confirm", sessionId, clipId, bytes, durationSec }),
  list: (sessionId) => call("campus-media", { action: "list", sessionId }),
  remove: (sessionId, clipId) => call("campus-media", { action: "delete", sessionId, clipId }),
};

// ---- talks (reuses the Studio's own data) ----
export async function fetchTalk(uri) {
  const res = await fetch(`${BASE}/fetch-talk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: uri }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't load the talk.");
  // The function returns the talk as paragraphs; the lyric writer wants one text.
  const text = Array.isArray(data.paragraphs) ? data.paragraphs.join("\n\n") : String(data.text || "");
  if (!text.trim()) throw new Error("The talk's text couldn't be read from the Church site. Check the connection and try again.");
  return { ...data, text }; // { text, paragraphs, title, speaker, speakerTitle, year, month, sourceUrl }
}

export async function conferenceSessions(year, month) {
  const res = await fetch(`${BASE}/list-conference`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, month }) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data.sessions || [] : [];
}

// Songs already in the Conference Concert library, keyed by talk link.
export async function libraryByTalk() {
  try {
    const resp = await fetch("https://conferenceconcert.netlify.app/.netlify/functions/data", { cache: "no-store" });
    const data = await resp.json();
    const songs = (data && (data.songs || (data.catalog && data.catalog.songs))) || [];
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const byUri = new Map(), byTitle = new Map();
    for (const s of songs) {
      const m = /general-conference\/(\d{4})\/(\d{2})\/([a-z0-9-]+)/i.exec(s.talkUrl || "");
      if (m) byUri.set(`/study/general-conference/${m[1]}/${m[2]}/${m[3]}`, s);
      if (s.talk) byTitle.set(norm(s.talk), s);
    }
    return { byUri, byTitle, norm, count: songs.length };
  } catch {
    return { byUri: new Map(), byTitle: new Map(), norm: (s) => s, count: 0, offline: true };
  }
}
