// netlify/lib/campus-retention.js
//
// Retention and deletion policy for Campus Sessions video clips (the only
// large personal media we store; they live in the private R2 bucket).
//
// Policy (settings:retention), set by an administrator:
//   clipRetentionDays  delete clips older than this many days (0 = keep until deleted by hand)
//   purgeWithdrawn     delete a session's clips once its consent is withdrawn (default on)
//   autoPurge          run the purge automatically once a day (default OFF — an
//                      administrator previews and deletes by hand until they turn it on)
//   followupRetentionDays  erase a follow-up email this many days after the last
//                      email was sent (or after the opt-in, if nothing was sent);
//                      opted-out contacts are erased right away (default 60)
//
// What a purge does: deletes the video file from R2 and marks the clip record
// "purged" with when and why. Consent records, session records and lyric text
// are NOT touched — the consent paperwork has to outlive the video.
// Every run writes a purge log entry (counts only, no names).

import { docGet, docSet, docList, newId, now } from "./campus-store.js";

export const DEFAULT_POLICY = { clipRetentionDays: 365, purgeWithdrawn: true, autoPurge: false, followupRetentionDays: 60 };

export async function getPolicy() {
  const p = (await docGet("settings:retention")) || {};
  return {
    clipRetentionDays: Number.isInteger(p.clipRetentionDays) && p.clipRetentionDays >= 0 ? p.clipRetentionDays : DEFAULT_POLICY.clipRetentionDays,
    purgeWithdrawn: p.purgeWithdrawn === undefined ? DEFAULT_POLICY.purgeWithdrawn : Boolean(p.purgeWithdrawn),
    autoPurge: Boolean(p.autoPurge),
    followupRetentionDays: Number.isInteger(p.followupRetentionDays) && p.followupRetentionDays > 0 ? p.followupRetentionDays : DEFAULT_POLICY.followupRetentionDays,
    updatedAt: p.updatedAt || null,
    updatedBy: p.updatedBy || null,
  };
}

export function validatePolicy(input, cur) {
  const days = input.clipRetentionDays === undefined ? cur.clipRetentionDays : Number(input.clipRetentionDays);
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error("Retention must be a whole number of days from 0 to 3650 (0 = keep until deleted by hand).");
  if (days > 0 && days < 7) throw new Error("Use at least 7 days, or 0 to keep clips until they're deleted by hand.");
  const fdays = input.followupRetentionDays === undefined ? cur.followupRetentionDays : Number(input.followupRetentionDays);
  if (!Number.isInteger(fdays) || fdays < 7 || fdays > 365) throw new Error("Keep follow-up emails between 7 and 365 days.");
  return {
    clipRetentionDays: days,
    purgeWithdrawn: input.purgeWithdrawn === undefined ? cur.purgeWithdrawn : Boolean(input.purgeWithdrawn),
    autoPurge: input.autoPurge === undefined ? cur.autoPurge : Boolean(input.autoPurge),
    followupRetentionDays: fdays,
  };
}

// Pure: which clips the policy says to delete. withdrawn = Set of session ids
// whose consent has been withdrawn.
export function purgeCandidates(sessions, withdrawn, policy, nowMs = Date.now()) {
  const out = [];
  const cutoff = policy.clipRetentionDays > 0 ? nowMs - policy.clipRetentionDays * 86400000 : null;
  for (const s of sessions) {
    for (const c of s.clips || []) {
      if (c.status !== "ready" && c.status !== "uploading") continue;
      const at = Date.parse(c.at || c.createdAt || s.startedAt);
      let reason = "";
      if (policy.purgeWithdrawn && withdrawn.has(s.id)) reason = "consent withdrawn";
      else if (cutoff != null && Number.isFinite(at) && at < cutoff) reason = `older than ${policy.clipRetentionDays} days`;
      if (reason) out.push({ sessionId: s.id, clipId: c.id, key: c.key, stage: c.stage, at: c.at || null, bytes: c.bytes || 0, status: c.status, reason, ageDays: Number.isFinite(at) ? Math.floor((nowMs - at) / 86400000) : null });
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Pure: follow-up contacts whose email should be erased now.
export function followupCandidates(followups, policy, nowMs = Date.now()) {
  const out = [];
  for (const f of followups) {
    if (!f.email) continue;
    const last = Date.parse(f.sentAt || f.at);
    const ageDays = Number.isFinite(last) ? Math.floor((nowMs - last) / 86400000) : null;
    let reason = "";
    if (f.status === "opted-out") reason = "opted out";
    else if (ageDays != null && ageDays >= policy.followupRetentionDays) reason = f.sentAt ? `${policy.followupRetentionDays} days after the last email` : `${policy.followupRetentionDays} days after opting in, never emailed`;
    if (reason) out.push({ sessionId: f.sessionId, status: f.status, ageDays, reason });
  }
  return out;
}

export async function storageSummary(sessions) {
  let clips = 0, bytes = 0, oldest = null;
  for (const s of sessions) for (const c of s.clips || []) if (c.status === "ready") { clips += 1; bytes += c.bytes || 0; if (c.at && (!oldest || c.at < oldest)) oldest = c.at; }
  return { clips, bytes, oldest };
}

async function withdrawnSet(sessions) {
  const set = new Set();
  for (const s of sessions) {
    if (!(s.clips || []).some((c) => c.status === "ready" || c.status === "uploading")) continue;
    const c = await docGet(`consent:${s.id}`);
    if (c && c.withdrawn) set.add(s.id);
  }
  return set;
}

export async function preview() {
  const policy = await getPolicy();
  const sessions = await docList("session:");
  const cands = purgeCandidates(sessions, await withdrawnSet(sessions), policy);
  const fus = await docList("followup:");
  return { policy, candidates: cands, storage: await storageSummary(sessions), followupCandidates: followupCandidates(fus, policy), followupContacts: fus.filter((f) => f.email).length };
}

// Deletes the files (deleter = R2 delete) and marks clip records. Returns a
// summary and writes purge:<id>. Clips whose file can't be deleted stay as
// they were and are reported as failures, so nothing is marked gone that isn't.
export async function runPurge({ by, trigger = "manual", deleter, only = null }) {
  const policy = await getPolicy();
  const sessions = await docList("session:");
  let cands = purgeCandidates(sessions, await withdrawnSet(sessions), policy);
  if (Array.isArray(only)) { const ok = new Set(only); cands = cands.filter((c) => ok.has(c.clipId)); }
  const bySession = new Map(sessions.map((s) => [s.id, s]));
  const done = [], failed = [];
  for (const c of cands) {
    if (!deleter) { failed.push({ ...c, error: "Video storage isn't set up on this site." }); continue; }
    try {
      if (c.key) await deleter(c.key);
      const s = bySession.get(c.sessionId);
      s.clips = (s.clips || []).map((k) => (k.id === c.clipId ? { ...k, status: "purged", purgedAt: now(), purgeReason: c.reason, purgedBy: by || trigger } : k));
      done.push(c);
    } catch (e) { failed.push({ ...c, error: String(e.message || e).slice(0, 200) }); }
  }
  for (const id of new Set(done.map((c) => c.sessionId))) { const s = bySession.get(id); s.updatedAt = now(); await docSet(`session:${id}`, s); }
  const reasons = {};
  for (const c of done) reasons[c.reason] = (reasons[c.reason] || 0) + 1;
  // Follow-up emails past their time (or opted out) are erased; the record stays, without contact details.
  let erased = 0;
  {
    const fus = await docList("followup:");
    for (const fc of followupCandidates(fus, policy)) {
      const f = fus.find((x) => x.sessionId === fc.sessionId);
      f.email = ""; f.firstName = ""; f.erasedAt = now();
      if (f.status !== "opted-out") f.status = f.sentAt ? "sent" : "expired";
      f.history = [...(f.history || []), { at: now(), what: `contact erased by the retention policy (${fc.reason})` }];
      await docSet(`followup:${f.sessionId}`, f);
      erased += 1;
    }
  }
  const log = { id: newId("pg_"), at: now(), by: by || null, trigger, policy, deleted: done.length, bytes: done.reduce((t, c) => t + c.bytes, 0), failed: failed.length, reasons, followupsErased: erased, sessions: [...new Set(done.map((c) => c.sessionId))] };
  if (done.length || failed.length || erased || trigger === "manual") await docSet(`purge:${log.id}`, log);
  return { log, failed };
}

export async function purgeLog(limit = 20) {
  return (await docList("purge:")).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
