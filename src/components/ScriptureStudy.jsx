// Insights → Scriptures: how often a scripture, a book, or a person is cited
// in General Conference, by whom, and when. Data: public/scripture-index.json
// (every talk's scripture anchors + the speakers/Presidents its footnotes
// name), built from the talks' own footnotes.

import React, { useEffect, useMemo, useState } from "react";

const ALIASES = {
  "d&c": "dc-testament/dc", "dc": "dc-testament/dc", "d c": "dc-testament/dc", "doctrine & covenants": "dc-testament/dc", "doctrine and covenants": "dc-testament/dc", "sec": "dc-testament/dc", "section": "dc-testament/dc",
  "od": "dc-testament/od", "official declaration": "dc-testament/od",
  "js-h": "pgp/js-h", "jsh": "pgp/js-h", "joseph smith history": "pgp/js-h", "joseph smith—history": "pgp/js-h",
  "js-m": "pgp/js-m", "jsm": "pgp/js-m", "joseph smith matthew": "pgp/js-m",
  "a of f": "pgp/a-of-f", "aof": "pgp/a-of-f", "articles of faith": "pgp/a-of-f",
  "w of m": "bofm/w-of-m", "words of mormon": "bofm/w-of-m",
  "ps": "ot/ps", "psalm": "ot/ps", "psalms": "ot/ps", "prov": "ot/prov", "eccl": "ot/eccl", "song": "ot/song", "isa": "ot/isa", "jer": "ot/jer", "ezek": "ot/ezek", "dan": "ot/dan", "gen": "ot/gen", "ex": "ot/ex", "exodus": "ot/ex", "lev": "ot/lev", "num": "ot/num", "deut": "ot/deut", "josh": "ot/josh", "judg": "ot/judg", "mal": "ot/mal",
  "matt": "nt/matt", "mt": "nt/matt", "mk": "nt/mark", "lk": "nt/luke", "jn": "nt/john", "rom": "nt/rom", "1 cor": "nt/1-cor", "2 cor": "nt/2-cor", "gal": "nt/gal", "eph": "nt/eph", "phil": "nt/philip", "philip": "nt/philip", "col": "nt/col", "1 thes": "nt/1-thes", "2 thes": "nt/2-thes", "1 tim": "nt/1-tim", "2 tim": "nt/2-tim", "heb": "nt/heb", "jas": "nt/james", "1 pet": "nt/1-pet", "2 pet": "nt/2-pet", "1 jn": "nt/1-jn", "rev": "nt/rev",
  "1 ne": "bofm/1-ne", "2 ne": "bofm/2-ne", "3 ne": "bofm/3-ne", "4 ne": "bofm/4-ne", "1 nephi": "bofm/1-ne", "2 nephi": "bofm/2-ne", "3 nephi": "bofm/3-ne", "4 nephi": "bofm/4-ne", "mos": "bofm/mosiah", "hel": "bofm/hel", "morm": "bofm/morm", "moro": "bofm/moro", "abr": "pgp/abr",
};
const norm = (s) => String(s || "").toLowerCase().replace(/[—–]/g, "-").replace(/[.’']/g, "").replace(/\s+/g, " ").trim();
const confNum = (y, m) => Number(y) * 100 + Number(m);
const refLabel = (books, r) => `${books[r[0]].name} ${r[1]}${r[2] ? `:${r[2]}${r[3] && r[3] !== r[2] ? `–${r[3]}` : ""}` : ""}`;

// "Isaiah 53:3-5" | "2 Nephi 2" | "Alma" | "D&C 121" | a person's name
function parseQuery(q, books, people) {
  const t = norm(q);
  if (!t) return null;
  const m = t.match(/^(.+?)\s*(?:(\d+)\s*(?::\s*(\d+)\s*(?:-\s*(\d+))?)?)?$/);
  const findBook = (name) => {
    const n = norm(name).replace(/\s*-\s*/g, " ");
    if (!n) return -1;
    const alias = ALIASES[n];
    if (alias) { const i = books.findIndex((b) => b.key === alias); if (i >= 0) return i; }
    let i = books.findIndex((b) => norm(b.name) === n);
    if (i >= 0) return i;
    i = books.findIndex((b) => norm(b.name).startsWith(n) && n.length >= 3);
    if (i >= 0) return i;
    i = books.findIndex((b) => b.key.split("/")[1].replace(/-/g, " ") === n);
    return i;
  };
  // a person's exact name wins over a loose book match ("Joseph Smith" is the man, not Joseph Smith—Matthew)
  const exactPerson = people.findIndex((p) => norm(p) === t);
  if (exactPerson >= 0) return { kind: "person", person: exactPerson };
  if (m) {
    const [, bookPart, ch, v1, v2] = m;
    const bp = norm(bookPart).replace(/\s*-\s*/g, " ");
    const exactBook = !!ALIASES[bp] || books.some((bk) => norm(bk.name) === bp);
    const bi = findBook(bookPart);
    if (bi >= 0 && (ch || exactBook)) {
      return { kind: "scripture", book: bi, chapter: ch ? Number(ch) : null, v1: v1 ? Number(v1) : null, v2: v2 ? Number(v2) : v1 ? Number(v1) : null };
    }
  }
  const pc = people.map((p, i) => ({ i, p })).filter(({ p }) => norm(p).includes(t));
  if (pc.length === 1) return { kind: "person", person: pc[0].i };
  if (pc.length > 1) return { kind: "people", candidates: pc.slice(0, 12) };
  // a book name typed loosely
  const bi = findBook(t);
  if (bi >= 0) return { kind: "scripture", book: bi, chapter: null, v1: null, v2: null };
  return { kind: "none" };
}

let cache = null;
function useScriptureIndex() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) return;
    fetch("/scripture-index.json").then((r) => (r.ok ? r.json() : null)).then((d) => { cache = d; setData(d); }).catch(() => setData({ error: true }));
  }, []);
  return data;
}

export default function ScriptureStudy({ index, presidencies, startUrisQueue, chooseTalk, nowPlayingUri, loadingUri, Timeline }) {
  const sidx = useScriptureIndex();
  const [q, setQ] = useState("");
  const [tf, setTf] = useState("all");
  const [yearPick, setYearPick] = useState(null);
  const [inclQuoted, setInclQuoted] = useState(true);   // unmarked quotations found in the text (v2 index)
  const [inclMentions, setInclMentions] = useState(true); // people named in the talk's own words (v2 index)
  const v2 = !!(sidx && sidx.version >= 2);
  const timeframe = useMemo(() => {
    if (tf === "all") return { from: 0, to: 999912, label: "all years" };
    const p = (presidencies || []).find((x) => x.key === tf);
    return p ? { from: p.from, to: p.to ?? 999912, label: p.label } : { from: 0, to: 999912, label: "all years" };
  }, [tf, presidencies]);

  const books = sidx && sidx.books ? sidx.books : [];
  const people = sidx && sidx.people ? sidx.people : [];
  const parsed = useMemo(() => (sidx && sidx.books ? parseQuery(q, books, people) : null), [q, sidx]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggestions while typing
  const suggestions = useMemo(() => {
    const t = norm(q);
    if (!sidx || !sidx.books || t.length < 2 || /\d/.test(t)) return [];
    const bs = books.map((b, i) => ({ kind: "book", label: b.name, sub: b.vol, i })).filter((x) => norm(x.label).includes(t));
    const ps = people.map((p, i) => ({ kind: "person", label: p, sub: "quoted in conference", i })).filter((x) => norm(x.label).includes(t));
    return [...bs.slice(0, 6), ...ps.slice(0, 6)];
  }, [q, sidx]); // eslint-disable-line react-hooks/exhaustive-deps

  // talks in the timeframe, with their citations
  const scoped = useMemo(() => {
    if (!sidx || !sidx.talks || !index) return [];
    return sidx.talks
      .map(([i, refs, qs, ms]) => ({ i, refs, qs, ms: ms || [], t: index.talks[i] }))
      .filter((x) => x.t && confNum(x.t.year, x.t.month) >= timeframe.from && confNum(x.t.year, x.t.month) <= timeframe.to);
  }, [sidx, index, timeframe]);
  const allByYear = useMemo(() => { const m = {}; for (const x of scoped) m[x.t.year] = (m[x.t.year] || 0) + 1; return m; }, [scoped]);

  const result = useMemo(() => {
    if (!parsed || parsed.kind === "none" || parsed.kind === "people") return null;
    const matches = []; // { x, mentions, refs }
    if (parsed.kind === "scripture") {
      for (const x of scoped) {
        const hit = x.refs.filter((r) => {
          if (r[4] === 1 && !inclQuoted) return false;
          if (r[0] !== parsed.book) return false;
          if (parsed.chapter == null) return true;
          if (r[1] !== parsed.chapter) return false;
          if (parsed.v1 == null) return true;
          if (!r[2]) return false; // whole-chapter citation doesn't prove the verse
          const a = r[2], b = r[3] || r[2];
          return b >= parsed.v1 && a <= parsed.v2;
        });
        if (hit.length) matches.push({ x, mentions: hit.length, refs: hit });
      }
    } else {
      for (const x of scoped) {
        const inNotes = x.qs.includes(parsed.person), inText = inclMentions && x.ms.includes(parsed.person);
        if (inNotes || inText) matches.push({ x, mentions: 1, refs: [], how: inNotes && inText ? "footnote + text" : inNotes ? "footnote" : "in the text" });
      }
    }
    const bySpeaker = {}, byYear = {}, passages = {};
    for (const m of matches) {
      const sp = m.x.t.speaker || "Unknown";
      bySpeaker[sp] = (bySpeaker[sp] || 0) + 1;
      byYear[m.x.t.year] = (byYear[m.x.t.year] || 0) + 1;
      for (const r of m.refs) { const k = refLabel(books, r); passages[k] = passages[k] || { n: 0, r }; passages[k].n++; }
    }
    // how many talks each speaker gave in the timeframe (for a share)
    const speakerTotals = {};
    for (const x of scoped) { const sp = x.t.speaker || "Unknown"; speakerTotals[sp] = (speakerTotals[sp] || 0) + 1; }
    const speakers = Object.entries(bySpeaker).map(([sp, n]) => ({ sp, n, of: speakerTotals[sp] || n })).sort((a, b) => b.n - a.n || a.sp.localeCompare(b.sp));
    const top = Object.entries(passages).map(([k, v]) => ({ k, n: v.n, r: v.r })).sort((a, b) => b.n - a.n).slice(0, 20);
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    const peak = years.reduce((best, y) => (byYear[y] > (byYear[best] || 0) ? y : best), years[0]);
    return { matches: matches.sort((a, b) => confNum(b.x.t.year, b.x.t.month) - confNum(a.x.t.year, a.x.t.month)), speakers, top, byYear, mentions: matches.reduce((a, m) => a + m.mentions, 0), first: years[0], last: years[years.length - 1], peak };
  }, [parsed, scoped, books, inclQuoted, inclMentions]);

  // leaderboards when nothing is typed
  const boards = useMemo(() => {
    if (parsed || !scoped.length) return null;
    const passage = {}, book = {}, person = {};
    for (const x of scoped) {
      const seenP = new Set(), seenB = new Set();
      for (const r of x.refs) {
        if (r[4] === 1 && !inclQuoted) continue;
        if (r[2]) { const k = refLabel(books, r); if (!seenP.has(k)) { seenP.add(k); passage[k] = (passage[k] || 0) + 1; } }
        if (!seenB.has(r[0])) { seenB.add(r[0]); book[r[0]] = (book[r[0]] || 0) + 1; }
      }
      for (const p of new Set([...x.qs, ...(inclMentions ? x.ms : [])])) person[p] = (person[p] || 0) + 1;
    }
    const sortTop = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    const maxBook = Math.max(1, ...Object.values(book));
    return { passages: sortTop(passage, 25), books: sortTop(book, 20).map(([i, n]) => ({ i: Number(i), n, w: n / maxBook })), people: sortTop(person, 20), talks: scoped.length };
  }, [parsed, scoped, books, inclQuoted, inclMentions]);

  const label = parsed && parsed.kind === "scripture"
    ? `${books[parsed.book].name}${parsed.chapter ? ` ${parsed.chapter}` : ""}${parsed.v1 ? `:${parsed.v1}${parsed.v2 && parsed.v2 !== parsed.v1 ? `–${parsed.v2}` : ""}` : ""}`
    : parsed && parsed.kind === "person" ? people[parsed.person] : "";

  const listed = result ? result.matches.filter((m) => !yearPick || Number(m.x.t.year) === yearPick) : [];
  const play = (uris, name) => startUrisQueue && startUrisQueue({ id: `scrip|${name}|${uris.length}`, label: name, uris, order: "newest" });

  if (!sidx) return <p className="note">Loading the scripture index…</p>;
  if (sidx.error || !sidx.books) return <p className="note">The scripture index isn't available yet.</p>;

  return (
    <div className="scripture-study">
      <p className="note">
        Every conference talk's footnotes and in-text references, read as data. Type a verse (<em>Isaiah 53:5</em>), a passage (<em>2 Nephi 2:25–27</em>), a chapter (<em>Alma 32</em>), a whole book (<em>Moses</em>), or a person (<em>Joseph Smith</em>, <em>Neal A. Maxwell</em>) to see how often it's cited, by whom, and when.
      </p>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <input type="text" className="picker-search-input" placeholder="e.g. Isaiah 53:5 · Alma 32 · Doctrine and Covenants 121 · Moses · Joseph Smith" value={q} onChange={(e) => { setQ(e.target.value); setYearPick(null); }} style={{ width: "100%" }} />
          {suggestions.length > 1 && !/\d/.test(q) && (!parsed || parsed.kind !== "person") && (
            <div className="scrip-suggest">
              {suggestions.map((s) => <button key={s.kind + s.i} className="para-row" onClick={() => { setQ(s.label); setYearPick(null); }}><span className="para-time">{s.kind === "book" ? "book" : "person"}</span><span className="para-text"><strong style={{ color: "var(--cloud)" }}>{s.label}</strong> · {s.sub}</span></button>)}
            </div>
          )}
        </div>
        <select value={tf} onChange={(e) => { setTf(e.target.value); setYearPick(null); }}>
          <option value="all">All years (1971–)</option>
          {(presidencies || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {q && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); setYearPick(null); }}>Clear</button>}
      </div>
      {v2 && (
        <div className="row" style={{ gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 13 }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={inclQuoted} onChange={(e) => setInclQuoted(e.target.checked)} /> count verses quoted in the text without a footnote</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={inclMentions} onChange={(e) => setInclMentions(e.target.checked)} /> count people named in the talk's own words, not just footnotes</label>
        </div>
      )}

      {parsed && parsed.kind === "people" && (
        <div className="topic-chips" style={{ marginTop: 8 }}>
          {parsed.candidates.map(({ i, p }) => <button key={i} className="picker-example-chip" onClick={() => setQ(p)}>{p}</button>)}
        </div>
      )}
      {parsed && parsed.kind === "none" && <p className="note">Nothing matched “{q}”. Try a book name, a reference like <em>Mosiah 2:17</em>, or a speaker's name.</p>}

      {result && (
        <div className="scrip-result">
          <div className="cg-stats" style={{ marginTop: 10 }}>
            <div className="cg-stat"><div className="cg-stat-label">{parsed.kind === "person" ? "Talks quoting" : "Talks citing"}</div><div className="cg-stat-value">{result.matches.length.toLocaleString()}</div><div className="cg-stat-delta">{label} · {timeframe.label}{scoped.length ? ` · ${(100 * result.matches.length / scoped.length).toFixed(1)}% of ${scoped.length.toLocaleString()} talks` : ""}</div></div>
            {parsed.kind === "scripture" && <div className="cg-stat"><div className="cg-stat-label">Mentions</div><div className="cg-stat-value">{result.mentions.toLocaleString()}</div><div className="cg-stat-delta">citations in text and footnotes</div></div>}
            <div className="cg-stat"><div className="cg-stat-label">Span</div><div className="cg-stat-value">{result.first ? `${result.first}–${result.last}` : "—"}</div><div className="cg-stat-delta">{result.peak ? `busiest year ${result.peak} (${result.byYear[result.peak]})` : "no citations in this timeframe"}</div></div>
            <div className="cg-stat"><div className="cg-stat-label">Speakers</div><div className="cg-stat-value">{result.speakers.length}</div><div className="cg-stat-delta">{result.speakers[0] ? `most often ${result.speakers[0].sp} (${result.speakers[0].n})` : "—"}</div></div>
          </div>

          {result.matches.length > 0 && Timeline && (
            <Timeline
              talks={result.matches.map((m) => m.x.t)}
              allByYear={allByYear}
              timeframe={{ from: yearPick ? yearPick * 100 : timeframe.from, to: yearPick ? yearPick * 100 + 12 : timeframe.to }}
              presidencies={presidencies}
              onPickYear={(y) => setYearPick((cur) => (cur === y ? null : y))}
              onPickPresidency={(key) => { setTf(key); setYearPick(null); }}
            />
          )}

          <div className="scrip-grid">
            <div>
              <div className="cg-where-title">{parsed.kind === "person" ? "Who quotes them most" : "Who cites it most"}</div>
              <table className="cg-table"><thead><tr><th>Speaker</th><th>Talks</th><th>Of their talks</th></tr></thead>
                <tbody>{result.speakers.slice(0, 15).map((s) => <tr key={s.sp}><td>{s.sp}</td><td>{s.n}</td><td><span className="note" style={{ margin: 0 }}>{s.of ? Math.round((100 * s.n) / s.of) : 0}% of {s.of}</span></td></tr>)}</tbody>
              </table>
            </div>
            {parsed.kind === "scripture" && result.top.length > 0 && (parsed.v1 == null) && (
              <div>
                <div className="cg-where-title">{parsed.chapter ? "Most-cited verses in this chapter" : "Most-cited passages in this book"}</div>
                <table className="cg-table"><thead><tr><th>Passage</th><th>Talks</th></tr></thead>
                  <tbody>{result.top.slice(0, 15).map((p) => <tr key={p.k}><td><button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px" }} onClick={() => { setQ(p.k); setYearPick(null); }}>{p.k}</button></td><td>{p.n}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <div className="cg-where-title" style={{ margin: 0 }}>{listed.length} talk{listed.length === 1 ? "" : "s"}{yearPick ? ` in ${yearPick}` : ""}</div>
            {yearPick && <button className="btn btn-ghost btn-sm" onClick={() => setYearPick(null)}>Show all years</button>}
            {listed.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => play(listed.map((m) => m.x.t.uri), label)} style={{ marginLeft: "auto" }}>▶ Play these talks, newest first</button>}
          </div>
          <div className="para-list" style={{ maxHeight: 420 }}>
            {listed.slice(0, 300).map((m) => {
              const t = m.x.t;
              const playing = nowPlayingUri === t.uri, loading = loadingUri === t.uri;
              return (
                <div key={t.uri} className={`para-row scrip-row${playing ? " active" : ""}`}>
                  <span className="para-time">{String(t.month) === "10" ? "Oct" : "Apr"} {t.year}</span>
                  <span className="para-text"><strong style={{ color: "var(--cloud)" }}>{t.title}</strong> — {t.speaker}{m.refs.length ? <span className="note" style={{ margin: 0 }}> · {[...new Set(m.refs.map((r) => refLabel(books, r) + (r[4] === 1 ? " (quoted, no footnote)" : "")))].slice(0, 4).join("; ")}{m.refs.length > 4 ? "…" : ""}</span> : null}{m.how ? <span className="note" style={{ margin: 0 }}> · {m.how}</span> : null}</span>
                  <span className="splice-actions">
                    <button className="btn btn-ghost btn-sm" title="Listen" onClick={() => play([t.uri], t.title)}>{playing ? "▶ playing" : "▶"}</button>
                    {chooseTalk && <button className="btn btn-ghost btn-sm" title="Make a song from this talk" onClick={() => chooseTalk(t)} disabled={loading}>{loading ? "…" : "Make song →"}</button>}
                  </span>
                </div>
              );
            })}
            {listed.length > 300 && <p className="note">Showing the newest 300.</p>}
          </div>
        </div>
      )}

      {boards && (
        <div className="scrip-boards">
          <p className="note" style={{ margin: "10px 0 6px" }}>Across {boards.talks.toLocaleString()} talks ({timeframe.label}). Click anything to study it.</p>
          <div className="scrip-grid three">
            <div className="scrip-top25">
              <div className="cg-where-title">Top 25 most-cited scriptures <span className="note" style={{ margin: 0 }}>· talks citing each passage</span></div>
              <div className="scrip-bars">
                {boards.passages.map(([k, n], i) => (
                  <button key={k} className="scrip-bar wide" onClick={() => setQ(k)} title={`${k} — cited in ${n} talks. Click to study it.`}>
                    <span className="scrip-bar-rank">{i + 1}</span>
                    <span className="scrip-bar-label">{k.replace("Doctrine and Covenants", "D&C")}</span>
                    <span className="scrip-bar-track"><span className="scrip-bar-fill" style={{ width: `${Math.round((100 * n) / (boards.passages[0][1] || 1))}%`, background: i < 3 ? "var(--warning)" : i < 10 ? "var(--sky)" : "var(--air)" }} /></span>
                    <span className="scrip-bar-n">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="cg-where-title">Most-cited books</div>
              <div className="scrip-bars">
                {boards.books.map((b) => (
                  <button key={b.i} className="scrip-bar" onClick={() => setQ(books[b.i].name)} title={`${books[b.i].name} — cited in ${b.n} talks`}>
                    <span className="scrip-bar-label">{books[b.i].name}</span>
                    <span className="scrip-bar-track"><span className="scrip-bar-fill" style={{ width: `${Math.round(b.w * 100)}%` }} /></span>
                    <span className="scrip-bar-n">{b.n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="cg-where-title">Most-quoted people</div>
              <table className="cg-table"><thead><tr><th>#</th><th>Person</th><th>Talks</th></tr></thead>
                <tbody>{boards.people.map(([p, n], i) => <tr key={p}><td>{i + 1}</td><td><button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px" }} onClick={() => setQ(people[Number(p)])}>{people[Number(p)]}</button></td><td>{n}</td></tr>)}</tbody>
              </table>
              <p className="note">People = conference speakers and Church Presidents named in a talk's footnotes (or linked by talk), not counting the speaker themselves.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
