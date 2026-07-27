// src/components/QuoteBoard.jsx
//
// The Quote board: quotes captured by highlighting text in the follow-along
// reader, each carrying its citation (speaker, talk title, conference).
// Filterable by subject tag, speaker, or free text; sortable; tags are
// editable by hand or AI-suggested (✨). Quotes ride the same device-sync
// and backup as everything else.

import React, { useMemo, useState } from "react";

const officialUrl = (uri) => `https://www.churchofjesuschrist.org${uri}?lang=eng`;

async function suggestTags(text) {
  const res = await fetch("/.netlify/functions/ai-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "tag", query: text }),
  });
  const data = await res.json();
  if (!res.ok || data.fallback) throw new Error(data.error || "AI tagging isn't available right now.");
  return (data.subjects || []).slice(0, 5);
}

function QuoteCard({ q, onDelete, onSetTags, onPlay, playing, onUseInTalk }) {
  const [adding, setAdding] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyQuote() {
    const cite = `“${q.text}” — ${q.speaker}, “${q.title},” ${q.when} General Conference`;
    try { await navigator.clipboard.writeText(cite); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function aiTags() {
    if (tagBusy) return;
    setTagBusy(true);
    try {
      const subjects = await suggestTags(q.text);
      const merged = [...new Set([...(q.tags || []), ...subjects])];
      onSetTags(q.id, merged);
    } catch {}
    setTagBusy(false);
  }

  function addTag() {
    const t = tagInput.trim();
    if (t) onSetTags(q.id, [...new Set([...(q.tags || []), t])]);
    setTagInput("");
    setAdding(false);
  }

  return (
    <div className="quote-card">
      <p className="quote-text">“{q.text}”</p>
      <div className="quote-cite">
        <strong>{q.speaker}</strong> — “{q.title},” {q.when} General Conference
      </div>
      <div className="quote-tags">
        {(q.tags || []).map((t) => (
          <span key={t} className="quote-tag">
            {t}
            <button
              className="quote-tag-x"
              title="Remove this subject"
              onClick={() => onSetTags(q.id, q.tags.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            className="quote-tag-input"
            autoFocus
            value={tagInput}
            placeholder="subject…"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addTag(); if (e.key === "Escape") setAdding(false); }}
            onBlur={addTag}
          />
        ) : (
          <button className="quote-tag ghost" onClick={() => setAdding(true)}>+ subject</button>
        )}
        <button className="quote-tag ghost" title="Let AI suggest subjects for this quote" onClick={aiTags} disabled={tagBusy}>
          {tagBusy ? "…" : "✨ suggest"}
        </button>
      </div>
      <div className="quote-actions">
        <button className="picker-talk-listen" onClick={onPlay}>{playing ? "♪ Playing" : "▶ Play talk"}</button>
        <a className="picker-talk-read" href={officialUrl(q.uri)} target="_blank" rel="noopener noreferrer">Read ↗</a>
        <button className="picker-talk-listen" onClick={copyQuote}>{copied ? "✓ Copied" : "⧉ Copy"}</button>
        <button
          className="picker-talk-make"
          title="Build a sacrament meeting talk around this quote"
          onClick={() => onUseInTalk(q)}
        >
          🎙 Use in a talk
        </button>
        {confirmDel ? (
          <button className="quote-del confirm" onClick={() => onDelete(q.id)}>Really delete?</button>
        ) : (
          <button className="quote-del" onClick={() => { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export default function QuoteBoard({ quotes, onDelete, onSetTags, startUrisQueue, nowPlayingUri, onUseInTalk }) {
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [subject, setSubject] = useState("");
  const [sort, setSort] = useState("newest");

  const speakers = useMemo(
    () => [...new Set(quotes.map((q) => q.speaker))].sort((a, b) => a.localeCompare(b)),
    [quotes]
  );
  const subjects = useMemo(() => {
    const counts = new Map();
    for (const q of quotes) for (const t of q.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [quotes]);

  const shown = useMemo(() => {
    const ql = query.trim().toLowerCase();
    let list = quotes.filter((q) => {
      if (speaker && q.speaker !== speaker) return false;
      if (subject && !(q.tags || []).includes(subject)) return false;
      if (ql && ![q.text, q.speaker, q.title, ...(q.tags || [])].join(" ").toLowerCase().includes(ql)) return false;
      return true;
    });
    if (sort === "newest") list = [...list].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    if (sort === "oldest") list = [...list].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    if (sort === "speaker") list = [...list].sort((a, b) => a.speaker.localeCompare(b.speaker) || String(b.savedAt).localeCompare(String(a.savedAt)));
    if (sort === "talk") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [quotes, query, speaker, subject, sort]);

  if (!quotes.length) {
    return (
      <div className="picker-quotes">
        <p className="note">
          Your Quote board is empty. While listening with the 📖 follow-along
          reader open, highlight any passage that strikes you — a “Save quote”
          button will appear, and the quote lands here with its citation.
        </p>
      </div>
    );
  }

  return (
    <div className="picker-quotes">
      <div className="quote-toolbar">
        <input
          type="text"
          className="picker-search-input quote-search"
          placeholder="Search quotes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="picker-select" value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
          <option value="">All speakers</option>
          {speakers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="picker-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="speaker">By speaker</option>
          <option value="talk">By talk</option>
        </select>
      </div>

      {subjects.length > 0 && (
        <div className="quote-subjects">
          <button className={`picker-example-chip ${subject === "" ? "active-chip" : ""}`} onClick={() => setSubject("")}>
            All subjects
          </button>
          {subjects.map(([t, n]) => (
            <button
              key={t}
              className={`picker-example-chip ${subject === t ? "active-chip" : ""}`}
              onClick={() => setSubject(subject === t ? "" : t)}
            >
              {t}<span className="topic-chip-count">{n}</span>
            </button>
          ))}
        </div>
      )}

      <p className="picker-result-count">
        {shown.length} quote{shown.length === 1 ? "" : "s"}
        {speaker ? ` · ${speaker}` : ""}{subject ? ` · ${subject}` : ""}
      </p>

      {shown.map((q) => (
        <QuoteCard
          key={q.id}
          q={q}
          onDelete={onDelete}
          onSetTags={onSetTags}
          onUseInTalk={onUseInTalk}
          playing={nowPlayingUri === q.uri}
          onPlay={() =>
            startUrisQueue({ id: `quote|${q.uri}`, label: q.title, uris: [q.uri], order: "newest" })
          }
        />
      ))}
    </div>
  );
}
