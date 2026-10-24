import test from "node:test";
import assert from "node:assert/strict";
import { firstChorusLines, firstChorusWindow, previewWindow } from "../src/lib/chorus.js";

const LYRICS = [
  "[Verse 1]",          // 0
  "Walking in the light", // 1
  "Every step I take",    // 2
  "",                     // 3
  "[Pre-Chorus]",         // 4
  "And I feel it rise",   // 5
  "",                     // 6
  "[Chorus]",             // 7
  "Come and follow me",   // 8
  "Hear the Shepherd call", // 9
  "Come and follow me",   // 10
  "",                     // 11
  "[Verse 2]",            // 12
  "Second verse begins",  // 13
].join("\n");
const SYNC = [[1, 10], [2, 14], [5, 20], [8, 30], [9, 34], [10, 38], [13, 46]];

test("finds the labelled chorus, not the pre-chorus", () => {
  assert.deepEqual(firstChorusLines(LYRICS), { first: 8, last: 10, source: "label" });
});

test("chorus window runs from its first word to the next section's first word", () => {
  const w = firstChorusWindow(LYRICS, SYNC, 120);
  assert.equal(w.start, 29.6);
  assert.equal(w.end, 45.7);
  assert.equal(w.source, "label");
});

test("a chorus that closes the song ends a line's length after its last line", () => {
  const ly = LYRICS.split("\n").slice(0, 11).join("\n");
  const w = firstChorusWindow(ly, SYNC.filter(([i]) => i <= 10), 50);
  assert.equal(w.start, 29.6);
  assert.ok(w.end > 40 && w.end <= 50, String(w.end));
});

test("no labels → the stanza that repeats", () => {
  const ly = ["one two three", "four five six", "", "sing it out loud", "sing it again", "", "seven eight", "nine ten", "", "sing it out loud", "sing it again"].join("\n");
  assert.deepEqual(firstChorusLines(ly), { first: 3, last: 4, source: "repeat" });
  const w = firstChorusWindow(ly, [[0, 5], [1, 8], [3, 12], [4, 15], [6, 20], [7, 23], [9, 28], [10, 31]], 40);
  assert.equal(w.start, 11.6);
  assert.equal(w.end, 19.7);
});

test("no sync or no chorus → null; a hand-set window wins", () => {
  assert.equal(firstChorusWindow(LYRICS, null, 100), null);
  assert.equal(firstChorusWindow("a b c\nd e f", [[0, 1], [1, 2]], 10), null);
  assert.deepEqual(previewWindow({ preview: { start: 12, end: 40 } }, LYRICS, SYNC, 120), { start: 12, end: 40, source: "manual" });
  assert.equal(previewWindow({}, LYRICS, SYNC, 120).source, "label");
});
