// src/components/SceneOrganizer.jsx
import React, { useState } from "react";
import {
  generateStyleBible,
  generateSceneDetail,
  generateImage,
} from "../lib/api.js";

export default function SceneOrganizer({ lyrics, styleReference }) {
  const [styleBible, setStyleBible] = useState(null);
  const [scenes, setScenes] = useState([]); // expanded scenes
  const [images, setImages] = useState({});
  const [saved, setSaved] = useState({});
  const [perSceneBusy, setPerSceneBusy] = useState({});
  const [lockReference, setLockReference] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  // Step 1: style bible + outline. Step 2: expand each scene one-by-one.
  async function buildScenes() {
    setError("");
    setProgress("");
    setBusy(true);
    setScenes([]);
    setImages({});
    setSaved({});
    setStyleBible(null);

    try {
      setProgress("Designing the visual style…");
      const bibleData = await generateStyleBible({ lyrics, styleReference });
      const bible = bibleData.styleBible || null;
      const outline = (bibleData.outline || [])
        .slice()
        .sort((a, b) => a.sceneNumber - b.sceneNumber);
      setStyleBible(bible);

      // Expand scenes sequentially so each request stays small and fast.
      const expanded = [];
      for (let i = 0; i < outline.length; i++) {
        const beat = outline[i];
        setProgress(`Writing scene ${i + 1} of ${outline.length}…`);
        try {
          const detail = await generateSceneDetail({
            styleBible: bible,
            scene: beat,
            styleReference,
          });
          expanded.push({
            sceneNumber: detail.sceneNumber ?? beat.sceneNumber,
            lyricSection: detail.lyricSection ?? beat.lyricSection,
            description: detail.description ?? beat.beat ?? "",
            imagePrompt: detail.imagePrompt ?? "",
          });
        } catch (e) {
          // If one scene fails, keep the outline beat as a fallback.
          expanded.push({
            sceneNumber: beat.sceneNumber,
            lyricSection: beat.lyricSection,
            description: beat.beat || "",
            imagePrompt: "",
          });
        }
        setScenes(expanded.slice()); // show progress as scenes arrive
      }
      setProgress("");
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

  // --- Manual image input: upload, URL, paste ---

  function setSceneImage(sceneNumber, dataUrl) {
    setImages((p) => ({ ...p, [sceneNumber]: dataUrl }));
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleUpload(sceneNumber, e) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(`Scene ${sceneNumber}: please choose an image file.`);
      return;
    }
    try {
      setSceneImage(sceneNumber, await fileToDataUrl(file));
    } catch {
      setError(`Scene ${sceneNumber}: couldn't read that file.`);
    }
    e.target.value = "";
  }

  async function handlePaste(sceneNumber, e) {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          try {
            setSceneImage(sceneNumber, await fileToDataUrl(file));
          } catch {
            setError(`Scene ${sceneNumber}: couldn't read the pasted image.`);
          }
        }
        return;
      }
    }
  }

  function handleUrlConfirm(sceneNumber, url) {
    setError("");
    const u = (url || "").trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u) && !/^data:image\//i.test(u)) {
      setError(`Scene ${sceneNumber}: that doesn't look like an image URL.`);
      return;
    }
    setSceneImage(sceneNumber, u);
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

      {busy && progress && (
        <p className="note" style={{ marginTop: 12 }}>{progress}</p>
      )}

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
              <span className="lbl">Image prompt (copy into ChatGPT, or generate below)</span>
              <textarea
                value={scene.imagePrompt}
                onChange={(e) => updatePrompt(scene.sceneNumber, e.target.value)}
                style={{ minHeight: 90 }}
              />
            </label>

            {working ? (
              <img className="scene-image" src={working} alt={`Scene ${scene.sceneNumber}`} />
            ) : (
              <div
                className="scene-image placeholder"
                tabIndex={0}
                onPaste={(e) => handlePaste(scene.sceneNumber, e)}
                title="Click here, then paste an image (Ctrl/Cmd+V)"
              >
                No image yet — generate, upload, paste a URL, or click here & paste an image
              </div>
            )}

            <div className="byo-image">
              <label className="byo-row">
                <span className="byo-label">Upload image file</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleUpload(scene.sceneNumber, e)}
                />
              </label>
              <label className="byo-row">
                <span className="byo-label">…or paste an image URL</span>
                <input
                  type="text"
                  placeholder="https://… (then press Enter)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUrlConfirm(scene.sceneNumber, e.target.value);
                  }}
                  onBlur={(e) => {
                    if (e.target.value.trim()) handleUrlConfirm(scene.sceneNumber, e.target.value);
                  }}
                />
              </label>
              <span className="note" style={{ margin: "4px 0 0" }}>
                Tip: copy this scene's prompt into ChatGPT, make the image there,
                then upload or paste it back here.
              </span>
            </div>

            <div className="row end">
              <button
                className="btn btn-ghost"
                onClick={() => genImage(scene)}
                disabled={sceneBusy || !scene.imagePrompt}
              >
                {sceneBusy && <span className="spinner" />}
                {working ? "Regenerate here" : "Generate image here"}
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
