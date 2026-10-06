// Insights → Words & phrases: how often a word or phrase is used in General
// Conference, year by year and by speaker — searched across the full text of
// every talk (public/talk-text/d<decade>.json, loaded once per session).

import React, { useEffect, useMemo, useRef, useState } from "react";

const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];
const COLORS = ["#F2C66D", "#8FB4E6", "#7FD1A8", "#E8938A"];
const confNum = (y, m) => Number(y) * 100 + Number(m);
const readUrl = (uri) => `https://www.churchofjesuschrist.org${String(uri || "").replace(/\?.*$/, "")}?lang=eng`;
const textCache = {}; // decade → { [talkIdx]: text }
let loadingAll = null;

async function loadDecade(d) {
  if (textCache[d]) return textCache[d];
  try {
    const r = await fetch(`/talk-text/d${d}.json`);
    const ct = r.headers.get("content-type") || "";
    const j = r.ok && /json/.test(ct) ? await r.json() : null; // a missing chunk comes back as the app's HTML
    textCache[d] = j && typeof j === "object" ? j : {};
  } catch { textCache[d] = {}; }
  return textCache[d];
}

function buildRegex(phrase, forms) {
  const words = phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length || !words[0]) return null;
  const body = words.map((w, i) => (forms && i === words.length - 1 ? `${w}\\w*` : w)).join("[\\s—–-]+");
  return new RegExp(`(?<![A-Za-z0-9'])${body}(?![A-Za-z0-9'])`, "gi");
}

export default function PhraseTrends({ index, presidencies, startUrisQueue, chooseTalk, nowPlayingUri, loadingUri }) {
  const [q, setQ] = useState("");
  const [forms, setForms] = useState(true);
  const [tf, setTf] = useState("all");
  const [loaded, setLoaded] = useState(0); // decades loaded
  const [loadMsg, setLoadMsg] = useState("");
  const [results, setResults] = useState(null);
  const [pickSeries, setPickSeries] = useState(0);
  const [yearPick, setYearPick] = useState(null);
  const [order, setOrder] = useState("newest"); // newest | oldest
  const listRef = useRef(null);
  const timer = useRef(null);

  const timeframe = useMemo(() => {
    if (tf === "all") return { from: 0, to: 999912, label: "all years" };
    const p = (presidencies || []).find((x) => x.key === tf);
    return p ? { from: p.from, to: p.to ?? 999912, label: p.label } : { from: 0, to: 999912, label: "all years" };
  }, [tf, presidencies]);

  async function ensureText() {
    if (loadingAll) return loadingAll;
    loadingAll = (async () => {
      let n = 0;
      for (const d of DECADES) {
        setLoadMsg(`Loading the talks' text… ${n + 1} of ${DECADES.length} (a one-time download of roughly 15 MB)`);
        await loadDecade(d);
        n++; setLoaded(n);
      }
      setLoadMsg("");
    })().catch(() => { loadingAll = null; setLoadMsg("The talk text couldn't be loaded — try again."); });
    return loadingAll;
  }

  const phrases = useMemo(() => q.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4), [q]);

  async function run() {
    if (!phrases.length || !index) { setResults(null); return; }
    await ensureText();
    const talks = index.talks;
    const series = phrases.map((p) => ({ phrase: p, re: buildRegex(p, forms), byYear: {}, bySpeaker: {}, hits: [] }));
    const allByYear = {};
    for (const d of DECADES) {
      const chunk = textCache[d] || {};
      for (const [k, text] of Object.entries(chunk)) {
        const i = Number(k), t = talks[i];
        if (!t) continue;
        const cn = confNum(t.year, t.month);
        if (cn < timeframe.from || cn > timeframe.to) continue;
        allByYear[t.year] = (allByYear[t.year] || 0) + 1;
        for (const s of series) {
          if (!s.re) continue;
          s.re.lastIndex = 0;
          const m = s.re.exec(text);
          if (!m) continue;
          let count = 1;
          while (s.re.exec(text)) count++;
          s.byYear[t.year] = (s.byYear[t.year] || 0) + 1;
          s.bySpeaker[t.speaker || "Unknown"] = (s.bySpeaker[t.speaker || "Unknown"] || 0) + 1;
          const a = Math.max(0, m.index - 70), b = Math.min(text.length, m.index + m[0].length + 70);
          s.hits.push({ i, t, count, snippet: (a > 0 ? "…" : "") + text.slice(a, b).replace(/\n/g, " ") + (b < text.length ? "…" : ""), at: m.index, len: m[0].length });
        }
      }
    }
    const speakerTotals = {};
    for (const t of talks) { const cn = confNum(t.year, t.month); if (cn >= timeframe.from && cn <= timeframe.to) speakerTotals[t.speaker || "Unknown"] = (speakerTotals[t.speaker || "Unknown"] || 0) + 1; }
    for (const s of series) {
      s.hits.sort((x, y) => confNum(y.t.year, y.t.month) - confNum(x.t.year, x.t.month));
      s.first = s.hits.slice(-5).reverse(); // the earliest five, oldest first
      s.firstYear = s.first.length ? Number(s.first[0].t.year) : null;
      s.speakers = Object.entries(s.bySpeaker).map(([sp, n]) => ({ sp, n, of: speakerTotals[sp] || n })).sort((a, b) => b.n - a.n);
      s.mentions = s.hits.reduce((a, h) => a + h.count, 0);
    }
    setResults({ series, allByYear, years: Object.keys(allByYear).map(Number).sort((a, b) => a - b) });
    setPickSeries(0);
    setYearPick(null);
  }

  useEffect(() => {
    clearTimeout(timer.current);
    if (!phrases.length) { setResults(null); return; }
    timer.current = setTimeout(run, 450);
    return () => clearTimeout(timer.current);
  }, [q, forms, tf, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (uris, name) => startUrisQueue && startUrisQueue({ id: `phrase|${name}|${uris.length}`, label: name, uris, order: "newest" });

  // ---- chart: share of talks each year containing each phrase ----
  const chart = useMemo(() => {
    if (!results || !results.years.length) return null;
    const W = 920, H = 240, L = 44, R = 10, T = 12, B = 30;
    const ys = results.years, x = (y) => L + ((y - ys[0]) / Math.max(1, ys[ys.length - 1] - ys[0])) * (W - L - R);
    const share = (s, y) => (results.allByYear[y] ? (100 * (s.byYear[y] || 0)) / results.allByYear[y] : 0);
    const max = Math.max(5, ...results.series.flatMap((s) => ys.map((y) => share(s, y))));
    const yy = (v) => T + (H - T - B) * (1 - v / max);
    return { W, H, L, R, T, B, x, yy, max, share, ys };
  }, [results]);

  const s0 = results ? results.series[Math.min(pickSeries, results.series.length - 1)] : null;
  const listed = s0 ? (order === "oldest" ? s0.hits.slice().reverse() : s0.hits).filter((h) => !yearPick || Number(h.t.year) === yearPick) : [];
  const scrollToList = () => setTimeout(() => { if (listRef.current && listRef.current.scrollIntoView) listRef.current.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50);
  function pickYear(y) { setYearPick((c) => (c === y ? null : y)); scrollToList(); }

  return (
    <div className="phrase-trends">
      <p className="note">
        Search the full text of every talk. Type a word or phrase — <em>ministering</em>, <em>plan of salvation</em>, <em>covenant path</em> — and see how often it's spoken, by year and by speaker. Separate up to four with commas to compare them on one chart.
      </p>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="text" className="picker-search-input" placeholder="e.g. covenant path, plan of happiness" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={forms} onChange={(e) => setForms(e.target.checked)} /> word forms (pray → prayer, praying)</label>
        <select value={tf} onChange={(e) => setTf(e.target.value)}>
          <option value="all">All years (1971–)</option>
          {(presidencies || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {q && <button className="btn btn-ghost btn-sm" onClick={() => setQ("")}>Clear</button>}
      </div>
      {loadMsg && <p className="note" style={{ marginTop: 8 }}>{loadMsg}</p>}

      {results && chart && (
        <div className="scrip-result">
          <div className="cg-stats" style={{ marginTop: 10 }}>
            {results.series.map((s, k) => (
              <button key={s.phrase} className={`cg-stat phrase-stat${k === pickSeries ? " active" : ""}`} onClick={() => { setPickSeries(k); setYearPick(null); }} style={{ borderColor: COLORS[k] }}>
                <div className="cg-stat-label" style={{ color: COLORS[k] }}>“{s.phrase}”</div>
                <div className="cg-stat-value">{s.hits.length.toLocaleString()}</div>
                <div className="cg-stat-delta">talks · {s.mentions.toLocaleString()} mentions · {s.speakers[0] ? `most by ${s.speakers[0].sp} (${s.speakers[0].n})` : "no one"}</div>
              </button>
            ))}
          </div>

          <div className="topic-timeline">
            <div className="topic-timeline-title">Share of talks each year that use it <span className="note" style={{ margin: 0 }}>· {timeframe.label} · <strong>click any year</strong> to list that year's talks below · dots mark years with at least one talk</span></div>
            <div className="topic-timeline-scroll">
              <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="topic-timeline-svg" role="img" aria-label="Phrase use by year">
                {[0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={chart.L} x2={chart.W - chart.R} y1={chart.yy(chart.max * f)} y2={chart.yy(chart.max * f)} className="grid" /><text x={chart.L - 6} y={chart.yy(chart.max * f) + 4} textAnchor="end" className="axis">{Math.round(chart.max * f)}%</text></g>)}
                {results.series.map((s, k) => (
                  <polyline key={s.phrase} fill="none" stroke={COLORS[k]} strokeWidth={k === pickSeries ? 2.5 : 1.5} opacity={k === pickSeries ? 1 : 0.6} points={chart.ys.map((y) => `${chart.x(y)},${chart.yy(chart.share(s, y))}`).join(" ")} />
                ))}
                {s0 && s0.firstYear && (
                  <g>
                    <line x1={chart.x(s0.firstYear)} x2={chart.x(s0.firstYear)} y1={chart.T} y2={chart.H - chart.B} stroke={COLORS[pickSeries]} strokeDasharray="4 3" opacity="0.8" />
                    <text x={chart.x(s0.firstYear) + 5} y={chart.T + 12} className="axis" style={{ fill: COLORS[pickSeries] }}>first heard {s0.firstYear}</text>
                  </g>
                )}
                {chart.ys.map((y) => {
                  const step = chart.ys.length > 1 ? (chart.W - chart.L - chart.R) / (chart.ys.length - 1) : 20;
                  return (
                    <g key={y} className={`phrase-col${yearPick === y ? " picked" : ""}`} onClick={() => pickYear(y)}>
                      <rect x={chart.x(y) - step / 2} y={chart.T} width={step} height={chart.H - chart.T - chart.B} />
                      {s0 && (s0.byYear[y] || 0) > 0 && <circle cx={chart.x(y)} cy={chart.yy(chart.share(s0, y))} r={yearPick === y ? 5 : 3} fill={COLORS[pickSeries]} stroke="#0B1630" strokeWidth="1" />}
                      {yearPick === y && <line x1={chart.x(y)} x2={chart.x(y)} y1={chart.T} y2={chart.H - chart.B} stroke="var(--warning)" strokeDasharray="3 3" />}
                      <title>{`${y}: ${results.series.map((s) => `“${s.phrase}” ${s.byYear[y] || 0} of ${results.allByYear[y]} talks (${chart.share(s, y).toFixed(0)}%)`).join(" · ")} — click to list the talks from ${y}`}</title>
                    </g>
                  );
                })}
                {chart.ys.map((y, i) => (y % 5 === 0 || i === 0 || i === chart.ys.length - 1) && <text key={y} x={chart.x(y)} y={chart.H - 8} textAnchor="middle" className="axis">{y}</text>)}
              </svg>
            </div>
          </div>

          {s0 && (
            <>
              <div className="scrip-grid">
                <div>
                  <div className="cg-where-title">Who says “{s0.phrase}” most</div>
                  <table className="cg-table"><thead><tr><th>Speaker</th><th>Talks</th><th>Of their talks</th></tr></thead>
                    <tbody>{s0.speakers.slice(0, 15).map((s) => <tr key={s.sp}><td>{s.sp}</td><td>{s.n}</td><td><span className="note" style={{ margin: 0 }}>{Math.round((100 * s.n) / s.of)}% of {s.of}</span></td></tr>)}</tbody>
                  </table>
                </div>
                <div>
                  <div className="cg-where-title">By decade</div>
                  <table className="cg-table"><thead><tr><th>Decade</th><th>Talks</th><th>Share</th></tr></thead>
                    <tbody>{DECADES.map((d) => { let n = 0, all = 0; for (const y of chart.ys) if (Math.floor(y / 10) * 10 === d) { n += s0.byYear[y] || 0; all += results.allByYear[y] || 0; } return all ? <tr key={d}><td>{d}s</td><td>{n}</td><td><span className="note" style={{ margin: 0 }}>{(100 * n / all).toFixed(1)}% of {all}</span></td></tr> : null; })}</tbody>
                  </table>
                </div>
              </div>
              {s0.first.length > 0 && (
                <div className="music-card" style={{ margin: "12px 0 0", borderColor: COLORS[pickSeries] }}>
                  <div className="cg-where-title" style={{ marginBottom: 4 }}>Where “{s0.phrase}” was first heard</div>
                  <div className="para-list" style={{ maxHeight: 240 }}>
                    {s0.first.map((h) => (
                      <div key={h.t.uri} className="para-row scrip-row">
                        <span className="para-time">{String(h.t.month) === "10" ? "Oct" : "Apr"} {h.t.year}</span>
                        <span className="para-text"><strong style={{ color: "var(--cloud)" }}>{h.t.title}</strong> — {h.t.speaker}<br /><span className="phrase-snippet">{h.snippet}</span></span>
                        <span className="splice-actions">
                          <button className="btn btn-ghost btn-sm" title="Listen" onClick={() => play([h.t.uri], h.t.title)}>▶</button>
                          <a className="btn btn-ghost btn-sm" href={readUrl(h.t.uri)} target="_blank" rel="noopener noreferrer" title="Open the talk on churchofjesuschrist.org in a new tab">Read ↗</a>
                          {chooseTalk && <button className="btn btn-ghost btn-sm" onClick={() => chooseTalk(h.t)}>Make song →</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => play(s0.first.map((h) => h.t.uri), `${s0.phrase} · first uses`)}>▶ Play these earliest talks in order</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setOrder("oldest"); setYearPick(null); scrollToList(); }}>Trace it forward from the first use ↓</button>
                  </div>
                </div>
              )}
              <div ref={listRef} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
                <div className="cg-where-title" style={{ margin: 0 }}>{listed.length} talk{listed.length === 1 ? "" : "s"}{yearPick ? ` in ${yearPick}` : ""} with “{s0.phrase}”</div>
                {yearPick && <button className="btn btn-ghost btn-sm" onClick={() => setYearPick(null)}>All years</button>}
                <select value={order} onChange={(e) => setOrder(e.target.value)} title="Order of the list">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
                {listed.length > 0 && <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => play(listed.map((h) => h.t.uri), s0.phrase)}>▶ Play these talks, {order === "oldest" ? "oldest" : "newest"} first</button>}
              </div>
              <div className="para-list" style={{ maxHeight: 460 }}>
                {listed.slice(0, 300).map((h) => (
                  <div key={h.t.uri} className={`para-row scrip-row${nowPlayingUri === h.t.uri ? " active" : ""}`}>
                    <span className="para-time">{String(h.t.month) === "10" ? "Oct" : "Apr"} {h.t.year}</span>
                    <span className="para-text"><strong style={{ color: "var(--cloud)" }}>{h.t.title}</strong> — {h.t.speaker}{h.count > 1 ? <span className="note" style={{ margin: 0 }}> · {h.count}×</span> : null}<br /><span className="phrase-snippet">{h.snippet}</span></span>
                    <span className="splice-actions">
                      <button className="btn btn-ghost btn-sm" title="Listen" onClick={() => play([h.t.uri], h.t.title)}>▶</button>
                      <a className="btn btn-ghost btn-sm" href={readUrl(h.t.uri)} target="_blank" rel="noopener noreferrer" title="Open the talk on churchofjesuschrist.org in a new tab">Read ↗</a>
                      {chooseTalk && <button className="btn btn-ghost btn-sm" onClick={() => chooseTalk(h.t)} disabled={loadingUri === h.t.uri}>Make song →</button>}
                    </span>
                  </div>
                ))}
                {listed.length > 300 && <p className="note">Showing the newest 300.</p>}
              </div>
            </>
          )}
        </div>
      )}
      {results && !results.years.length && <p className="note">No talk text in that timeframe.</p>}
    </div>
  );
}
