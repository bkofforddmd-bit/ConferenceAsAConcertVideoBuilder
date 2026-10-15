// Campus Sessions video clips — run with:  node --test tests/campus-media.test.mjs
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
const { presign } = await import("../netlify/lib/r2.js");

async function call(fn, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fn(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
const PNG = "data:image/png;base64," + "A".repeat(600);
let adminTok, w1, w2, recorded, unrecorded;

before(async () => {
  adminTok = (await call(auth, { action: "bootstrap", secret: "test-admin-secret", email: "a@x.com", name: "A", password: "password1" })).data.token;
  for (const [email, set] of [["w1@x.com", (t) => (w1 = t)], ["w2@x.com", (t) => (w2 = t)]]) {
    const inv = await call(admin, { action: "invite", email, name: email }, adminTok);
    set((await call(auth, { action: "accept-invite", code: inv.data.invite.code, password: "workerpass1" })).data.token);
  }
  recorded = (await call(sessions, { action: "start" }, w1)).data.session;
  await call(sessions, { action: "consent", id: recorded.id, choice: "recorded", name: "Pat", adult: true, signaturePng: PNG }, w1);
  unrecorded = (await call(sessions, { action: "start" }, w2)).data.session;
  await call(sessions, { action: "consent", id: unrecorded.id, choice: "unrecorded", name: "Sam", adult: true, acknowledged: true }, w2);
});

test("presigned URLs point at the private bucket and carry a V4 signature", () => {
  const put = presign({ method: "PUT", key: "campus/cs_1/clip_1.mp4", expiresSec: 600, contentType: "video/mp4" });
  const u = new URL(put);
  assert.equal(u.host, "acct123.r2.cloudflarestorage.com");
  assert.equal(u.pathname, "/cac-campus-clips/campus/cs_1/clip_1.mp4");
  assert.equal(u.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.match(u.searchParams.get("X-Amz-Credential"), /^AKIDTEST\/\d{8}\/auto\/s3\/aws4_request$/);
  assert.equal(u.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assert.equal(u.searchParams.get("X-Amz-Expires"), "600");
  assert.match(u.searchParams.get("X-Amz-Signature"), /^[0-9a-f]{64}$/);
  const get = presign({ method: "GET", key: "campus/cs_1/clip 1.mp4" });
  assert.equal(new URL(get).searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.ok(get.includes("/campus/cs_1/clip%201.mp4?"), "keys are URL-encoded");
});

test("recording needs authorized consent, the session's own worker, and sane sizes", async () => {
  assert.equal((await call(media, { action: "status" }, w1)).data.configured, true);
  assert.equal((await call(media, { action: "sign-upload", sessionId: unrecorded.id, stage: "testimony", mime: "video/mp4", bytes: 1000 }, w2)).status, 403);
  assert.equal((await call(media, { action: "sign-upload", sessionId: recorded.id, stage: "testimony", mime: "video/mp4", bytes: 1000 }, w2)).status, 403, "another worker");
  assert.equal((await call(media, { action: "sign-upload", sessionId: recorded.id, stage: "testimony", mime: "video/mp4", bytes: 900 * 1048576 }, w1)).status, 400, "too big");
  assert.equal((await call(media, { action: "list", sessionId: recorded.id })).status, 401, "unauthenticated");
});

test("sign → upload → confirm → list → delete, with signed links and no leakage into summaries", async () => {
  const s1 = await call(media, { action: "sign-upload", sessionId: recorded.id, stage: "lyrics-reaction", mime: "video/webm;codecs=vp9", bytes: 5000 }, w1);
  assert.equal(s1.status, 200);
  assert.equal(s1.data.clip.status, "uploading");
  assert.equal(s1.data.clip.ext, "webm");
  assert.match(s1.data.uploadUrl, /X-Amz-Signature=/);
  assert.ok(s1.data.uploadUrl.includes(`/campus/${recorded.id}/${s1.data.clip.id}.webm?`));
  // not listed until confirmed
  assert.equal((await call(media, { action: "list", sessionId: recorded.id }, w1)).data.clips.length, 0);
  const c = await call(media, { action: "confirm", sessionId: recorded.id, clipId: s1.data.clip.id, bytes: 5000, durationSec: 12.34 }, w1);
  assert.equal(c.data.clip.status, "ready");
  assert.equal(c.data.clip.durationSec, 12.3);
  const list = await call(media, { action: "list", sessionId: recorded.id }, w1);
  assert.equal(list.data.clips.length, 1);
  assert.match(list.data.clips[0].url, /^https:\/\/acct123\.r2\.cloudflarestorage\.com\/cac-campus-clips\/campus\//);
  // admin sees it in consent lookup and the count in summaries; summaries never carry keys or urls
  const look = await call(admin, { action: "consent-lookup", sessionId: recorded.id }, adminTok);
  assert.equal(look.data.clips.length, 1);
  assert.ok(look.data.clips[0].url);
  const all = await call(admin, { action: "sessions" }, adminTok);
  const row = all.data.sessions.find((x) => x.id === recorded.id);
  assert.equal(row.clipCount, 1);
  assert.ok(!JSON.stringify(row).includes("cloudflarestorage"), "no storage links in summaries");
  // other worker can't list or delete
  assert.equal((await call(media, { action: "list", sessionId: recorded.id }, w2)).status, 403);
  assert.equal((await call(media, { action: "delete", sessionId: recorded.id, clipId: s1.data.clip.id }, w2)).status, 403);
  // delete goes to storage (mocked) and drops the record
  const realFetch = globalThis.fetch;
  let deletedUrl = "";
  globalThis.fetch = async (url, opts) => { deletedUrl = String(url); assert.equal(opts.method, "DELETE"); return { ok: true, status: 204 }; };
  try {
    const d = await call(media, { action: "delete", sessionId: recorded.id, clipId: s1.data.clip.id }, w1);
    assert.equal(d.status, 200);
  } finally { globalThis.fetch = realFetch; }
  assert.match(deletedUrl, /X-Amz-Signature=/);
  assert.equal((await call(media, { action: "list", sessionId: recorded.id }, w1)).data.clips.length, 0);
});

test("the built-in release text now describes in-app recording (version 2)", async () => {
  const cfg = await call(sessions, { action: "config" }, w1);
  assert.equal(cfg.data.consent.version, 2);
  assert.match(cfg.data.consent.text, /this app's camera window/);
  assert.doesNotMatch(cfg.data.consent.text, /The app itself does not record you/);
});
