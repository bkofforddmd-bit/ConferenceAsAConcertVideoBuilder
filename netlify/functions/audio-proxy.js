// netlify/functions/audio-proxy.js
//
// Relay for talk audio bytes. The official MP3s on
// assets.churchofjesuschrist.org play fine in an <audio> tag but don't send
// CORS headers, so the browser can't READ the bytes to cut clips. This
// function streams them through same-origin, forwarding Range requests so
// the clipper fetches only the slice it needs (~16KB per second of audio).
// Locked to that one host — this is not an open proxy.

export default async (req) => {
  const url = new URL(req.url);
  const src = url.searchParams.get("src") || "";
  let target;
  try {
    target = new URL(src);
  } catch {
    return json({ error: "Bad src." }, 400);
  }
  if (target.hostname !== "assets.churchofjesuschrist.org") {
    return json({ error: "Only official talk audio can be relayed." }, 403);
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
