// netlify/functions/campus-analytics.js
//
// Phase 3 — administrator analytics and retention (administrators only).
//   overview  { from?, to?, workerId? }  -> totals, funnel, reactions, talks,
//                                           unsongified, byWorker, byDate, rows
//             (dates are local campus dates "YYYY-MM-DD"; no participant details)
//   retention                            -> { policy, candidates, storage, log }
//   set-retention { clipRetentionDays, purgeWithdrawn, autoPurge } -> { policy }
//   purge     { clipIds? }               -> { log, failed }  (deletes video files from R2)

import { json, readJson } from "../lib/keys.js";
import { docList, docSet, now } from "../lib/campus-store.js";
import { authFrom, listUsers } from "../lib/campus-auth.js";
import { analyze } from "../lib/campus-analytics.js";
import { getPolicy, validatePolicy, preview, runPurge, purgeLog } from "../lib/campus-retention.js";
import { r2Configured, deleteObject } from "../lib/r2.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  const a = await authFrom(req, ["admin"]);
  if (a.error) return json({ error: a.error }, a.status);
  const admin = a.user;

  try {
    if (action === "overview") {
      const from = DATE.test(String(body.from || "")) ? String(body.from) : "";
      const to = DATE.test(String(body.to || "")) ? String(body.to) : "";
      if (from && to && from > to) return json({ error: "The start date is after the end date." }, 400);
      const [sessions, users, shifts, shares, pagefb, fus] = await Promise.all([docList("session:"), listUsers(), docList("shift:"), docList("share:"), docList("sharefb:"), docList("followup:")]);
      const views = Object.fromEntries(shares.map((x) => [x.sessionId, x.views || 0]));
      const pageFeedback = Object.fromEntries(pagefb.map((x) => [x.sessionId, x.items || []]));
      const followups = Object.fromEntries(fus.map((x) => [x.sessionId, x.status])); // statuses only
      const result = analyze(sessions, { from, to, workerId: String(body.workerId || ""), users, shifts, views, pageFeedback, followups });
      return json({ ...result, workers: users.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })), generatedAt: now() });
    }

    if (action === "retention") {
      const p = await preview();
      return json({ ...p, storageConfigured: r2Configured(), log: await purgeLog(15) });
    }

    if (action === "set-retention") {
      const cur = await getPolicy();
      let next;
      try { next = validatePolicy(body, cur); } catch (e) { return json({ error: e.message }, 400); }
      await docSet("settings:retention", { ...next, updatedAt: now(), updatedBy: admin.id });
      return json({ policy: await getPolicy() });
    }

    if (action === "purge") {
      // Video files need R2; follow-up emails are erased either way.
      const only = Array.isArray(body.clipIds) && body.clipIds.length ? body.clipIds.map(String) : null;
      const r = await runPurge({ by: admin.id, trigger: "manual", deleter: r2Configured() ? deleteObject : null, only });
      return json(r);
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};
