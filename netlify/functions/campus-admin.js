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
//
// Consent records hold participant names/emails/signatures and are only ever
// returned by consent-lookup, by session id, to an administrator.

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, docList, newId, now } from "../lib/campus-store.js";
import { authFrom, normEmail, publicUser, listUsers } from "../lib/campus-auth.js";
import { CONSENT_TEXT, CONSENT_VERSION } from "../lib/campus-consent-default.js";

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
      const sid = String(body.sessionId || "").trim();
      const consent = await docGet(`consent:${sid}`);
      const session = await docGet(`session:${sid}`);
      if (!consent && !session) return json({ error: "No session with that id." }, 404);
      return json({ consent, session: session && summary(session) });
    }

    if (action === "consent-withdraw") {
      const sid = String(body.sessionId || "").trim();
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
    participation: s.participation || null, consentVersion: s.consentVersion || null, lyrics: s.lyrics || null, song: s.song || null,
    reaction: s.reaction || null, recordingCaptured: s.recordingCaptured ?? null, hasVideoRef: Boolean(s.videoRef), notes: s.notes || "",
  };
}
