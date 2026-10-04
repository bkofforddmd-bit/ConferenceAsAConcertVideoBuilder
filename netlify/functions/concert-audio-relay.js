// netlify/functions/concert-audio-relay.js
//
// Streams a song file to the Concert app's storage (a presigned Cloudflare R2
// PUT link from its "sign" step). The browser tries the PUT directly first;
// if the storage bucket's CORS rules don't allow the Studio's address, the
// browser sends the bytes here instead and this function PUTs them server-side.
// Netlify caps a function request at ~6 MB, so very large songs still need the
// direct route (add the Studio origin to the bucket's CORS allow-list).
//
//   PUT /.netlify/functions/concert-audio-relay?to=<presigned url>
//   body = raw audio bytes, content-type = the audio type

const ALLOWED = [
  /^https:\/\/[a-z0-9.-]+\.r2\.cloudflarestorage\.com\//i,
  /^https:\/\/[a-z0-9.-]+\.r2\.dev\//i,
  /^https:\/\/[a-z0-9.-]+\.cloudflarestorage\.com\//i,
];

export default async (req) => {
  if (req.method !== "PUT" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const to = new URL(req.url).searchParams.get("to") || "";
  if (!ALLOWED.some((re) => re.test(to))) {
    return new Response(JSON.stringify({ error: "That upload address isn't allowed." }), { status: 403, headers: { "content-type": "application/json" } });
  }
  const ct = req.headers.get("content-type") || "audio/mpeg";
  let bytes;
  try {
    bytes = await req.arrayBuffer();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Couldn't read the audio", detail: String(e).slice(0, 200) }), { status: 400, headers: { "content-type": "application/json" } });
  }
  if (!bytes || bytes.byteLength === 0) {
    return new Response(JSON.stringify({ error: "Empty audio body" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  let up;
  try {
    up = await fetch(to, { method: "PUT", headers: { "content-type": ct }, body: bytes });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Storage upload failed", detail: String(e).slice(0, 200) }), { status: 502, headers: { "content-type": "application/json" } });
  }
  if (!up.ok) {
    const detail = await up.text().catch(() => "");
    return new Response(JSON.stringify({ error: `Storage refused the upload (${up.status})`, detail: detail.slice(0, 300) }), { status: 502, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, bytes: bytes.byteLength }), { status: 200, headers: { "content-type": "application/json" } });
};
