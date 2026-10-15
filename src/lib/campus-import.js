// src/lib/campus-import.js
//
// Turns a Campus Sessions interaction into a Studio project: the talk, its
// text, and the lyrics the student helped write, ready for the Music step
// (upload the MelodyCraft MP3, sync the lyrics, then storyboard, video,
// publish). Opened through /?campus=<sessionId>; needs a Campus Sessions
// sign-in in this browser, since session data is read with that token.

import { sessionApi, fetchTalk, getToken } from "../campus/campus-api.js";

export const APP_ID = "conference-music-video-studio";

export function campusSessionIdFromUrl() {
  try { return new URLSearchParams(window.location.search).get("campus") || ""; } catch { return ""; }
}

export async function campusSessionToProject(sessionId, { projectId, version = 3 } = {}) {
  if (!getToken()) throw new Error("Sign in to Campus Sessions in this browser first (open /campus), then try the link again.");
  const { session: s } = await sessionApi.get(sessionId);
  if (!s.talk || !s.talk.uri) throw new Error("That session never got as far as choosing a talk.");
  const lyrics = (s.lyrics && s.lyrics.text) || "";
  if (!lyrics.trim()) throw new Error("That session has no lyrics saved — only sessions that wrote lyrics can open in the Studio.");
  const talk = await fetchTalk(s.talk.uri);
  const monthName = s.talk.month === "10" ? "October" : "April";
  const title = (s.lyrics && s.lyrics.title) || "";
  return {
    app: APP_ID,
    version,
    savedAt: new Date().toISOString(),
    projectId: projectId || `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    campusSessionId: s.id,
    talkText: talk.text,
    talkMeta: {
      title: talk.title || s.talk.title || "",
      speaker: talk.speaker || s.talk.speaker || "",
      speakerTitle: talk.speakerTitle || "",
      conferenceMonthYear: s.talk.year ? `${monthName} ${s.talk.year}` : "",
      session: s.talk.session || "",
      sourceUrl: talk.sourceUrl || s.talk.sourceUrl || "",
    },
    lyrics,
    finalLyrics: lyrics,
    styleReference: [s.lyrics && s.lyrics.genre, s.lyrics && s.lyrics.mood].filter(Boolean).join(", "),
    lyricSources: null,
    scene: { styleBible: null, scenes: [], images: {}, saved: {}, meta: title ? { songTitle: title, speaker: talk.speaker || s.talk.speaker || "" } : {}, endcards: {} },
    song: { versions: [], activeId: null },
    clips: {},
    timeline: { starts: {}, introSec: 4, outroSec: 6, lyricsOverlay: true },
    render: null,
  };
}

// A .json file of the same project, for opening on another computer with
// the Studio's "Open .json" button (no Campus sign-in needed there).
export async function downloadCampusProject(sessionId) {
  const project = await campusSessionToProject(sessionId);
  const safe = (project.scene.meta.songTitle || project.talkMeta.title || "campus-session").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.studio.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return project;
}
