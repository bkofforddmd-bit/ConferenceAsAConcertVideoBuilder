// Phase 4 tests — run with:  node --test tests/campus-phase4.test.mjs
// QR song pages, student feedback, recording references, opt-in follow-ups.
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.CAMPUS_ADMIN_SECRET = "test-admin-secret";
process.env.CAMPUS_SESSION_SECRET = "test-session-secret";
process.env.R2_ACCOUNT_ID = "acct123";
process.env.R2_ACCESS_KEY_ID = "AKIDTEST";
process.env.R2_SECRET_ACCESS_KEY = "secret";
process.env.R2_CAMPUS_BUCKET = "cac-campus-clips";
delete process.env.NETLIFY;

const auth = (await import("../netlify/functions/campus-auth.js")).default;
const admin = (await import("../netlify/functions/campus-admin.js")).default;
const sessions = (await import("../netlify/functions/campus-sessions.js")).default;
const share = (await import("../netlify/functions/campus-share.js")).default;
const media = (await import("../netlify/functions/campus-media.js")).default;
const analytics = (await import("../netlify/functions/campus-analytics.js")).default;
const { docGet, docSet } = await import("../netlify/lib/campus-store.js");
const { resolveSong, normRef, _resetLibraryCache, FOLLOWUP_TEXT } = await import("../netlify/lib/campus-share.js");
const { runPurge } = await import("../netlify/lib/campus-retention.js");

async function call(fn, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fn(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const PNG = "data:image/png;base64," + "A".repeat(600);
const TALK = { uri: "/study/general-conference/2026/10/13runia", title: "The Sculpting of Our Souls", speaker: "Tamara W. Runia", sourceUrl: "https://www.churchofjesuschrist.org/study/general-conference/2026/10/13runia?lang=eng" };
let adminTok, w1, w2, rec, unrec, dec;

async function session(tok, choice, extra = {}) {
  const s = (await call(sessions, { action: "start" }, tok)).data.session;
  await call(sessions, { action: "update", id: s.id, patch: { talk: TALK, songified: { existing: false }, ...extra } }, tok);
  if (choice === "declined") await call(sessions, { action: "consent", id: s.id, choice }, tok);
  else await call(sessions, { action: "consent", id: s.id, choice, name: "Pat Student", email: "pat@byu.edu", adult: true, acknowledged: true, signaturePng: choice === "recorded" ? PNG : "" }, tok);
  await call(sessions, { action: "update", id: s.id, patch: { lyrics: { generated: true, text: "[Chorus]\nShape me, sculpt me", title: "Sculpted" } } }, tok);
  return s;
}

before(async () => {
  adminTok = (await call(auth, { action: "bootstrap", secret: "test-admin-secret", email: "admin@x.com", name: "Admin", password: "password1" })).data.token;
  for (const [email, name] of [["k@x.com", "Kaitlin Test"], ["o@x.com", "Other Worker"]]) {
    const inv = await call(admin, { action: "invite", email, name }, adminTok);
    const acc = await call(auth, { action: "accept-invite", code: inv.data.invite.code, password: "workerpass1" });
    if (email === "k@x.com") w1 = acc.data.token; else w2 = acc.data.token;
  }
});

test("every session gets a short reference code; recordings are logged against it and found by it", async () => {
  rec = await session(w1, "recorded");
  assert.match(rec.ref, /^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/);
  const add = await call(sessions, { action: "recording-add", id: rec.id, kind: "camera", file: "IMG_0412.MOV", note: "wide shot" }, w1);
  assert.equal(add.status, 200);
  assert.equal(add.data.session.recordings.length, 1);
  assert.equal(add.data.session.videoRef, "IMG_0412.MOV");
  assert.equal((await call(sessions, { action: "recording-add", id: rec.id, file: "x" }, w2)).status, 403, "another worker can't add to it");
  const c = await docGet(`consent:${rec.id}`);
  assert.equal(c.recordings[0].file, "IMG_0412.MOV", "the consent record carries the recording references");
  // the administrator finds the session by its reference code, typed loosely
  const look = await call(admin, { action: "consent-lookup", sessionId: rec.ref.toLowerCase().replace("-", " ") }, adminTok);
  assert.equal(look.status, 200);
  assert.equal(look.data.sessionId, rec.id);
  assert.equal(look.data.recordings[0].kind, "camera");
  assert.equal(normRef(" k7q-4mx "), "K7Q4MX");
  // only authorized-recording sessions take recording references
  unrec = await session(w2, "unrecorded"); // (a new session by the same worker would close the open one)
  assert.equal((await call(sessions, { action: "recording-add", id: unrec.id, file: "IMG_1.MOV" }, w2)).status, 403);
});

test("completing a participating session creates the song page; declined sessions get none", async () => {
  const done = await call(sessions, { action: "complete", id: rec.id, outcome: { reaction: "positive" } }, w1);
  assert.match(done.data.session.share.code, /^[a-z2-9]{10}$/);
  dec = await session(w1, "declined");
  const d = await call(sessions, { action: "complete", id: dec.id, outcome: {} }, w1);
  assert.equal(d.data.session.share, undefined);
  assert.equal((await call(sessions, { action: "share", id: dec.id }, w1)).status, 400);
  // an already-finished session can still produce its QR (same code)
  const again = await call(sessions, { action: "share", id: rec.id }, w1);
  assert.equal(again.data.share.code, done.data.session.share.code);
  rec = done.data.session;
});

test("the public song page shows the song and lyrics, and nothing about the student or worker", async () => {
  const code = rec.share.code;
  assert.equal((await call(share, { action: "get", code: "nope" })).status, 404);
  assert.equal((await call(share, { action: "get", code: "abcdefghjk" })).status, 404);
  _resetLibraryCache();
  const g = await call(share, { action: "get", code });
  assert.equal(g.status, 200);
  assert.equal(g.data.page.title, "Sculpted");
  assert.equal(g.data.page.talk.title, TALK.title);
  assert.match(g.data.page.lyrics, /Shape me/);
  const txt = JSON.stringify(g.data);
  for (const bad of ["Pat Student", "pat@byu.edu", "data:image", rec.id, "Kaitlin", "IMG_0412", "workerId"]) assert.ok(!txt.includes(bad), `song page must not include ${bad}`);
  // the worker pastes MelodyCraft's share link → the page plays it
  assert.equal((await call(sessions, { action: "song-link", id: rec.id, url: "javascript:alert(1)" }, w1)).status, 400);
  await call(sessions, { action: "song-link", id: rec.id, url: "https://melodycraft.example/s/abc" }, w1);
  const g2 = await call(share, { action: "get", code });
  assert.equal(g2.data.page.song.kind, "link");
  assert.equal(g2.data.page.songPending, false);
  const idx = await docGet(`share:${code}`);
  assert.equal(idx.views, 2, "visits are counted on the share record, not the session");
  // ratings from the page
  assert.equal((await call(share, { action: "feedback", code, rating: 9 })).status, 400);
  assert.equal((await call(share, { action: "feedback", code, rating: 5, comment: "Love it!" })).status, 200);
  assert.equal((await docGet(`sharefb:${rec.id}`)).items[0].comment, "Love it!");
});

test("an uploaded song plays from a signed private link; a library song is found by talk", async () => {
  const sg = await call(media, { action: "sign-song", sessionId: unrec.id, mime: "audio/mpeg", bytes: 4_000_000 }, w2);
  assert.equal(sg.status, 200);
  assert.match(sg.data.uploadUrl, /X-Amz-Signature=/);
  assert.equal((await call(media, { action: "sign-song", sessionId: unrec.id, mime: "video/mp4", bytes: 10 }, w2)).status, 400);
  const cf = await call(media, { action: "confirm-song", sessionId: unrec.id, bytes: 4_000_000 }, w2);
  assert.equal(cf.data.songFile.status, "ready");
  const s = await docGet(`session:${unrec.id}`);
  assert.equal(s.song.generated, true);
  const song = await resolveSong(s, { signedSongUrl: (k) => `signed:${k}` });
  assert.equal(song.kind, "audio");
  assert.match(song.url, /^signed:campus\//);
  // nothing attached → a library song for the same talk, newest first
  _resetLibraryCache();
  const fake = async () => ({ json: async () => ({ songs: [
    { id: "a", title: "Old", talkUrl: "https://www.churchofjesuschrist.org/study/general-conference/2026/10/13runia?lang=eng", audioUrl: "https://x/a.mp3", addedAt: "2026-10-01" },
    { id: "b", title: "New", talkUrl: "https://www.churchofjesuschrist.org/study/general-conference/2026/10/13runia?lang=eng", audioUrl: "https://x/b.mp3", videoUrl: "https://x/b.mp4", addedAt: "2026-10-12" },
    { id: "c", title: "Other", talkUrl: "https://www.churchofjesuschrist.org/study/general-conference/2026/10/12gong?lang=eng", audioUrl: "https://x/c.mp3" },
  ] }) });
  const lib = await resolveSong({ talk: TALK }, { fetchImpl: fake });
  assert.equal(lib.title, "New");
  assert.equal(lib.kind, "video");
  assert.equal(lib.fromLibrary, true);
  _resetLibraryCache();
  assert.equal(await resolveSong({ talk: { uri: "/study/general-conference/2026/10/99nobody" } }, { fetchImpl: fake }), null);
  _resetLibraryCache();
});

test("student feedback is saved after completion, but not forever", async () => {
  const f = await call(sessions, { action: "feedback", id: rec.id, rating: 5, helped: "yes", more: "maybe", share: "yes", comment: "So cool" }, w1);
  assert.equal(f.status, 200);
  assert.equal(f.data.session.feedback.rating, 5);
  assert.equal(f.data.session.feedback.more, "maybe");
  const bad = await call(sessions, { action: "feedback", id: rec.id, rating: 11, helped: "banana" }, w1);
  assert.equal(bad.data.session.feedback.rating, null);
  assert.equal(bad.data.session.feedback.helped, null);
  await call(sessions, { action: "feedback", id: rec.id, rating: 5, helped: "yes", more: "maybe", share: "yes", comment: "So cool" }, w1);
  const old = await docGet(`session:${dec.id}`);
  old.endedAt = new Date(Date.now() - 8 * 86400000).toISOString();
  await docSet(`session:${dec.id}`, old);
  assert.equal((await call(sessions, { action: "feedback", id: dec.id, rating: 3 }, w1)).status, 400, "closed for a week → no more edits by the worker");
});

test("follow-ups need an explicit opt-in; the email lives only in the follow-up record", async () => {
  assert.equal((await call(sessions, { action: "followup", id: rec.id, email: "pat@byu.edu" }, w1)).status, 400, "no tick, no follow-up");
  assert.equal((await call(sessions, { action: "followup", id: rec.id, email: "not-an-email", agree: true }, w1)).status, 400);
  assert.equal((await call(sessions, { action: "followup", id: dec.id, email: "x@y.com", agree: true }, adminTok)).status, 400, "declined students can't be followed up");
  const ok = await call(sessions, { action: "followup", id: rec.id, email: "Pat@BYU.edu", firstName: "Pat Student", agree: true, purposes: ["song", "video"] }, w1);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.session.followUp.optedIn, true);
  assert.ok(!JSON.stringify(ok.data.session).includes("pat@byu.edu"), "the session never holds the email");
  const fu = await docGet(`followup:${rec.id}`);
  assert.equal(fu.email, "pat@byu.edu");
  assert.equal(fu.firstName, "Pat");
  assert.equal(fu.optInText, FOLLOWUP_TEXT, "the exact opt-in wording is kept");
  // summaries, worker lists and analytics never carry it
  const mine = await call(sessions, { action: "mine" }, w1);
  assert.ok(!JSON.stringify(mine.data).includes("pat@byu.edu"));
  const an = await call(analytics, { action: "overview" }, adminTok);
  assert.ok(!JSON.stringify(an.data).includes("pat@byu.edu"));
  assert.equal(an.data.engagement.followUps.optedIn, 1);
  assert.equal(an.data.engagement.feedback.avgRating, 5);
  assert.equal(an.data.engagement.songPages.views, 2);
  assert.equal(an.data.engagement.songPages.ratings, 1);
  assert.ok(an.data.comments.some((c) => c.comment === "So cool" && c.where === "thank-you screen"));
  assert.ok(an.data.comments.some((c) => c.comment === "Love it!" && c.where === "song page"));
  const row = an.data.rows.find((r) => r.id === rec.id);
  assert.equal(row.rating, 5);
  assert.equal(row.followUp, "waiting");
  // only the administrator sees the list (with the email), and logs each send
  assert.equal((await call(admin, { action: "followups" }, w1)).status, 403);
  const list = await call(admin, { action: "followups" }, adminTok);
  assert.equal(list.data.followups[0].email, "pat@byu.edu");
  assert.equal(list.data.followups[0].songReady, true);
  const s1 = await call(admin, { action: "followup-update", sessionId: rec.id, status: "sent", purpose: "song" }, adminTok);
  assert.equal(s1.data.followup.status, "waiting", "the video email is still owed");
  const s2 = await call(admin, { action: "followup-update", sessionId: rec.ref, status: "sent", purpose: "video" }, adminTok);
  assert.equal(s2.data.followup.status, "sent");
  assert.equal(s2.data.followup.sent.length, 2);
});

test("opting out erases the email at once; the retention policy erases the rest on schedule", async () => {
  const other = await session(w2, "unrecorded");
  await call(sessions, { action: "complete", id: other.id, outcome: {} }, w2);
  await call(sessions, { action: "followup", id: other.id, email: "sam@byu.edu", agree: true }, w2);
  const out = await call(admin, { action: "followup-update", sessionId: other.id, status: "opted-out" }, adminTok);
  assert.equal(out.data.followup.email, "");
  assert.equal(out.data.followup.status, "opted-out");
  assert.equal((await call(admin, { action: "followup-update", sessionId: other.id, status: "sent" }, adminTok)).status, 400, "can't email an erased contact");
  // the sent contact ages past the policy
  const fu = await docGet(`followup:${rec.id}`);
  fu.sentAt = new Date(Date.now() - 61 * 86400000).toISOString();
  await docSet(`followup:${rec.id}`, fu);
  const pv = await call(analytics, { action: "retention" }, adminTok);
  assert.equal(pv.data.followupCandidates.length, 1);
  assert.ok(!JSON.stringify(pv.data).includes("pat@byu.edu"), "the retention preview shows no emails");
  const r = await runPurge({ by: "admin", deleter: async () => {} });
  assert.equal(r.log.followupsErased, 1);
  const after = await docGet(`followup:${rec.id}`);
  assert.equal(after.email, "");
  assert.equal(after.status, "sent");
  assert.match(after.history.at(-1).what, /retention policy/);
  assert.equal((await call(analytics, { action: "set-retention", followupRetentionDays: 2 }, adminTok)).status, 400);
});

test("withdrawn consent or an administrator switch takes the song page down", async () => {
  const code = rec.share.code;
  const off = await call(admin, { action: "share-toggle", sessionId: rec.id, disabled: true }, adminTok);
  assert.equal(off.data.share.disabled, true);
  assert.equal((await call(share, { action: "get", code })).status, 404);
  await call(admin, { action: "share-toggle", sessionId: rec.id, disabled: false }, adminTok);
  assert.equal((await call(share, { action: "get", code })).status, 200);
  await call(admin, { action: "consent-withdraw", sessionId: rec.ref, note: "Emailed" }, adminTok);
  assert.equal((await call(share, { action: "get", code })).status, 404);
  assert.equal((await call(sessions, { action: "share", id: rec.id }, adminTok)).status, 403);
});
