// netlify/functions/fetch-talk.js
//
// Fetches a General Conference talk from churchofjesuschrist.org and returns
// clean structured JSON: { title, speaker, paragraphs[], year, month, slug, ... }.
// Tries the site's internal content API first, falls back to HTML parsing.
//
// The talk text is openly published Church content; this fetches it for
// transformation into original derivative songs. It is not an official API.

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

  let result = null;
  const errors = [];
  try {
    result = await fetchViaApi(parsed);
    if (!result.paragraphs.length) throw new Error("API returned no paragraphs");
  } catch (e) {
    errors.push("api: " + e.message);
    try {
      result = await fetchViaHtml(parsed);
    } catch (e2) {
      errors.push("html: " + e2.message);
    }
  }

  if (!result || !result.paragraphs.length) {
    return json({
      error: "Fetched the page but could not extract the talk text. The site structure may have changed.",
      detail: errors.join(" | "),
    }, 502);
  }

  return json({
    ...result,
    year: parsed.year,
    month: parsed.month,
    slug: parsed.slug,
    sourceUrl: `https://www.churchofjesuschrist.org${parsed.pathname}?lang=eng`,
    wordCount: result.paragraphs.join(" ").split(/\s+/).filter(Boolean).length,
  });
};

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

async function fetchViaApi({ year, month, slug }) {
  const uri = `/study/general-conference/${year}/${month}/${slug}`;
  const apiUrl =
    "https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content" +
    `?lang=eng&uri=${encodeURIComponent(uri)}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": "ConferenceAsAConcert/1.0" },
  });
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  const data = await res.json();
  const meta = data?.meta || {};
  const title =
    meta?.title || meta?.pageAttributes?.["page-title"] || data?.content?.head?.title || "";
  const bodyHtml = data?.content?.body || data?.content?.content || "";
  let paragraphs = [];
  if (typeof bodyHtml === "string" && bodyHtml.length) {
    paragraphs = htmlToParagraphs(bodyHtml);
  } else {
    extractParagraphsFromApiBody(data?.content, paragraphs);
  }
  return {
    title: cleanTitle(title),
    speaker: meta?.pageAttributes?.author || meta?.author || "",
    kicker: meta?.pageAttributes?.kicker || meta?.description || "",
    paragraphs,
  };
}

async function fetchViaHtml({ pathname }) {
  const pageUrl = `https://www.churchofjesuschrist.org${pathname}?lang=eng`;
  const res = await fetch(pageUrl, {
    headers: { Accept: "text/html", "User-Agent": "ConferenceAsAConcert/1.0" },
  });
  if (!res.ok) throw new Error(`Page responded ${res.status}`);
  const html = await res.text();
  const ogTitle = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = cleanTitle(ogTitle?.[1] || titleTag?.[1] || "");
  const bodyMatch = html.match(
    /<div[^>]+class="[^"]*body-block[^"]*"[\s\S]*?<\/div>\s*<\/div>/i
  );
  const scope = bodyMatch ? bodyMatch[0] : html;
  return { title, speaker: "", kicker: "", paragraphs: htmlToParagraphs(scope) };
}

function extractParagraphsFromApiBody(node, out) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach((n) => extractParagraphsFromApiBody(n, out));
  if (typeof node === "object") {
    if (typeof node.content === "string" && node.content.trim()) {
      const t = stripHtml(node.content);
      if (t) out.push(t);
    }
    for (const k of Object.keys(node)) {
      if (k === "content") continue;
      extractParagraphsFromApiBody(node[k], out);
    }
  }
}

function htmlToParagraphs(html) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = stripHtml(m[1]);
    if (t && t.length > 1 && !/^Notes?$/i.test(t)) out.push(t);
  }
  return out;
}

function stripHtml(html) {
  return (html || "")
    .replace(/<sup[^>]*>.*?<\/sup>/gi, "")
    .replace(/<a[^>]*class="[^"]*note-ref[^"]*"[^>]*>.*?<\/a>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&rsquo;|&apos;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(t) {
  return (t || "").replace(/\s*[|–-]\s*.*$/, "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
