// netlify/functions/fetch-audio.js
//
// Given { url } (a General Conference talk URL or /study/... uri), returns
// { audioUrl, title } where audioUrl is the talk's official MP3 on
// assets.churchofjesuschrist.org — the same file the site's own audio player
// streams. Powers the "listen to a speaker's talks in a row" playlist.
//
// How: the talk page embeds its data as base64 JSON in
// window.__INITIAL_STATE__; the MP3 lives at
// reader.contentStore[uri].meta.audio[0].mediaUrl. No scraping heuristics —
// just decoding what the page itself ships. Verified to work for talks from
// 1971 through the present.

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseTalkUrl(body.url || "");
  if (!parsed) {
    return json({
      error:
        "Could not parse that as a General Conference talk URL/URI. Expected " +
        "/study/general-conference/{year}/{month}/{slug}.",
    }, 400);
  }

  const pageUrl = `https://www.churchofjesuschrist.org${parsed.pathname}?lang=eng`;
  let html;
  try {
    const res = await fetch(pageUrl, {
      headers: { Accept: "text/html", "User-Agent": "ConferenceAsAConcert/1.0" },
    });
    if (!res.ok) throw new Error(`Page responded ${res.status}`);
    html = await res.text();
  } catch (e) {
    return json({ error: "Could not load the talk page.", detail: e.message }, 502);
  }

  const state = decodeInitialState(html);
  if (!state) {
    return json({ error: "The talk page's data blob was missing or unreadable. The site structure may have changed." }, 502);
  }

  // The content store is keyed like "/eng/general-conference/2025/10/51bednar".
  const store = state?.reader?.contentStore || {};
  const entry =
    Object.values(store).find((v) => v?.meta) || null;
  const meta = entry?.meta || null;
  const audioUrl = meta?.audio?.[0]?.mediaUrl || "";

  if (!audioUrl) {
    return json({ error: "No audio recording is available for this talk." }, 404);
  }

  return json({
    audioUrl,
    title: meta?.title || "",
    sourceUrl: pageUrl,
  });
};

function decodeInitialState(html) {
  const m = html.match(/__INITIAL_STATE__="([A-Za-z0-9+/=]+)"/);
  if (!m) return null;
  try {
    const jsonStr = Buffer.from(m[1], "base64").toString("utf8");
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function parseTalkUrl(input) {
  let u;
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    u = new URL(raw);
  } catch {
    try {
      u = new URL("https://www.churchofjesuschrist.org" + raw);
    } catch {
      return null;
    }
  }
  if (!u.hostname.includes("churchofjesuschrist.org")) return null;
  const m = u.pathname.match(
    /\/study\/general-conference\/(\d{4})\/(\d{2})\/([^/?#]+)/
  );
  if (!m) return null;
  return { year: m[1], month: m[2], slug: m[3], pathname: u.pathname };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
