// Phase 3 analytics + retention tests — run with:  node --test tests/campus-analytics.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.CAMPUS_ADMIN_SECRET = "test-admin-secret";
process.env.CAMPUS_SESSION_SECRET = "test-session-secret";
delete process.env.NETLIFY;
delete process.env.R2_ACCOUNT_ID;

const auth = (await import("../netlify/functions/campus-auth.js")).default;
const admin = (await import("../netlify/functions/campus-admin.js")).default;
const sessions = (await import("../netlify/functions/campus-sessions.js")).default;
const analytics = (await import("../netlify/functions/campus-analytics.js")).default;
const { docGet, docSet } = await import("../netlify/lib/campus-store.js");
const { analyze, metrics, funnel } = await import("../netlify/lib/campus-analytics.js");
const { purgeCandidates, runPurge, validatePolicy, DEFAULT_POLICY } = await import("../netlify/lib/campus-retention.js");

async function call(fn, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fn(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const PNG = "data:image/png;base64," + "A".repeat(600);
const T1 = { uri: "/study/general-conference/2026/10/13runia", title: "The Sculpting of Our Souls", speaker: "Tamara W. Runia" };
const T2 = { uri: "/study/general-conference/2026/10/12gong", title: "Come to the Lord in His Holy House", speaker: "Gerrit W. Gong" };
let adminTok, w1, w2;

before(async () => {
  adminTok = (await call(auth, { action: "bootstrap", secret: "test-admin-secret", email: "admin@x.com", name: "Admin", password: "password1" })).data.token;
  for (const [email, name] of [["k@x.com", "Kaitlin Test"], ["o@x.com", "Other Worker"]]) {
    const inv = await call(admin, { action: "invite", email, name }, adminTok);
    const acc = await call(auth, { action: "accept-invite", code: inv.data.invite.code, password: "workerpass1" });
    if (email === "k@x.com") w1 = acc.data.token; else w2 = acc.data.token;
  }
  // Worker 1: a recorded session with lyrics + song on T1; a declined one; an unfinished one.
  const a = (await call(sessions, { action: "start" }, w1)).data.session;
  await call(sessions, { action: "update", id: a.id, patch: { talk: T1, songified: { existing: false } } }, w1);
  await call(sessions, { action: "consent", id: a.id, choice: "recorded", name: "Pat Student", email: "pat@byu.edu", adult: true, signaturePng: PNG }, w1);
  await call(sessions, { action: "update", id: a.id, patch: { lyrics: { generated: true, text: "words" }, song: { generated: true } } }, w1);
  await call(sessions, { action: "complete", id: a.id, outcome: { reaction: "positive" } }, w1);
  const b = (await call(sessions, { action: "start" }, w1)).data.session;
  await call(sessions, { action: "consent", id: b.id, choice: "declined" }, w1);
  await call(sessions, { action: "complete", id: b.id, outcome: {} }, w1);
  const c = (await call(sessions, { action: "start" }, w1)).data.session;
  await call(sessions, { action: "update", id: c.id, patch: { talk: T2, songified: { existing: false }, lyrics: { generated: true } } }, w1);
  await call(sessions, { action: "abandon", id: c.id }, w1);
  // Worker 2: unrecorded participation on T2 with lyrics only.
  const d = (await call(sessions, { action: "start" }, w2)).data.session;
  await call(sessions, { action: "update", id: d.id, patch: { talk: T2, songified: { existing: false } } }, w2);
  await call(sessions, { action: "consent", id: d.id, choice: "unrecorded", name: "Sam", adult: true, acknowledged: true }, w2);
  await call(sessions, { action: "update", id: d.id, patch: { lyrics: { generated: true } } }, w2);
  await call(sessions, { action: "complete", id: d.id, outcome: { reaction: "neutral" } }, w2);
});

test("only administrators can see analytics or touch retention", async () => {
  for (const action of ["overview", "retention", "set-retention", "purge"]) {
    assert.equal((await call(analytics, { action })).status, 401, action);
    assert.equal((await call(analytics, { action }, w1)).status, 403, action);
  }
});

test("overview: totals, funnel, abandoned never counted as completed, no participant details", async () => {
  const r = await call(analytics, { action: "overview" }, adminTok);
  assert.equal(r.status, 200);
  const t = r.data.totals;
  assert.equal(t.approached, 4);
  assert.equal(t.declined, 1);
  assert.equal(t.participated, 2);
  assert.equal(t.recorded, 1);
  assert.equal(t.unrecorded, 1);
  assert.equal(t.lyrics, 2, "the abandoned session's lyrics don't count");
  assert.equal(t.songs, 1);
  assert.equal(t.abandoned, 1);
  assert.deepEqual(r.data.funnel.map((f) => f.n), [4, 2, 2, 1]);
  assert.equal(r.data.funnel[1].pctOfApproached, 50);
  assert.equal(r.data.funnel[3].pctOfPrev, 50);
  assert.equal(r.data.reactions.positive, 1);
  assert.equal(r.data.reactions.neutral, 1);
  // talks: T2 chosen twice, no song anywhere → unsongified; T1 got a song
  assert.equal(r.data.talks[0].uri, T2.uri);
  assert.equal(r.data.talks[0].n, 2);
  assert.deepEqual(r.data.unsongified.map((u) => u.uri), [T2.uri]);
  // workers
  const k = r.data.byWorker.find((w) => w.name === "Kaitlin Test");
  assert.equal(k.approached, 3);
  assert.equal(k.participated, 1);
  assert.equal(k.songs, 1);
  const txt = JSON.stringify(r.data);
  for (const pii of ["Pat Student", "pat@byu.edu", "signature", "data:image"]) assert.ok(!txt.includes(pii), `analytics must not include ${pii}`);
  assert.ok(!txt.includes("\"words\""), "lyric text stays out of analytics");
});

test("overview filters by worker and by local date", async () => {
  const all = await call(analytics, { action: "overview" }, adminTok);
  const k = all.data.workers.find((w) => w.name === "Other Worker");
  const one = await call(analytics, { action: "overview", workerId: k.id }, adminTok);
  assert.equal(one.data.totals.approached, 1);
  assert.equal(one.data.totals.unrecorded, 1);
  const none = await call(analytics, { action: "overview", from: "2020-01-01", to: "2020-01-31" }, adminTok);
  assert.equal(none.data.totals.approached, 0);
  assert.equal((await call(analytics, { action: "overview", from: "2026-10-20", to: "2026-10-01" }, adminTok)).status, 400);
});

test("analytics math: hours per worker and per-hour rates come from clocked shifts", () => {
  const s = (id, w, extra) => ({ id, workerId: w, startedAt: "2026-10-15T18:00:00Z", status: "completed", participation: "unrecorded", durationSec: 300, ...extra });
  const list = [s("a", "w1"), s("b", "w1", { participation: "declined" }), s("c", "w1", { lyrics: { generated: true } })];
  const r = analyze(list, { users: [{ id: "w1", name: "K" }], shifts: [{ workerId: "w1", status: "closed", in: "2026-10-15T17:00:00Z", minutes: 120 }] });
  assert.equal(r.byWorker[0].minutes, 120);
  assert.equal(r.byWorker[0].approachedPerHour, 1.5);
  assert.equal(r.byWorker[0].participatedPerHour, 1);
  assert.equal(r.totals.avgParticipatedDurationSec, 300);
  assert.equal(r.byDate[0].date, "2026-10-15");
  assert.deepEqual(funnel(metrics([])).map((f) => f.pctOfApproached), [0, 0, 0, 0]);
});

test("retention: candidates by age and by withdrawn consent; unfinished uploads included", () => {
  const nowMs = Date.parse("2026-10-17T12:00:00Z");
  const old = "2025-09-01T00:00:00Z", recent = "2026-10-10T00:00:00Z";
  const ss = [
    { id: "s1", clips: [{ id: "c1", key: "k1", status: "ready", at: old, bytes: 10 }, { id: "c2", key: "k2", status: "ready", at: recent, bytes: 20 }] },
    { id: "s2", clips: [{ id: "c3", key: "k3", status: "ready", at: recent, bytes: 30 }, { id: "c4", key: "k4", status: "purged", at: old }] },
    { id: "s3", clips: [{ id: "c5", key: "k5", status: "uploading", at: old, bytes: 0 }] },
  ];
  const c = purgeCandidates(ss, new Set(["s2"]), { clipRetentionDays: 365, purgeWithdrawn: true }, nowMs);
  assert.deepEqual(c.map((x) => x.clipId).sort(), ["c1", "c3", "c5"]);
  assert.equal(c.find((x) => x.clipId === "c3").reason, "consent withdrawn");
  assert.match(c.find((x) => x.clipId === "c1").reason, /older than 365 days/);
  assert.deepEqual(purgeCandidates(ss, new Set(["s2"]), { clipRetentionDays: 0, purgeWithdrawn: false }, nowMs), [], "0 days + withdrawn off = keep everything");
  assert.throws(() => validatePolicy({ clipRetentionDays: 3 }, DEFAULT_POLICY));
  assert.throws(() => validatePolicy({ clipRetentionDays: -1 }, DEFAULT_POLICY));
  assert.equal(validatePolicy({ clipRetentionDays: 0 }, DEFAULT_POLICY).clipRetentionDays, 0);
  assert.equal(DEFAULT_POLICY.autoPurge, false, "automatic deletion is off until an administrator turns it on");
});

test("retention: policy saves; purge deletes files, marks clips, keeps consent, logs counts only", async () => {
  // give the recorded session two clips: one old, one new; withdraw nothing yet
  const all = await call(admin, { action: "sessions" }, adminTok);
  const rec = all.data.sessions.find((s) => s.participation === "recorded");
  const s = await docGet(`session:${rec.id}`);
  s.clips = [
    { id: "clip_old", key: `campus/${s.id}/clip_old.mp4`, status: "ready", at: "2024-01-01T00:00:00Z", bytes: 1000, stage: "testimony" },
    { id: "clip_new", key: `campus/${s.id}/clip_new.mp4`, status: "ready", at: new Date().toISOString(), bytes: 2000, stage: "song-reaction" },
  ];
  await docSet(`session:${s.id}`, s);
  const set = await call(analytics, { action: "set-retention", clipRetentionDays: 90, purgeWithdrawn: true, autoPurge: false }, adminTok);
  assert.equal(set.status, 200);
  assert.equal(set.data.policy.clipRetentionDays, 90);
  assert.equal((await call(analytics, { action: "set-retention", clipRetentionDays: 2 }, adminTok)).status, 400);
  const pv = await call(analytics, { action: "retention" }, adminTok);
  assert.deepEqual(pv.data.candidates.map((c) => c.clipId), ["clip_old"]);
  assert.equal(pv.data.storage.clips, 2);
  assert.equal(pv.data.storageConfigured, false);
  assert.equal((await call(analytics, { action: "purge" }, adminTok)).status, 503, "no storage, no purge");

  // run the purge with a stand-in for the R2 delete
  const deleted = [];
  const r1 = await runPurge({ by: "admin", deleter: async (k) => { deleted.push(k); } });
  assert.equal(r1.log.deleted, 1);
  assert.deepEqual(deleted, [`campus/${s.id}/clip_old.mp4`]);
  let after = await docGet(`session:${s.id}`);
  assert.equal(after.clips.find((c) => c.id === "clip_old").status, "purged");
  assert.match(after.clips.find((c) => c.id === "clip_old").purgeReason, /older than 90 days/);
  assert.equal(after.clips.find((c) => c.id === "clip_new").status, "ready");

  // consent withdrawal makes the remaining clip due; a failed delete leaves it alone
  await call(admin, { action: "consent-withdraw", sessionId: s.id, note: "Emailed" }, adminTok);
  const r2 = await runPurge({ by: "admin", deleter: async () => { throw new Error("R2 down"); } });
  assert.equal(r2.log.deleted, 0);
  assert.equal(r2.failed.length, 1);
  after = await docGet(`session:${s.id}`);
  assert.equal(after.clips.find((c) => c.id === "clip_new").status, "ready", "nothing is marked deleted unless the file was deleted");
  const r3 = await runPurge({ by: "admin", deleter: async () => {} });
  assert.equal(r3.log.reasons["consent withdrawn"], 1);

  // the consent record survives, and summaries count only ready clips
  const look = await call(admin, { action: "consent-lookup", sessionId: s.id }, adminTok);
  assert.equal(look.data.consent.name, "Pat Student");
  assert.equal(look.data.session.clipCount, 0);
  const log = (await call(analytics, { action: "retention" }, adminTok)).data.log;
  assert.ok(log.length >= 2);
  assert.ok(!JSON.stringify(log).includes("Pat Student"));
});
