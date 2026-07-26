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

function Essay({ md, citations, onCite }) {
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

// ===========================================================================
// INSIGHTS MODE (speaker journey + era focus)
// ===========================================================================
export function InsightsMode({ index, presidencies, startUrisQueue, nowPlayingUri, chooseTalk, loadingUri }) {
  const [tab, setTab] = useState("speaker"); // speaker | era
  const [speakerQuery, setSpeakerQuery] = useState("");
  const [speaker, setSpeaker] = useState(null);
  const [tfKey, setTfKey] = useState("hinckley");
  const [tfFrom, setTfFrom] = useState("1990");
  const [tfTo, setTfTo] = useState("1994");
  const [scope, setScope] = useState("apostles"); // apostles | all

  const [phase, setPhase] = useState("idle"); // idle | notes | writing | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0, cached: 0, failed: 0 });
  const [essay, setEssay] = useState("");
  const [items, setItems] = useState([]); // analyzed talks, chronological
  const [errMsg, setErrMsg] = useState("");
  const abortRef = useRef(null);

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
    if (tfKey === "custom") {
      const f = parseInt(tfFrom, 10), t = parseInt(tfTo, 10);
      return {
        from: Number.isFinite(f) ? f * 100 : 0,
        to: Number.isFinite(t) ? t * 100 + 12 : 999912,
        label: `${tfFrom}–${tfTo}`,
      };
    }
    const p = (presidencies || []).find((x) => x.key === tfKey);
    if (!p) return { from: 0, to: 999912, label: "all years" };
    return { from: p.from, to: p.to ?? 999912, label: p.label };
  }, [tfKey, tfFrom, tfTo, presidencies]);

  // The talk set the analysis would run over (chronological, oldest first).
  const targetTalks = useMemo(() => {
    if (!index) return [];
    let talks;
    if (tab === "speaker") {
      if (!speaker) return [];
      talks = index.talks.filter((t) => t.speaker === speaker);
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
  }, [index, tab, speaker, timeframe, scope]);

  const analysisLabel =
    tab === "speaker"
      ? speaker || ""
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
      const res = await fetch("/.netlify/functions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          kind: tab,
          label: analysisLabel,
          items: analyzed.map((t) => {
            const n = notes.get(t.uri);
            return { title: t.title, speaker: t.speaker, when: whenOf(t), summary: n.summary, themes: n.themes };
          }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Analysis failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // Leading newlines are keep-alive pulses from the server — ignore.
        setEssay(acc.replace(/^\s+/, ""));
      }
      setPhase("done");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPhase("error");
      setErrMsg(e.message || "Analysis failed.");
    }
  }

  const itemUris = useMemo(() => [...items].reverse().map((t) => t.uri), [items]); // newest-first for queues
  const missingCount = Math.max(0, progress.total);
  const estimate = (n) => (n * NOTE_COST >= 0.5 ? `~$${(n * NOTE_COST).toFixed(2)}` : "a few cents");

  function playCitation(t) {
    startUrisQueue({
      id: `ins|${analysisLabel}|oldest`,
      label: analysisLabel,
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
        <button className={`picker-mode-btn ${tab === "era" ? "active" : ""}`} onClick={() => setTab("era")} disabled={busy}>
          Era focus
        </button>
      </div>

      {tab === "speaker" && !busy && (
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

      {!busy && targetTalks.length >= 2 && (tab === "era" || speaker) && (
        <div className="ins-launch">
          <button className="btn btn-primary" onClick={analyze}>
            ✨ Analyze {tab === "speaker" ? `${speaker}’s journey` : `this era`} ({targetTalks.length} talks)
          </button>
          <span className="note" style={{ margin: 0 }}>
            First run may cost {estimate(targetTalks.length)} in API credits and take a few
            minutes; talks already noted are free and instant.
          </span>
        </div>
      )}
      {!busy && tab === "era" && targetTalks.length < 2 && (
        <p className="note">No talks match that timeframe and speaker scope.</p>
      )}

      {phase === "notes" && (
        <div className="ins-progress">
          <div className="ins-progress-text">
            Preparing study notes… {progress.done} of {progress.total} new
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
            <span className="picker-group-name">{analysisLabel}</span>
            {items.length > 0 && (
              <span className="picker-listen-btns">
                <button
                  className="picker-listen-btn"
                  onClick={() =>
                    startUrisQueue({
                      id: `ins|${analysisLabel}|oldest`,
                      label: analysisLabel,
                      uris: itemUris,
                      order: "oldest",
                    })
                  }
                >
                  ▶ Listen to these talks (oldest → newest)
                </button>
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
