// src/components/TalkStudio.jsx
//
// The Talk builder: take a quote from the Quote board and get coached into a
// sacrament meeting talk built in the CONSTRUCTION style of a chosen General
// Conference speaker (structure and craft — never impersonation).
//
// Flow: pick quote + speaker to emulate (+ assignment context) → the coach
// streams a personalized scaffold (that speaker's architecture applied to
// this quote, with "your move" prompts) → the user fills each section with
// their own stories, scriptures, and testimony → the coach reviews the
// outline and suggests next actions. Drafts persist on-device (and in the
// backup file); finished outlines export to PDF/Word.
//
// If a Talk-construction analysis for the emulated speaker exists in
// My analyses, its "construction template" section is attached to the
// coaching automatically — the scaffold then follows the measured template
// rather than general knowledge.

import React, { useMemo, useRef, useState } from "react";
import { APOSTLES, Essay } from "./AiTools.jsx";

const CONTINUE_SENTINEL = "@@CONTINUE@@";
const DRAFTS_KEY = "cac-talk-drafts";
const cleanText = (s) => s.replace(/​/g, "").replace(/^\s+/, "");

function loadDrafts() {
  try {
    const a = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function persistDrafts(list) {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list.slice(0, 10))); } catch {}
}

// Pull the construction template out of a saved Talk-construction analysis.
function templateFor(speaker) {
  try {
    const analyses = JSON.parse(localStorage.getItem("cac-analyses") || "[]");
    const rec = analyses.find(
      (a) => a.kind === "construction" && String(a.label || "").startsWith(speaker)
    );
    if (!rec) return "";
    const i = rec.essay.indexOf("## The construction template");
    return i >= 0 ? rec.essay.slice(i) : rec.essay.slice(-3000);
  } catch {
    return "";
  }
}

// Parse the streamed scaffold's numbered "## n. Section" headings into
// fillable outline sections (guidance = the coach text under each heading).
function sectionsFromSkeleton(md) {
  const out = [];
  let current = null;
  for (const raw of String(md).split("\n")) {
    const m = raw.match(/^##\s+(.*)$/);
    if (m) {
      const name = m[1].trim();
      if (/^\d+[.)]/.test(name)) {
        current = { name, guidance: "", userText: "" };
        out.push(current);
      } else {
        current = null; // intro/outro headings aren't fillable sections
      }
    } else if (current) {
      current.guidance += (current.guidance ? "\n" : "") + raw;
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildOutlineHtml(draft) {
  const secs = draft.sections
    .map(
      (s) =>
        `<h2>${escapeHtml(s.name)}</h2>\n` +
        (s.userText.trim()
          ? s.userText.trim().split(/\n+/).map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")
          : `<p class="empty">(to be written)</p>`)
    )
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Talk outline</title>
<style>body{font-family:Georgia,serif;color:#1a1a1a;max-width:7.5in;margin:0 auto;padding:24px;line-height:1.6;font-size:12pt}
h1{font-size:18pt;margin:0 0 4px}.meta{color:#666;font-size:10pt;margin:0 0 14px}
blockquote{margin:0 0 16px;padding:10px 16px;border-left:3px solid #b9923c;background:#faf7ef;font-style:italic}
blockquote .cite{display:block;margin-top:6px;font-style:normal;font-size:10pt;color:#555}
h2{font-size:13pt;margin:18px 0 6px;border-bottom:1px solid #ddd;padding-bottom:2px}
p{margin:0 0 8px}.empty{color:#999;font-style:italic}@media print{body{padding:0}}</style></head><body>
<h1>Sacrament meeting talk outline</h1>
<p class="meta">Built in the construction style of ${escapeHtml(draft.emulate)} · ${new Date().toLocaleDateString()}</p>
<blockquote>“${escapeHtml(draft.quote.text)}”<span class="cite">— ${escapeHtml(draft.quote.speaker)}, “${escapeHtml(draft.quote.title)},” ${escapeHtml(draft.quote.when)} General Conference</span></blockquote>
${secs}
</body></html>`;
}

function exportOutline(draft, mode) {
  const html = buildOutlineHtml(draft);
  if (mode === "pdf") {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 400);
  } else {
    const blob = new Blob(["﻿" + html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "talk-outline.doc";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export default function TalkStudio({ quotes, seedQuoteId }) {
  const [drafts, setDrafts] = useState(loadDrafts);
  const [draft, setDraft] = useState(null); // the active draft
  const [phase, setPhase] = useState("setup"); // setup | coaching | build | reviewing
  const [errMsg, setErrMsg] = useState("");
  const [quoteId, setQuoteId] = useState(seedQuoteId || (quotes[0] && quotes[0].id) || "");
  const [emulate, setEmulate] = useState("");
  const [context, setContext] = useState("");
  const abortRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Persist the active draft shortly after any edit (plus on blur), so a
  // closed tab never loses work.
  function scheduleDraftSave() {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setDraft((cur) => {
        if (cur) saveDraft({ ...cur, updatedAt: Date.now() });
        return cur;
      });
    }, 800);
  }

  const seedQuote = useMemo(() => quotes.find((q) => q.id === quoteId), [quotes, quoteId]);
  const template = useMemo(() => (emulate ? templateFor(emulate) : ""), [emulate]);
  const apostleChips = useMemo(() => {
    const q = emulate.trim().toLowerCase();
    const names = APOSTLES.map(([n]) => n).reverse(); // recent apostles first
    return q.length >= 2 && !names.some((n) => n === emulate)
      ? names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8)
      : [];
  }, [emulate]);

  function saveDraft(d) {
    const next = [d, ...loadDrafts().filter((x) => x.id !== d.id)].slice(0, 10);
    setDrafts(next);
    persistDrafts(next);
  }

  function updateDraft(patch) {
    setDraft((d) => {
      const next = { ...d, ...patch, updatedAt: Date.now() };
      saveDraft(next);
      return next;
    });
  }

  // Stream one coaching document (with browser-driven continuation rounds).
  async function streamCoach(kind, payload, onText) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    for (let round = 0; round < 12; round++) {
      const res = await fetch("/.netlify/functions/talk-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ ...payload, kind, continueFrom: round === 0 ? undefined : cleanText(acc) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Coaching failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        onText(cleanText(acc.split(CONTINUE_SENTINEL).join("")));
      }
      const cut = acc.lastIndexOf(CONTINUE_SENTINEL);
      if (cut === -1) return cleanText(acc);
      acc = acc.slice(0, cut);
    }
    return cleanText(acc);
  }

  async function buildScaffold() {
    if (!seedQuote || !emulate.trim() || phase === "coaching") return;
    setErrMsg("");
    const d = {
      id: `d${Date.now()}`,
      emulate: emulate.trim(),
      context: context.trim(),
      quote: { text: seedQuote.text, speaker: seedQuote.speaker, title: seedQuote.title, when: seedQuote.when, uri: seedQuote.uri },
      skeleton: "",
      sections: [],
      review: "",
      at: new Date().toISOString(),
      updatedAt: Date.now(),
    };
    setDraft(d);
    setPhase("coaching");
    try {
      const skeleton = await streamCoach(
        "skeleton",
        { emulate: d.emulate, context: d.context, quote: d.quote, template },
        (text) => setDraft((cur) => ({ ...cur, skeleton: text }))
      );
      const sections = sectionsFromSkeleton(skeleton);
      const done = { ...d, skeleton, sections };
      setDraft(done);
      saveDraft(done);
      setPhase("build");
    } catch (e) {
      if (!abortRef.current?.signal.aborted) {
        setErrMsg(e.message || "Coaching failed.");
        setPhase("setup");
      }
    }
  }

  async function reviewOutline() {
    if (!draft || phase === "reviewing") return;
    setErrMsg("");
    setPhase("reviewing");
    updateDraft({ review: "" });
    try {
      const review = await streamCoach(
        "review",
        {
          emulate: draft.emulate,
          context: draft.context,
          quote: draft.quote,
          sections: draft.sections.map((s) => ({ name: s.name, userText: s.userText })),
        },
        (text) => setDraft((cur) => ({ ...cur, review: text }))
      );
      updateDraft({ review });
      setPhase("build");
    } catch (e) {
      if (!abortRef.current?.signal.aborted) setErrMsg(e.message || "Review failed.");
      setPhase("build");
    }
  }

  function openDraft(d) {
    setDraft(d);
    setEmulate(d.emulate);
    setContext(d.context);
    setPhase(d.sections.length ? "build" : "setup");
    setErrMsg("");
  }

  function deleteDraft(id) {
    const next = drafts.filter((d) => d.id !== id);
    setDrafts(next);
    persistDrafts(next);
    if (draft && draft.id === id) { setDraft(null); setPhase("setup"); }
  }

  const busy = phase === "coaching" || phase === "reviewing";

  // ---------- setup ----------
  if (phase === "setup" || !draft) {
    return (
      <div className="picker-studio">
        <p className="note">
          Take a quote from your Quote board and get coached into a sacrament
          meeting talk built the way a speaker you admire builds theirs —
          their architecture, your voice, your stories.
        </p>

        {drafts.length > 0 && (
          <div className="resume-shelf">
            <div className="resume-shelf-title">My talk drafts</div>
            {drafts.map((d) => (
              <div className="resume-card" key={d.id}>
                <button className="resume-card-main" onClick={() => openDraft(d)}>
                  <span className="resume-card-label">🎙 In the style of {d.emulate}</span>
                  <span className="resume-card-sub">“{d.quote.text.slice(0, 70)}…”</span>
                  <span className="resume-card-pos">
                    {d.sections.filter((s) => s.userText.trim()).length} of {d.sections.length} sections drafted · {new Date(d.at).toLocaleDateString()}
                  </span>
                </button>
                <button className="resume-card-x" onClick={() => deleteDraft(d.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {!quotes.length ? (
          <p className="note">
            Your Quote board is empty — highlight a passage in the 📖
            follow-along reader first, then come back here to build on it.
          </p>
        ) : (
          <>
            <label className="picker-field" style={{ width: "100%" }}>
              <span className="picker-label">Seed quote</span>
              <select className="picker-select" style={{ width: "100%" }} value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    “{q.text.slice(0, 80)}…” — {q.speaker}
                  </option>
                ))}
              </select>
            </label>
            {seedQuote && (
              <blockquote className="studio-quote">
                “{seedQuote.text}”
                <span className="studio-cite">
                  — {seedQuote.speaker}, “{seedQuote.title},” {seedQuote.when} General Conference
                </span>
              </blockquote>
            )}

            <label className="picker-field" style={{ width: "100%" }}>
              <span className="picker-label">Build it in the construction style of…</span>
              <input
                type="text"
                className="picker-search-input"
                placeholder="e.g. Dallin H. Oaks"
                value={emulate}
                onChange={(e) => setEmulate(e.target.value)}
              />
            </label>
            {apostleChips.length > 0 && (
              <div className="topic-chips">
                {apostleChips.map((n) => (
                  <button key={n} className="picker-example-chip" onClick={() => setEmulate(n)}>{n}</button>
                ))}
              </div>
            )}
            {emulate && (
              <p className="note" style={{ marginTop: 8 }}>
                {template
                  ? `✓ Using your saved Talk-construction analysis of ${emulate} — the scaffold will follow their measured template.`
                  : `No Talk-construction analysis of ${emulate} on this device — the coach will use its general knowledge of their style. (Running one first, under 📈 Insights → Talk construction, makes the scaffold sharper.)`}
              </p>
            )}

            <label className="picker-field" style={{ width: "100%" }}>
              <span className="picker-label">Your assignment (optional)</span>
              <input
                type="text"
                className="picker-search-input"
                placeholder="e.g. 12-minute talk on service, youth in the congregation"
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </label>

            <div className="ins-launch">
              <button className="btn btn-primary" onClick={buildScaffold} disabled={!seedQuote || !emulate.trim()}>
                ✨ Coach me through this talk
              </button>
              <span className="note" style={{ margin: 0 }}>
                Each coaching step costs a few cents in API credits.
              </span>
            </div>
            {errMsg && <div className="picker-error">{errMsg}</div>}
          </>
        )}
      </div>
    );
  }

  // ---------- coaching / build / review ----------
  return (
    <div className="picker-studio">
      <div className="topic-selected">
        <span className="picker-group-name">In the style of {draft.emulate}</span>
        <button className="picker-example-chip" onClick={() => { setPhase("setup"); }} disabled={busy}>
          ← drafts & setup
        </button>
        {draft.sections.length > 0 && (
          <span className="picker-listen-btns">
            <button className="picker-listen-btn" onClick={() => exportOutline(draft, "pdf")}>🖨 PDF</button>
            <button className="picker-listen-btn" onClick={() => exportOutline(draft, "doc")}>⬇ Word</button>
          </span>
        )}
      </div>

      <blockquote className="studio-quote">
        “{draft.quote.text}”
        <span className="studio-cite">
          — {draft.quote.speaker}, “{draft.quote.title},” {draft.quote.when} General Conference
        </span>
      </blockquote>

      {phase === "coaching" && !draft.skeleton && (
        <p className="note" style={{ fontStyle: "italic" }}>The coach is studying your quote…</p>
      )}

      {draft.skeleton && (
        <details className="studio-coach" open={phase !== "build" || !draft.sections.some((s) => s.userText.trim())}>
          <summary>The coach's scaffold</summary>
          <Essay md={draft.skeleton} citations={[]} onCite={() => {}} />
        </details>
      )}

      {draft.sections.length > 0 && (
        <div className="studio-sections">
          {draft.sections.map((s, i) => (
            <div className="studio-section" key={i}>
              <div className="studio-section-name">{s.name}</div>
              <div className="studio-guidance">
                <Essay md={s.guidance} citations={[]} onCite={() => {}} />
              </div>
              <textarea
                className="studio-input"
                placeholder="Your material for this section — a story, a scripture, the point you'll make…"
                value={s.userText}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((cur) => ({
                    ...cur,
                    sections: cur.sections.map((x, j) => (j === i ? { ...x, userText: v } : x)),
                  }));
                  scheduleDraftSave();
                }}
                onBlur={() => updateDraft({})}
              />
            </div>
          ))}
          <div className="ins-launch">
            <button className="btn btn-primary" onClick={reviewOutline} disabled={busy}>
              {phase === "reviewing" ? "Coaching…" : "💬 Review my outline"}
            </button>
            <span className="note" style={{ margin: 0 }}>
              The coach reads what you've written and suggests what to strengthen next.
            </span>
          </div>
        </div>
      )}

      {draft.review && (
        <div className="studio-review">
          <div className="resume-shelf-title" style={{ marginTop: 16 }}>The coach's review</div>
          <Essay md={draft.review} citations={[]} onCite={() => {}} />
        </div>
      )}
      {errMsg && <div className="picker-error">{errMsg}</div>}
    </div>
  );
}
