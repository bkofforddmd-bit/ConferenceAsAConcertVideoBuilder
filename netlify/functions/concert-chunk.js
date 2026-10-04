// netlify/functions/concert-chunk.js
//
// Receives one piece (≤ 3 MB) of a song being sent to the Conference Concert
// library and parks it in storage. concert-assemble-background.js stitches
// the pieces together and uploads the whole file to the Concert app's
// storage. (Netlify caps a single function request at a few MB, and the
// Concert storage won't accept a direct browser upload from this site, so the
// song travels in pieces.)
//
//   PUT /.netlify/functions/concert-chunk?id=<uploadId>&n=<index>
//   body = raw bytes

import { json } from "../lib/keys.js";
import { blobSetBytes, validJobId } from "../lib/jobs.js";

export default async (req) => {
  if (req.method !== "PUT" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const u = new URL(req.url);
  const id = u.searchParams.get("id") || "";
  const n = Number(u.searchParams.get("n"));
  if (!validJobId(id) || !Number.isInteger(n) || n < 0 || n > 400) return json({ error: "Bad chunk address" }, 400);
  let bytes;
  try { bytes = await req.arrayBuffer(); } catch (e) { return json({ error: "Couldn't read the chunk", detail: String(e).slice(0, 200) }, 400); }
  if (!bytes || !bytes.byteLength) return json({ error: "Empty chunk" }, 400);
  try {
    await blobSetBytes(`chunk:${id}:${n}`, bytes);
  } catch (e) {
    return json({ error: "Couldn't store the chunk", detail: String(e).slice(0, 300) }, 500);
  }
  return json({ ok: true, n, bytes: bytes.byteLength });
};
