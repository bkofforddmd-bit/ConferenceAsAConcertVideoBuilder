// netlify/functions/campus-media.js
//
// Video clips recorded in Campus Sessions (student reactions and testimonies),
// stored in a PRIVATE Cloudflare R2 bucket. The phone uploads straight to R2
// through a presigned link; playback and download use short-lived signed
// links. Clip records live on the session document (no participant names).
//
//   status                                   -> { configured }
//   sign-upload { sessionId, stage, mime, bytes } -> { clip, uploadUrl }   (session must be the worker's own, and recorded-consented)
//   confirm     { sessionId, clipId, bytes, durationSec } -> { clip }
//   list        { sessionId }                -> { clips: [{ …, url }] }    (worker: own sessions; admin: any)
//   delete      { sessionId, clipId }        -> { ok }
//
// Stages: "lyrics-reaction" | "song-reaction" | "testimony" | "other".

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, newId, now } from "../lib/campus-store.js";
import { authFrom } from "../lib/campus-auth.js";
import { r2Configured, presign, deleteObject } from "../lib/r2.js";

const STAGES = ["lyrics-reaction", "song-reaction", "testimony", "other"];
const MAX_BYTES = 400 * 1048576; // one clip
const MAX_CLIPS = 12;            // per session

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  const a = await authFrom(req);
  if (a.error) return json({ error: a.error }, a.status);
  const user = a.user;

  if (action === "status") return json({ configured: r2Configured() });
  if (!r2Configured()) return json({ error: "Video storage isn't set up on this site yet (Cloudflare R2 variables)." }, 503);

  const own = async (id) => {
    const s = await docGet(`session:${String(id || "")}`);
    if (!s) return { error: "No such session.", status: 404 };
    if (s.workerId !== user.id && user.role !== "admin") return { error: "That session belongs to another worker.", status: 403 };
    return { s };
  };
  const withUrls = (s) => (s.clips || []).filter((c) => c.status === "ready").map((c) => ({ ...c, url: presign({ method: "GET", key: c.key, expiresSec: 3600 }) }));

  try {
    if (action === "sign-upload") {
      const r = await own(body.sessionId);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      if (s.participation !== "recorded") return json({ error: "Recording wasn't authorized for this session." }, 403);
      const consentRec = await docGet(`consent:${s.id}`);
      if (consentRec && consentRec.withdrawn) return json({ error: "The student withdrew consent for this session, so no more recording." }, 403);
      const stage = STAGES.includes(body.stage) ? body.stage : "other";
      const mime = /^video\/(mp4|webm|quicktime)/.test(String(body.mime || "")) ? String(body.mime).split(";")[0] : "video/mp4";
      const bytes = Number(body.bytes) || 0;
      if (bytes > MAX_BYTES) return json({ error: `That clip is too large (${Math.round(bytes / 1048576)} MB). Keep clips under ${MAX_BYTES / 1048576} MB.` }, 400);
      const clips = s.clips || [];
      if (clips.filter((c) => c.status === "ready").length >= MAX_CLIPS) return json({ error: `This session already has ${MAX_CLIPS} clips.` }, 400);
      const ext = mime.includes("webm") ? "webm" : mime.includes("quicktime") ? "mov" : "mp4";
      const clip = { id: newId("clip_"), stage, mime, ext, key: "", bytes, durationSec: null, status: "uploading", at: now(), by: user.id };
      clip.key = `campus/${s.id}/${clip.id}.${ext}`;
      s.clips = [...clips, clip];
      s.updatedAt = now();
      await docSet(`session:${s.id}`, s);
      return json({ clip, uploadUrl: presign({ method: "PUT", key: clip.key, expiresSec: 1800, contentType: mime }) });
    }

    if (action === "confirm") {
      const r = await own(body.sessionId);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      const clip = (s.clips || []).find((c) => c.id === body.clipId);
      if (!clip) return json({ error: "No such clip." }, 404);
      clip.status = "ready";
      clip.bytes = Number(body.bytes) || clip.bytes;
      clip.durationSec = Number(body.durationSec) > 0 ? Math.round(Number(body.durationSec) * 10) / 10 : clip.durationSec;
      clip.readyAt = now();
      s.updatedAt = now();
      await docSet(`session:${s.id}`, s);
      return json({ clip: { ...clip, url: presign({ method: "GET", key: clip.key, expiresSec: 3600 }) } });
    }

    if (action === "list") {
      const r = await own(body.sessionId);
      if (r.error) return json({ error: r.error }, r.status);
      return json({ clips: withUrls(r.s) });
    }

    if (action === "delete") {
      const r = await own(body.sessionId);
      if (r.error) return json({ error: r.error }, r.status);
      const s = r.s;
      const clip = (s.clips || []).find((c) => c.id === body.clipId);
      if (!clip) return json({ error: "No such clip." }, 404);
      try { await deleteObject(clip.key); } catch (e) { return json({ error: e.message }, 502); }
      s.clips = (s.clips || []).filter((c) => c.id !== clip.id);
      s.updatedAt = now();
      await docSet(`session:${s.id}`, s);
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};
