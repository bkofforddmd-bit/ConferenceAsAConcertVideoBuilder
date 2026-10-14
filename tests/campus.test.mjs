// Campus Sessions server tests — run with:  node --test tests/
// Functions run in-process against the in-memory store (no Netlify env).
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.CAMPUS_ADMIN_SECRET = "test-admin-secret";
process.env.CAMPUS_SESSION_SECRET = "test-session-secret";
delete process.env.NETLIFY;

const auth = (await import("../netlify/functions/campus-auth.js")).default;
const admin = (await import("../netlify/functions/campus-admin.js")).default;
const sessions = (await import("../netlify/functions/campus-sessions.js")).default;

async function call(fn, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fn(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}

let adminTok, workerTok, worker2Tok;
const PNG = "data:image/png;base64," + "A".repeat(600);

before(async () => {
  const st = await call(auth, { action: "status" });
  assert.equal(st.data.hasUsers, false);
  const bad = await call(auth, { action: "bootstrap", secret: "wrong", email: "a@x.com", name: "A", password: "password1" });
  assert.equal(bad.status, 403);
  const boot = await call(auth, { action: "bootstrap", secret: "test-admin-secret", email: "admin@x.com", name: "Admin", password: "password1" });
  assert.equal(boot.status, 200);
  adminTok = boot.data.token;
  for (const [email, name] of [["w1@x.com", "Worker One"], ["w2@x.com", "Worker Two"]]) {
    const inv = await call(admin, { action: "invite", email, name }, adminTok);
    assert.equal(inv.status, 200);
    assert.match(inv.data.link, /\/campus\?invite=inv_/);
    const acc = await call(auth, { action: "accept-invite", code: inv.data.invite.code, password: "workerpass1" });
    assert.equal(acc.status, 200);
    assert.equal(acc.data.user.role, "worker");
    if (email === "w1@x.com") workerTok = acc.data.token; else worker2Tok = acc.data.token;
  }
});

test("local development: the setup secret \"dev\" works only when no deploy environment is present", async () => {
  const saved = process.env.CAMPUS_ADMIN_SECRET;
  delete process.env.CAMPUS_ADMIN_SECRET;
  const ok = await call(auth, { action: "bootstrap", secret: "dev", email: "dev@x.com", name: "Dev", password: "password1" });
  assert.equal(ok.status, 200);
  process.env.NETLIFY = "true";
  const no = await call(auth, { action: "bootstrap", secret: "dev", email: "dev2@x.com", name: "Dev", password: "password1" });
  assert.equal(no.status, 403);
  delete process.env.NETLIFY;
  process.env.CAMPUS_ADMIN_SECRET = saved;
});

test("unauthenticated visitors are refused everywhere", async () => {
  assert.equal((await call(sessions, { action: "mine" })).status, 401);
  assert.equal((await call(admin, { action: "workers" })).status, 401);
  assert.equal((await call(sessions, { action: "mine" }, "garbage.token")).status, 401);
});

test("workers cannot use administrator actions", async () => {
  const r = await call(admin, { action: "workers" }, workerTok);
  assert.equal(r.status, 403);
  const c = await call(admin, { action: "consent-lookup", sessionId: "x" }, workerTok);
  assert.equal(c.status, 403);
});

test("a wrong password or a used invite is refused", async () => {
  assert.equal((await call(auth, { action: "login", email: "w1@x.com", password: "nope" })).status, 401);
  const ok = await call(auth, { action: "login", email: "W1@X.com", password: "workerpass1" });
  assert.equal(ok.status, 200);
  const list = await call(admin, { action: "workers" }, adminTok);
  assert.equal(list.data.invites.length, 0, "used invites are not listed");
  assert.equal((await call(auth, { action: "accept-invite", code: "inv_nope", password: "workerpass1" })).status, 404);
});

test("scenario 1: unsongified talk, lyrics only, recorded consent, completed", async () => {
  const st = await call(sessions, { action: "start", campus: "BYU Provo" }, workerTok);
  assert.equal(st.status, 200);
  const s = st.data.session;
  assert.equal(s.status, "active");
  assert.ok(s.startedAt);
  const up = await call(sessions, { action: "update", id: s.id, patch: { talk: { uri: "/study/general-conference/2026/10/13runia", title: "The Sculpting of Our Souls", speaker: "Tamara W. Runia", session: "Saturday Morning Session" }, songified: { existing: false }, step: "consent" } }, workerTok);
  assert.equal(up.data.session.step, "consent");
  // minors can't authorize recording
  const minor = await call(sessions, { action: "consent", id: s.id, choice: "recorded", name: "Kid", adult: false, signaturePng: PNG }, workerTok);
  assert.equal(minor.status, 400);
  // recording needs a signature
  const nosig = await call(sessions, { action: "consent", id: s.id, choice: "recorded", name: "Pat", adult: true }, workerTok);
  assert.equal(nosig.status, 400);
  const con = await call(sessions, { action: "consent", id: s.id, choice: "recorded", name: "Pat Student", email: "pat@byu.edu", adult: true, signaturePng: PNG }, workerTok);
  assert.equal(con.status, 200);
  assert.equal(con.data.session.participation, "recorded");
  assert.equal(con.data.session.step, "lyrics");
  assert.equal(con.data.session.consentVersion, 1);
  assert.ok(!JSON.stringify(con.data.session).includes("Pat Student"), "session never carries the participant's name");
  await call(sessions, { action: "update", id: s.id, patch: { lyrics: { generated: true, accepted: true, mood: "Hopeful" }, step: "outcome" } }, workerTok);
  const done = await call(sessions, { action: "complete", id: s.id, outcome: { reaction: "positive", recordingCaptured: true, videoRef: "IMG_0412.MOV" } }, workerTok);
  assert.equal(done.data.session.status, "completed");
  assert.equal(typeof done.data.session.durationSec, "number");
  assert.equal(done.data.session.lyrics.generated, true);
  assert.equal(done.data.session.song.generated, false);
  // administrator can find the consent by session id, with the exact text accepted
  const look = await call(admin, { action: "consent-lookup", sessionId: s.id }, adminTok);
  assert.equal(look.status, 200);
  assert.equal(look.data.consent.name, "Pat Student");
  assert.equal(look.data.consent.videoRef, "IMG_0412.MOV");
  assert.match(look.data.consent.text, /Media Release/);
  assert.equal(look.data.session.hasVideoRef, true);
  assert.ok(!("name" in look.data.session));
  // scenario 13: consent withdrawn after the session
  const wd = await call(admin, { action: "consent-withdraw", sessionId: s.id, note: "Emailed 2026-10-20" }, adminTok);
  assert.ok(wd.data.consent.withdrawn.at);
  // closed sessions can't be edited
  assert.equal((await call(sessions, { action: "update", id: s.id, patch: { notes: "x" } }, workerTok)).status, 400);
});

test("scenario 4/5: participate without recording; decline participation", async () => {
  const a = (await call(sessions, { action: "start" }, workerTok)).data.session;
  const c = await call(sessions, { action: "consent", id: a.id, choice: "unrecorded", name: "Sam", adult: false, acknowledged: true }, workerTok);
  assert.equal(c.status, 200);
  assert.equal(c.data.session.participation, "unrecorded");
  const done = await call(sessions, { action: "complete", id: a.id, outcome: { recordingCaptured: true, reaction: "neutral" } }, workerTok);
  assert.equal(done.data.session.recordingCaptured, false, "no recording can be captured without authorization");
  const b = (await call(sessions, { action: "start" }, workerTok)).data.session;
  const d = await call(sessions, { action: "consent", id: b.id, choice: "declined" }, workerTok);
  assert.equal(d.data.session.step, "outcome");
  const fin = await call(sessions, { action: "complete", id: b.id, outcome: {} }, workerTok);
  assert.equal(fin.data.session.participation, "declined");
  assert.equal(fin.data.session.status, "completed");
});

test("scenario 3: a talk that already has a song goes to the existing-song screen", async () => {
  const s = (await call(sessions, { action: "start" }, workerTok)).data.session;
  await call(sessions, { action: "update", id: s.id, patch: { talk: { uri: "/study/general-conference/2026/10/12gong", title: "Come to the Lord in His Holy House", speaker: "Gerrit W. Gong" }, songified: { existing: true, libraryId: "abc", audioUrl: "https://pub.r2.dev/x.mp3" } } }, workerTok);
  const c = await call(sessions, { action: "consent", id: s.id, choice: "unrecorded", name: "Lee", adult: true, acknowledged: true }, workerTok);
  assert.equal(c.data.session.step, "existing");
  await call(sessions, { action: "abandon", id: s.id, reason: "test" }, workerTok);
});

test("scenario 6/7: an interrupted session resumes, and a new start abandons it", async () => {
  const s = (await call(sessions, { action: "start" }, workerTok)).data.session;
  await call(sessions, { action: "update", id: s.id, patch: { step: "lyrics" } }, workerTok);
  const mine = await call(sessions, { action: "mine" }, workerTok);
  assert.equal(mine.data.active && mine.data.active.id, s.id, "the open session is offered for resume");
  const n = (await call(sessions, { action: "start" }, workerTok)).data.session;
  const old = await call(sessions, { action: "get", id: s.id }, workerTok);
  assert.equal(old.data.session.status, "abandoned");
  assert.equal((await call(sessions, { action: "mine" }, workerTok)).data.active.id, n.id);
  await call(sessions, { action: "abandon", id: n.id }, workerTok);
  const after = await call(sessions, { action: "mine" }, workerTok);
  assert.equal(after.data.active, null);
  assert.ok(after.data.today.approached >= 5);
  assert.ok(after.data.recent.every((r) => !("videoRef" in r) && !("name" in r)));
});

test("scenario 11: a worker cannot read or change another worker's session", async () => {
  const s = (await call(sessions, { action: "start" }, workerTok)).data.session;
  assert.equal((await call(sessions, { action: "get", id: s.id }, worker2Tok)).status, 403);
  assert.equal((await call(sessions, { action: "update", id: s.id, patch: { notes: "hi" } }, worker2Tok)).status, 403);
  assert.equal((await call(sessions, { action: "complete", id: s.id, outcome: {} }, worker2Tok)).status, 403);
  await call(sessions, { action: "abandon", id: s.id }, workerTok);
});

test("admin: deactivated workers lose access; consent text is versioned; settings validate", async () => {
  const list = await call(admin, { action: "workers" }, adminTok);
  const w2 = list.data.workers.find((w) => w.email === "w2@x.com");
  await call(admin, { action: "set-active", userId: w2.id, active: false }, adminTok);
  assert.equal((await call(sessions, { action: "mine" }, worker2Tok)).status, 401);
  assert.equal((await call(auth, { action: "login", email: "w2@x.com", password: "workerpass1" })).status, 403);
  await call(admin, { action: "set-active", userId: w2.id, active: true }, adminTok);
  const v1 = await call(admin, { action: "consent-text" }, adminTok);
  assert.equal(v1.data.version, 1);
  assert.equal(v1.data.reviewed, false);
  const v2 = await call(admin, { action: "set-consent-text", text: "New release text. ".repeat(20), reviewed: true }, adminTok);
  assert.equal(v2.data.version, 2);
  const cfg = await call(sessions, { action: "config" }, workerTok);
  assert.equal(cfg.data.consent.version, 2);
  assert.equal(cfg.data.settings.melodyCraftUrl, "https://melodycraft.app");
  assert.equal((await call(admin, { action: "set-settings", melodyCraftUrl: "javascript:alert(1)" }, adminTok)).status, 400);
  const set = await call(admin, { action: "set-settings", melodyCraftUrl: "https://example.com/melody", defaultCampus: "BYU Provo" }, adminTok);
  assert.equal(set.data.melodyCraftUrl, "https://example.com/melody");
  const all = await call(admin, { action: "sessions" }, adminTok);
  assert.ok(all.data.sessions.length >= 6);
  assert.ok(all.data.sessions.every((s) => !("name" in s) && !("signaturePng" in s)));
});
