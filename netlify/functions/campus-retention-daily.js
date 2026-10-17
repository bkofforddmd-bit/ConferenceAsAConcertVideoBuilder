// netlify/functions/campus-retention-daily.js
//
// Scheduled once a day by Netlify. Does nothing unless an administrator has
// turned on "Delete automatically every day" in Admin → Retention. When on,
// it deletes the video clips the retention policy says to delete (too old, or
// consent withdrawn) and writes a purge log entry. Never touches consent or
// session records.

import { getPolicy, runPurge } from "../lib/campus-retention.js";
import { r2Configured, deleteObject } from "../lib/r2.js";

export default async () => {
  try {
    const policy = await getPolicy();
    if (!policy.autoPurge) return new Response("auto-purge is off", { status: 200 });
    if (!r2Configured()) return new Response("no video storage configured", { status: 200 });
    const { log, failed } = await runPurge({ by: null, trigger: "daily", deleter: deleteObject });
    return new Response(`deleted ${log.deleted}, failed ${failed.length}`, { status: 200 });
  } catch (e) {
    return new Response(`retention run failed: ${e.message || e}`, { status: 500 });
  }
};

export const config = { schedule: "@daily" };
