// netlify/functions/list-conference.js
//
// Given { year, month } returns a conference's structure:
//   { year, month, sessions: [ { title, talks: [ { title, speaker, slug, uri } ] } ] }
// Powers the Year → Conference → Session → Speaker cascade. Uses the site's
// internal content endpoint, with an HTML-TOC fallback.

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const year = String(body.year || "").trim();
  const month = String(body.month || "").trim().padStart(2, "0");
  if (!/^\d{4}$/.test(year) || !/^(04|10)$/.test(month)) {
    return json({ error: "Need a 4-digit year and month 04 (April) or 10 (October)." }, 400);
  }

  let sessions = [];
  const errors = [];
  try {
    sessions = await fetchToc(year, month);
    if (!sessions.length) throw new Error("TOC API returned no talks");
  } catch (e) {
    errors.push("api: " + e.message);
    try {
      sessions = await fetchTocHtml(year, month);
    } catch (e2) {
      errors.push("html: " + e2.message);
    }
  }

  if (!sessions.length) {
    return json({
      error: "Could not read that conference's contents. The site structure may have changed.",
      detail: errors.join(" | "),
    }, 502);
  }

  return json({ year, month, sessions });
};

function isTalkUri(uri, year, month) {
  const base = `/study/general-conference/${year}/${month}/`;
  if (!uri || !uri.startsWith(base)) return false;
  const rest = uri.slice(base.length);
  if (!rest || rest.includes("/")) return false;
  if (/^\d+$/.test(rest)) return false;
  if (/(sustaining|audit-report|statistical-report|^contents$)/i.test(rest)) return false;
  return true;
}

function walkToc(node, year, month, ctx, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walkToc(n, year, month, ctx, out));

  const sectionTitle = node.sectionTitle || (node.type === "section" && node.title) || null;
  let nextCtx = ctx;
  if (sectionTitle) {
    nextCtx = { session: stripHtml(sectionTitle) };
    if (!out.find((s) => s.title === nextCtx.session)) out.push({ title: nextCtx.session, talks: [] });
  }

  const uri = node.uri || node.href || null;
  if (uri && isTalkUri(uri, year, month) && (node.title || node.titleHtml)) {
    const sessName = (nextCtx && nextCtx.session) || "General Sessions";
    let session = out.find((s) => s.title === sessName);
    if (!session) { session = { title: sessName, talks: [] }; out.push(session); }
    const slug = uri.split("/").pop();
    if (!session.talks.find((t) => t.slug === slug)) {
      session.talks.push({
        title: stripHtml(node.title || node.titleHtml),
        speaker: stripHtml(node.author || node.speaker || node.subtitle || node.kicker || ""),
        slug,
        uri,
      });
    }
  }

  for (const k of Object.keys(node)) {
    if (["uri", "href", "title", "titleHtml", "author"].includes(k)) continue;
    walkToc(node[k], year, month, nextCtx, out);
  }
}

async function fetchToc(year, month) {
  const uri = `/study/general-conference/${year}/${month}`;
  const apiUrl =
    "https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content" +
    `?lang=eng&uri=${encodeURIComponent(uri)}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": "ConferenceAsAConcert/1.0" },
  });
  if (!res.ok) throw new Error(`TOC API responded ${res.status}`);
  const data = await res.json();
  const sessions = [];
  const tocRoot = data?.toc || data?.content?.toc || data?.content || data;
  walkToc(tocRoot, year, month, null, sessions);
  return sessions.filter((s) => s.talks.length > 0);
}

// HTML fallback (the TOC content API has been returning 404 since 2026).
// The conference page lists every item as an <a href=".../{year}/{month}/{slug}">
// whose title sits in an itemTitle <span> and whose speaker is a "subtitle"
// paragraph. Session headers link to "...-session" and carry no subtitle;
// we use them to group the talks that follow. Same markup since 1971 and the
// same parser as scripts/build-talk-index.js.
async function fetchTocHtml(year, month) {
  const pageUrl = `https://www.churchofjesuschrist.org/study/general-conference/${year}/${month}?lang=eng`;
  const res = await fetch(pageUrl, {
    headers: { Accept: "text/html", "User-Agent": "ConferenceAsAConcert/1.0" },
  });
  if (!res.ok) throw new Error(`TOC page responded ${res.status}`);
  const html = await res.text();
  return parseConferenceHtml(html, year, month);
}

export function parseConferenceHtml(html, year, month) {
  const base = `/study/general-conference/${year}/${month}/`;
  const anchorRe = /<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const sessions = [];
  const seen = new Set();
  let current = null;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2];
    if (!href.includes(base)) continue;
    const slug = (href.split(base)[1] || "").split(/[?#]/)[0];
    if (!slug || slug.includes("/") || seen.has(slug)) continue;
    const titleM = inner.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    const title = stripHtml(titleM ? titleM[1] : inner);
    const subM = inner.match(/class="subtitle-[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const speaker = subM ? stripHtml(subM[1]) : "";
    if (!speaker) {
      // A session header (or "Contents"): start a new group.
      if (/session/i.test(slug) && title) { current = { title, talks: [] }; sessions.push(current); seen.add(slug); }
      continue;
    }
    if (!title || !isTalkUri(`${base}${slug}`, year, month)) continue;
    seen.add(slug);
    if (!current) { current = { title: "General Sessions", talks: [] }; sessions.push(current); }
    current.talks.push({ title, speaker, slug, uri: `${base}${slug}` });
  }
  return sessions.filter((s) => s.talks.length > 0);
}

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&rsquo;|&#x27;|&apos;/g, "\u2019")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
