// netlify/functions/campus-sessions.js
//
// Worker actions for Campus Sessions (Bearer token, role worker or admin).
//   config                         -> { consent: {version,text,reviewed}, settings, user }
//   start   { campus }             -> { session }   (server timestamp; older open sessions of this worker are marked abandoned)
//   get     { id }                 -> { session }
//   update  { id, patch }          -> { session }   (talk, songified, step, lyrics, song, reaction, recordingCaptured, videoRef, notes, participation)
//   consent { id, choice, name, email, adult, signaturePng, acknowledged }
//                                  -> { session }   (stores the consent record with the exact release text + version)
//   complete { id, outcome }       -> { session }   (status completed; duration from server timestamps)
//   abandon  { id, reason }        -> { session }
//   mine    {}                     -> { active, recent, today: { sessions, lyrics, songs } }
//
// Sessions never store the participant's name or email — those live only in
// the consent record (consent:<sessionId>), which workers write but can't
// read back; administrators look it up by session id.

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, docList, newId, now } from "../lib/campus-store.js";
import { authFrom, publicUser } from "../lib/campus-auth.js";
import { currentConsent, currentSettings, summary } from "./campus-admin.js";

const STEPS = ["talk", "consent", "existing", "lyrics", "song", "outcome", "done"];
const PARTICIPATION = ["recorded", "unrecorded", "declined"];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  const a = await authFrom(req);
  if (a.error) return json({ error: a.error }, a.status);
  const user = a.user;

  const own = async (id) => {
    const s = await docGet(`session:${String(id || "")}`);
    if (!s) return { error: "No such session.", status: 404 };
    if (s.workerId !== user.id && user.role !== "admin") return { error: "That session belongs to another worker.", status: 403 };
    return { s };
  };
  const save = async (s) => { s.updatedAt = now(); await docSet(`session:${s.id}`, s); return s; };

  try {
    if (action === "config") {
      const consent = await currentConsent();
      return json({ consent: { version: consent.version, text: consent.text, reviewed: Boolean(consent.reviewed) }, settings: await currentSettings(), user: publicUser(user) });
    }

    if (action === "start") {
      const settings = await currentSettings();
      // Any session this worker left open is abandoned by starting a new one.
      const open = (await docList("session:")).filter((s) => s.workerId === user.id && s.status === "active");
      for (const s of open) { s.status = "abandoned"; s.endedAt = now(); s.abandonReason = "A new session was started."; s.durationSec = secs(s.startedAt, s.endedAt); await save(s); }
      const s = {
        id: newId("cs_"), workerId: user.id, campus: String(body.campus || settings.defaultCampus).trim() || settings.defaultCampus,
        startedAt: now(), endedAt: null, durationSec: null, status: "active", step: "talk",
        talk: null, songified: null, participation: null, consentVersion: null,
        lyrics: { generated: false, regenerated: 0, accepted: false, edited: false }, song: { opened: false, generated: false, played: false },
        reaction: null, recordingCaptured: null, videoRef: "", notes: "",
      };
      return json({ session: await save(s) });
    }

    if (action === "get") {
      const r = await own(body.id);
      if (r.error) return json({ error: r.error }, r.status);
      return json({ session: r.s });
    }

    if (action === "update") {
      const r = await own(body.id);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      if (s.status !== "active") return json({ error: "This session is already closed." }, 400);
      const p = body.patch || {};
      if (p.talk) s.talk = { uri: String(p.talk.uri || ""), title: String(p.talk.title || ""), speaker: String(p.talk.speaker || ""), session: String(p.talk.session || ""), year: String(p.talk.year || ""), month: String(p.talk.month || ""), sourceUrl: String(p.talk.sourceUrl || "") };
      if (p.songified) s.songified = { existing: Boolean(p.songified.existing), libraryId: p.songified.libraryId || null, libraryTitle: p.songified.libraryTitle || null, audioUrl: p.songified.audioUrl || null, newInterpretation: Boolean(p.songified.newInterpretation), playedExisting: Boolean(p.songified.playedExisting) };
      if (p.step && STEPS.includes(p.step)) s.step = p.step;
      if (p.lyrics) s.lyrics = { ...s.lyrics, ...pick(p.lyrics, ["generated", "regenerated", "accepted", "edited", "mood", "genre", "message", "title", "text", "reference", "melodyCraft"]) };
      if (s.lyrics && typeof s.lyrics.text === "string") s.lyrics.text = s.lyrics.text.slice(0, 20000);
      if (p.song) s.song = { ...s.song, ...pick(p.song, ["opened", "generated", "played"]) };
      if (p.reaction !== undefined) s.reaction = ["positive", "neutral", "negative", "not_captured"].includes(p.reaction) ? p.reaction : null;
      if (p.recordingCaptured !== undefined) s.recordingCaptured = p.recordingCaptured === null ? null : Boolean(p.recordingCaptured);
      if (p.videoRef !== undefined) {
        s.videoRef = String(p.videoRef || "").slice(0, 200);
        const c = await docGet(`consent:${s.id}`);
        if (c) await docSet(`consent:${s.id}`, { ...c, videoRef: s.videoRef });
      }
      if (p.notes !== undefined) s.notes = String(p.notes || "").slice(0, 2000);
      return json({ session: await save(s) });
    }

    if (action === "consent") {
      const r = await own(body.id);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      if (s.status !== "active") return json({ error: "This session is already closed." }, 400);
      const choice = String(body.choice || "");
      if (!PARTICIPATION.includes(choice)) return json({ error: "Pick one of the three consent options." }, 400);
      const adult = Boolean(body.adult);
      if (choice === "recorded" && !adult) return json({ error: "Recording needs an adult participant. Choose 'participate without being recorded' instead." }, 400);
      if (choice === "recorded" && !(typeof body.signaturePng === "string" && body.signaturePng.startsWith("data:image/png") && body.signaturePng.length > 500)) return json({ error: "Please sign in the box to authorize recording." }, 400);
      if (choice !== "declined" && !body.acknowledged && !body.signaturePng) return json({ error: "Please confirm you've read the release." }, 400);
      const rel = await currentConsent();
      const consent = {
        sessionId: s.id, workerId: user.id, choice, adult, name: String(body.name || "").trim().slice(0, 120), email: String(body.email || "").trim().slice(0, 160),
        signaturePng: choice === "declined" ? "" : String(body.signaturePng || ""), acknowledged: Boolean(body.acknowledged) || Boolean(body.signaturePng),
        acceptedAt: now(), textVersion: rel.version, textReviewed: Boolean(rel.reviewed), text: rel.text, videoRef: s.videoRef || "", withdrawn: null,
      };
      await docSet(`consent:${s.id}`, consent);
      s.participation = choice;
      s.consentVersion = rel.version;
      if (choice === "declined") { s.step = "outcome"; }
      else s.step = s.songified && s.songified.existing && !s.songified.newInterpretation ? "existing" : "lyrics";
      return json({ session: await save(s) });
    }

    if (action === "complete") {
      const r = await own(body.id);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      if (s.status !== "active") return json({ error: "This session is already closed." }, 400);
      const o = body.outcome || {};
      if (o.lyrics) s.lyrics = { ...s.lyrics, ...pick(o.lyrics, ["generated", "accepted", "regenerated", "edited"]) };
      if (o.song) s.song = { ...s.song, ...pick(o.song, ["opened", "generated", "played"]) };
      if (o.reaction !== undefined) s.reaction = ["positive", "neutral", "negative", "not_captured"].includes(o.reaction) ? o.reaction : "not_captured";
      if (o.recordingCaptured !== undefined) s.recordingCaptured = Boolean(o.recordingCaptured);
      if (s.participation !== "recorded") s.recordingCaptured = false;
      if (o.videoRef !== undefined) { s.videoRef = String(o.videoRef || "").slice(0, 200); const c = await docGet(`consent:${s.id}`); if (c) await docSet(`consent:${s.id}`, { ...c, videoRef: s.videoRef }); }
      if (o.notes !== undefined) s.notes = String(o.notes || "").slice(0, 2000);
      if (!s.participation) s.participation = "declined";
      s.status = "completed"; s.step = "done"; s.endedAt = now(); s.durationSec = secs(s.startedAt, s.endedAt);
      return json({ session: await save(s) });
    }

    if (action === "abandon") {
      const r = await own(body.id);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      if (s.status !== "active") return json({ session: s });
      s.status = "abandoned"; s.endedAt = now(); s.durationSec = secs(s.startedAt, s.endedAt); s.abandonReason = String(body.reason || "").slice(0, 300);
      return json({ session: await save(s) });
    }

    if (action === "mine") {
      const settings = await currentSettings();
      const mine = (await docList("session:")).filter((s) => s.workerId === user.id);
      // Time out sessions that were left open for too long.
      const cutoff = Date.now() - settings.abandonAfterMinutes * 60000;
      for (const s of mine) if (s.status === "active" && Date.parse(s.updatedAt || s.startedAt) < cutoff) { s.status = "abandoned"; s.endedAt = now(); s.abandonReason = "Left open too long."; s.durationSec = secs(s.startedAt, s.endedAt); await save(s); }
      const active = mine.find((s) => s.status === "active") || null;
      const today = new Date().toISOString().slice(0, 10);
      const todays = mine.filter((s) => String(s.startedAt).slice(0, 10) === today);
      return json({
        active,
        recent: mine.filter((s) => s.status !== "active").sort((x, y) => String(y.startedAt).localeCompare(String(x.startedAt))).slice(0, 20).map(summary),
        today: { sessions: todays.filter((s) => s.status === "completed").length, approached: todays.length, lyrics: todays.filter((s) => s.lyrics && s.lyrics.generated).length, songs: todays.filter((s) => s.song && s.song.generated).length },
      });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};

function pick(obj, keys) { const o = {}; for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k]; return o; }
function secs(a, b) { const d = (Date.parse(b) - Date.parse(a)) / 1000; return Number.isFinite(d) && d >= 0 ? Math.round(d) : null; }
