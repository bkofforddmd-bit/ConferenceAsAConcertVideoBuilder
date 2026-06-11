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

  // Scope to the article body so nav/footer paragraphs are excluded, but do
  // NOT stop at the first body-block — talks with embedded images are split
  // across several body-block sections, and an early </div></div> would
  // otherwise truncate the talk at the first image. We find where the article
  // body begins and read to the end of the article, then collect every <p>.
  const scope = scopeToArticleBody(html);
  return { title, speaker: "", kicker: "", paragraphs: htmlToParagraphs(scope) };
}

// Returns the HTML region containing the talk body. Prefers the <div class="body">
// (or <article>) start and runs to the article's end; falls back to the whole
// document. Critically, it never stops early at an image-induced block boundary.
function scopeToArticleBody(html) {
  // Find the opening of the main body container.
  const startRe = /<div[^>]+class="[^"]*\bbody\b[^"]*"[^>]*>/i;
  const startMatch = startRe.exec(html);
  let from = startMatch ? startMatch.index : 0;

  // If there's an <article>, prefer its bounds (tighter, excludes related links).
  const artStart = html.search(/<article\b/i);
  const artEnd = html.search(/<\/article>/i);
  if (artStart !== -1 && artEnd !== -1 && artEnd > artStart) {
    return html.slice(artStart, artEnd);
  }

  // Otherwise read from the body container to the footer / related-content area,
  // or to end of document — whichever comes first.
  let to = html.length;
  const enders = [
    /<footer\b/i,
    /<div[^>]+class="[^"]*\brelated\b[^"]*"/i,
    /<div[^>]+class="[^"]*\bassociated-content\b[^"]*"/i,
  ];
  for (const re of enders) {
    const m = re.exec(html.slice(from));
    if (m && from + m.index < to) to = from + m.index;
  }
  return html.slice(from, to);
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
  // Remove figures (images + their captions) so caption text isn't mixed into
  // the talk body, then collect every remaining paragraph. Removing figures —
  // rather than scoping to one block — is what lets images appear anywhere in
  // the talk without truncating or polluting the text.
  const cleaned = (html || "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, " ")
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, " ");
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
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
