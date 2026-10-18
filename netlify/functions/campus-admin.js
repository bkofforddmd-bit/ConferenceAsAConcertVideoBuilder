// netlify/functions/campus-admin.js
//
// Administrator actions for Campus Sessions (Bearer token with role "admin").
//   workers            -> { workers, invites }
//   invite             { email, name, role }           -> { invite, link }
//   revoke-invite      { code }
//   set-active         { userId, active }
//   set-role           { userId, role }
//   consent-text       -> current version (also readable by workers via campus-sessions "config")
//   set-consent-text   { text, reviewed }              -> new version
//   set-consent-reviewed { reviewed }
//   settings / set-settings { melodyCraftUrl, defaultCampus }
//   consent-lookup     { sessionId }                   -> consent record + session summary
//   consent-withdraw   { sessionId, note }
//   sessions           { from, to }                    -> session summaries (no participant details)
//   (consent-lookup and consent-withdraw accept a session id OR its reference code, e.g. "K7Q-4MX")
//   followups                                          -> opted-in follow-up contacts (admin-only; the only place emails are listed)
//   followup-update    { sessionId, status, purpose }  -> status "sent" (logs the send) | "waiting" | "opted-out" (erases the email now)
//   followup-delete    { sessionId }                   -> erases the contact details
//   share-toggle       { sessionId, disabled }         -> switch a student's song page off/on
//
// Consent records hold participant names/emails/signatures and are only ever
// returned by consent-lookup, by session id, to an administrator.

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, docList, newId, now } from "../lib/campus-store.js";
import { authFrom, normEmail, publicUser, listUsers } from "../lib/campus-auth.js";
import { CONSENT_TEXT, CONSENT_VERSION } from "../lib/campus-consent-default.js";
import { r2Configured, presign } from "../lib/r2.js";
import { normRef, resolveSong } from "../lib/campus-share.js";

// A session id ("cs_…") or a reference code ("K7Q-4MX") → the session id.
async function resolveSid(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("cs_")) return raw;
  const want = normRef(raw);
  if (want.length !== 6) return raw;
  const hit = (await docList("session:")).find((s) => normRef(s.ref) === want);
  return hit ? hit.id : raw;
}

export async function currentConsent() {
  const cur = await docGet("settings:consent");
  if (cur && cur.text) return cur;
  return { version: CONSENT_VERSION, text: CONSENT_TEXT, reviewed: false, updatedAt: null, updatedBy: null, isDefault: true };
}
export async function currentSettings() {
  const s = (await docGet("settings:general")) || {};
  return { melodyCraftUrl: s.melodyCraftUrl || "https://melodycraft.app", defaultCampus: s.defaultCampus || "BYU Provo", abandonAfterMinutes: s.abandonAfterMinutes || 120 };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  const a = await authFrom(req, ["admin"]);
  if (a.error) return json({ error: a.error }, a.status);
  const admin = a.user;
  try {
    if (action === "workers") {
      const invites = (await docList("invite:")).filter((i) => !i.usedAt).map((i) => ({ code: i.code, email: i.email, name: i.name, role: i.role, createdAt: i.createdAt }));
      return json({ workers: await listUsers(), invites });
    }

    if (action === "invite") {
      const email = normEmail(body.email);
      if (!email.includes("@")) return json({ error: "Enter the worker's email." }, 400);
      const role = body.role === "admin" ? "admin" : "worker";
      const code = newId("inv_");
      const invite = { code, email, name: String(body.name || "").trim(), role, createdAt: now(), createdBy: admin.id };
      await docSet(`invite:${code}`, invite);
      const origin = (req.headers.get("origin") || new URL(req.url).origin).replace(/\/$/, "");
      return json({ invite, link: `${origin}/campus?invite=${code}` });
    }

    if (action === "revoke-invite") {
      const inv = await docGet(`invite:${String(body.code || "")}`);
      if (inv && !inv.usedAt) await docSet(`invite:${inv.code}`, { ...inv, usedAt: now(), revoked: true });
      return json({ ok: true });
    }

    if (action === "set-active" || action === "set-role") {
      const u = await docGet(`user:${String(body.userId || "")}`);
      if (!u) return json({ error: "No such account." }, 404);
      if (u.id === admin.id) return json({ error: "You can't change your own account here." }, 400);
      const next = action === "set-active" ? { ...u, active: Boolean(body.active) } : { ...u, role: body.role === "admin" ? "admin" : "worker" };
      await docSet(`user:${u.id}`, next);
      return json({ user: publicUser(next) });
    }

    if (action === "consent-text") return json(await currentConsent());

    if (action === "set-consent-text") {
      const text = String(body.text || "").trim();
      if (text.length < 200) return json({ error: "The release text looks too short." }, 400);
      const cur = await currentConsent();
      const rec = { version: (cur.version || 0) + 1, text, reviewed: Boolean(body.reviewed), updatedAt: now(), updatedBy: admin.id };
      await docSet("settings:consent", rec);
      await docSet(`consent-version:${rec.version}`, rec);
      return json(rec);
    }

    if (action === "set-consent-reviewed") {
      const cur = await currentConsent();
      const rec = { ...cur, isDefault: undefined, reviewed: Boolean(body.reviewed), reviewedAt: body.reviewed ? now() : null, reviewedBy: body.reviewed ? admin.id : null };
      await docSet("settings:consent", rec);
      return json(rec);
    }

    if (action === "settings") return json(await currentSettings());

    if (action === "set-settings") {
      const cur = await currentSettings();
      const url = String(body.melodyCraftUrl || cur.melodyCraftUrl).trim();
      if (!/^https?:\/\//i.test(url)) return json({ error: "The MelodyCraft address must start with https://" }, 400);
      const next = { ...cur, melodyCraftUrl: url, defaultCampus: String(body.defaultCampus || cur.defaultCampus).trim() || "BYU Provo", abandonAfterMinutes: Number(body.abandonAfterMinutes) > 0 ? Number(body.abandonAfterMinutes) : cur.abandonAfterMinutes, updatedAt: now(), updatedBy: admin.id };
      await docSet("settings:general", next);
      return json(next);
    }

    if (action === "consent-lookup") {
      const sid = await resolveSid(body.sessionId);
      const consent = await docGet(`consent:${sid}`);
      const session = await docGet(`session:${sid}`);
      if (!consent && !session) return json({ error: "No session with that id." }, 404);
      let clips = [];
      try { if (session && r2Configured()) clips = (session.clips || []).filter((c) => c.status === "ready").map((c) => ({ id: c.id, stage: c.stage, durationSec: c.durationSec, bytes: c.bytes, at: c.at, url: presign({ method: "GET", key: c.key, expiresSec: 3600 }) })); } catch {}
      const followup = await docGet(`followup:${sid}`);
      const shareIdx = session && session.share ? await docGet(`share:${session.share.code}`) : null;
      const pageFb = await docGet(`sharefb:${sid}`);
      return json({
        sessionId: sid, consent, session: session && summary(session), clips,
        recordings: (session && session.recordings) || [],
        feedback: (session && session.feedback) || null,
        followup,
        share: session && session.share ? { code: session.share.code, disabled: Boolean(session.share.disabled), views: (shareIdx && shareIdx.views) || 0, ratings: (pageFb && pageFb.items) || [] } : null,
        songLink: (session && session.songLink) || null,
        songFile: session && session.songFile ? { status: session.songFile.status, bytes: session.songFile.bytes, at: session.songFile.at } : null,
      });
    }

    if (action === "followups") {
      const list = await docList("followup:");
      const out = [];
      for (const f of list) {
        const s = await docGet(`session:${f.sessionId}`);
        let song = null;
        try { song = s ? await resolveSong(s, { signedSongUrl: s.songFile ? () => "uploaded" : null }) : null; } catch {}
        out.push({
          ...f, ref: s && s.ref, talk: s && s.talk ? s.talk.title : "", songTitle: s && s.lyrics ? s.lyrics.title || "" : "",
          shareCode: s && s.share && !s.share.disabled ? s.share.code : null, songReady: Boolean(song), songFrom: song ? (song.fromLibrary ? "library" : song.kind === "link" ? "link" : "upload") : null,
        });
      }
      out.sort((a, b) => (a.status === "waiting" ? 0 : 1) - (b.status === "waiting" ? 0 : 1) || String(b.at).localeCompare(String(a.at)));
      return json({ followups: out });
    }

    if (action === "followup-update" || action === "followup-delete") {
      const sid = await resolveSid(body.sessionId);
      const f = await docGet(`followup:${sid}`);
      if (!f) return json({ error: "No follow-up for that session." }, 404);
      const erase = (why) => { f.email = ""; f.firstName = ""; f.erasedAt = now(); f.history = [...(f.history || []), { at: now(), by: admin.id, what: why }]; };
      if (action === "followup-delete") { erase("contact details erased by an administrator"); f.status = "deleted"; }
      else {
        const st = String(body.status || "");
        if (!["sent", "waiting", "opted-out"].includes(st)) return json({ error: "Unknown status." }, 400);
        if (st === "sent") {
          if (!f.email) return json({ error: "This contact's email has already been erased." }, 400);
          f.sent = [...(f.sent || []), { at: now(), by: admin.id, purpose: ["song", "video"].includes(body.purpose) ? body.purpose : "song" }];
          f.sentAt = now();
          f.history = [...(f.history || []), { at: now(), by: admin.id, what: `email sent (${body.purpose || "song"})` }];
          // Both promised emails sent (or only one was asked for) → done.
          f.status = f.sent.length >= (f.purposes || ["song"]).length ? "sent" : "waiting";
        } else if (st === "opted-out") { erase("student opted out"); f.status = "opted-out"; }
        else { f.status = "waiting"; f.history = [...(f.history || []), { at: now(), by: admin.id, what: "reopened" }]; }
      }
      await docSet(`followup:${sid}`, f);
      return json({ followup: f });
    }

    if (action === "share-toggle") {
      const sid = await resolveSid(body.sessionId);
      const s = await docGet(`session:${sid}`);
      if (!s || !s.share) return json({ error: "That session has no song page." }, 404);
      s.share = { ...s.share, disabled: Boolean(body.disabled) };
      s.updatedAt = now();
      await docSet(`session:${sid}`, s);
      return json({ share: s.share });
    }

    if (action === "consent-withdraw") {
      const sid = await resolveSid(body.sessionId);
      const consent = await docGet(`consent:${sid}`);
      if (!consent) return json({ error: "No consent record for that session." }, 404);
      const next = { ...consent, withdrawn: { at: now(), by: admin.id, note: String(body.note || "").slice(0, 500) } };
      await docSet(`consent:${sid}`, next);
      return json({ consent: next });
    }

    if (action === "sessions") {
      const from = body.from ? String(body.from) : "";
      const to = body.to ? String(body.to) : "";
      const all = (await docList("session:")).filter((s) => (!from || s.startedAt >= from) && (!to || s.startedAt <= to + "T23:59:59.999Z"));
      return json({ sessions: all.map(summary).sort((x, y) => String(y.startedAt).localeCompare(String(x.startedAt))) });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};

// A session without anything that identifies the participant.
export function summary(s) {
  return {
    id: s.id, workerId: s.workerId, campus: s.campus, startedAt: s.startedAt, endedAt: s.endedAt || null, durationSec: s.durationSec || null,
    status: s.status, step: s.step, talk: s.talk ? { uri: s.talk.uri, title: s.talk.title, speaker: s.talk.speaker, session: s.talk.session } : null,
    songified: s.songified ? { existing: Boolean(s.songified.existing), libraryId: s.songified.libraryId || null, newInterpretation: Boolean(s.songified.newInterpretation) } : null,
    participation: s.participation || null, consentVersion: s.consentVersion || null, lyrics: s.lyrics ? { ...s.lyrics, text: undefined, hasText: Boolean(s.lyrics.text) } : null, song: s.song || null,
    reaction: s.reaction || null, recordingCaptured: s.recordingCaptured ?? null, hasVideoRef: Boolean(s.videoRef), notes: s.notes || "",
    clipCount: (s.clips || []).filter((c) => c.status === "ready").length,
    ref: s.ref || null, shareCode: s.share && !s.share.disabled ? s.share.code : null,
    feedback: s.feedback ? { rating: s.feedback.rating, helped: s.feedback.helped, more: s.feedback.more, share: s.feedback.share, hasComment: Boolean(s.feedback.comment) } : null,
    followUp: Boolean(s.followUp && s.followUp.optedIn), recordingCount: (s.recordings || []).length,
    songReady: Boolean(s.songLink || (s.songFile && s.songFile.status === "ready") || (s.songified && s.songified.existing && !s.songified.newInterpretation)),
  };
}
