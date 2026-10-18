// src/components/MelodyInstructions.jsx — ChatGPT writes the text for
// MelodyCraft AI's "Instructions" field (~450 characters) to get a sound like
// the artist chosen on the Lyrics step; one tap copies it. Shown on the Lyrics
// step beside Copy lyrics, and again on the Music step. The text is saved with
// the project (song.melodyCraft.instructions).
import React, { useEffect, useRef, useState } from "react";
import { keyHeaders } from "../lib/keys.js";
import { artistFor } from "./ArtistInspirationSelector.jsx";

const defaultRequest = (artist) => `Write a 450 character description for MelodyCraft AI to elicit a similar sound to ${artist || "the selected artist"}`;

export default function MelodyInstructions({ artist, title, lyrics, value, onChange, compact = false }) {
  const [request, setRequest] = useState(defaultRequest(artist));
  const edited = useRef(false);
  // The selected artist carries into the request (unless it was rewritten by hand).
  useEffect(() => { if (!edited.current) setRequest(defaultRequest(artist)); }, [artist]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function write() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/.netlify/functions/melodycraft-instructions", {
        method: "POST",
        headers: { "content-type": "application/json", ...keyHeaders() },
        body: JSON.stringify({ request, artist, profile: (artistFor(artist) || {}).lyricProfile || "", title, lyrics: String(lyrics || "").slice(0, 1500) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `The writer answered ${res.status}.`);
      onChange(d.text);
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(value || ""); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setErr("Couldn't copy — select the text and copy it by hand."); }
  }

  return (
    <div className={`mc-instr${compact ? " compact" : ""}`}>
      <div className="mc-instr-head">
        <strong>MelodyCraft instructions</strong>
        <span className="mc-instr-sub">written by ChatGPT · paste into MelodyCraft's Instructions field</span>
      </div>
      <div className="mc-instr-ask">
        <input type="text" value={request} onChange={(e) => { edited.current = true; setRequest(e.target.value); }} aria-label="What to ask ChatGPT" />
        <button type="button" className="mc-instr-go" onClick={write} disabled={busy || !request.trim()}>{busy ? "Writing…" : value ? "↻ Rewrite" : "✨ Write it"}</button>
      </div>
      {edited.current && <button type="button" className="mc-instr-reset" onClick={() => { edited.current = false; setRequest(defaultRequest(artist)); }}>↺ Back to the standard request</button>}
      {value ? (
        <div className="mc-instr-card">
          <textarea className="mc-instr-text" value={value} onChange={(e) => onChange(e.target.value)} rows={Math.max(4, Math.ceil(String(value).length / (compact ? 52 : 64)) + 1)} aria-label="MelodyCraft instructions" />
          <div className="mc-instr-foot">
            <span className={`mc-instr-count${value.length > 450 ? " over" : ""}`}>{value.length} characters</span>
            <button type="button" className="mc-instr-copy" onClick={copy}>{copied ? "Copied ✓" : <><span aria-hidden="true">⧉</span> Copy instructions</>}</button>
          </div>
        </div>
      ) : (
        <p className="mc-instr-hint">{artist ? `Press ✨ Write it for a ~450-character description of a sound like ${artist}.` : "Pick an artist above, then press ✨ Write it."}</p>
      )}
      {err && <p className="mc-instr-err">{err}</p>}
    </div>
  );
}
