// Server-side storyboard pipeline — run with:  node --test tests/scene-pipeline.test.mjs
// The AI services are faked (global fetch), so this checks the orchestration:
// order of steps, reference chaining, cards, stop, resume, and the image rules.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

delete process.env.NETLIFY;
process.env.ANTHROPIC_API_KEY = "test-anthropic";
process.env.OPENAI_API_KEY = "test-openai";

const pipelineBg = (await import("../netlify/functions/scene-pipeline-background.js")).default;
const pipelineApi = (await import("../netlify/functions/scene-pipeline.js")).default;
const { jobGet, jobSet, blobGetText } = await import("../netlify/lib/jobs.js");

const calls = [];
let imageFails = new Set();
let imageCount = 0;
const reply = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
const claude = (obj) => reply({ content: [{ type: "text", text: JSON.stringify(obj) }] });

beforeEach(() => { calls.length = 0; imageFails = new Set(); imageCount = 0; });

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("api.anthropic.com")) {
    const b = JSON.parse(init.body);
    const text = `${b.system || ""}\n${JSON.stringify(b.messages)}`;
    if (/style bible|styleBible/i.test(text) && /"styleBible"/.test(text) && !/OUTLINE|outline/.test(b.system || "")) { calls.push("style"); return claude({ styleBible: { artStyle: "Painterly", colorPalette: "Gold & navy", lighting: "Dawn" } }); }
    if (/outline/i.test(b.system || "")) { calls.push("outline"); return claude({ outline: [1, 2, 3].map((n) => ({ sceneNumber: n, lyricSection: `Verse ${n}`, beat: `Beat ${n}`, lyrics: `Line ${n}` })) }); }
    if (/songTitle/.test(text)) { calls.push("meta"); return claude({ songTitle: "Sculpted", speaker: "Tamara W. Runia", conferenceMonthYear: "October 2026", session: "" }); }
    calls.push("detail");
    return claude({ description: "A scene", imagePrompt: "A painterly dawn scene" });
  }
  if (url.includes("api.openai.com/v1/images")) {
    imageCount++;
    const isEdit = url.includes("/edits");
    let prompt = "";
    if (isEdit) prompt = init.body.get("prompt"); else prompt = JSON.parse(init.body).prompt;
    calls.push(isEdit ? "image+ref" : "image");
    calls.push(prompt);
    if (imageFails.has(imageCount)) return new Response("nope", { status: 500 });
    return reply({ data: [{ b64_json: Buffer.from(`img${imageCount}`).toString("base64") }] });
  }
  if (url.includes("scene-pipeline-background")) { calls.push("handoff"); return reply({}); }
  throw new Error("unexpected fetch " + url);
};

const call = async (fn, body) => { const r = await fn(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, data: await r.json() }; };
const INPUT = { lyrics: "[Verse 1]\nLine 1\n[Verse 2]\nLine 2\n[Verse 3]\nLine 3", talkText: "A talk", meta: { speaker: "Tamara W. Runia" } };

test("builds the whole storyboard: style → outline → prompts → images in order (each referencing the last) → cards", async () => {
  const pipeId = "pipe_test_full";
  await call(pipelineBg, { pipeId, input: INPUT });
  const doc = await jobGet(pipeId);
  assert.equal(doc.status, "done");
  assert.equal(doc.scenes.length, 3);
  assert.ok(doc.scenes.every((s) => s.imagePrompt === "A painterly dawn scene"));
  assert.deepEqual(Object.keys(doc.images).sort(), ["1", "2", "3"]);
  // first scene image is generated fresh, the next two use the previous image as reference
  const kinds = calls.filter((c) => c === "image" || c === "image+ref");
  assert.deepEqual(kinds.slice(0, 3), ["image", "image+ref", "image+ref"]);
  // house rules are on every image prompt
  assert.ok(calls.filter((c) => typeof c === "string" && c.startsWith("A painterly")).every((p) => /do not depict the sacrament/.test(p)));
  // title from the AI (the speaker came from the talk), then both cards, referencing first / last scene
  assert.equal(doc.meta.songTitle, "Sculpted");
  assert.equal(doc.meta.speaker, "Tamara W. Runia");
  assert.ok(doc.cards.intro.jobId && doc.cards.outro.jobId);
  assert.match(doc.cards.intro.prompt, /TITLE CARD/);
  assert.equal(kinds.length, 5);
  const img = JSON.parse(await blobGetText(`out:${doc.images[2]}`));
  assert.equal(Buffer.from(img.b64, "base64").toString(), "img2");
  // the status call hides the inputs and internal fields
  const st = await call(pipelineApi, { action: "status", pipeId });
  assert.equal(st.data.pipe.status, "done");
  assert.equal(st.data.pipe.input, undefined);
  assert.ok(st.data.pipe.scenes.every((s) => !("_beat" in s)));
});

test("a failed image is recorded and the rest carry on", async () => {
  imageFails = new Set([2]);
  const pipeId = "pipe_test_fail";
  await call(pipelineBg, { pipeId, input: INPUT });
  const doc = await jobGet(pipeId);
  assert.equal(doc.status, "done");
  assert.deepEqual(doc.failures, [2]);
  assert.deepEqual(Object.keys(doc.images).sort(), ["1", "3"]);
  assert.match(doc.progress, /1 scene image failed/);
});

test("stop is honored between steps; a second invocation can't steal a live lease; resume finishes the job", async () => {
  const pipeId = "pipe_test_stop";
  // pretend a build is mid-way: scenes written, one image done, a live lease held by another run
  await jobSet(pipeId, {
    id: pipeId, status: "running", input: { ...INPUT, sceneBasis: "song", lockReference: true, autoImages: true },
    styleBible: { artStyle: "x" }, scenes: [1, 2].map((n) => ({ sceneNumber: n, lyrics: "", lyricSection: "", description: "d", imagePrompt: "p", _detailTried: true })),
    images: {}, cards: {}, meta: null, failures: [], stop: false, lease: { run: "other", until: Date.now() + 60000 },
  });
  const busy = await call(pipelineBg, { pipeId, run: "mine" });
  assert.equal(busy.data.busy, true);
  assert.equal(calls.length, 0, "nothing ran while someone else held the lease");
  // lease expires (the other invocation died) → this one takes over, but a stop arrives first
  const d = await jobGet(pipeId);
  await jobSet(pipeId, { ...d, lease: { run: "other", until: Date.now() - 1 } });
  await call(pipelineApi, { action: "stop", pipeId });
  await call(pipelineBg, { pipeId, run: "mine" });
  assert.equal((await jobGet(pipeId)).status, "stopped");
  assert.equal(calls.filter((c) => c === "image" || c === "image+ref").length, 0);
  // a finished build ignores further calls
  const again = await call(pipelineBg, { pipeId, run: "x" });
  assert.equal(again.data.status, "stopped");
});

test("bad requests are refused", async () => {
  assert.equal((await call(pipelineBg, { pipeId: "nope" })).status, 400);
  assert.equal((await call(pipelineBg, { pipeId: "pipe_test_nolyrics", input: { lyrics: "  " } })).status, 400);
  assert.equal((await call(pipelineApi, { action: "status", pipeId: "../etc" })).status, 400);
  assert.equal((await call(pipelineApi, { action: "status", pipeId: "pipe_unknown_1" })).data.pipe, null);
});

test("out of time: the build hands itself off to a fresh invocation, which picks up where it left off", async () => {
  process.env.SCENE_PIPELINE_BUDGET_MS = "1";
  const mod = await import("../netlify/functions/scene-pipeline-background.js?budget=1");
  const pipeId = "pipe_test_handoff";
  let handed = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes("scene-pipeline-background")) { handed = JSON.parse(init.body); return reply({}); } return realFetch(url, init); };
  await call(mod.default, { pipeId, input: INPUT });
  let doc = await jobGet(pipeId);
  assert.equal(doc.status, "running");
  assert.ok(handed && handed.pipeId === pipeId && handed.run, "it called itself with a run token");
  assert.equal(doc.lease.run, handed.run, "the lease is reserved for the next invocation");
  assert.ok(Array.isArray(doc.scenes), "work done so far was saved");
  // keep invoking with each hand-off token until done (each pass does one step)
  delete process.env.SCENE_PIPELINE_BUDGET_MS;
  for (let i = 0; i < 3 && doc.status === "running"; i++) {
    const run = handed.run; handed = null;
    await call(pipelineBg, { pipeId, run });
    doc = await jobGet(pipeId);
  }
  globalThis.fetch = realFetch;
  assert.equal(doc.status, "done");
  assert.deepEqual(Object.keys(doc.images).sort(), ["1", "2", "3"]);
  assert.ok(doc.handoffs >= 1);
});

test("merging into the project never overwrites the person's own work", async () => {
  const { mergePipeline, lyricsKey } = await import("../src/lib/scene-pipeline.js");
  const pipe = {
    styleBible: { artStyle: "server" },
    scenes: [{ sceneNumber: 1, description: "srv d1", imagePrompt: "srv p1", lyrics: "L1" }, { sceneNumber: 2, description: "srv d2", imagePrompt: "srv p2", lyrics: "L2" }],
    images: { 1: "job1", 2: "job2" }, cards: { intro: { jobId: "jobI", prompt: "intro prompt" } },
    meta: { songTitle: "Server title", speaker: "Server speaker" },
  };
  // empty storyboard → everything lands
  let r = mergePipeline({ scenes: [], images: {}, saved: {}, meta: {}, endcards: {} }, pipe, { job1: "data:1", job2: "data:2", jobI: "data:I" }, null);
  assert.equal(r.changed, true);
  assert.equal(r.next.scenes.length, 2);
  assert.equal(r.next.images[1], "data:1");
  assert.equal(r.next.endcards.intro.image, "data:I");
  assert.equal(r.next.meta.songTitle, "Server title");
  assert.deepEqual(r.applied.images, { 1: "job1", 2: "job2" });
  // the person edited a prompt, uploaded scene 2's image, saved scene 1, and typed a title → all kept
  const mine = { styleBible: { artStyle: "mine" }, scenes: [{ sceneNumber: 1, description: "", imagePrompt: "MY prompt", lyrics: "L1" }, { sceneNumber: 2, description: "my d2", imagePrompt: "", lyrics: "L2" }],
    images: { 2: "data:upload" }, saved: { 1: "data:saved1" }, meta: { songTitle: "My title" }, endcards: { intro: { image: "data:my-intro" } } };
  r = mergePipeline(mine, pipe, { job1: "data:1", job2: "data:2", jobI: "data:I" }, null);
  assert.equal(r.next.styleBible.artStyle, "mine");
  assert.equal(r.next.scenes[0].imagePrompt, "MY prompt");
  assert.equal(r.next.scenes[0].description, "srv d1", "blanks are filled");
  assert.equal(r.next.scenes[1].imagePrompt, "srv p2");
  assert.equal(r.next.scenes[1].description, "my d2");
  assert.equal(r.next.images[2], "data:upload");
  assert.equal(r.next.images[1], undefined, "scene 1 is already saved → the server image isn't forced in");
  assert.equal(r.next.endcards.intro.image, "data:my-intro");
  assert.equal(r.next.meta.songTitle, "My title");
  assert.equal(r.next.meta.speaker, "Server speaker");
  // already-applied jobs aren't merged again; images not fetched yet wait for the next poll
  const again = mergePipeline({ ...r.next, images: {} }, pipe, {}, r.applied);
  assert.equal(again.next.images[1], undefined);
  assert.notEqual(lyricsKey("a"), lyricsKey("b"));
  assert.equal(lyricsKey("same"), lyricsKey("same"));
});
