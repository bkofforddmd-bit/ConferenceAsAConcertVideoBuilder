// src/lib/reel.js
//
// The vertical Reel / Short (9:16, 1080×1920): a short piece of the speaker's
// own words from the talk video, then the song's first chorus (the same
// "preview" window the Concert library plays), then the logo. These helpers
// pick the speaker piece, keep its captions in step when it is trimmed, and
// write the post text for Facebook Reels and YouTube Shorts.

import { captionSchedule } from "./video-render.js";

export const REEL_W = 1080;
export const REEL_H = 1920;
export const REEL_SPEAKER_MAX = 15;   // default length of the speaker piece
export const FB_REEL_MAX = 90;        // Facebook Reels limit (seconds)
export const SHORTS_MAX = 180;        // YouTube Shorts limit (seconds)

// Seconds of a bookend clip (its in → out).
export function clipLength(clip) {
  if (!clip) return 0;
  const a = Math.max(0, Number(clip.in) || 0);
  const b = Number(clip.out) > a ? Number(clip.out) : a;
  return b - a;
}

// Default piece of the speaker clip: all of it when short; otherwise from the
// start to the end of the last caption phrase that finishes by ~15 s (so it
// never stops mid-sentence), else a plain 15 s.
export function defaultSpeakerRange(clip, max = REEL_SPEAKER_MAX) {
  const len = clipLength(clip);
  if (!(len > 0)) return null;
  if (len <= max + 5) return { from: 0, to: round1(len) };
  const cues = captionSchedule(clip, len);
  const ends = cues.map((c) => c.to).filter((t) => t >= 6 && t <= max + 1);
  const to = ends.length ? Math.max(...ends) : max;
  return { from: 0, to: round1(Math.min(len, to)) };
}

// The clip the renderer plays for the speaker piece: in/out narrowed to
// from → to, and its captions re-timed (as tapped-in marks) so the words on
// screen still match what is said.
export function trimSpeakerClip(clip, src, range) {
  const len = clipLength(clip);
  if (!clip || !src || !(len > 0)) return null;
  const from = Math.max(0, Math.min(len - 0.5, Number(range && range.from) || 0));
  const to = Math.max(from + 0.5, Math.min(len, Number(range && range.to) || len));
  const cues = captionSchedule(clip, len).filter((c) => c.to > from + 0.15 && c.from < to - 0.15);
  const captions = cues.length
    ? { on: true, text: cues.map((c) => c.text.replace(/\n/g, " ")).join("\n"), marks: cues.map((c) => round2(Math.max(0, c.from - from))) }
    : null;
  const base = Math.max(0, Number(clip.in) || 0);
  return { src, in: base + from, out: base + to, fade: 0.4, captions, segments: null };
}

// Post text for the Reel / Short.
export function reelText({ songTitle = "", talk = {}, site = "conferenceconcert.netlify.app" } = {}) {
  const song = songTitle || talk.title || "Untitled";
  const speaker = talk.speaker || "";
  const conf = talk.conferenceMonthYear ? `${talk.conferenceMonthYear} General Conference` : "General Conference";
  const who = speaker.replace(/^(Elder|President|Sister|Bishop|Brother)\s+/i, "").replace(/[^A-Za-z]/g, "");
  const tags = ["#GeneralConference", "#ConferenceAsAConcert", "#ComeUntoChrist", "#LDSMusic", who && `#${who}`].filter(Boolean);
  const lead = `♪ "${song}" — an original song inspired by${talk.title ? ` "${talk.title}"` : " a General Conference talk"}${speaker ? ` by ${speaker}` : ""} (${conf}).`;
  const full = `Hear the whole song: ${site.replace(/^https?:\/\//, "")}`;
  const shortsTitle = `${song}${speaker ? ` | ${speaker}` : ""} #Shorts`.slice(0, 100);
  const shortsDescription = [lead, "", full, talk.sourceUrl ? `The talk: ${talk.sourceUrl}` : "", "", [...tags, "#Shorts"].join(" ")].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
  const facebookCaption = [lead, "", full, "", "Share it with someone who needs to hear this today. 💛", "", tags.join(" ")].join("\n");
  return { shortsTitle, shortsDescription, facebookCaption };
}

// What the Reel will contain, in order, with lengths (for the summary line).
export function reelOutline({ speakerLen = 0, speakerOrder = "first", songLen = 0, logoSec = 0 }) {
  const parts = [];
  if (speakerLen > 0 && speakerOrder === "first") parts.push({ key: "speaker", sec: speakerLen });
  if (songLen > 0) parts.push({ key: "chorus", sec: songLen });
  if (speakerLen > 0 && speakerOrder === "after") parts.push({ key: "speaker", sec: speakerLen });
  if (logoSec > 0) parts.push({ key: "logo", sec: logoSec });
  const total = parts.reduce((a, p) => a + p.sec, 0) + (parts.length > 1 ? 0.6 : 0);
  return { parts, total: round1(total), fitsFacebook: total <= FB_REEL_MAX, fitsShorts: total <= SHORTS_MAX };
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }
