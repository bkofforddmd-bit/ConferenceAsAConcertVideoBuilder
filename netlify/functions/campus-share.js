// netlify/functions/campus-share.js
//
// PUBLIC (no sign-in): the student's song page at /song/<code>, reached from
// the QR code on the thank-you screen.
//   get      { code }                   -> { page }   song title, talk, lyrics, the song to play
//   feedback { code, rating, comment }  -> { ok }     "How do you like your song?" from the page
//
// Never returns anything about the student or the worker: no names, emails,
// signatures, clips, session ids or notes. The page switches off when consent
// is withdrawn or an administrator disables it. Views and page ratings live in
// their own records (share:<code>, sharefb:<sessionId>) so a visit can never
// overwrite a worker's edit to the session.

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, now } from "../lib/campus-store.js";
import { resolveSong } from "../lib/campus-share.js";
import { r2Configured, presign } from "../lib/r2.js";

const CODE = /^[a-z2-9]{10}$/;
const GONE = { error: "This song page isn't available." };

async function load(code) {
  if (!CODE.test(String(code || ""))) return null;
  const idx = await docGet(`share:${code}`);
  if (!idx) return null;
  const s = await docGet(`session:${idx.sessionId}`);
  if (!s || !s.share || s.share.code !== code || s.share.disabled) return null;
  if (!s.participation || s.participation === "declined") return null;
  const consent = await docGet(`consent:${s.id}`);
  if (consent && consent.withdrawn) return null;
  return { s, idx };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  try {
    const hit = await load(body.code);
    if (!hit) return json(GONE, 404);
    const { s, idx } = hit;

    if (action === "get") {
      const song = await resolveSong(s, { signedSongUrl: r2Configured() ? (key) => presign({ method: "GET", key, expiresSec: 6 * 3600 }) : null });
      // count the visit (best effort)
      try { await docSet(`share:${body.code}`, { ...idx, views: (idx.views || 0) + 1, lastViewAt: now() }); } catch {}
      const talk = s.talk ? { title: s.talk.title, speaker: s.talk.speaker, url: s.talk.sourceUrl || (s.talk.uri ? `https://www.churchofjesuschrist.org${s.talk.uri}?lang=eng` : "") } : null;
      const lyrics = s.lyrics && s.lyrics.generated && s.lyrics.text ? s.lyrics.text : "";
      return json({
        page: {
          title: (s.lyrics && s.lyrics.title) || (song && song.title) || (talk && talk.title) || "Your song",
          talk, lyrics, song,
          madeOn: String(s.startedAt || "").slice(0, 10),
          campus: s.campus || "",
          songPending: !song,
        },
      });
    }

    if (action === "feedback") {
      const rating = Number(body.rating);
      if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return json({ error: "Pick 1 to 5 stars." }, 400);
      const key = `sharefb:${s.id}`;
      const cur = (await docGet(key)) || { sessionId: s.id, items: [] };
      if (cur.items.length >= 30) return json({ ok: true, capped: true });
      cur.items.push({ rating, comment: String(body.comment || "").trim().slice(0, 500), at: now() });
      await docSet(key, cur);
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};
