// src/components/MelodyCraftPicker.jsx
//
// MelodyCraft AI settings: "sound like …" → recommended genre + mood
// combinations (from MelodyCraft's own vocabulary), plus a browse-and-pick
// list for any combination by hand. The chosen combination is copied in one
// tap, ready to paste into MelodyCraft. Used on the Studio's Music step and
// on the Campus Sessions song step.
import React, { useMemo, useState } from "react";
import { MELODYCRAFT_GENRES, MELODYCRAFT_MOODS } from "../../netlify/lib/melodycraft-tags.js";
import { melodyCraftSuggest } from "../lib/api.js";

export const comboText = (v) => `Genres: ${(v.genres || []).join(", ") || "—"} · Moods: ${(v.moods || []).join(", ") || "—"}`;

export default function MelodyCraftPicker({ reference, onReference, value, onChange, lyrics = "", talkTitle = "", moodHint = "", compact = false, btnClass = "btn", primaryClass = "btn btn-primary", chipClass = "chip" }) {
  const sel = value || { genres: [], moods: [] };
  const [combos, setCombos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [browse, setBrowse] = useState(false);
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? MELODYCRAFT_GENRES.filter((g) => g.toLowerCase().includes(t)) : MELODYCRAFT_GENRES;
    return list.slice(0, 60);
  }, [q]);

  const toggle = (kind, tag) => {
    const cur = sel[kind] || [];
    const next = cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag].slice(-3);
    onChange && onChange({ ...sel, [kind]: next });
  };
  async function copy(text, key) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1800); } catch { setErr("Couldn't copy — select the text and copy by hand."); }
  }
  async function suggest() {
    if (!reference || !reference.trim()) { setErr("Type a song or artist to sound like first."); return; }
    setBusy(true); setErr(""); setCombos(null);
    try {
      const r = await melodyCraftSuggest({ reference, lyrics, talkTitle, moodHint });
      setCombos(r.combos || []);
      if (r.combos && r.combos[0] && !(sel.genres || []).length && !(sel.moods || []).length) onChange && onChange({ genres: r.combos[0].genres, moods: r.combos[0].moods, reference });
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }
  const hasSel = (sel.genres || []).length || (sel.moods || []).length;

  return (
    <div className="mc-picker">
      <label className="field" style={{ margin: "0 0 8px" }}>
        <span className="lbl">Sound like (a song or artist)</span>
        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <input type="text" value={reference || ""} onChange={(e) => onReference && onReference(e.target.value)} placeholder='e.g. "Forrest Frank", "Oceans by Hillsong United", "Mumford & Sons"' style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); suggest(); } }} />
          <button type="button" className={primaryClass} onClick={suggest} disabled={busy} style={{ whiteSpace: "nowrap" }}>{busy ? "Thinking…" : "✨ Suggest settings"}</button>
        </span>
      </label>
      {err && <div className="error" style={{ margin: "6px 0" }}>{err}</div>}

      {combos && combos.length > 0 && (
        <div className="mc-combos">
          {combos.map((c, i) => {
            const chosen = JSON.stringify([c.genres, c.moods]) === JSON.stringify([sel.genres || [], sel.moods || []]);
            return (
              <div key={i} className={`mc-combo${chosen ? " on" : ""}`}>
                <div className="mc-combo-tags">
                  {c.genres.map((g) => <span key={g} className={`${chipClass} mc-g`}>{g}</span>)}
                  {c.moods.map((m) => <span key={m} className={`${chipClass} mc-m`}>{m}</span>)}
                </div>
                {!compact && c.why && <div className="note" style={{ margin: "4px 0 6px" }}>{c.why}</div>}
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className={`${btnClass} btn-sm`} onClick={() => onChange && onChange({ genres: c.genres, moods: c.moods, reference })}>{chosen ? "✓ Chosen" : "Use this"}</button>
                  <button type="button" className={`${btnClass} btn-sm`} onClick={() => copy(comboText(c), `c${i}`)}>{copied === `c${i}` ? "Copied ✓" : "Copy"}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mc-selection">
        <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="note" style={{ margin: 0 }}>Your MelodyCraft settings:</span>
          {(sel.genres || []).map((g) => <button key={g} type="button" className={`${chipClass} mc-g`} title="Remove" onClick={() => toggle("genres", g)}>{g} ✕</button>)}
          {(sel.moods || []).map((m) => <button key={m} type="button" className={`${chipClass} mc-m`} title="Remove" onClick={() => toggle("moods", m)}>{m} ✕</button>)}
          {!hasSel && <span className="note" style={{ margin: 0, opacity: 0.7 }}>none yet — suggest some, or browse below</span>}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button type="button" className={`${btnClass} btn-sm`} disabled={!hasSel} onClick={() => copy(comboText(sel), "sel")}>{copied === "sel" ? "Copied ✓" : "📋 Copy settings"}</button>
          <button type="button" className={`${btnClass} btn-sm`} onClick={() => setBrowse((v) => !v)}>{browse ? "Hide the list" : `Browse all ${MELODYCRAFT_GENRES.length} genres & ${MELODYCRAFT_MOODS.length} moods`}</button>
        </div>
      </div>

      {browse && (
        <div className="mc-browse">
          <span className="note">Moods (tap up to 3)</span>
          <div className="mc-taglist">
            {MELODYCRAFT_MOODS.map((m) => <button key={m} type="button" className={`${chipClass} mc-m${(sel.moods || []).includes(m) ? " on" : ""}`} onClick={() => toggle("moods", m)}>{m}</button>)}
          </div>
          <label className="field" style={{ margin: "8px 0 4px" }}>
            <span className="lbl">Genres (tap up to 3)</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search genres, e.g. worship, folk, piano, gospel" />
          </label>
          <div className="mc-taglist">
            {results.map((g) => <button key={g} type="button" className={`${chipClass} mc-g${(sel.genres || []).includes(g) ? " on" : ""}`} onClick={() => toggle("genres", g)}>{g}</button>)}
            {results.length === 60 && <span className="note" style={{ margin: 0 }}>…keep typing to narrow the list</span>}
          </div>
        </div>
      )}
    </div>
  );
}
