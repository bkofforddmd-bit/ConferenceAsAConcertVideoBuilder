// src/campus/questions.js — the interview questions a worker asks on camera.
// Shared by the campus phone (question picker), the server (default bank in
// the administrator's settings) and the Studio (the question card shown before
// each answer in the Q&A intro). Plain JS so Netlify functions can import it.

export const DEFAULT_QUESTIONS = [
  "What was your favorite talk from General Conference, and why?",
  "What part of the talk stood out to you most?",
  "How did it feel to read lyrics written from your favorite talk?",
  "What did you think of hearing your favorite conference message turned into music?",
  "How has this message made a difference in your life?",
  "What would you say to a friend who hasn't heard this talk?",
];

// Where each recording moment starts by default (the worker can pick any).
export const STAGE_DEFAULT = {
  "favorite-talk": DEFAULT_QUESTIONS[0],
  "lyrics-reaction": DEFAULT_QUESTIONS[2],
  "song-reaction": DEFAULT_QUESTIONS[3],
  testimony: DEFAULT_QUESTIONS[4],
};

export const STAGE_LABEL = {
  "favorite-talk": "Why it's their favorite talk",
  "lyrics-reaction": "Reaction to the lyrics",
  "song-reaction": "Reaction to the song",
  testimony: "Closing testimony / interview",
  other: "Clip",
};

// Clean an administrator's list: one question per entry, trimmed, unique, ≤ 30.
export function cleanQuestions(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/\r?\n/);
  const out = [];
  for (const q of list) {
    const t = String(q || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 30);
}

export function defaultQuestionFor(stage, bank) {
  const list = bank && bank.length ? bank : DEFAULT_QUESTIONS;
  const d = STAGE_DEFAULT[stage];
  return d && list.includes(d) ? d : list[0] || "";
}
