// src/components/LyricCreator.jsx
import React, { useState } from "react";
import { generateLyrics } from "../lib/api.js";
import ArtistInspirationSelector, { artistFor } from "./ArtistInspirationSelector.jsx";
import MelodyInstructions from "./MelodyInstructions.jsx";

export default function LyricCreator({
  onSources,
  talkText,
  setTalkText,
  lyrics,
  setLyrics,
  styleReference,
  setStyleReference,
  onFinalize,
  finalized,
  simple = false,
  songTitle = "",
  melodyInstructions = "",
  setMelodyInstructions = null,
}) {
  const [revisionRequest, setRevisionRequest] = useState("");
  const [copied, setCopied] = useState(""); // "all" | "plain" while the confirmation shows
  // Copy the lyrics for a music tool (MelodyCraft etc.) — with the [Section]
  // labels, or just the sung lines.
  async function copyLyrics(mode) {
    const text = mode === "plain"
      ? String(lyrics || "").split("\n").filter((l) => !/^\s*\[[^\]]+\]\s*$/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim()
      : String(lyrics || "").trim();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
      setCopied(mode);
      setTimeout(() => setCopied(""), 1800);
    } catch { setError("Couldn't copy — select the text in the box and copy it by hand."); }
  }
  // characters of sung lyric (section labels and blank lines not counted)
  const lyricChars = String(lyrics || "").split("\n").filter((l) => l.trim() && !/^\s*\[[^\]]+\]\s*$/.test(l)).join("\n").length;
  const [pastedLyrics, setPastedLyrics] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function handleUsePasted() {
    setError("");
    if (!pastedLyrics.trim()) {
      setError("Paste your finalized lyrics first.");
      return;
    }
    setLyrics(pastedLyrics.trim());
    setPastedLyrics("");
  }

  async function handleCreate() {
    setError("");
    if (!talkText.trim()) {
      setError("Please paste the talk text first.");
      return;
    }
    if (!styleReference.trim()) {
      setError(simple ? "Pick an artist above (or search for any artist or song and choose “Use …”) before creating the song." : "Please provide a style/artist reference before creating the song.");
      return;
    }
    setBusy(true);
    try {
      const { lyrics: out, sources } = await generateLyrics({ talkText, styleReference, styleProfile: (artistFor(styleReference) || {}).lyricProfile || "" });
      setLyrics(out);
      if (onSources) onSources(sources || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevise() {
    setError("");
    if (!revisionRequest.trim()) {
      setError("Describe the change you want.");
      return;
    }
    setBusy(true);
    try {
      const { lyrics: out, sources } = await generateLyrics({
        currentLyrics: lyrics,
        revisionRequest,
        styleReference,
        styleProfile: (artistFor(styleReference) || {}).lyricProfile || "",
        talkText,
      });
      setLyrics(out);
      if (onSources && sources) onSources(sources);
      setRevisionRequest("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setTalkText(String(reader.result || ""));
    reader.readAsText(file);
  }

  return (
    <section className="panel">
      <h2>{simple ? "Write the song" : "Lyric Creator"}</h2>
      <p className="sub">
        {simple
          ? "Name a modern artist or song to sound like, and the lyrics are written from the talk in that style. Revise until it sings, then finalize."
          : "Upload or paste a General Conference talk, choose a musical style, and generate original lyrics that teach its principles — then revise until it sings."}
      </p>

      {simple ? (
        <details className="music-card" style={{ marginBottom: 14 }}>
          <summary className="note" style={{ cursor: "pointer" }}>The talk's text is loaded ({String(talkText || "").split(/\s+/).filter(Boolean).length.toLocaleString()} words) — show it</summary>
          <textarea className="tall" value={talkText} onChange={(e) => setTalkText(e.target.value)} style={{ marginTop: 8 }} />
        </details>
      ) : (<>
      <label className="field">
        <span className="lbl">Conference talk</span>
        <textarea
          className="tall"
          placeholder="Paste the talk text here…"
          value={talkText}
          onChange={(e) => setTalkText(e.target.value)}
        />
      </label>
      <div className="row" style={{ marginBottom: 16 }}>
        <input type="file" accept=".txt,.md" onChange={handleFileUpload} />
        <span className="note" style={{ margin: 0 }}>
          .txt or .md upload fills the box above.
        </span>
      </div>
      </>)}

      <ArtistInspirationSelector value={styleReference} onChange={setStyleReference} />

      {/* Simple mode: the picker IS the style choice (its search takes any artist or song). */}
      {!simple && (
        <label className="field">
          <span className="lbl">Style / artist reference</span>
          <input
            type="text"
            placeholder="e.g. contemplative piano ballad, or 'in the style of a worship anthem'"
            value={styleReference}
            onChange={(e) => setStyleReference(e.target.value)}
          />
        </label>
      )}

      <div className="row">
        <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
          {busy && <span className="spinner" />}
          {lyrics ? "Regenerate from talk" : "Create song lyrics"}
        </button>
      </div>

      {!simple && <div className="paste-lyrics">
        <span className="lbl">Already have finished lyrics? Paste them here</span>
        <textarea
          placeholder="Paste finalized lyrics to skip generation. Include section labels like [Verse 1], [Chorus]…"
          value={pastedLyrics}
          onChange={(e) => setPastedLyrics(e.target.value)}
          style={{ minHeight: 140 }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={handleUsePasted}>
            Use these lyrics
          </button>
          <span className="note" style={{ margin: 0 }}>
            Loads them into the editable box below, ready to finalize. Tip: if
            you also paste the talk above, the Scene Organizer uses both for
            richer, more accurate scenes.
          </span>
        </div>
      </div>}

      {error && <div className="error">{error}</div>}

      {lyrics && (
        <>
          <div className="row" style={{ marginTop: 24, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="lbl" style={{ margin: 0 }}>Lyrics (editable)</span>
            <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => copyLyrics("all")} title="Copy the whole lyric, section labels included, ready to paste into MelodyCraft or another music tool">
              {copied === "all" ? "Copied ✓" : "📋 Copy lyrics"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => copyLyrics("plain")} title="Copy just the sung lines, without [Verse] / [Chorus] labels">
              {copied === "plain" ? "Copied ✓" : "Copy without labels"}
            </button>
          </div>
          <label className="field" style={{ marginTop: 6 }}>
            <textarea
              className="lyrics"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
            />
          </label>
          {setMelodyInstructions && (
            <MelodyInstructions artist={styleReference} title={songTitle} lyrics={lyrics} value={melodyInstructions} onChange={setMelodyInstructions} />
          )}

          <p className="note" style={{ margin: "4px 0 8px" }}>
            <strong style={{ color: lyricChars > 1500 ? "var(--warning)" : "var(--cloud)" }}>{lyricChars.toLocaleString()} characters</strong> of lyric
            {lyricChars > 1500 ? " — over the 1,500 default" : " — the generator aims for under 1,500"}. To change the target, say so in a revision (e.g. "make it longer, about 2,500 characters") or in the style line before generating.
          </p>
          <label className="field">
            <span className="lbl">Request a revision</span>
            <input
              type="text"
              placeholder="e.g. 'make the chorus more hopeful', 'add a bridge about gratitude', or 'make it longer — about 2,500 characters'"
              value={revisionRequest}
              onChange={(e) => setRevisionRequest(e.target.value)}
            />
          </label>

          <div className="row end">
            <button className="btn btn-ghost" onClick={handleRevise} disabled={busy}>
              {busy && <span className="spinner" />}
              Apply revision
            </button>
            <button className="btn btn-primary" onClick={onFinalize} disabled={busy}>
              {finalized ? "Lyrics finalized ✓" : simple ? "Finalize lyrics → Scenes" : "Finalize lyrics → Storyboard"}
            </button>
          </div>

          <p className="note">
            You can keep editing directly in the box, ask for AI revisions, or
            finalize to carry these lyrics into the Storyboard (the images start painting right away) and then the Music step.
          </p>
        </>
      )}
    </section>
  );
}
