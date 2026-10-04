// netlify/functions/concert-assemble-background.js
//
// Background function (15-minute limit): joins the song pieces stored by
// concert-chunk.js and uploads the whole file to the Conference Concert
// storage via the presigned link from the Concert app's "sign" step. The
// browser polls art-status.js for the job record.
//
// Body: { jobId, uploadId, count, to, contentType }

import { json, readJson } from "../lib/keys.js";
import { jobSet, blobGetBytes, blobDelete, validJobId } from "../lib/jobs.js";

export const config = { background: true };

const ALLOWED = [
  /^https:\/\/[a-z0-9.-]+\.r2\.cloudflarestorage\.com\//i,
  /^https:\/\/[a-z0-9.-]+\.r2\.dev\//i,
  /^https:\/\/[a-z0-9.-]+\.cloudflarestorage\.com\//i,
];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || !validJobId(body.jobId)) return json({ error: "Provide a jobId." }, 400);
  const { jobId, uploadId = "", count = 0, to = "", contentType = "audio/mpeg" } = body;
  const fail = async (error, detail) => { await jobSet(jobId, { status: "failed", error, detail }); return json({ ok: false }, 202); };

  if (!validJobId(uploadId) || !Number.isInteger(count) || count < 1 || count > 400) return fail("Bad upload description.");
  if (!ALLOWED.some((re) => re.test(to))) return fail("That upload address isn't allowed.");

  await jobSet(jobId, { status: "running", startedAt: Date.now() });
  try {
    const parts = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
      const buf = await blobGetBytes(`chunk:${uploadId}:${n}`);
      if (!buf || !buf.byteLength) return fail(`Piece ${n + 1} of ${count} is missing — try publishing again.`);
      parts.push(new Uint8Array(buf));
      total += buf.byteLength;
    }
    const whole = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { whole.set(p, off); off += p.byteLength; }

    const up = await fetch(to, { method: "PUT", headers: { "content-type": contentType }, body: whole });
    if (!up.ok) {
      const detail = await up.text().catch(() => "");
      return fail(`The Concert storage refused the upload (${up.status})`, detail.slice(0, 300));
    }
    for (let n = 0; n < count; n++) blobDelete(`chunk:${uploadId}:${n}`).catch(() => {});
    await jobSet(jobId, { status: "done", bytes: total });
    return json({ ok: true }, 202);
  } catch (err) {
    return fail("Upload failed", String(err).slice(0, 300));
  }
};
