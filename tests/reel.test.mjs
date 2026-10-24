import test from "node:test";
import assert from "node:assert/strict";
import { defaultSpeakerRange, trimSpeakerClip, reelText, reelOutline, clipLength } from "../src/lib/reel.js";

const TAPPED = { in: 10, out: 40, captions: { on: true, text: "First phrase here\nSecond phrase now\nThird one\nFourth and last", marks: [0, 5, 13, 22] } };

test("a short speaker clip is used whole", () => {
  assert.deepEqual(defaultSpeakerRange({ in: 2, out: 14 }), { from: 0, to: 12 });
});

test("a long clip stops at the end of a phrase near 15 s", () => {
  assert.equal(clipLength(TAPPED), 30);
  // phrase ends: 5, 13, 22, 30 -> the last one by 16 s is 13
  assert.deepEqual(defaultSpeakerRange(TAPPED), { from: 0, to: 13 });
  // no captions: a plain 15 s
  assert.deepEqual(defaultSpeakerRange({ in: 0, out: 60 }), { from: 0, to: 15 });
});

test("trimming keeps the captions in step with the words", () => {
  const c = trimSpeakerClip(TAPPED, "blob:x", { from: 5, to: 20 });
  assert.equal(c.in, 15);
  assert.equal(c.out, 30);
  assert.equal(c.captions.text, "Second phrase now\nThird one");
  assert.deepEqual(c.captions.marks, [0, 8]);
  assert.equal(trimSpeakerClip(TAPPED, "", { from: 0, to: 5 }), null);
});

test("post text names the song, the talk and #Shorts", () => {
  const t = reelText({ songTitle: "Come Follow Me", talk: { title: "The Good Shepherd", speaker: "Elder Jane Doe", conferenceMonthYear: "October 2026" } });
  assert.match(t.shortsTitle, /^Come Follow Me \| Elder Jane Doe #Shorts$/);
  assert.match(t.shortsDescription, /October 2026 General Conference/);
  assert.match(t.shortsDescription, /#Shorts/);
  assert.match(t.facebookCaption, /#JaneDoe/);
  assert.ok(!/#Shorts/.test(t.facebookCaption));
});

test("outline adds up and checks the platform limits", () => {
  const o = reelOutline({ speakerLen: 13, speakerOrder: "first", songLen: 32, logoSec: 3 });
  assert.deepEqual(o.parts.map((p) => p.key), ["speaker", "chorus", "logo"]);
  assert.equal(o.total, 48.6);
  assert.ok(o.fitsFacebook && o.fitsShorts);
  assert.equal(reelOutline({ speakerLen: 30, songLen: 70, logoSec: 3 }).fitsFacebook, false);
});
