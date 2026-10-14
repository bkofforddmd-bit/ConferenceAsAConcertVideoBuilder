// netlify/functions/concert-assemble-background.js
//
// Background function (15-minute limit): joins the media pieces stored by
// concert-chunk.js and uploads the whole file to the Conference Concert
// storage via the presigned link from the Concert app's "sign" step. The
// browser polls art-status.js for the job record.
//
// Body: { jobId, uploadId, count, size, to, contentType }
//   size = the file's total bytes (the browser knows it), so the file is
//   joined into ONE buffer as the pieces stream in. An earlier version kept
//   every piece AND the joined copy in memory at once — fine for a 5 MB song,
//   but a 1080p music video (200–360 MB) doubled past the function's memory
//   and the job died without ever writing a status, so the browser waited the
//   full 14 minutes and reported "Timed out delivering the video".
//
// Progress is written to the job record as pieces are joined and while the
// upload runs, so the browser can show it (and can tell a stall from a slow
// upload).

import { json, readJson } from "../lib/keys.js";
import { jobSet, blobGetBytes, blobDelete, validJobId } from "../lib/jobs.js";

export const config = { background: true };

const ALLOWED = [
  /^https:\/\/[a-z0-9.-]+\.r2\.cloudflarestorage\.com\//i,
  /^https:\/\/[a-z0-9.-]+\.r2\.dev\//i,
  /^https:\/\/[a-z0-9.-]+\.cloudflarestorage\.com\//i,
];

// Above this the joined buffer plus the upload's own copy no longer fit in a
// function's memory. Direct browser→storage uploads (the storage's CORS
// policy listing this site) have no such limit.
const MAX_BYTES = 600 * 1048576;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body || !validJobId(body.jobId)) return json({ error: "Provide a jobId." }, 400);
  const { jobId, uploadId = "", count = 0, size = 0, to = "", contentType = "audio/mpeg" } = body;

  const cleanup = () => { for (let n = 0; n < count; n++) blobDelete(`chunk:${uploadId}:${n}`).catch(() => {}); };
  const fail = async (error, detail) => { cleanup(); await jobSet(jobId, { status: "failed", error, detail }); return json({ ok: false }, 202); };
  const progress = (phase, pieces, bytes) => jobSet(jobId, { status: "running", phase, pieces, count, bytes });

  if (!validJobId(uploadId) || !Number.isInteger(count) || count < 1 || count > 400) return fail("Bad upload description.");
  if (!ALLOWED.some((re) => re.test(to))) return fail("That upload address isn't allowed.");
  if (size && size > MAX_BYTES) {
    return fail(`This file (${(size / 1048576).toFixed(0)} MB) is too big for the pieces route (limit ${MAX_BYTES / 1048576} MB).`,
      "Add the Studio's address to the Concert storage's CORS policy so uploads go straight from the browser to storage — no size limit that way.");
  }

  await progress("joining", 0, 0);
  try {
    // One buffer for the whole file. If the browser didn't say the size (an
    // older page), fall back to collecting pieces first.
    let whole = size ? new Uint8Array(size) : null;
    const parts = whole ? null : [];
    let off = 0;
    for (let n = 0; n < count; n++) {
      const buf = await blobGetBytes(`chunk:${uploadId}:${n}`);
      if (!buf || !buf.byteLength) return fail(`Piece ${n + 1} of ${count} is missing — try publishing again.`);
      const piece = new Uint8Array(buf);
      if (whole) {
        if (off + piece.byteLength > whole.byteLength) return fail("The pieces add up to more than the file's size — try publishing again.");
        whole.set(piece, off);
      } else {
        parts.push(piece);
      }
      off += piece.byteLength;
      if ((n + 1) % 10 === 0 || n + 1 === count) await progress("joining", n + 1, off);
    }
    if (whole && off !== whole.byteLength) return fail(`The pieces add up to ${off} bytes but the file is ${whole.byteLength} — try publishing again.`);
    if (!whole) {
      if (off > MAX_BYTES) return fail("This file is too big for the pieces route — reload the Studio and publish again.");
      whole = new Uint8Array(off);
      let o = 0;
      for (const p of parts) { whole.set(p, o); o += p.byteLength; }
      parts.length = 0;
    }

    await progress("uploading", count, off);
    // Keep the record fresh while the upload runs so the browser can tell a
    // slow upload from a dead job.
    const heartbeat = setInterval(() => { progress("uploading", count, off).catch(() => {}); }, 20000);
    // When the storage answers early with an error (an expired link gives a
    // 403) while a large body is still being sent, Node's fetch never settles:
    // the function hangs, Netlify re-runs it, and the job sits at "running"
    // forever. Seen on the live site with a 300 MB body. So the upload gets a
    // deadline sized to the file (≥ 1 MB/s, 2–12 minutes) and reports a
    // failure instead of hanging.
    const deadlineMs = Math.min(12 * 60 * 1000, Math.max(2 * 60 * 1000, off / 1048576 * 1000));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deadlineMs);
    let up;
    try {
      up = await fetch(to, { method: "PUT", headers: { "content-type": contentType }, body: whole, signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) {
        return fail(`The upload to the Concert storage stalled after ${Math.round(deadlineMs / 60000)} minutes — usually the upload link had expired or the storage refused the file mid-upload. Try publishing again.`,
          "Add the Studio's address to the Concert storage's CORS policy so videos upload straight from the browser.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
    }
    if (!up.ok) {
      const detail = await up.text().catch(() => "");
      return fail(`The Concert storage refused the upload (${up.status})`, detail.slice(0, 300));
    }
    cleanup();
    await jobSet(jobId, { status: "done", bytes: off });
    return json({ ok: true }, 202);
  } catch (err) {
    return fail("Upload failed", String(err).slice(0, 300));
  }
};
