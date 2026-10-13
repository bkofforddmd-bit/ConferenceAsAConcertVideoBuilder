// Crawl every conference talk's content and record its scripture citations
// and the people it quotes. Resumable: one JSON line per talk in citations.jsonl.
import fs from "fs";
const UA = "Mozilla/5.0 (research script; contact bkofford.dmd@gmail.com)";
const API = "https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
const INDEX = path.join(ROOT, "public", "talks-index.json");
const OUT = path.join(DATA, "citations.jsonl"); // resumable cache (gitignored)
const idx = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const talks = idx.talks;
const done = new Set();
if (fs.existsSync(OUT)) for (const line of fs.readFileSync(OUT, "utf8").split("\n")) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r.uri) done.add(r.uri); } catch {} }
console.log("talks", talks.length, "already done", done.size);

// people we recognise in footnotes: every conference speaker + the Presidents of the Church
const PRESIDENTS = ["Joseph Smith", "Brigham Young", "John Taylor", "Wilford Woodruff", "Lorenzo Snow", "Joseph F. Smith", "Heber J. Grant", "George Albert Smith", "David O. McKay", "Joseph Fielding Smith", "Harold B. Lee", "Spencer W. Kimball", "Ezra Taft Benson", "Howard W. Hunter", "Gordon B. Hinckley", "Thomas S. Monson", "Russell M. Nelson", "Dallin H. Oaks"];
const speakerNames = new Set(talks.map((t) => String(t.speaker || "").replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "").trim()).filter((n) => n.split(" ").length >= 2));
for (const p of PRESIDENTS) speakerNames.add(p);
const people = [...speakerNames].sort((a, b) => b.length - a.length);
const peopleRe = people.map((n) => ({ n, re: new RegExp("(^|[^A-Za-z])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "(?![A-Za-z])") }));
const uriToSpeaker = new Map(talks.map((t) => [t.uri.replace(/\?.*$/, ""), String(t.speaker || "").replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "").trim()]));

const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

function parseRefs(body) {
  const refs = [];
  const names = {};
  for (const m of body.matchAll(/<a[^>]*href="(\/study\/scriptures\/([a-z-]+)\/([a-z0-9-]+)\/(\d+)[^"]*)"[^>]*>([^<]*)<\/a>/g)) {
    const [, href, vol, book, chap, text] = m;
    const id = (href.match(/id=p(\d+)(?:-p(\d+))?/) || []);
    const v1 = id[1] ? Number(id[1]) : null, v2 = id[2] ? Number(id[2]) : null;
    refs.push([`${vol}/${book}`, Number(chap), v1, v2]);
    const t = strip(text).replace(/\s*\d.*$/, "").trim(); // "2 Nephi 2:25" → "2 Nephi"; "88:91" → ""
    if (t && /[A-Za-z]/.test(t) && !/^\d+$/.test(t)) { const key = `${vol}/${book}`; names[key] = names[key] || {}; names[key][t] = (names[key][t] || 0) + 1; }
  }
  return { refs, names };
}

function parseQuotes(noteHtml) {
  const q = new Set();
  for (const n of noteHtml || []) {
    for (const m of n.matchAll(/href="(\/study\/general-conference\/\d{4}\/\d{2}\/[a-z0-9-]+)/g)) { const sp = uriToSpeaker.get(m[1]); if (sp) q.add(sp); }
    const text = strip(n);
    const tp = text.match(/Teachings of Presidents of the Church:\s*([A-Z][A-Za-z. ]+?)(?:\s*\(|,|$)/);
    if (tp) { const nm = tp[1].trim(); const hit = people.find((p) => p === nm || p.endsWith(nm)); if (hit) q.add(hit); }
    for (const { n: name, re } of peopleRe) if (re.test(text)) q.add(name);
  }
  return [...q];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = fs.createWriteStream(OUT, { flags: "a" });
// Lines carry the talk uri so the cache survives index rebuilds (positions shift when a conference is added).
const queue = talks.map((t, i) => [t, i]).filter(([t]) => !done.has(t.uri));
let ok = 0, fail = 0;
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
        const fo = (j.content && j.content.footnotes) || {};
        // footnotes: an object id → { text: html } (the body's <footer class="notes"> repeats them, so
        // scripture anchors are read from the body alone, and people from the note texts)
        const noteHtml = typeof fo === "string"
          ? [...fo.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1])
          : Object.values(fo).map((v) => (typeof v === "string" ? v : (v && (v.text || v.html || v.content || "")) || ""));
        const { refs, names } = parseRefs(body);
        const quotes = parseQuotes(noteHtml);
        const self = String(t.speaker || "").replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "").trim();
        out.write(JSON.stringify({ i, uri: t.uri, refs, names, q: quotes.filter((p) => p !== self) }) + "\n");
        ok++;
        break;
      } catch (e) {
        if (attempt === 3) { fail++; out.write(JSON.stringify({ i, uri: t.uri, error: String(e.message || e) }) + "\n"); }
        else await sleep(1500);
      }
    }
    if ((ok + fail) % 100 === 0) console.log(new Date().toISOString().slice(11, 19), "done", ok + fail, "of", queue.length + ok + fail, "fail", fail);
    await sleep(250);
  }
}
await Promise.all([worker(), worker()]);
out.end();
console.log("FINISHED ok", ok, "fail", fail);
