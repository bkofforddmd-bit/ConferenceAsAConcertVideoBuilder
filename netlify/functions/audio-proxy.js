// netlify/functions/audio-proxy.js
//
// Relay for talk media bytes. The official MP3s/MP4s on
// assets.churchofjesuschrist.org play fine in media tags but don't send
// CORS headers, so the browser can't READ the bytes to cut clips or record
// video. This function streams them through same-origin, forwarding Range
// requests so the clipper fetches only the slice it needs. Also relays the
// speaker portraits (Church image server + BYU Speeches CDN) so they can be
// downloaded as files. Locked to those hosts/paths — this is not an open
// proxy.

const ALLOWED = [
  { host: "assets.churchofjesuschrist.org", path: /^\// },
  { host: "www.churchofjesuschrist.org", path: /^\/imgs\// },
  { host: "d6zb2yxvzmqfc.cloudfront.net", path: /^\/wp-content\/uploads\// },
];

export default async (req) => {
  const url = new URL(req.url);
  const src = url.searchParams.get("src") || "";
  let target;
  try {
    target = new URL(src);
  } catch {
    return json({ error: "Bad src." }, 400);
  }
  if (!ALLOWED.some((a) => a.host === target.hostname && a.path.test(target.pathname))) {
    return json({ error: "Only official talk media can be relayed." }, 403);
  }

  const headers = { "User-Agent": "ConferenceAsAConcert/1.0" };
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  let upstream;
  try {
    upstream = await fetch(target.href, { headers });
  } catch (e) {
    return json({ error: "Couldn't reach the audio server.", detail: String(e.message) }, 502);
  }
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: `Audio server responded ${upstream.status}.` }, 502);
  }

  const out = new Headers({
    "content-type": upstream.headers.get("content-type") || "audio/mpeg",
    "cache-control": "public, max-age=86400",
  });
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
