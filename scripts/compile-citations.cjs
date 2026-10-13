// citations.jsonl → public/scripture-index.json (compact, canonical book order)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const dir = path.join(ROOT, "data") + path.sep;
const pub = path.join(ROOT, "public") + path.sep;
fs.mkdirSync(dir, { recursive: true });
const OUT = pub + "scripture-index.json";
const idx = JSON.parse(fs.readFileSync(pub + "talks-index.json", "utf8"));
// Cache lines are keyed by uri (positions shift whenever a conference is added); fall back to the stored position for legacy lines.
const uriToIdx = new Map(idx.talks.map((t, i) => [t.uri, i]));
const pos = (r) => (r.uri && uriToIdx.has(r.uri) ? uriToIdx.get(r.uri) : r.i);

const lines = fs.readFileSync(dir + "citations.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byTalk = new Map();
for (const r of lines) if (!r.error) byTalk.set(pos(r), r);
console.log("records", lines.length, "ok", byTalk.size, "errors", lines.filter((r) => r.error).length);

// canonical order of the standard works (href slugs)
const ORDER = [
  "ot/gen","ot/ex","ot/lev","ot/num","ot/deut","ot/josh","ot/judg","ot/ruth","ot/1-sam","ot/2-sam","ot/1-kgs","ot/2-kgs","ot/1-chr","ot/2-chr","ot/ezra","ot/neh","ot/esth","ot/job","ot/ps","ot/prov","ot/eccl","ot/song","ot/isa","ot/jer","ot/lam","ot/ezek","ot/dan","ot/hosea","ot/joel","ot/amos","ot/obad","ot/jonah","ot/micah","ot/nahum","ot/hab","ot/zeph","ot/hag","ot/zech","ot/mal",
  "nt/matt","nt/mark","nt/luke","nt/john","nt/acts","nt/rom","nt/1-cor","nt/2-cor","nt/gal","nt/eph","nt/philip","nt/col","nt/1-thes","nt/2-thes","nt/1-tim","nt/2-tim","nt/titus","nt/philem","nt/heb","nt/james","nt/1-pet","nt/2-pet","nt/1-jn","nt/2-jn","nt/3-jn","nt/jude","nt/rev",
  "bofm/1-ne","bofm/2-ne","bofm/jacob","bofm/enos","bofm/jarom","bofm/omni","bofm/w-of-m","bofm/mosiah","bofm/alma","bofm/hel","bofm/3-ne","bofm/4-ne","bofm/morm","bofm/ether","bofm/moro",
  "dc-testament/dc","dc-testament/od",
  "pgp/moses","pgp/abr","pgp/js-m","pgp/js-h","pgp/a-of-f",
];
const VOL = { ot: "Old Testament", nt: "New Testament", bofm: "Book of Mormon", "dc-testament": "Doctrine and Covenants", pgp: "Pearl of Great Price" };
const NAMES = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth","1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
  "Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation",
  "1 Nephi","2 Nephi","Jacob","Enos","Jarom","Omni","Words of Mormon","Mosiah","Alma","Helaman","3 Nephi","4 Nephi","Mormon","Ether","Moroni",
  "Doctrine and Covenants","Official Declaration",
  "Moses","Abraham","Joseph Smith—Matthew","Joseph Smith—History","Articles of Faith"];
const NAME_FIX = Object.fromEntries(ORDER.map((k, i) => [k, NAMES[i]]));

// book names: most common anchor text per slug, with fixes
const nameCounts = {};
for (const r of byTalk.values()) for (const [key, m] of Object.entries(r.names || {})) { nameCounts[key] = nameCounts[key] || {}; for (const [n, c] of Object.entries(m)) nameCounts[key][n] = (nameCounts[key][n] || 0) + c; }
const keys = new Set([...ORDER, ...Object.keys(nameCounts)]);
for (const r of byTalk.values()) for (const ref of r.refs) keys.add(ref[0]);
const books = [...keys].filter((k) => /^(ot|nt|bofm|dc-testament|pgp)\//.test(k)).sort((a, b) => { const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b); })
  .map((key) => {
    const vol = key.split("/")[0];
    const best = Object.entries(nameCounts[key] || {}).sort((x, y) => y[1] - x[1])[0];
    const name = NAME_FIX[key] || (best ? best[0] : key.split("/")[1]);
    return { key, name, vol: VOL[vol] || vol };
  });
const bookIdx = new Map(books.map((b, i) => [b.key, i]));

// people
const peopleCount = {};
for (const r of byTalk.values()) for (const p of r.q || []) peopleCount[p] = (peopleCount[p] || 0) + 1;
const people = Object.keys(peopleCount).sort((a, b) => peopleCount[b] - peopleCount[a]);
const peopleIdx = new Map(people.map((p, i) => [p, i]));

const talks = [];
let refTotal = 0;
for (const [i, r] of byTalk) {
  const refs = r.refs.filter((x) => bookIdx.has(x[0])).map(([k, c, v1, v2]) => [bookIdx.get(k), c, v1 == null ? 0 : v1, v2 == null ? 0 : v2]);
  refTotal += refs.length;
  talks.push([i, refs, (r.q || []).map((p) => peopleIdx.get(p))]);
}
talks.sort((a, b) => a[0] - b[0]);
const out = { generated: new Date().toISOString().slice(0, 10), books, people, talks, note: "Scripture anchors in each talk's text and footnotes (book, chapter, first verse, last verse; 0 = whole chapter). People = conference speakers and Church Presidents named in the footnotes or linked by talk." };
fs.writeFileSync(OUT, JSON.stringify(out));
fs.writeFileSync(dir + "scripture-index.v1.json", JSON.stringify(out)); // v1 = input for compile-citations-v2.js
console.log("books", books.length, "people", people.length, "talks", talks.length, "refs", refTotal, "bytes", fs.statSync(OUT).size);
console.log("top people:", people.slice(0, 8).map((p) => `${p} ${peopleCount[p]}`).join(", "));
const bc = {}; for (const t of talks) for (const r of t[1]) bc[books[r[0]].name] = (bc[books[r[0]].name] || 0) + 1;
console.log("top books:", Object.entries(bc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} ${c}`).join(", "));
