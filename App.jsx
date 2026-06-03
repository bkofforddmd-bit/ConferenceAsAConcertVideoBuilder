// src/components/LyricCreator.jsx
import React, { useState } from "react";
import { generateLyrics } from "../lib/api.js";

export default function LyricCreator({
  lyrics,
  setLyrics,
  styleReference,
  setStyleReference,
  onFinalize,
  finalized,
}) {
  const [talkText, setTalkText] = useState("");
  const [revisionRequest, setRevisionRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setError("");
    if (!talkText.trim()) {
      setError("Please paste the talk text first.");
      return;
    }
    if (!styleReference.trim()) {
      setError("Please provide a style/artist reference before creating the song.");
      return;
    }
    setBusy(true);
    try {
      const { lyrics: out } = await generateLyrics({ talkText, styleReference });
      setLyrics(out);
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
      const { lyrics: out } = await generateLyrics({
        currentLyrics: lyrics,
        revisionRequest,
        styleReference,
      });
      setLyrics(out);
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
      <h2>Lyric Creator</h2>
      <p className="sub">
        Upload or paste a General Conference talk, choose a musical style, and
        generate original lyrics that teach its principles — then revise until
        it sings.
      </p>

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

      <label className="field">
        <span className="lbl">Style / artist reference</span>
        <input
          type="text"
          placeholder="e.g. contemplative piano ballad, or 'in the style of a worship anthem'"
          value={styleReference}
          onChange={(e) => setStyleReference(e.target.value)}
        />
      </label>

      <div className="row">
        <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
          {busy && <span className="spinner" />}
          {lyrics ? "Regenerate from talk" : "Create song lyrics"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {lyrics && (
        <>
          <label className="field" style={{ marginTop: 24 }}>
            <span className="lbl">Lyrics (editable)</span>
            <textarea
              className="lyrics"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="lbl">Request a revision</span>
            <input
              type="text"
              placeholder="e.g. 'make the chorus more hopeful' or 'add a bridge about gratitude'"
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
              {finalized ? "Lyrics finalized ✓" : "Finalize → Scene Organizer"}
            </button>
          </div>

          <p className="note">
            You can keep editing directly in the box, ask for AI revisions, or
            finalize to send these lyrics to the Movie Scene Organizer.
          </p>
        </>
      )}
    </section>
  );
}
