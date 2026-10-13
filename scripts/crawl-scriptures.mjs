// Fetch the text of every verse of the standard works (for matching unmarked
// quotations in talks). One JSON line per chapter: { key, chapter, verses: [[n, text], ...] }
import fs from "fs";
const UA = "Mozilla/5.0 (research script; contact bkofford.dmd@gmail.com)";
const API = "https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
const OUT = path.join(DATA, "scriptures.jsonl"); // resumable cache (gitignored)
const BOOKS = ["ot/gen","ot/ex","ot/lev","ot/num","ot/deut","ot/josh","ot/judg","ot/ruth","ot/1-sam","ot/2-sam","ot/1-kgs","ot/2-kgs","ot/1-chr","ot/2-chr","ot/ezra","ot/neh","ot/esth","ot/job","ot/ps","ot/prov","ot/eccl","ot/song","ot/isa","ot/jer","ot/lam","ot/ezek","ot/dan","ot/hosea","ot/joel","ot/amos","ot/obad","ot/jonah","ot/micah","ot/nahum","ot/hab","ot/zeph","ot/hag","ot/zech","ot/mal",
  "nt/matt","nt/mark","nt/luke","nt/john","nt/acts","nt/rom","nt/1-cor","nt/2-cor","nt/gal","nt/eph","nt/philip","nt/col","nt/1-thes","nt/2-thes","nt/1-tim","nt/2-tim","nt/titus","nt/philem","nt/heb","nt/james","nt/1-pet","nt/2-pet","nt/1-jn","nt/2-jn","nt/3-jn","nt/jude","nt/rev",
  "bofm/1-ne","bofm/2-ne","bofm/jacob","bofm/enos","bofm/jarom","bofm/omni","bofm/w-of-m","bofm/mosiah","bofm/alma","bofm/hel","bofm/3-ne","bofm/4-ne","bofm/morm","bofm/ether","bofm/moro",
  "dc-testament/dc","dc-testament/od","pgp/moses","pgp/abr","pgp/js-m","pgp/js-h","pgp/a-of-f"];
const done = new Set();
if (fs.existsSync(OUT)) for (const line of fs.readFileSync(OUT, "utf8").split("\n")) { if (!line.trim()) continue; try { const r = JSON.parse(line); done.add(r.key + "/" + r.chapter); } catch {} }
const strip = (h) => h.replace(/<sup[\s\S]*?<\/sup>/g, "").replace(/<span class="verse-number">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&#8212;|&mdash;/g, "—").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (uri) => { for (let a = 0; a < 4; a++) { const r = await fetch(API + uri, { headers: { "user-agent": UA } }); if (r.status === 429) { await sleep(4000 * (a + 1)); continue; } if (r.status === 404) return null; if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); } return null; };
const out = fs.createWriteStream(OUT, { flags: "a" });
let chapters = 0;
// chapter lists from each book's table of contents
const jobs = [];
for (const key of BOOKS) {
  const toc = await get("/scriptures/" + key);
  const text = JSON.stringify(toc || {});
  const nums = new Set([...text.matchAll(new RegExp(`/study/scriptures/${key.replace(/[-/]/g, (c) => "\\" + c)}/(\\d+)`, "g"))].map((m) => Number(m[1])));
  const list = nums.size ? [...nums].sort((a, b) => a - b) : [1];
  for (const c of list) if (!done.has(key + "/" + c)) jobs.push([key, c]);
  await sleep(150);
}
console.log("chapters to fetch", jobs.length);
async function worker() {
  while (jobs.length) {
    const [key, c] = jobs.shift();
    try {
      const j = await get(`/scriptures/${key}/${c}`);
      const body = (j && j.content && j.content.body) || "";
      const verses = [...body.matchAll(/<p[^>]*class="verse"[^>]*id="p(\d+)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => [Number(m[1]), strip(m[2])]);
      // sections without class="verse" (e.g. Official Declarations, JS—History): take numbered paragraphs
      const fallback = verses.length ? verses : [...body.matchAll(/<p[^>]*id="p(\d+)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => [Number(m[1]), strip(m[2])]);
      out.write(JSON.stringify({ key, chapter: c, verses: fallback }) + "\n");
      chapters++;
      if (chapters % 100 === 0) console.log(new Date().toISOString().slice(11, 19), "chapters", chapters, "left", jobs.length);
    } catch (e) { out.write(JSON.stringify({ key, chapter: c, error: String(e.message || e) }) + "\n"); }
    await sleep(200);
  }
}
await Promise.all([worker(), worker()]);
out.end();
console.log("FINISHED chapters", chapters);
