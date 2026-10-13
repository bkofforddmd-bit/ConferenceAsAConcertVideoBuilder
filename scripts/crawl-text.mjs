// Save every conference talk's plain text (paragraphs) — resumable, one JSON line per talk.
import fs from "fs";
const UA = "Mozilla/5.0 (research script; contact bkofford.dmd@gmail.com)";
const API = "https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "talks-index.json"), "utf8"));
const OUT = path.join(DATA, "talk-text.jsonl"); // resumable cache (gitignored)
const done = new Set();
if (fs.existsSync(OUT)) for (const line of fs.readFileSync(OUT, "utf8").split("\n")) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r.uri) done.add(r.uri); } catch {} }
const strip = (h) => h.replace(/<sup[\s\S]*?<\/sup>/g, "").replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&#8212;|&mdash;/g, "—").replace(/\s+/g, " ").trim();
function paragraphs(body) {
  const main = body.indexOf("<footer");
  const b = main >= 0 ? body.slice(0, main) : body;
  const ps = [...b.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => strip(m[1])).filter((t) => t.length > 1);
  return ps;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = fs.createWriteStream(OUT, { flags: "a" });
// Lines carry the talk uri so the cache survives index rebuilds (positions shift when a conference is added).
const queue = idx.talks.map((t, i) => [t, i]).filter(([t]) => !done.has(t.uri));
console.log("talks", idx.talks.length, "to do", queue.length);
let n = 0, fail = 0;
async function worker() {
  while (queue.length) {
    const [t, i] = queue.shift();
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(API + t.uri.replace(/^\/study/, "").replace(/\?.*$/, ""), { headers: { "user-agent": UA } });
        if (r.status === 429) { await sleep(4000 * (attempt + 1)); continue; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        const body = (j.content && j.content.body) || "";
        out.write(JSON.stringify({ i, uri: t.uri, p: paragraphs(body) }) + "\n");
        break;
      } catch (e) { if (attempt === 3) { fail++; out.write(JSON.stringify({ i, uri: t.uri, error: String(e.message || e) }) + "\n"); } else await sleep(1500); }
    }
    n++;
    if (n % 250 === 0) console.log(new Date().toISOString().slice(11, 19), "done", n, "of", queue.length + n, "fail", fail);
    await sleep(250);
  }
}
await Promise.all([worker(), worker()]);
out.end();
console.log("FINISHED", n, "fail", fail);
