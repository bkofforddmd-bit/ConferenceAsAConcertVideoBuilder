// src/components/SceneOrganizer.jsx
import React, { useState } from "react";
import { generateScenes, generateImage } from "../lib/api.js";

export default function SceneOrganizer({ lyrics, styleReference }) {
  const [styleBible, setStyleBible] = useState(null);
  const [scenes, setScenes] = useState([]); // each: {sceneNumber, lyricSection, description, imagePrompt}
  const [images, setImages] = useState({}); // sceneNumber -> dataUrl (working)
  const [saved, setSaved] = useState({}); // sceneNumber -> dataUrl (master folder)
  const [perSceneBusy, setPerSceneBusy] = useState({});
  const [lockReference, setLockReference] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function buildScenes() {
    setError("");
    setBusy(true);
    try {
      const data = await generateScenes({ lyrics, styleReference });
      setStyleBible(data.styleBible || null);
      setScenes((data.scenes || []).slice().sort((a, b) => a.sceneNumber - b.sceneNumber));
      setImages({});
      setSaved({});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function updatePrompt(sceneNumber, value) {
    setScenes((prev) =>
      prev.map((s) => (s.sceneNumber === sceneNumber ? { ...s, imagePrompt: value } : s))
    );
  }

  // The reference image for consistency: the most recent SAVED earlier scene.
  function referenceFor(sceneNumber) {
    if (!lockReference) return "";
    const earlier = Object.keys(saved)
      .map(Number)
      .filter((n) => n < sceneNumber)
      .sort((a, b) => b - a);
    return earlier.length ? saved[earlier[0]] : "";
  }

  async function genImage(scene) {
    setError("");
    setPerSceneBusy((p) => ({ ...p, [scene.sceneNumber]: true }));
    try {
      const { imageDataUrl } = await generateImage({
        prompt: scene.imagePrompt,
        referenceImageB64: referenceFor(scene.sceneNumber),
      });
      setImages((p) => ({ ...p, [scene.sceneNumber]: imageDataUrl }));
    } catch (e) {
      setError(`Scene ${scene.sceneNumber}: ${e.message}`);
    } finally {
      setPerSceneBusy((p) => ({ ...p, [scene.sceneNumber]: false }));
    }
  }

  function saveImage(sceneNumber) {
    const img = images[sceneNumber];
    if (!img) return;
    setSaved((p) => ({ ...p, [sceneNumber]: img }));
  }

  function downloadImage(sceneNumber) {
    const img = saved[sceneNumber] || images[sceneNumber];
    if (!img) return;
    const a = document.createElement("a");
    a.href = img;
    a.download = `Scene_${sceneNumber}.png`;
    a.click();
  }

  function downloadAll() {
    Object.keys(saved)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((n, i) => setTimeout(() => downloadImage(n), i * 250));
  }

  if (!lyrics) {
    return (
      <section className="panel">
        <h2>Movie Scene Organizer</h2>
        <p className="sub">
          Finalize lyrics in the Lyric Creator first. Once finalized, they’ll
          flow here automatically.
        </p>
      </section>
    );
  }

  const savedCount = Object.keys(saved).length;

  return (
    <section className="panel">
      <h2>Movie Scene Organizer</h2>
      <p className="sub">
        Break the finalized song into a visual story. A shared style bible keeps
        characters, palette, and style consistent across every scene.
      </p>

      <div className="row">
        <button className="btn btn-primary" onClick={buildScenes} disabled={busy}>
          {busy && <span className="spinner" />}
          {scenes.length ? "Rebuild scene breakdown" : "Generate scene breakdown"}
        </button>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={lockReference}
            onChange={(e) => setLockReference(e.target.checked)}
          />
          <span className="note" style={{ margin: 0 }}>
            Lock consistency (feed previous saved scene as reference)
          </span>
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {styleBible && (
        <div className="style-bible">
          <h3>Style Bible</h3>
          <dl>
            <dt>Art style</dt><dd>{styleBible.artStyle}</dd>
            <dt>Palette</dt><dd>{styleBible.colorPalette}</dd>
            <dt>Lighting</dt><dd>{styleBible.lighting}</dd>
            <dt>Motifs</dt><dd>{styleBible.recurringMotifs}</dd>
            {Array.isArray(styleBible.characters) && styleBible.characters.length > 0 && (
              <>
                <dt>Characters</dt>
                <dd>
                  {styleBible.characters.map((c, i) => (
                    <div key={i}>
                      <strong>{c.name}:</strong> {c.description}
                    </div>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {scenes.map((scene) => {
        const working = images[scene.sceneNumber];
        const isSaved = saved[scene.sceneNumber];
        const sceneBusy = perSceneBusy[scene.sceneNumber];
        return (
          <div className="scene-card" key={scene.sceneNumber}>
            <div className="scene-head">
              <span className="scene-no">
                Scene {scene.sceneNumber}
                {isSaved && <span className="saved-badge">saved ✓</span>}
              </span>
              <span className="lyric-tag">{scene.lyricSection}</span>
            </div>
            <p className="desc">{scene.description}</p>

            <label className="field">
              <span className="lbl">Image prompt (editable)</span>
              <textarea
                value={scene.imagePrompt}
                onChange={(e) => updatePrompt(scene.sceneNumber, e.target.value)}
                style={{ minHeight: 90 }}
              />
            </label>

            {working ? (
              <img className="scene-image" src={working} alt={`Scene ${scene.sceneNumber}`} />
            ) : (
              <div className="scene-image placeholder">No image yet</div>
            )}

            <div className="row end">
              <button
                className="btn btn-ghost"
                onClick={() => genImage(scene)}
                disabled={sceneBusy}
              >
                {sceneBusy && <span className="spinner" />}
                {working ? "Regenerate" : "Generate image"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => downloadImage(scene.sceneNumber)}
                disabled={!working && !isSaved}
              >
                Download
              </button>
              <button
                className="btn btn-primary"
                onClick={() => saveImage(scene.sceneNumber)}
                disabled={!working}
              >
                Save to master folder
              </button>
            </div>
          </div>
        );
      })}

      {savedCount > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ color: "var(--gold)", margin: 0 }}>
              Master Folder · {savedCount} saved
            </h3>
            <button className="btn btn-ghost" onClick={downloadAll}>
              Download all
            </button>
          </div>
          <div className="gallery" style={{ marginTop: 14 }}>
            {Object.keys(saved)
              .map(Number)
              .sort((a, b) => a - b)
              .map((n) => (
                <figure key={n}>
                  <img src={saved[n]} alt={`Scene ${n}`} />
                  <figcaption>Scene {n}</figcaption>
                </figure>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
