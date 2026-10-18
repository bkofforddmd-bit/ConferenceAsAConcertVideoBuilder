// Interview questions — run with:  node --test tests/campus-questions.test.mjs
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
const media = (await import("../netlify/functions/campus-media.js")).default;
const { DEFAULT_QUESTIONS, cleanQuestions, defaultQuestionFor, STAGE_DEFAULT } = await import("../src/campus/questions.js");

async function call(fn, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fn(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
let adminTok, w1, sid;

before(async () => {
  adminTok = (await call(auth, { action: "bootstrap", secret: "test-admin-secret", email: "admin@x.com", name: "Admin", password: "password1" })).data.token;
  const inv = await call(admin, { action: "invite", email: "k@x.com", name: "Kaitlin Test" }, adminTok);
  w1 = (await call(auth, { action: "accept-invite", code: inv.data.invite.code, password: "workerpass1" })).data.token;
  const s = (await call(sessions, { action: "start" }, w1)).data.session;
  await call(sessions, { action: "consent", id: s.id, choice: "recorded", name: "Pat", adult: true, signaturePng: "data:image/png;base64," + "A".repeat(600) }, w1);
  sid = s.id;
});

test("question helpers: defaults per stage, cleaning an administrator's list", () => {
  assert.equal(defaultQuestionFor("favorite-talk"), DEFAULT_QUESTIONS[0]);
  assert.equal(defaultQuestionFor("song-reaction"), STAGE_DEFAULT["song-reaction"]);
  assert.equal(defaultQuestionFor("testimony", ["Only this?"]), "Only this?", "a custom bank without the default falls back to its first question");
  assert.deepEqual(cleanQuestions("  Why?  \n\nWhy?\nWhat   now? "), ["Why?", "What now?"]);
  assert.equal(cleanQuestions(Array(50).fill(0).map((_, i) => `Q${i}`)).length, 30);
});

test("the question bank lives in the administrator's settings and reaches the phone", async () => {
  const cfg = await call(sessions, { action: "config" }, w1);
  assert.deepEqual(cfg.data.settings.questions, DEFAULT_QUESTIONS);
  const set = await call(admin, { action: "set-settings", questions: "What did you love?\nWho should hear this song?" }, adminTok);
  assert.deepEqual(set.data.questions, ["What did you love?", "Who should hear this song?"]);
  assert.deepEqual((await call(sessions, { action: "config" }, w1)).data.settings.questions, ["What did you love?", "Who should hear this song?"]);
  const reset = await call(admin, { action: "set-settings", questions: "   " }, adminTok);
  assert.deepEqual(reset.data.questions, DEFAULT_QUESTIONS, "an empty list goes back to the built-in questions");
});

test("each recorded clip keeps the question the student was asked, and it can be corrected", async () => {
  const sg = await call(media, { action: "sign-upload", sessionId: sid, stage: "favorite-talk", mime: "video/mp4", bytes: 1000, question: "  What was your   favorite talk, and why? " }, w1);
  assert.equal(sg.status, 200);
  assert.equal(sg.data.clip.stage, "favorite-talk");
  assert.equal(sg.data.clip.question, "What was your favorite talk, and why?");
  await call(media, { action: "confirm", sessionId: sid, clipId: sg.data.clip.id, bytes: 1000, durationSec: 12 }, w1);
  const list = await call(media, { action: "list", sessionId: sid }, w1);
  assert.equal(list.data.clips[0].question, "What was your favorite talk, and why?");
  const fix = await call(media, { action: "set-question", sessionId: sid, clipId: sg.data.clip.id, question: "Why is this talk your favorite?" }, w1);
  assert.equal(fix.data.clip.question, "Why is this talk your favorite?");
  assert.equal((await call(media, { action: "set-question", sessionId: sid, clipId: "nope", question: "x" }, w1)).status, 404);
});
