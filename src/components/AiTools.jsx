// src/components/AiTools.jsx
//
// The AI-powered modes of the Choose-a-Talk step:
//
//   <AiSearchMode>  — free-text topic search ("exaltation") over the full
//     archive: a local full-text index (public/search-index.json) finds
//     keyword candidates, Claude expands the query with related vocabulary
//     and re-ranks the candidates by true relevance. Degrades gracefully to
//     plain keyword ranking when AI is unavailable.
//
//   <InsightsMode>  — analyses built from per-talk study notes (cached
//     server-side forever, so each talk is only ever summarized once):
//       • Speaker journey: how a speaker's teaching progressed first→last.
//       • Era focus: what the Apostles (or all speakers) emphasized during
//         a presidency or custom year range.
//     The browser orchestrates: check note cache → fetch missing talk texts
//     → summarize one by one (with progress + cancel) → stream the essay.
//
// Both integrate with the shared player via props from ConferencePicker.

import React, { useMemo, useRef, useState } from "react";
import { tokenize } from "../lib/search-text.js";

const monthName = (m) => (String(m) === "10" ? "October" : "April");
const officialUrl = (uri) => `https://www.churchofjesuschrist.org${uri}?lang=eng`;
const confNum = (year, month) => Number(year) * 100 + Number(month);

// ---------------------------------------------------------------------------
// First Presidency & Quorum of the Twelve roster (year called as apostle →
// year their service ended), for the "Apostles only" era filter. Names match
// the talks-index speaker strings exactly. Current through early 2026.
// ---------------------------------------------------------------------------
export const APOSTLES = [
  ["Joseph Fielding Smith", 1910, 1972], ["Harold B. Lee", 1941, 1973],
  ["Spencer W. Kimball", 1943, 1985], ["Ezra Taft Benson", 1943, 1994],
  ["Mark E. Petersen", 1944, 1984], ["Delbert L. Stapley", 1950, 1978],
  ["Marion G. Romney", 1951, 1988], ["LeGrand Richards", 1952, 1983],
  ["Richard L. Evans", 1953, 1971], ["Hugh B. Brown", 1958, 1975],
  ["Howard W. Hunter", 1959, 1995], ["Gordon B. Hinckley", 1961, 2008],
  ["N. Eldon Tanner", 1962, 1982], ["Thomas S. Monson", 1963, 2018],
  ["Alvin R. Dyer", 1967, 1977], ["Boyd K. Packer", 1970, 2015],
  ["Marvin J. Ashton", 1971, 1994], ["Bruce R. McConkie", 1972, 1985],
  ["L. Tom Perry", 1974, 2015], ["David B. Haight", 1976, 2004],
  ["James E. Faust", 1978, 2007], ["Neal A. Maxwell", 1981, 2004],
  ["Russell M. Nelson", 1984, 9999], ["Dallin H. Oaks", 1984, 9999],
  ["M. Russell Ballard", 1985, 2023], ["Joseph B. Wirthlin", 1986, 2008],
  ["Richard G. Scott", 1988, 2015], ["Robert D. Hales", 1994, 2017],
  ["Jeffrey R. Holland", 1994, 9999], ["Henry B. Eyring", 1995, 9999],
  ["David A. Bednar", 2004, 9999], ["Dieter F. Uchtdorf", 2004, 9999],
  ["Quentin L. Cook", 2007, 9999], ["D. Todd Christofferson", 2008, 9999],
  ["Neil L. Andersen", 2009, 9999], ["Ronald A. Rasband", 2015, 9999],
  ["Gary E. Stevenson", 2015, 9999], ["Dale G. Renlund", 2015, 9999],
  ["Gerrit W. Gong", 2018, 9999], ["Ulisses Soares", 2018, 9999],
  ["Patrick Kearon", 2023, 9999],
];
const APOSTLE_MAP = new Map(APOSTLES.map(([n, f, t]) => [n, [f, t]]));

// Rough per-talk cost of generating a study note (input + output at
// claude-opus-5 rates) — shown before the user commits to an analysis.
const NOTE_COST = 0.02;

// When the essay hits the model's output ceiling, the server ends the stream
// with this marker and the browser immediately requests a continuation.
const CONTINUE_SENTINEL = "@@CONTINUE@@";
const CONSTRUCTION_SAMPLE = 12; // most-recent talks read in full

// Strip keep-alive pulses (zero-width spaces) and leading blank space.
const cleanEssay = (s) => s.replace(/​/g, "").replace(/^\s+/, "");

// ---------------------------------------------------------------------------
// Export: turn a finished analysis into a print-ready HTML document (for
// "Save as PDF") or a Word-openable .doc, with citations as real links.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineHtml(text, items) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[(\d+)\]/g, (m, n) => {
    const t = items[parseInt(n, 10) - 1];
    if (!t) return m;
    return `<sup><a href="${officialUrl(t.uri)}">[${n}]</a></sup>`;
  });
  return s;
}

export function buildExportHtml(label, essay, items) {
  const blocks = [];
  let inList = false;
  const closeList = () => { if (inList) { blocks.push("</ul>"); inList = false; } };
  for (const raw of String(essay).split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    if (line.startsWith("#")) {
      closeList();
      blocks.push(`<h2>${inlineHtml(line.replace(/^#+\s*/, ""), items)}</h2>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) { blocks.push("<ul>"); inList = true; }
      blocks.push(`<li>${inlineHtml(line.replace(/^[-*]\s+/, ""), items)}</li>`);
    } else {
      closeList();
      blocks.push(`<p>${inlineHtml(line, items)}</p>`);
    }
  }
  closeList();

  const cited = items
    .map(
      (t, i) =>
        `<li value="${i + 1}"><a href="${officialUrl(t.uri)}">${escapeHtml(t.title)}</a> — ${escapeHtml(t.speaker)}, ${escapeHtml(t.when)}</li>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(label)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; background: #fff;
         max-width: 7.5in; margin: 0 auto; padding: 24px; line-height: 1.6; font-size: 12pt; }
  h1 { font-size: 20pt; margin: 0 0 2px; }
  .meta { color: #666; font-size: 10pt; margin: 0 0 18px; }
  h2 { font-size: 14pt; margin: 20px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  p { margin: 0 0 10px; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
  sup a { text-decoration: none; color: #8a6d1d; font-weight: bold; }
  a { color: #1a4a8a; }
  .cited li { margin-bottom: 4px; font-size: 10.5pt; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(label)}</h1>
<p class="meta">Generated by Conference as a Concert · ${new Date().toLocaleDateString()} · ${items.length} talks analyzed</p>
${blocks.join("\n")}
<h2>Talks cited</h2>
<ol class="cited">
${cited}
</ol>
</body>
</html>`;
}

export function safeFilename(label) {
  return (String(label).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "analysis");
}

// Opens a print-ready view; the browser's print dialog offers "Save as PDF".
function exportPdf(label, essay, items) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(buildExportHtml(label, essay, items));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 400);
}

// Downloads an HTML-based .doc that Word (and Google Docs) opens cleanly.
function exportDoc(label, essay, items) {
  const blob = new Blob(["﻿" + buildExportHtml(label, essay, items)], {
    type: "application/msword",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(label)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Run `worker(item)` over items with limited concurrency; honors an
// AbortController and reports progress.
async function pool(items, limit, worker, onProgress, signal) {
  let next = 0, done = 0, failed = 0;
  async function lane() {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next++;
      try {
        await worker(items[i]);
      } catch {
        failed++;
      }
      done++;
      onProgress?.(done, failed);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return { done, failed };
}

async function postJson(url, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// Tiny markdown renderer for the streamed essays: ## headings, - bullets,
// **bold**, and [n] citation chips. citations[n-1] is the cited talk.
// ---------------------------------------------------------------------------
function Inline({ text, citations, onCite }) {
  const parts = String(text).split(/(\[\d+\]|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const cite = p.match(/^\[(\d+)\]$/);
        if (cite) {
          const t = citations[parseInt(cite[1], 10) - 1];
          if (!t) return p;
          return (
            <button
              key={i}
              className="cite-chip"
              title={`${t.title} — ${t.speaker}, ${t.when}. Click to listen.`}
              onClick={() => onCite(t)}
            >
              {cite[1]}
            </button>
          );
        }
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return p;
      })}
    </>
  );
}

export function Essay({ md, citations, onCite }) {
  const blocks = [];
  let list = null;
  for (const raw of String(md).split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { list = null; continue; }
    if (line.startsWith("#")) {
      list = null;
      blocks.push({ h: line.replace(/^#+\s*/, "") });
    } else if (/^[-*]\s+/.test(line)) {
      if (!list) { list = { items: [] }; blocks.push(list); }
      list.items.push(line.replace(/^[-*]\s+/, ""));
    } else {
      list = null;
      blocks.push({ p: line });
    }
  }
  return (
    <div className="essay">
      {blocks.map((b, i) =>
        b.h ? (
          <h3 key={i} className="essay-h"><Inline text={b.h} citations={citations} onCite={onCite} /></h3>
        ) : b.items ? (
          <ul key={i} className="essay-ul">
            {b.items.map((it, j) => (
              <li key={j}><Inline text={it} citations={citations} onCite={onCite} /></li>
            ))}
          </ul>
        ) : (
          <p key={i} className="essay-p"><Inline text={b.p} citations={citations} onCite={onCite} /></p>
        )
      )}
    </div>
  );
}

// Shared result row (matches the picker's row styling).
function TalkRow({ t, subtitle, note, nowPlayingUri, onListen, onMakeSong, makeLoading }) {
  return (
    <div className="picker-talk static">
      <span className="picker-talk-speaker">{subtitle}</span>
      <span className="picker-talk-title">
        {t.title}
        {note ? <span className="ai-why"> — {note}</span> : null}
      </span>
      <span className="picker-talk-actions">
        <button className="picker-talk-listen" title="Listen from this talk onward" onClick={onListen}>
          {nowPlayingUri === t.uri ? "♪ Playing" : "▶ Listen"}
        </button>
        <a className="picker-talk-read" href={officialUrl(t.uri)} target="_blank" rel="noopener noreferrer">
          Read ↗
        </a>
        <button className="picker-talk-make" onClick={onMakeSong} disabled={makeLoading}>
          {makeLoading ? "Loading…" : "Make song →"}
        </button>
      </span>
    </div>
  );
}

// ===========================================================================
// AI SEARCH MODE
// ===========================================================================
export function AiSearchMode({ index, startUrisQueue, listenButtons, nowPlayingUri, chooseTalk, loadingUri }) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | working | done | error
  const [statusMsg, setStatusMsg] = useState("");
  const [results, setResults] = useState([]); // [{talk, why, kw}]
  const [note, setNote] = useState("");
  const searchIdxRef = useRef(null);

  async function loadSearchIndex() {
    if (searchIdxRef.current) return searchIdxRef.current;
    setStatusMsg("Loading the talk-text index…");
    const res = await fetch("/search-index.json");
    let data = null;
    try {
      // A missing file comes back as the SPA's index.html (status 200), so
      // "did it parse as JSON with the right shape" is the real check.
      data = await res.json();
    } catch {}
    if (!res.ok || !data || !data.terms) {
      throw new Error("The talk-text search index isn't on this site yet — it needs to be built and uploaded (scripts/build-search-index.js).");
    }
    searchIdxRef.current = data;
    return data;
  }

  async function run() {
    const q = query.trim();
    if (q.length < 2 || phase === "working") return;
    setPhase("working");
    setResults([]);
    setNote("");
    try {
      const sIdx = await loadSearchIndex();
      if (!index || sIdx.talkCount !== index.talks.length) {
        // Index files out of step — still usable, positions may be off at the tail.
      }
      setStatusMsg("Asking AI for related vocabulary…");
      let terms = [q];
      let aiDown = false;
      try {
        const exp = await postJson("/.netlify/functions/ai-search", { action: "expand", query: q });
        terms = exp.terms || [q];
        if (exp.fallback) aiDown = true;
      } catch {
        aiDown = true;
      }

      // Keyword scoring over the local index. Original-query tokens count
      // triple so expansions refine rather than dominate.
      setStatusMsg("Scanning 4,000+ talks…");
      const qTokens = new Set(tokenize(q));
      const weights = new Map();
      for (const term of terms) {
        for (const tok of tokenize(term)) {
          const w = qTokens.has(tok) ? 3 : 1;
          weights.set(tok, Math.max(weights.get(tok) || 0, w));
        }
      }
      const scores = new Map();
      for (const [tok, mult] of weights) {
        const postings = sIdx.terms[tok];
        if (!postings) continue;
        for (const [i, w] of postings) scores.set(i, (scores.get(i) || 0) + w * mult);
      }
      const candidates = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([i, kw]) => ({ i, kw, talk: index.talks[i] }))
        .filter((c) => c.talk);

      if (!candidates.length) {
        setPhase("done");
        setStatusMsg("");
        setNote(`No talks matched “${q}”. Try different wording.`);
        return;
      }

      // AI re-rank by real relevance.
      let ordered = candidates;
      let whys = new Map();
      if (!aiDown) {
        setStatusMsg(`AI is ranking ${candidates.length} candidate talks…`);
        try {
          // The ranking arrives as a streamed JSON string (kept streaming so
          // the server never hits its time limit); fallback errors arrive as
          // regular JSON. Distinguish by content type.
          const res = await fetch("/.netlify/functions/ai-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "rerank",
              query: q,
              candidates: candidates.map((c) => ({
                i: c.i,
                title: c.talk.title,
                speaker: c.talk.speaker,
                when: `${monthName(c.talk.month)} ${c.talk.year}`,
              })),
            }),
          });
          let rr;
          if ((res.headers.get("content-type") || "").includes("application/json")) {
            rr = await res.json();
            if (!res.ok) throw new Error(rr.error || `Ranking failed (${res.status})`);
          } else {
            rr = JSON.parse(await res.text());
          }
          if (rr.fallback) {
            aiDown = true;
          } else {
            const byI = new Map(candidates.map((c) => [c.i, c]));
            const seen = new Set();
            const picked = [];
            for (const r of rr.ranked || []) {
              const c = byI.get(r.i);
              if (!c || seen.has(r.i)) continue;
              seen.add(r.i);
              if (r.score >= 4) {
                picked.push(c);
                whys.set(r.i, r.why || "");
              }
            }
            for (const c of candidates) if (!seen.has(c.i) && picked.length < 25) {} // dropped low-scorers stay dropped
            if (picked.length) ordered = picked;
          }
        } catch {
          aiDown = true;
        }
      }
      if (aiDown) setNote("AI ranking unavailable right now — showing keyword ranking instead.");

      setResults(ordered.map((c) => ({ talk: c.talk, why: whys.get(c.i) || "" })));
      setPhase("done");
      setStatusMsg("");
    } catch (e) {
      setPhase("error");
      setStatusMsg("");
      setNote(e.message || "Search failed.");
    }
  }

  const resultUris = useMemo(() => results.map((r) => r.talk.uri), [results]);
  const qKey = query.trim().toLowerCase();

  return (
    <div className="picker-ai">
      <p className="note">
        Search the full text of every conference talk for any topic — not just
        the official topic list. AI expands your search and ranks the results
        by how directly each talk addresses it.
      </p>

      <div className="ai-search-row">
        <input
          type="text"
          className="picker-search-input"
          placeholder="e.g. exaltation, becoming like God, enduring trials…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        />
        <button className="btn btn-primary" onClick={run} disabled={phase === "working" || query.trim().length < 2}>
          {phase === "working" ? "Searching…" : "✨ Search"}
        </button>
      </div>

      {statusMsg && <p className="note" style={{ fontStyle: "italic" }}>{statusMsg}</p>}
      {note && <p className="note">{note}</p>}

      {results.length > 0 && (
        <>
          <div className="picker-group-head">
            <span className="picker-result-count" style={{ margin: 0 }}>
              {results.length} talk{results.length === 1 ? "" : "s"} on “{query.trim()}”
            </span>
            {listenButtons(
              (order) => `ai|${qKey}|${order}`,
              (order) => startUrisQueue({
                id: `ai|${qKey}|${order}`,
                label: `“${query.trim()}” · AI search`,
                uris: resultUris,
                order,
              })
            )}
          </div>
          <div className="picker-talks">
            {results.map(({ talk, why }) => (
              <TalkRow
                key={talk.uri}
                t={talk}
                subtitle={`${talk.speaker} · ${monthName(talk.month)} ${talk.year}`}
                note={why}
                nowPlayingUri={nowPlayingUri}
                onListen={() =>
                  startUrisQueue({
                    id: `ai|${qKey}|ranked`,
                    label: `“${query.trim()}” · AI search`,
                    uris: resultUris,
                    order: "ranked",
                    startUri: talk.uri,
                  })
                }
                onMakeSong={() => chooseTalk(talk)}
                makeLoading={loadingUri === talk.uri}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved analyses live in localStorage so a finished essay survives reloads
// without re-running (and re-paying for) the analysis.
// ---------------------------------------------------------------------------
const ANALYSES_KEY = "cac-analyses";
function loadMyAnalyses() {
  try {
    const a = JSON.parse(localStorage.getItem(ANALYSES_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function persistMyAnalyses(list) {
  try { localStorage.setItem(ANALYSES_KEY, JSON.stringify(list.slice(0, 30))); } catch {}
}

// ===========================================================================
// INSIGHTS MODE (speaker journey + era focus)
// ===========================================================================
// ---- Topic timeline: talks per year for one topic, April/October stacked ----
// `talks` = the topic's talks (already scope-filtered, all years);
// `allByYear` = every conference talk per year, for the share line.
function TopicTimeline({ talks, allByYear, timeframe, presidencies, onPickYear, onPickPresidency }) {
  const years = useMemo(() => {
    const ys = Object.keys(allByYear).map(Number);
    const min = Math.min(...ys), max = Math.max(...ys);
    const out = [];
    for (let y = min; y <= max; y++) out.push(y);
    return out;
  }, [allByYear]);
  const byYear = useMemo(() => {
    const m = new Map();
    for (const t of talks) {
      const y = Number(t.year);
      const cur = m.get(y) || { apr: 0, oct: 0 };
      if (String(t.month) === "10") cur.oct++; else cur.apr++;
      m.set(y, cur);
    }
    return m;
  }, [talks]);
  if (!years.length || !talks.length) return null;

  const W = 920, H = 230, L = 36, R = 10, T = 14, B = 46;
  const plotW = W - L - R, plotH = H - T - B;
  const bw = plotW / years.length;
  const maxCount = Math.max(1, ...years.map((y) => { const c = byYear.get(y); return c ? c.apr + c.oct : 0; }));
  const yScale = (n) => plotH - (n / maxCount) * plotH;
  const inRange = (y) => y * 100 + 4 >= timeframe.from && y * 100 + 4 <= timeframe.to || y * 100 + 10 >= timeframe.from && y * 100 + 10 <= timeframe.to;
  const total = talks.length;
  const peak = years.reduce((best, y) => { const c = byYear.get(y); const n = c ? c.apr + c.oct : 0; return n > best.n ? { y, n } : best; }, { y: null, n: 0 });
  const decade = (y) => y % 10 === 0;

  // share line: topic talks ÷ all talks that year
  const sharePts = years.map((y, i) => {
    const c = byYear.get(y); const n = c ? c.apr + c.oct : 0;
    const all = allByYear[y] || 0;
    const s = all ? n / all : 0;
    return [L + i * bw + bw / 2, T + plotH - s * plotH * 4]; // 25% share = full height
  });
  const maxShare = Math.max(0, ...years.map((y) => { const c = byYear.get(y); const n = c ? c.apr + c.oct : 0; const all = allByYear[y] || 0; return all ? n / all : 0; }));

  return (
    <div className="topic-timeline">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div className="topic-timeline-title">Talks on this topic by year <span className="note" style={{ margin: 0 }}>· {total} talks · peak {peak.y} ({peak.n})</span></div>
        <div className="topic-timeline-legend">
          <span><i className="sw apr" /> April</span>
          <span><i className="sw oct" /> October</span>
          <span><i className="sw share" /> share of that year's talks (max {Math.round(maxShare * 100)}%)</span>
        </div>
      </div>
      <div className="topic-timeline-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="topic-timeline-svg" role="img" aria-label="Talks on this topic per year">
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={T + yScale(maxCount * f)} y2={T + yScale(maxCount * f)} className="grid" />
            <text x={L - 6} y={T + yScale(maxCount * f) + 4} className="axis" textAnchor="end">{Math.round(maxCount * f)}</text>
          </g>
        ))}
        {/* presidency bands */}
        {(presidencies || []).map((p) => {
          const y0 = Math.floor(p.from / 100), y1 = p.to ? Math.floor(p.to / 100) : years[years.length - 1];
          const i0 = years.indexOf(y0), i1 = years.indexOf(y1);
          if (i0 < 0) return null;
          const x0 = L + i0 * bw, x1 = L + ((i1 < 0 ? years.length - 1 : i1) + 1) * bw;
          const name = p.label.replace(/^Pres\. /, "").replace(/\s*\(.*\)$/, "").split(" ").slice(-1)[0];
          return (
            <g key={p.key} className="pres-band" onClick={() => onPickPresidency && onPickPresidency(p.key)}>
              <rect x={x0} y={H - B + 18} width={Math.max(0, x1 - x0 - 1)} height={14} rx={3} />
              {x1 - x0 > 44 && <text x={(x0 + x1) / 2} y={H - B + 28} textAnchor="middle" className="pres-label">{name}</text>}
              <title>{p.label} — click to study this presidency</title>
            </g>
          );
        })}
        {/* bars */}
        {years.map((y, i) => {
          const c = byYear.get(y) || { apr: 0, oct: 0 };
          const n = c.apr + c.oct;
          const x = L + i * bw + 1;
          const w = Math.max(1, bw - 2);
          const dim = !inRange(y);
          return (
            <g key={y} className={`bar${dim ? " dim" : ""}`} onClick={() => onPickYear && onPickYear(y)}>
              <rect x={x} y={T} width={w} height={plotH} className="hit" />
              {c.apr > 0 && <rect x={x} y={T + yScale(c.apr)} width={w} height={plotH - yScale(c.apr)} className="apr" />}
              {c.oct > 0 && <rect x={x} y={T + yScale(n)} width={w} height={yScale(c.apr) - yScale(n)} className="oct" />}
              <title>{`${y}: ${n} talk${n === 1 ? "" : "s"} (${c.apr} April, ${c.oct} October)${allByYear[y] ? ` · ${Math.round((n / allByYear[y]) * 100)}% of that year's ${allByYear[y]} talks` : ""} — click to study ${y}`}</title>
            </g>
          );
        })}
        {/* share line */}
        <polyline className="share" points={sharePts.map(([x, y]) => `${x},${Math.max(T, y)}`).join(" ")} />
        {/* year axis */}
        {years.map((y, i) => (decade(y) || i === 0 || i === years.length - 1) && (
          <text key={y} x={L + i * bw + bw / 2} y={H - B + 12} textAnchor="middle" className="axis">{y}</text>
        ))}
      </svg>
      </div>
      <p className="note" style={{ marginTop: 4 }}>
        Bars count talks the Church files under this topic. The line shows the topic's share of all talks that year (how much of
        conference it occupied, which evens out the longer conferences of earlier decades). Dimmed bars fall outside your timeframe —
        click a bar to study that year, or a presidency band to study that presidency.
      </p>
    </div>
  );
}

// Topic names arrive all-lowercase from the source page; capitalize like the picker does.
function prettyTopic(name) {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function InsightsMode({ index, presidencies, startUrisQueue, nowPlayingUri, chooseTalk, loadingUri, sharedId }) {
  const [tab, setTab] = useState("speaker"); // speaker | construction | era | topic
  const [speakerQuery, setSpeakerQuery] = useState("");
  const [speaker, setSpeaker] = useState(null);
  const [tfKey, setTfKey] = useState("hinckley");
  const [tfFrom, setTfFrom] = useState("1990");
  const [tfTo, setTfTo] = useState("1994");
  const [scope, setScope] = useState("apostles"); // apostles | all

  // ---- topic insights: the Church's curated topic pages (public/topics-index.json) ----
  const [topicsIdx, setTopicsIdx] = useState(null);
  const [topicQuery, setTopicQuery] = useState("");
  const [topicSlug, setTopicSlug] = useState(null);
  const [topicTf, setTopicTf] = useState("all"); // all | presidency key | custom
  const [topicScope, setTopicScope] = useState("all"); // all | apostles
  React.useEffect(() => {
    if (tab !== "topic" || topicsIdx) return;
    fetch("/topics-index.json")
      .then((r) => r.json())
      .then((data) => {
        const topics = (data.topics || []).map((t) => ({ ...t, name: prettyTopic(t.name) })).sort((a, b) => a.name.localeCompare(b.name));
        setTopicsIdx({ ...data, topics });
      })
      .catch(() => setTopicsIdx({ topics: [] }));
  }, [tab, topicsIdx]);
  const topicMatches = useMemo(() => {
    if (!topicsIdx) return [];
    const q = topicQuery.trim().toLowerCase();
    const list = q ? topicsIdx.topics.filter((t) => t.name.toLowerCase().includes(q)) : topicsIdx.topics;
    return list.slice(0, 40);
  }, [topicsIdx, topicQuery]);
  const selectedTopic = useMemo(() => (topicsIdx && topicSlug ? topicsIdx.topics.find((t) => t.slug === topicSlug) : null), [topicsIdx, topicSlug]);
  // The topic's talks across ALL years (scope-filtered) for the timeline, and
  // every conference talk per year for the share line.
  const topicAllTalks = useMemo(() => {
    if (!index || !selectedTopic) return [];
    const out = [];
    for (const i of selectedTopic.t || []) {
      const t = index.talks[i];
      if (!t) continue;
      if (topicScope === "apostles") {
        const tenure = APOSTLE_MAP.get(t.speaker);
        if (!tenure) continue;
        const y = Number(t.year);
        if (y < tenure[0] || y > tenure[1]) continue;
      }
      out.push(t);
    }
    return out;
  }, [index, selectedTopic, topicScope]);
  const allByYear = useMemo(() => {
    const m = {};
    if (!index) return m;
    for (const t of index.talks) {
      if (topicScope === "apostles") {
        const tenure = APOSTLE_MAP.get(t.speaker);
        if (!tenure) continue;
        const y = Number(t.year);
        if (y < tenure[0] || y > tenure[1]) continue;
      }
      m[Number(t.year)] = (m[Number(t.year)] || 0) + 1;
    }
    return m;
  }, [index, topicScope]);

  const [phase, setPhase] = useState("idle"); // idle | notes | writing | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0, cached: 0, failed: 0 });
  const [essay, setEssay] = useState("");
  const [items, setItems] = useState([]); // analyzed talks, chronological
  const [errMsg, setErrMsg] = useState("");
  const abortRef = useRef(null);

  // Viewing a saved or shared analysis instead of a freshly generated one.
  const [loaded, setLoaded] = useState(null); // {kind,label,essay,items,sharedId?}
  const [myAnalyses, setMyAnalyses] = useState(loadMyAnalyses);
  const [shareState, setShareState] = useState("idle"); // idle | working | copied | error
  const [shareUrl, setShareUrl] = useState("");

  function openSaved(rec) {
    setLoaded(rec);
    setEssay(rec.essay);
    setItems(rec.items);
    setPhase("done");
    setErrMsg("");
    setShareState("idle");
    setShareUrl(rec.sharedId ? `${window.location.origin}/?analysis=${rec.sharedId}` : "");
  }

  function deleteSaved(localId) {
    const next = myAnalyses.filter((a) => a.localId !== localId);
    setMyAnalyses(next);
    persistMyAnalyses(next);
  }

  // A shared link (/?analysis=abc) — load and display it.
  React.useEffect(() => {
    if (!sharedId) return;
    (async () => {
      try {
        const d = await postJson("/.netlify/functions/analysis", { action: "get", id: sharedId });
        openSaved({ ...d.analysis, sharedId });
      } catch (e) {
        setErrMsg(e.message || "Couldn't load that shared analysis.");
      }
    })();
  }, [sharedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function shareAnalysis() {
    if (!essay || shareState === "working") return;
    // Already published (reopened or shared view) — just copy the link again.
    let url = shareUrl;
    if (!url) {
      setShareState("working");
      try {
        const d = await postJson("/.netlify/functions/analysis", {
          action: "save",
          analysis: {
            kind: loaded ? loaded.kind : tab,
            label: loaded ? loaded.label : analysisLabel,
            essay,
            items: items.map((t) => ({ uri: t.uri, title: t.title, speaker: t.speaker, when: t.when })),
          },
        });
        url = `${window.location.origin}/?analysis=${d.id}`;
        setShareUrl(url);
        // Remember the share id on the local copy so re-sharing reuses it.
        if (loaded && loaded.localId) {
          const next = myAnalyses.map((a) => (a.localId === loaded.localId ? { ...a, sharedId: d.id } : a));
          setMyAnalyses(next);
          persistMyAnalyses(next);
        }
      } catch (e) {
        setShareState("error");
        setErrMsg(e.message || "Couldn't publish the analysis.");
        return;
      }
    }
    try { await navigator.clipboard.writeText(url); } catch {}
    setShareState("copied");
    setTimeout(() => setShareState("idle"), 4000);
  }

  const speakerMatches = useMemo(() => {
    if (!index) return [];
    const q = speakerQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const names = new Map();
    for (const t of index.talks) {
      if (t.speaker.toLowerCase().includes(q)) names.set(t.speaker, (names.get(t.speaker) || 0) + 1);
    }
    return [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [index, speakerQuery]);

  const timeframe = useMemo(() => {
    // The topic tab keeps its own timeframe choice (defaulting to all years).
    const key = tab === "topic" ? topicTf : tfKey;
    if (key === "all") return { from: 0, to: 999912, label: "all years" };
    if (key === "custom") {
      const f = parseInt(tfFrom, 10), t = parseInt(tfTo, 10);
      return {
        from: Number.isFinite(f) ? f * 100 : 0,
        to: Number.isFinite(t) ? t * 100 + 12 : 999912,
        label: `${tfFrom}–${tfTo}`,
      };
    }
    const p = (presidencies || []).find((x) => x.key === key);
    if (!p) return { from: 0, to: 999912, label: "all years" };
    return { from: p.from, to: p.to ?? 999912, label: p.label };
  }, [tab, tfKey, topicTf, tfFrom, tfTo, presidencies]);

  // The talk set the analysis would run over (chronological, oldest first).
  const targetTalks = useMemo(() => {
    if (!index) return [];
    let talks;
    if (tab === "speaker" || tab === "construction") {
      if (!speaker) return [];
      talks = index.talks.filter((t) => t.speaker === speaker);
    } else if (tab === "topic") {
      if (!selectedTopic) return [];
      talks = [];
      for (const i of selectedTopic.t || []) {
        const t = index.talks[i];
        if (!t) continue;
        const n = confNum(t.year, t.month);
        if (n < timeframe.from || n > timeframe.to) continue;
        if (topicScope === "apostles") {
          const tenure = APOSTLE_MAP.get(t.speaker);
          if (!tenure) continue;
          const y = Number(t.year);
          if (y < tenure[0] || y > tenure[1]) continue;
        }
        talks.push(t);
      }
    } else {
      talks = index.talks.filter((t) => {
        const n = confNum(t.year, t.month);
        if (n < timeframe.from || n > timeframe.to) return false;
        if (scope === "apostles") {
          const tenure = APOSTLE_MAP.get(t.speaker);
          if (!tenure) return false;
          const y = Number(t.year);
          if (y < tenure[0] || y > tenure[1]) return false;
        }
        return true;
      });
    }
    return [...talks].sort((a, b) => confNum(a.year, a.month) - confNum(b.year, b.month));
  }, [index, tab, speaker, timeframe, scope, selectedTopic, topicScope]);

  // Construction studies a manageable sample: the most recent talks, in full.
  const constructionSample = useMemo(
    () => (tab === "construction" ? targetTalks.slice(-CONSTRUCTION_SAMPLE) : []),
    [tab, targetTalks]
  );

  const analysisLabel =
    tab === "speaker"
      ? speaker || ""
      : tab === "construction"
      ? (speaker ? `${speaker} · talk construction` : "")
      : tab === "topic"
      ? (selectedTopic ? `${selectedTopic.name}${timeframe.label === "all years" ? "" : ` · ${timeframe.label}`}${topicScope === "apostles" ? " · the Apostles" : ""}` : "")
      : `${scope === "apostles" ? "The Apostles" : "All speakers"} · ${timeframe.label}`;

  function cancel() {
    abortRef.current?.abort();
    setPhase("idle");
    setErrMsg("Analysis cancelled.");
  }

  async function analyze() {
    if (targetTalks.length < 2 || phase === "notes" || phase === "writing") return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErrMsg("");
    setEssay("");
    setItems([]);
    setLoaded(null);
    setShareUrl("");
    setShareState("idle");
    setPhase("notes");

    try {
      const talks = targetTalks;
      const uris = talks.map((t) => t.uri);
      const whenOf = (t) => `${monthName(t.month)} ${t.year}`;

      // 1) which talks already have study notes?
      const have = await postJson("/.netlify/functions/summarize-talk", { action: "have", uris }, ctrl.signal);
      const notes = new Map(Object.entries(have.found || {}));
      const missing = talks.filter((t) => !notes.has(t.uri));
      setProgress({ done: 0, total: missing.length, cached: notes.size, failed: 0 });

      // 2) create the missing notes (fetch text → summarize), 3 at a time.
      if (missing.length) {
        const res = await pool(
          missing,
          3,
          async (t) => {
            const talkData = await postJson("/.netlify/functions/fetch-talk", { url: t.uri }, ctrl.signal);
            const text = (talkData.paragraphs || []).join("\n\n");
            const sum = await postJson(
              "/.netlify/functions/summarize-talk",
              { action: "summarize", talk: { uri: t.uri, title: t.title, speaker: t.speaker, when: whenOf(t), text } },
              ctrl.signal
            );
            notes.set(t.uri, sum.summary);
          },
          (done, failed) => setProgress((p) => ({ ...p, done, failed })),
          ctrl.signal
        );
        if (ctrl.signal.aborted) return;
        if (res.failed && notes.size < 2) throw new Error("Couldn't prepare notes for these talks.");
      }

      // 3) stream the essay.
      const analyzed = talks.filter((t) => notes.has(t.uri));
      const citeList = analyzed.map((t) => ({ ...t, when: whenOf(t) }));
      setItems(citeList);
      setPhase("writing");
      const essayText = await streamEssay(
        ctrl,
        tab,
        analysisLabel,
        analyzed.map((t) => {
          const n = notes.get(t.uri);
          return { title: t.title, speaker: t.speaker, when: whenOf(t), summary: n.summary, themes: n.themes };
        })
      );
      finishAnalysis(essayText, citeList);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPhase("error");
      setErrMsg(e.message || "Analysis failed.");
    }
  }

  // Talk-construction analysis: read the most recent talks IN FULL (no note
  // cache — structure lives in the actual prose) and stream the essay.
  async function analyzeConstruction() {
    if (constructionSample.length < 2 || phase === "notes" || phase === "writing") return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErrMsg("");
    setEssay("");
    setItems([]);
    setLoaded(null);
    setShareUrl("");
    setShareState("idle");
    setPhase("notes");

    try {
      const whenOf = (t) => `${monthName(t.month)} ${t.year}`;
      const sample = constructionSample;
      setProgress({ done: 0, total: sample.length, cached: 0, failed: 0 });
      const texts = new Map();
      const res = await pool(
        sample,
        3,
        async (t) => {
          const talkData = await postJson("/.netlify/functions/fetch-talk", { url: t.uri }, ctrl.signal);
          texts.set(t.uri, (talkData.paragraphs || []).join("\n\n"));
        },
        (done, failed) => setProgress((p) => ({ ...p, done, failed })),
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      const got = sample.filter((t) => texts.has(t.uri));
      if (res.failed && got.length < 2) throw new Error("Couldn't read these talks.");

      const citeList = got.map((t) => ({ ...t, when: whenOf(t) }));
      setItems(citeList);
      setPhase("writing");
      const essayText = await streamEssay(
        ctrl,
        "construction",
        analysisLabel,
        got.map((t) => ({ title: t.title, speaker: t.speaker, when: whenOf(t), text: texts.get(t.uri) }))
      );
      finishAnalysis(essayText, citeList);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPhase("error");
      setErrMsg(e.message || "Analysis failed.");
    }
  }

  // Stream the essay, automatically requesting continuations when a round
  // ends at the model's output ceiling (each round is a fresh server call
  // with its own time budget, so long essays always finish).
  async function streamEssay(ctrl, kind, label, payloadItems) {
    let acc = "";
    // Rounds are small slices (~1200 tokens each, fitting the server's ~30s
    // stream window), so a full essay can take many of them.
    for (let round = 0; round < 24; round++) {
      const res = await fetch("/.netlify/functions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          kind,
          label,
          items: payloadItems,
          continueFrom: round === 0 ? undefined : cleanEssay(acc),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Analysis failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setEssay(cleanEssay(acc.split(CONTINUE_SENTINEL).join("")));
      }
      const cut = acc.lastIndexOf(CONTINUE_SENTINEL);
      if (cut === -1) return cleanEssay(acc); // finished naturally
      acc = acc.slice(0, cut); // trim the marker and go another round
    }
    return cleanEssay(acc) + "\n\n*(The analysis reached its maximum length.)*";
  }

  // Persist a finished analysis on-device and mark it as the loaded one.
  function finishAnalysis(essayText, citeList) {
    setEssay(essayText);
    setPhase("done");
    const rec = {
      localId: String(Date.now()),
      kind: tab,
      label: analysisLabel,
      essay: essayText,
      items: citeList.map((t) => ({ uri: t.uri, title: t.title, speaker: t.speaker, when: t.when })),
      at: new Date().toISOString(),
    };
    const nextList = [rec, ...loadMyAnalyses()].slice(0, 30);
    setMyAnalyses(nextList);
    persistMyAnalyses(nextList);
    setLoaded(rec);
  }

  const itemUris = useMemo(() => [...items].reverse().map((t) => t.uri), [items]); // newest-first for queues
  const estimate = (n) => (n * NOTE_COST >= 0.5 ? `~$${(n * NOTE_COST).toFixed(2)}` : "a few cents");
  const displayLabel = loaded ? loaded.label : analysisLabel;

  // The progression playlist: talks in the ORDER THE ESSAY CITES THEM —
  // following the analysis's narrative arc rather than the calendar.
  const progressionUris = useMemo(() => {
    if (!essay || !items.length) return [];
    const seen = new Set();
    const out = [];
    const re = /\[(\d+)\]/g;
    let m;
    while ((m = re.exec(essay)) !== null) {
      const t = items[parseInt(m[1], 10) - 1];
      if (t && !seen.has(t.uri)) {
        seen.add(t.uri);
        out.push(t.uri);
      }
    }
    return out;
  }, [essay, items]);

  function playCitation(t) {
    startUrisQueue({
      id: `ins|${displayLabel}|oldest`,
      label: displayLabel,
      uris: itemUris,
      order: "oldest",
      startUri: t.uri,
    });
  }

  const busy = phase === "notes" || phase === "writing";

  return (
    <div className="picker-insights">
      <p className="note">
        AI reads the talks and writes an evidence-based analysis — every claim
        cites the talks it came from, and every citation is playable. Notes on
        each talk are saved server-side, so repeat analyses get faster and cheaper.
      </p>

      <div className="ins-tabs">
        <button className={`picker-mode-btn ${tab === "speaker" ? "active" : ""}`} onClick={() => setTab("speaker")} disabled={busy}>
          Speaker journey
        </button>
        <button className={`picker-mode-btn ${tab === "construction" ? "active" : ""}`} onClick={() => setTab("construction")} disabled={busy}>
          Talk construction
        </button>
        <button className={`picker-mode-btn ${tab === "era" ? "active" : ""}`} onClick={() => setTab("era")} disabled={busy}>
          Era focus
        </button>
        <button className={`picker-mode-btn ${tab === "topic" ? "active" : ""}`} onClick={() => setTab("topic")} disabled={busy}>
          Topic study
        </button>
      </div>

      {loaded && loaded.sharedId && sharedId && (
        <div className="ins-shared-banner">
          Viewing a shared analysis. You can listen to every cited talk right here.
        </div>
      )}

      {!busy && myAnalyses.length > 0 && (
        <div className="resume-shelf" style={{ marginTop: 4 }}>
          <div className="resume-shelf-title">My analyses</div>
          {myAnalyses.map((a) => (
            <div className="resume-card" key={a.localId}>
              <button
                className="resume-card-main"
                title="Reopen this analysis — no cost, it's saved on this device"
                onClick={() => openSaved(a)}
              >
                <span className="resume-card-label">📈 {a.label}</span>
                <span className="resume-card-pos">
                  {a.items.length} talks · {new Date(a.at).toLocaleDateString()}
                  {a.sharedId ? " · shared" : ""}
                </span>
              </button>
              <button className="resume-card-x" title="Remove this saved analysis" onClick={() => deleteSaved(a.localId)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {(tab === "speaker" || tab === "construction") && !busy && (
        <>
          {!speaker ? (
            <>
              <label className="picker-field" style={{ width: "100%" }}>
                <span className="picker-label">Speaker</span>
                <input
                  type="text"
                  className="picker-search-input"
                  placeholder="e.g. David A. Bednar"
                  value={speakerQuery}
                  onChange={(e) => setSpeakerQuery(e.target.value)}
                />
              </label>
              <div className="topic-chips">
                {speakerMatches.map(([name, n]) => (
                  <button key={name} className="picker-example-chip" onClick={() => setSpeaker(name)}>
                    {name}<span className="topic-chip-count">{n}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="topic-selected">
              <span className="picker-group-name">{speaker}</span>
              <span className="picker-chip-count">{targetTalks.length} talks</span>
              <button className="picker-example-chip" onClick={() => { setSpeaker(null); setSpeakerQuery(""); setEssay(""); setPhase("idle"); }}>
                ← change speaker
              </button>
            </div>
          )}
        </>
      )}

      {tab === "topic" && !busy && (
        <>
          {!selectedTopic ? (
            <>
              <label className="picker-field" style={{ width: "100%" }}>
                <span className="picker-label">Gospel topic</span>
                <input
                  type="text"
                  className="picker-search-input"
                  placeholder="e.g. Faith, Repentance, Family, Sabbath…"
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                />
              </label>
              {!topicsIdx ? (
                <p className="note">Loading the topic list…</p>
              ) : (
                <div className="topic-chips">
                  {topicMatches.map((t) => (
                    <button key={t.slug} className="picker-example-chip" onClick={() => setTopicSlug(t.slug)}>
                      {t.name}<span className="topic-chip-count">{(t.t || []).length}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="note">
                Topics are the Church's own curated General Conference topic pages — every talk it files under each one.
              </p>
            </>
          ) : (
            <>
              <div className="topic-selected">
                <span className="picker-group-name">{selectedTopic.name}</span>
                <span className="picker-chip-count">{targetTalks.length} talks</span>
                <button className="picker-example-chip" onClick={() => { setTopicSlug(null); setTopicQuery(""); setEssay(""); setPhase("idle"); }}>
                  ← change topic
                </button>
              </div>
              <div className="topic-timeframe">
                <label className="picker-field">
                  <span className="picker-label">Timeframe</span>
                  <select className="picker-select" value={topicTf} onChange={(e) => setTopicTf(e.target.value)}>
                    <option value="all">All years</option>
                    {(presidencies || []).map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                    <option value="custom">Custom year range…</option>
                  </select>
                </label>
                {topicTf === "custom" && (
                  <>
                    <label className="picker-field">
                      <span className="picker-label">From</span>
                      <input type="text" className="picker-select" style={{ width: 90 }} value={tfFrom} onChange={(e) => setTfFrom(e.target.value)} />
                    </label>
                    <label className="picker-field">
                      <span className="picker-label">To</span>
                      <input type="text" className="picker-select" style={{ width: 90 }} value={tfTo} onChange={(e) => setTfTo(e.target.value)} />
                    </label>
                  </>
                )}
                <label className="picker-field">
                  <span className="picker-label">Speakers</span>
                  <select className="picker-select" value={topicScope} onChange={(e) => setTopicScope(e.target.value)}>
                    <option value="all">All conference speakers</option>
                    <option value="apostles">First Presidency & the Twelve</option>
                  </select>
                </label>
              </div>
              <TopicTimeline
                talks={topicAllTalks}
                allByYear={allByYear}
                timeframe={timeframe}
                presidencies={presidencies}
                onPickYear={(y) => { setTopicTf("custom"); setTfFrom(String(y)); setTfTo(String(y)); }}
                onPickPresidency={(key) => setTopicTf(key)}
              />
              {targetTalks.length > 60 && (
                <p className="note">
                  {targetTalks.length} talks is a big study — narrow the timeframe or speakers for a sharper essay (and a smaller first-run cost), or go ahead for the full sweep.
                </p>
              )}
              {targetTalks.length < 2 && <p className="note">Fewer than two talks match — widen the timeframe or speakers.</p>}
            </>
          )}
        </>
      )}

      {tab === "era" && !busy && (
        <div className="topic-timeframe">
          <label className="picker-field">
            <span className="picker-label">Timeframe</span>
            <select className="picker-select" value={tfKey} onChange={(e) => setTfKey(e.target.value)}>
              {(presidencies || []).map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="custom">Custom year range…</option>
            </select>
          </label>
          {tfKey === "custom" && (
            <>
              <label className="picker-field">
                <span className="picker-label">From</span>
                <input type="text" className="picker-select" style={{ width: 90 }} value={tfFrom} onChange={(e) => setTfFrom(e.target.value)} />
              </label>
              <label className="picker-field">
                <span className="picker-label">To</span>
                <input type="text" className="picker-select" style={{ width: 90 }} value={tfTo} onChange={(e) => setTfTo(e.target.value)} />
              </label>
            </>
          )}
          <label className="picker-field">
            <span className="picker-label">Speakers</span>
            <select className="picker-select" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="apostles">First Presidency & the Twelve</option>
              <option value="all">All conference speakers</option>
            </select>
          </label>
        </div>
      )}

      {!busy && tab !== "construction" && targetTalks.length >= 2 && (tab === "era" || (tab === "topic" ? selectedTopic : speaker)) && (
        <div className="ins-launch">
          <button className="btn btn-primary" onClick={analyze}>
            ✨ Analyze {tab === "speaker" ? `${speaker}’s journey` : tab === "topic" ? `how “${selectedTopic.name}” has been taught` : `this era`} ({targetTalks.length} talks)
          </button>
          <span className="note" style={{ margin: 0 }}>
            First run may cost {estimate(targetTalks.length)} in API credits and take a few
            minutes; talks already noted are free and instant.
          </span>
        </div>
      )}
      {!busy && tab === "construction" && speaker && constructionSample.length >= 2 && (
        <div className="ins-launch">
          <button className="btn btn-primary" onClick={analyzeConstruction}>
            ✨ Analyze how {speaker.split(" ").slice(-1)[0]} builds a talk ({constructionSample.length} recent talks)
          </button>
          <span className="note" style={{ margin: 0 }}>
            Reads their {constructionSample.length} most recent talks in full and maps the
            architecture — openings, scaffolding, stories, testimony, closings — ending
            with a reusable construction template. Typically $0.30–$0.70 per run.
          </span>
        </div>
      )}
      {!busy && tab === "era" && targetTalks.length < 2 && (
        <p className="note">No talks match that timeframe and speaker scope.</p>
      )}

      {phase === "notes" && (
        <div className="ins-progress">
          <div className="ins-progress-text">
            {tab === "construction" ? "Reading talks" : "Preparing study notes"}…{" "}
            {progress.done} of {progress.total}{tab === "construction" ? "" : " new"}
            {progress.cached ? ` (${progress.cached} already on file)` : ""}
            {progress.failed ? ` · ${progress.failed} failed` : ""}
          </div>
          <div className="ins-bar">
            <div
              className="ins-bar-fill"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }}
            />
          </div>
          <button className="picker-example-chip" onClick={cancel}>Cancel</button>
        </div>
      )}
      {phase === "writing" && !essay && (
        <p className="note" style={{ fontStyle: "italic" }}>Writing the analysis…</p>
      )}

      {errMsg && <div className="picker-error">{errMsg}</div>}

      {essay && (
        <>
          <div className="picker-group-head" style={{ marginTop: 14 }}>
            <span className="picker-group-name">{displayLabel}</span>
            {items.length > 0 && (
              <span className="picker-listen-btns">
                {progressionUris.length >= 2 && (
                  <button
                    className="picker-listen-btn"
                    title="Play the cited talks in the order the essay tells the story"
                    onClick={() =>
                      startUrisQueue({
                        id: `insprog|${displayLabel}`,
                        label: `${displayLabel} · progression`,
                        uris: progressionUris,
                        order: "analysis",
                      })
                    }
                  >
                    ▶ Play the progression
                  </button>
                )}
                <button
                  className="picker-listen-btn"
                  onClick={() =>
                    startUrisQueue({
                      id: `ins|${displayLabel}|oldest`,
                      label: displayLabel,
                      uris: itemUris,
                      order: "oldest",
                    })
                  }
                >
                  ▶ All talks (oldest → newest)
                </button>
                {phase === "done" && (
                  <button
                    className="picker-listen-btn"
                    title="Publish this analysis and copy a link — anyone who opens it can read it and play every cited talk"
                    onClick={shareAnalysis}
                    disabled={shareState === "working"}
                  >
                    {shareState === "working"
                      ? "Publishing…"
                      : shareState === "copied"
                      ? "✓ Link copied!"
                      : "🔗 Share"}
                  </button>
                )}
                {phase === "done" && (
                  <button
                    className="picker-listen-btn"
                    title="Opens a print-ready view — choose 'Save as PDF' in the print dialog. Citations become clickable links to the talks."
                    onClick={() => exportPdf(displayLabel, essay, items)}
                  >
                    🖨 PDF
                  </button>
                )}
                {phase === "done" && (
                  <button
                    className="picker-listen-btn"
                    title="Download as a Word document (citations stay clickable links)"
                    onClick={() => exportDoc(displayLabel, essay, items)}
                  >
                    ⬇ Word
                  </button>
                )}
              </span>
            )}
          </div>
          <Essay md={essay} citations={items} onCite={playCitation} />
          {phase === "done" && items.length > 0 && (
            <details className="ins-talklist">
              <summary>The {items.length} talks behind this analysis</summary>
              <div className="picker-talks">
                {[...items].reverse().map((t) => (
                  <TalkRow
                    key={t.uri}
                    t={t}
                    subtitle={`${t.speaker} · ${t.when}`}
                    nowPlayingUri={nowPlayingUri}
                    onListen={() => playCitation(t)}
                    onMakeSong={() => chooseTalk(t)}
                    makeLoading={loadingUri === t.uri}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
