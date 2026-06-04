// src/components/SceneOrganizer.jsx
import React, { useState, useEffect } from "react";
import {
  generateStyleBible,
  generateSceneDetail,
  generateImage,
  extractMeta,
} from "../lib/api.js";

export default function SceneOrganizer({ talkText, lyrics, styleReference, restoreState, onStateChange }) {
  const [styleBible, setStyleBible] = useState(null);
  const [scenes, setScenes] = useState([]); // expanded scenes
  const [images, setImages] = useState({});
  const [saved, setSaved] = useState({});
  const [perSceneBusy, setPerSceneBusy] = useState({});
  const [editNotes, setEditNotes] = useState({}); // sceneNumber -> correction text
  const [lockReference, setLockReference] = useState(true);
  const [meta, setMeta] = useState({
    songTitle: "",
    speaker: "",
    conferenceMonthYear: "",
    session: "",
    scripture: "",
  });
  // endcards: { intro: {image, prompt}, outro: {image, prompt} }
  const [endcards, setEndcards] = useState({ intro: {}, outro: {} });
  const [cardBusy, setCardBusy] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  // Restore from a loaded project file.
  useEffect(() => {
    if (restoreState) {
      setStyleBible(restoreState.styleBible || null);
      setScenes(Array.isArray(restoreState.scenes) ? restoreState.scenes : []);
      setImages(restoreState.images || {});
      setSaved(restoreState.saved || {});
      if (restoreState.meta) setMeta(restoreState.meta);
      if (restoreState.endcards) setEndcards(restoreState.endcards);
    }
  }, [restoreState]);

  // Report current state up so the project can be saved at any time.
  useEffect(() => {
    if (onStateChange) onStateChange({ styleBible, scenes, images, saved, meta, endcards });
  }, [styleBible, scenes, images, saved, meta, endcards, onStateChange]);

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

  const DISCLAIMER =
    "This music and video presentation is not an official production of " +
    "The Church of Jesus Christ of Latter-day Saints and is not endorsed by " +
    "the Church. The creators of this presentation fully and wholeheartedly " +
    "sustain and support the Church, its leaders, doctrines, and teachings.";

  async function autofillMeta() {
    setError("");
    try {
      const m = await extractMeta({ talkText: talkText || "", lyrics });
      setMeta((prev) => ({
        songTitle: prev.songTitle || m.songTitle || "",
        speaker: prev.speaker || m.speaker || "",
        conferenceMonthYear: prev.conferenceMonthYear || m.conferenceMonthYear || "",
        session: prev.session || m.session || "",
        scripture: prev.scripture || "",
      }));
    } catch (e) {
      setError(`Auto-fill: ${e.message}`);
    }
  }

  function introText() {
    const lines = [];
    if (meta.songTitle) lines.push(`"${meta.songTitle}"`);
    const adapted = [
      meta.speaker ? `Adapted from a talk given by ${meta.speaker}` : "",
      meta.conferenceMonthYear ? meta.conferenceMonthYear : "",
      meta.session ? meta.session : "",
    ].filter(Boolean);
    if (adapted.length) lines.push(adapted.join(" · "));
    lines.push("General Conference of The Church of Jesus Christ of Latter-day Saints");
    lines.push("");
    lines.push(DISCLAIMER);
    return lines.join("\n");
  }

  function outroText() {
    const lines = [];
    if (meta.songTitle) lines.push(`"${meta.songTitle}"`);
    if (meta.speaker) lines.push(`A song inspired by ${meta.speaker}`);
    lines.push("");
    lines.push("If this message touched your heart, please share this video with someone who may need hope.");
    lines.push("");
    lines.push("• Like the video");
    lines.push("• Subscribe to the channel");
    lines.push("• Turn on notifications");
    if (meta.scripture) {
      lines.push("");
      lines.push(meta.scripture);
    }
    lines.push("");
    lines.push(DISCLAIMER);
    return lines.join("\n");
  }

  function cardBackgroundPrompt(kind) {
    const sb = styleBible || {};
    const styleBits = [
      sb.artStyle ? `Art style: ${sb.artStyle}.` : "",
      sb.colorPalette ? `Color palette: ${sb.colorPalette}.` : "",
      sb.lighting ? `Lighting: ${sb.lighting}.` : "",
    ].filter(Boolean).join(" ");

    // Quote helper so the model treats text as exact strings to render.
    const q = (s) => `"${(s || "").replace(/"/g, "'")}"`;

    if (kind === "intro") {
      const creditParts = [
        meta.speaker ? `A song inspired by ${meta.speaker}` : "",
        meta.conferenceMonthYear ? `Based on a message from ${meta.conferenceMonthYear} General Conference` : "",
        meta.session ? `${meta.session}` : "",
        "of The Church of Jesus Christ of Latter-day Saints",
      ].filter(Boolean);

      return [
        "A cinematic, reverent TITLE CARD for a Latter-day Saint music video,",
        "wide 3:2 landscape, golden-hour atmosphere.",
        styleBits,
        "Render the following text cleanly and legibly, baked into the image,",
        "spelled EXACTLY as written, in an elegant serif typeface:",
        `Large title at top: ${q(meta.songTitle || "Untitled")}.`,
        creditParts.length
          ? `Centered credit lines below the title: ${creditParts.map(q).join(", then ")}.`
          : "",
        "A small disclaimer in a subtle band across the bottom, smaller text,",
        `reading exactly: ${q(DISCLAIMER)}.`,
        "Spelling must be perfect. Keep text crisp, high-contrast, and readable.",
        "Tasteful, uplifting, doctrinally appropriate imagery; no Church logo.",
      ].filter(Boolean).join(" ");
    }

    // outro
    const outroScripture = meta.scripture
      ? `Near the bottom left, an italic scripture quote rendered exactly: ${q(meta.scripture)}.`
      : "";
    return [
      "A cinematic, reverent CLOSING CARD for a Latter-day Saint music video,",
      "wide 3:2 landscape, warm golden-hour atmosphere.",
      styleBits,
      "Render all text cleanly and legibly, baked into the image, spelled",
      "EXACTLY as written, in an elegant serif typeface:",
      `Large title at top: ${q(meta.songTitle || "Untitled")}.`,
      meta.speaker ? `Italic credit line below the title: ${q("A song inspired by " + meta.speaker)}.` : "",
      `An upper-left invitation in a few lines, reading exactly: ${q("If this message touched your heart, please share this video with someone who may need hope.")}`,
      "Below that, a vertical stack of three call-to-action rows on the left,",
      "each with a small gold circular icon and a label, reading exactly:",
      `a thumbs-up icon with ${q("LIKE THE VIDEO")}, a play-button icon with ${q("SUBSCRIBE TO THE CHANNEL")}, and a bell icon with ${q("TURN ON NOTIFICATIONS")}.`,
      outroScripture,
      "A small disclaimer in a subtle band across the very bottom, smaller text,",
      `reading exactly: ${q(DISCLAIMER)}.`,
      "Spelling must be perfect. Keep all text crisp, high-contrast, readable.",
      "Tasteful, uplifting, doctrinally appropriate imagery; no Church logo.",
    ].filter(Boolean).join(" ");
  }

  async function genCard(kind) {
    setError("");
    setCardBusy((p) => ({ ...p, [kind]: true }));
    try {
      const prompt = endcards[kind]?.prompt?.trim() || cardBackgroundPrompt(kind);
      const { imageDataUrl } = await generateImage({ prompt, size: "1536x1024" });
      setEndcards((p) => ({
        ...p,
        [kind]: { ...p[kind], image: imageDataUrl, prompt },
      }));
    } catch (e) {
      setError(`${kind === "intro" ? "Intro" : "Outro"} card: ${e.message}`);
    } finally {
      setCardBusy((p) => ({ ...p, [kind]: false }));
    }
  }

  function setCardImage(kind, dataUrl) {
    setEndcards((p) => ({ ...p, [kind]: { ...p[kind], image: dataUrl } }));
  }

  async function handleCardUpload(kind, e) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    try {
      setCardImage(kind, await fileToDataUrl(file));
    } catch {
      setError("Couldn't read that file.");
    }
    e.target.value = "";
  }

  function downloadCardText(kind) {
    const text = kind === "intro" ? introText() : outroText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind === "intro" ? "Intro" : "Outro"}_text.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCardImage(kind) {
    const img = endcards[kind]?.image;
    if (!img) return;
    const a = document.createElement("a");
    a.href = img;
    a.download = `${kind === "intro" ? "00_Intro" : "99_Outro"}.png`;
    a.click();
  }

  async function genImage(scene) {
    setError("");
    setPerSceneBusy((p) => ({ ...p, [scene.sceneNumber]: true }));
    try {
      const notes = (editNotes[scene.sceneNumber] || "").trim();
      const prompt = notes
        ? `${scene.imagePrompt}\n\nIMPORTANT CORRECTIONS — apply these changes: ${notes}`
        : scene.imagePrompt;
      const { imageDataUrl } = await generateImage({
        prompt,
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

      {scenes.length > 0 && (
        <div className="endcard-block">
          <h3 className="endcard-h">Title &amp; Credits</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Used on the intro and outro cards. Auto-fill pulls what it can from
            the talk; edit anything.
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="btn btn-ghost" onClick={autofillMeta}>
              Auto-fill from talk
            </button>
          </div>
          <label className="field">
            <span className="lbl">Song title</span>
            <input type="text" value={meta.songTitle}
              onChange={(e) => setMeta((m) => ({ ...m, songTitle: e.target.value }))} />
          </label>
          <label className="field">
            <span className="lbl">Speaker / General Authority</span>
            <input type="text" placeholder="e.g. Elder ..."
              value={meta.speaker}
              onChange={(e) => setMeta((m) => ({ ...m, speaker: e.target.value }))} />
          </label>
          <label className="field">
            <span className="lbl">Conference month &amp; year</span>
            <input type="text" placeholder="e.g. April 2026"
              value={meta.conferenceMonthYear}
              onChange={(e) => setMeta((m) => ({ ...m, conferenceMonthYear: e.target.value }))} />
          </label>
          <label className="field">
            <span className="lbl">Session</span>
            <input type="text" placeholder="e.g. Sunday Morning Session"
              value={meta.session}
              onChange={(e) => setMeta((m) => ({ ...m, session: e.target.value }))} />
          </label>
          <label className="field">
            <span className="lbl">Closing scripture (shown on the outro)</span>
            <input type="text" placeholder={'e.g. "I will give away all my sins to know thee." — Alma 22:18'}
              value={meta.scripture}
              onChange={(e) => setMeta((m) => ({ ...m, scripture: e.target.value }))} />
          </label>
        </div>
      )}

      {scenes.length > 0 && (
        <EndCard
          kind="intro"
          label="Intro / Title Card"
          text={introText()}
          card={endcards.intro}
          busy={cardBusy.intro}
          onGenerate={() => genCard("intro")}
          onUpload={(e) => handleCardUpload("intro", e)}
          onDownloadImage={() => downloadCardImage("intro")}
          onDownloadText={() => downloadCardText("intro")}
        />
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

            <label className="field" style={{ marginTop: 4 }}>
              <span className="lbl">
                Revision notes (optional — applied when you regenerate)
              </span>
              <input
                type="text"
                placeholder="e.g. 'turn the list of names right-side up' or 'fewer light streaks'"
                value={editNotes[scene.sceneNumber] || ""}
                onChange={(e) =>
                  setEditNotes((p) => ({ ...p, [scene.sceneNumber]: e.target.value }))
                }
              />
            </label>

            <div className="row end">
              <button
                className="btn btn-ghost"
                onClick={() => genImage(scene)}
                disabled={sceneBusy || !scene.imagePrompt}
              >
                {sceneBusy && <span className="spinner" />}
                {working
                  ? (editNotes[scene.sceneNumber] || "").trim()
                    ? "Regenerate with notes"
                    : "Regenerate here"
                  : "Generate image here"}
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

      {scenes.length > 0 && (
        <EndCard
          kind="outro"
          label="Outro / Closing Card"
          text={outroText()}
          card={endcards.outro}
          busy={cardBusy.outro}
          onGenerate={() => genCard("outro")}
          onUpload={(e) => handleCardUpload("outro", e)}
          onDownloadImage={() => downloadCardImage("outro")}
          onDownloadText={() => downloadCardText("outro")}
        />
      )}

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

function EndCard({ kind, label, text, card, busy, onGenerate, onUpload, onDownloadImage, onDownloadText }) {
  const img = card?.image;
  return (
    <div className="scene-card endcard">
      <div className="scene-head">
        <span className="scene-no">{label}</span>
        <span className="lyric-tag">{kind === "intro" ? "before Scene 1" : "after last scene"}</span>
      </div>

      <label className="field">
        <span className="lbl">Exact text (copy/overlay this in your video editor)</span>
        <textarea value={text} readOnly style={{ minHeight: 130 }} />
      </label>

      {img ? (
        <img className="scene-image" src={img} alt={label} />
      ) : (
        <div className="scene-image placeholder">
          No background yet — generate a styled background, or upload your own card
        </div>
      )}

      <div className="byo-image">
        <label className="byo-row">
          <span className="byo-label">Upload your own card image</span>
          <input type="file" accept="image/*" onChange={onUpload} />
        </label>
        <span className="note" style={{ margin: "4px 0 0" }}>
          The generated card bakes the text in. If a word is misspelled on a
          given try, just regenerate — or upload your own finished card. The
          exact text is shown above so you can verify or overlay it yourself.
        </span>
      </div>

      <div className="row end">
        <button className="btn btn-ghost" onClick={onGenerate} disabled={busy}>
          {busy && <span className="spinner" />}
          {img ? "Regenerate background" : "Generate background"}
        </button>
        <button className="btn btn-ghost" onClick={onDownloadText}>
          Download text
        </button>
        <button className="btn btn-ghost" onClick={onDownloadImage} disabled={!img}>
          Download image
        </button>
      </div>
    </div>
  );
}
