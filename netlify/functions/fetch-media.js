// netlify/functions/fetch-media.js
//
// Streams a generated media file (song MP3, video clip) from an AI provider's
// CDN to the browser. Needed when a provider's download URL doesn't send CORS
// headers, which would block the app from reading the bytes it just paid for.
// Host-locked to the providers we use — this is NOT an open proxy.

const ALLOWED = [
  /^https:\/\/([a-z0-9-]+\.)*fal\.media\//i,
  /^https:\/\/([a-z0-9-]+\.)*fal\.run\//i,
  /^https:\/\/([a-z0-9-]+\.)*fal\.ai\//i,
  /^https:\/\/generativelanguage\.googleapis\.com\//i,
  /^https:\/\/([a-z0-9-]+\.)*googleusercontent\.com\//i,
  /^https:\/\/([a-z0-9-]+\.)*storage\.googleapis\.com\//i,
  /^https:\/\/([a-z0-9-]+\.)*replicate\.delivery\//i,
  /^https:\/\/assets\.churchofjesuschrist\.org\//i, // official talk recordings (no CORS upstream)
];

export default async (req) => {
  const url = new URL(req.url).searchParams.get("src") || "";
  if (!ALLOWED.some((re) => re.test(url))) {
    return new Response(JSON.stringify({ error: "That host isn't allowed." }), { status: 403, headers: { "content-type": "application/json" } });
  }
  const headers = {};
  const range = req.headers.get("range");
  if (range) headers.range = range;
  // Google's file downloads need the API key; pass it through if the browser supplied one.
  const gkey = (req.headers.get("x-user-gemini-key") || process.env.GEMINI_API_KEY || "").trim();
  if (/googleapis\.com/i.test(url) && gkey) {
    if (gkey.startsWith("AQ.")) headers.Authorization = `Bearer ${gkey}`;
    else headers["x-goog-api-key"] = gkey;
  }

  let upstream;
  try {
    upstream = await fetch(url, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Could not reach the media host", detail: String(e) }), { status: 502, headers: { "content-type": "application/json" } });
  }
  const out = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("cache-control", "private, max-age=3600");
  out.set("access-control-allow-origin", "*");
  out.set("access-control-expose-headers", "content-length, content-range, accept-ranges");
  return new Response(upstream.body, { status: upstream.status, headers: out });
};
