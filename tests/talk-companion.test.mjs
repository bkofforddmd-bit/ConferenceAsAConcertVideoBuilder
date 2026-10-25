import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanion, companionPayload, phraseRange, talkParagraphs, lineAtTime, anchorOf } from "../src/lib/talk-companion.js";

const TALK = [
  "My dear brothers and sisters, I testify that the Savior knows each of us by name. He is the Good Shepherd.",
  "When we feel lost, He leaves the ninety and nine to find the one. No one is beyond the reach of His love.",
  "Come, follow Him. Hear His voice calling softly in the stillness of the night, and answer with faith.",
].join("\n\n");
const LYRICS = ["[Verse 1]", "He knows my name, the Shepherd of my soul", "", "[Chorus]", "Come follow, hear His voice", "No one is beyond His reach"].join("\n");

test("paragraph split and anchors", () => {
  const ps = talkParagraphs(TALK);
  assert.equal(ps.length, 3);
  assert.equal(anchorOf(ps[1]), "when we feel lost he leaves the ninety and nine");
});

test("traced lines use the AI's paragraph and exact phrase; others fall back to shared words", () => {
  const sources = { lines: ["He knows my name, the Shepherd of my soul", "Come follow, hear His voice"], map: { 0: { paragraphs: [0], phrase: "knows each of us by name", confidence: 0.9 }, 1: { paragraphs: [2], phrase: "Hear His voice calling softly", confidence: 0.8 } } };
  const c = buildCompanion({ lyrics: LYRICS, talkText: TALK, sources, sync: [[1, 5], [4, 20], [5, 24]] });
  assert.equal(c.lines.length, 3);
  assert.equal(c.traced, 2);
  const [a, b, d] = c.lines;
  assert.equal(a.p, 0); assert.equal(a.section, "Verse 1"); assert.equal(a.t, 5); assert.equal(a.ai, true);
  assert.equal(c.paragraphs[0].slice(...a.phrase), "knows each of us by name");
  assert.equal(b.p, 2); assert.equal(b.section, "Chorus");
  assert.equal(d.p, 1, "untraced line found by shared words"); assert.equal(d.ai, false);
  assert.match(c.paragraphs[1].slice(...d.phrase), /No one is beyond the reach of His love/);
  assert.equal(lineAtTime(c.lines, 21), 1);
  assert.equal(lineAtTime(c.lines, 1), -1);
});

test("phrase not found verbatim → the best sentence", () => {
  const p = "First idea here. The Savior seeks the lost sheep with patience. Last idea.";
  const r = phraseRange(p, "He seeks the lost sheep", "seeking lost sheep patiently");
  assert.equal(p.slice(...r), "The Savior seeks the lost sheep with patience.");
});

test("payload carries no talk text beyond the phrases", () => {
  const c = buildCompanion({ lyrics: LYRICS, talkText: TALK, sources: null, sync: null });
  const pay = companionPayload(c, { talkUrl: "https://www.churchofjesuschrist.org/study/general-conference/2026/10/x", talkTitle: "T", speaker: "S" });
  assert.equal(pay.v, 1);
  assert.equal(pay.paragraphCount, 3);
  const json = JSON.stringify(pay);
  for (const p of talkParagraphs(TALK)) assert.ok(!json.includes(p), "no whole paragraph is stored");
  assert.ok(Object.keys(pay.anchors).length >= 1);
  assert.equal(pay.lines[0].t, null);
});

import { focusFromLines, focusFromTalk, mergeRanges } from "../src/lib/talk-companion.js";
test("linked highlighting: lines -> talk, talk words -> lines", () => {
  const sources = { lines: ["He knows my name, the Shepherd of my soul", "Come follow, hear His voice"], map: { 0: { paragraphs: [0], phrase: "knows each of us by name", confidence: 0.9 }, 1: { paragraphs: [2], phrase: "Hear His voice calling softly", confidence: 0.8 } } };
  const c = buildCompanion({ lyrics: LYRICS, talkText: TALK, sources, sync: null });
  const f1 = focusFromLines(c, [0, 1]);
  assert.deepEqual(f1.paras, [0, 2]);
  assert.equal(f1.quote, "“knows each of us by name” … “Hear His voice calling softly”");
  // select words inside the traced phrase of line 1 -> line 1
  const p2 = c.paragraphs[2], a = p2.indexOf("voice calling");
  const f2 = focusFromTalk(c, [{ p: 2, a, b: a + 13 }]);
  assert.deepEqual(f2.lines, [1]);
  assert.equal(f2.quote, "“voice calling”");
  // select untraced words -> found by shared words ("reach")
  const p1 = c.paragraphs[1], b = p1.indexOf("beyond the reach");
  assert.deepEqual(focusFromTalk(c, [{ p: 1, a: b, b: b + 16 }]).lines, [2]);
  assert.deepEqual(mergeRanges([[5, 9], [0, 3], [8, 12]]), [[0, 3], [5, 12]]);
});
