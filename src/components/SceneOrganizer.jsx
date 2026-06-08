// src/components/SceneOrganizer.jsx
import React, { useState, useEffect } from "react";
import {
  generateStyleBible,
  generateOutline,
  generateSceneDetail,
  generateImage,
  extractMeta,
  describeImage,
  matchImages,
  outlineFromImages,
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
  const [unmatched, setUnmatched] = useState([]); // data URLs not auto-placed
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
  async function buildOutlineFromImages(fileList) {
    setError("");
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) { setError("Choose one or more image files."); return; }
    if (!lyrics || !lyrics.trim()) {
      setError("Finalize your lyrics first — the outline is built from the lyrics and your images.");
      return;
    }
    setBusy(true);
    setProgress("");
    try {
      // 1) Read files to data URLs (keep upload order as the original index).
      setProgress(`Reading ${files.length} images…`);
      const dataUrls = await Promise.all(files.map(fileToDataUrl));

      // 2) Describe each image with vision.
      const descriptions = [];
      for (let i = 0; i < dataUrls.length; i++) {
        setProgress(`Describing image ${i + 1} of ${dataUrls.length}…`);
        try {
          const { description } = await describeImage({ imageDataUrl: dataUrls[i] });
          descriptions.push(description || `Image ${i}`);
        } catch {
          descriptions.push(`Image ${i}`);
        }
      }

      // 3) Build the outline FROM lyrics + images: one scene per image,
      //    AI decides order and the lyric pairing.
      setProgress("Building the scene outline from your lyrics and images…");
      const { outline } = await outlineFromImages({ lyrics, images: descriptions });
      if (!outline || !outline.length) throw new Error("No outline returned.");

      // 4) Make a style bible too (nice to have for consistency / prompts),
      //    but don't block on it.
      let bible = null;
      try {
        setProgress("Designing the visual style…");
        const bibleData = await generateStyleBible({ lyrics, styleReference, talkText: talkText || "" });
        bible = bibleData.styleBible || null;
      } catch { /* optional */ }
      setStyleBible(bible);

      // 5) Turn the outline into scenes, attach each image, fill detail.
      const sorted = outline.slice().sort((a, b) => a.sceneNumber - b.sceneNumber);
      const newScenes = [];
      const newImages = {};
      for (let idx = 0; idx < sorted.length; idx++) {
        const o = sorted[idx];
        const n = idx + 1; // renumber sequentially for safety
        setProgress(`Writing scene ${n} of ${sorted.length}…`);
        let detail = { description: "", imagePrompt: "" };
        try {
          detail = await generateSceneDetail({
            styleBible: bible,
            scene: { sceneNumber: n, lyricSection: o.lyricSection, beat: o.beat },
            styleReference,
          });
        } catch { /* keep going even if one detail call fails */ }
        newScenes.push({
          sceneNumber: n,
          lyrics: o.lyrics || "",
          lyricSection: o.lyricSection || detail.lyricSection || "",
          description: detail.description || "",
          imagePrompt: detail.imagePrompt || "",
        });
        if (o.imageIndex != null && dataUrls[o.imageIndex]) {
          newImages[n] = dataUrls[o.imageIndex];
        }
      }

      setScenes(newScenes);
      setImages(newImages);
      setSaved({});
      // Any images the model didn't assign land in the tray for manual placing.
      const used = new Set(sorted.map((o) => o.imageIndex).filter((x) => x != null));
      setUnmatched(dataUrls.filter((_, i) => !used.has(i)));

      setProgress(`Built ${newScenes.length} scenes from your images. Review, reorder, or reassign as needed.`);
    } catch (e) {
      setError(`Build from images: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

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
      const bibleData = await generateStyleBible({ lyrics, styleReference, talkText: talkText || "" });
      const bible = bibleData.styleBible || null;
      setStyleBible(bible);

      setProgress("Outlining the scenes…");
      const outlineData = await generateOutline({ lyrics, styleBible: bible, talkText: talkText || "" });
      const outline = (outlineData.outline || [])
        .slice()
        .sort((a, b) => a.sceneNumber - b.sceneNumber);

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
            lyrics: beat.lyrics || "",
            lyricSection: detail.lyricSection ?? beat.lyricSection,
            description: detail.description ?? beat.beat ?? "",
            imagePrompt: detail.imagePrompt ?? "",
          });
        } catch (e) {
          // If one scene fails, keep the outline beat as a fallback.
          expanded.push({
            sceneNumber: beat.sceneNumber,
            lyrics: beat.lyrics || "",
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

  function updateLyrics(sceneNumber, value) {
    setScenes((prev) =>
      prev.map((s) => (s.sceneNumber === sceneNumber ? { ...s, lyrics: value } : s))
    );
  }

  const [copiedScene, setCopiedScene] = useState(null);
  function copyScenePrompt(sceneNumber, text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text || "");
    setCopiedScene(sceneNumber);
    setTimeout(() => setCopiedScene((c) => (c === sceneNumber ? null : c)), 1500);
  }

  // Re-key an object whose keys are scene numbers, shifting any key > afterNum up by 1.
  function shiftKeyedUp(obj, afterNum) {
    const out = {};
    Object.keys(obj).forEach((k) => {
      const n = Number(k);
      out[n > afterNum ? n + 1 : n] = obj[k];
    });
    return out;
  }

  async function insertSceneAfter(afterNum) {
    setError("");
    setPerSceneBusy((p) => ({ ...p, [`ins-${afterNum}`]: true }));
    try {
      const before = scenes.find((s) => s.sceneNumber === afterNum) || null;
      const after = scenes.find((s) => s.sceneNumber === afterNum + 1) || null;

      // Ask the detail generator for a bridging scene between the two neighbors.
      const bridgeBeat = {
        sceneNumber: afterNum + 1,
        lyricSection: before ? `Transition after ${before.lyricSection}` : "Transition",
        beat:
          "A short TRANSITION scene that visually bridges these two moments" +
          (before ? `, FROM: ${before.description || before.imagePrompt}` : "") +
          (after ? `, TO: ${after.description || after.imagePrompt}` : "") +
          ". Keep it a smooth connective shot consistent with the style bible.",
      };

      const detail = await generateSceneDetail({
        styleBible,
        scene: bridgeBeat,
        styleReference,
      });

      const newScene = {
        sceneNumber: afterNum + 1,
        lyricSection: detail.lyricSection || bridgeBeat.lyricSection,
        description: detail.description || "",
        imagePrompt: detail.imagePrompt || "",
        isTransition: true,
      };

      // Renumber scenes: bump everything after, insert the new one.
      setScenes((prev) => {
        const bumped = prev.map((s) =>
          s.sceneNumber > afterNum ? { ...s, sceneNumber: s.sceneNumber + 1 } : s
        );
        return [...bumped, newScene].sort((a, b) => a.sceneNumber - b.sceneNumber);
      });
      // Shift keyed state so existing images/saved/notes stay attached to the right scenes.
      setImages((p) => shiftKeyedUp(p, afterNum));
      setSaved((p) => shiftKeyedUp(p, afterNum));
      setEditNotes((p) => shiftKeyedUp(p, afterNum));
    } catch (e) {
      setError(`Add scene: ${e.message}`);
    } finally {
      setPerSceneBusy((p) => ({ ...p, [`ins-${afterNum}`]: false }));
    }
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

  async function loadPptxLib() {
    if (window.PptxGenJS) return window.PptxGenJS;
    // Bundled with the app (no external CDN dependency).
    const mod = await import("pptxgenjs");
    return mod.default || mod;
  }

  async function exportPptx() {
    setError("");
    setProgress("Preparing PowerPoint…");
    let Pptx;
    try {
      Pptx = await loadPptxLib();
    } catch (e) {
      setProgress("");
      setError(`PowerPoint export: ${e.message}. Try again, or check your connection.`);
      return;
    }
    try {
      const pptx = new Pptx();
      pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
      pptx.layout = "WIDE";

      const NAVY = "0E1330";
      const PANEL = "161D44";
      const GOLD = "D9B45B";
      const INK = "F4ECDC";
      const SOFT = "C9BDA4";

      const titleText = meta.songTitle || "Untitled Song";

      // Helper: a full-bleed image slide (image fit within frame on navy).
      // Read an image's natural dimensions from its data URL.
      const imgSize = (dataUrl) => new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => resolve(null);
        im.src = dataUrl;
      });

      // Fit (w,h) into a box, preserving aspect ratio; return centered x,y,w,h.
      const fitBox = (natW, natH, boxX, boxY, boxW, boxH) => {
        if (!natW || !natH) return { x: boxX, y: boxY, w: boxW, h: boxH };
        const scale = Math.min(boxW / natW, boxH / natH);
        const w = natW * scale;
        const h = natH * scale;
        const x = boxX + (boxW - w) / 2;
        const y = boxY + (boxH - h) / 2;
        return { x, y, w, h };
      };

      const addImageSlide = async (dataUrl, captionTop) => {
        const s = pptx.addSlide();
        s.background = { color: NAVY };
        if (captionTop) {
          s.addText(captionTop, {
            x: 0.5, y: 0.15, w: 12.33, h: 0.9, align: "center", valign: "top",
            fontFace: "Georgia", fontSize: 13, color: GOLD, italic: true,
          });
        }
        if (dataUrl) {
          const dim = await imgSize(dataUrl);
          const box = fitBox(dim?.w, dim?.h, 0.5, 1.15, 12.33, 5.95);
          s.addImage({ data: dataUrl, x: box.x, y: box.y, w: box.w, h: box.h });
        } else {
          s.addText("(no image yet — generate or upload this scene)", {
            x: 1, y: 3.2, w: 11.33, h: 1, align: "center",
            fontFace: "Calibri", fontSize: 18, color: SOFT, italic: true,
          });
        }
        return s;
      };

      // Helper: a lyric divider slide.
      const addDivider = (heading, lyric) => {
        const s = pptx.addSlide();
        s.background = { color: PANEL };
        s.addText(heading || "", {
          x: 0.8, y: 0.6, w: 11.7, h: 0.8,
          fontFace: "Georgia", fontSize: 24, bold: true, color: GOLD,
        });
        s.addText(lyric || "", {
          x: 0.8, y: 1.6, w: 11.7, h: 5.3, valign: "top",
          fontFace: "Georgia", fontSize: 30, color: INK, lineSpacingMultiple: 1.2,
        });
        return s;
      };

      // 1) Intro slide
      {
        const s = pptx.addSlide();
        s.background = { color: NAVY };
        if (endcards.intro?.image) {
          const dim = await imgSize(endcards.intro.image);
          const box = fitBox(dim?.w, dim?.h, 0.5, 0.5, 12.33, 6.5);
          s.addImage({ data: endcards.intro.image, x: box.x, y: box.y, w: box.w, h: box.h });
        } else {
          s.addText(titleText, {
            x: 1, y: 2.4, w: 11.33, h: 1.5, align: "center",
            fontFace: "Georgia", fontSize: 44, bold: true, color: GOLD,
          });
          const creditLines = [
            meta.speaker ? `A song inspired by ${meta.speaker}` : "",
            meta.conferenceMonthYear || "",
            meta.session || "",
            "The Church of Jesus Christ of Latter-day Saints",
          ].filter(Boolean).join("\n");
          s.addText(creditLines, {
            x: 1, y: 4, w: 11.33, h: 2, align: "center",
            fontFace: "Calibri", fontSize: 18, color: INK,
          });
        }
      }

      // 1b) Full lyrics slide (for pasting into MelodyCraft / a music tool)
      if (lyrics && lyrics.trim()) {
        const s = pptx.addSlide();
        s.background = { color: PANEL };
        s.addText("Full Lyrics", {
          x: 0.8, y: 0.4, w: 11.7, h: 0.7,
          fontFace: "Georgia", fontSize: 24, bold: true, color: GOLD,
        });
        s.addText("Copy these lyrics into your music generator (e.g. MelodyCraft).", {
          x: 0.8, y: 1.05, w: 11.7, h: 0.4,
          fontFace: "Calibri", fontSize: 12, italic: true, color: SOFT,
        });
        // Auto-size font to roughly fit the lyric length on one slide.
        const len = lyrics.length;
        const lyricFont = len > 1800 ? 11 : len > 1200 ? 13 : len > 700 ? 16 : 20;
        s.addText(lyrics, {
          x: 0.8, y: 1.6, w: 11.7, h: 5.4, valign: "top",
          fontFace: "Calibri", fontSize: lyricFont, color: INK,
          lineSpacingMultiple: 1.05,
        });
      }

      // 2) Each scene: lyric divider, then image slide
      const orderedScenes = scenes
        .slice()
        .sort((a, b) => a.sceneNumber - b.sceneNumber);
      for (const scene of orderedScenes) {
        const n = scene.sceneNumber;
        const img = saved[n] || images[n] || "";
        const heading = `Scene ${n}${scene.isTransition ? " (transition)" : ""}`;
        // Prefer the actual lyric text; fall back to the section label.
        const lyricText = (scene.lyrics && scene.lyrics.trim())
          ? scene.lyrics.trim()
          : (scene.lyricSection || "");
        const sectionLabel = scene.lyricSection || "";
        // Divider: heading + section label + the actual lyric words.
        addDivider(
          sectionLabel ? `${heading} · ${sectionLabel}` : heading,
          lyricText
        );
        // Image slide caption: lyrics first, then the visual description.
        const captionParts = [];
        if (scene.lyrics && scene.lyrics.trim()) captionParts.push(`♪ ${scene.lyrics.trim()}`);
        if (scene.description) captionParts.push(scene.description);
        const caption = captionParts.length
          ? `Scene ${n}: ${truncateCaption(captionParts.join("  —  "), 200)}`
          : heading;
        await addImageSlide(img, caption);
      }

      // 3) Outro slide
      {
        const s = pptx.addSlide();
        s.background = { color: NAVY };
        if (endcards.outro?.image) {
          const dim = await imgSize(endcards.outro.image);
          const box = fitBox(dim?.w, dim?.h, 0.5, 0.5, 12.33, 6.5);
          s.addImage({ data: endcards.outro.image, x: box.x, y: box.y, w: box.w, h: box.h });
        } else {
          s.addText(titleText, {
            x: 1, y: 2, w: 11.33, h: 1.2, align: "center",
            fontFace: "Georgia", fontSize: 40, bold: true, color: GOLD,
          });
          s.addText(
            "If this message touched your heart, please like, share, subscribe, and turn on notifications." +
            (meta.scripture ? `\n\n${meta.scripture}` : ""),
            { x: 1, y: 3.4, w: 11.33, h: 2.5, align: "center", fontFace: "Calibri", fontSize: 18, color: INK }
          );
        }
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const safeTitle = (titleText || "music-video").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      setProgress("Building slides…");
      await pptx.writeFile({ fileName: `${safeTitle}-storyboard-${stamp}.pptx` });
      setProgress("PowerPoint downloaded.");
    } catch (e) {
      setProgress("");
      setError(`PowerPoint export failed: ${e.message}`);
    }
  }

  function truncateCaption(s, n = 140) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  async function genCardDescription(kind) {
    setError("");
    setCardBusy((p) => ({ ...p, [`desc-${kind}`]: true }));
    try {
      const sceneHint =
        kind === "intro"
          ? "the OPENING title card — an establishing, inviting image that sets the song's reverent mood before the story begins"
          : "the CLOSING card — a resolving, hopeful image that leaves the viewer uplifted after the story ends";
      const beat = {
        sceneNumber: 0,
        lyricSection: kind === "intro" ? "Intro / Title Card" : "Outro / Closing Card",
        beat:
          `Background art for ${sceneHint}. It should fit the song's overall ` +
          `style and themes, leave room for text overlay, and feel cinematic ` +
          `and reverent. Song themes from the lyrics: ${(lyrics || "").slice(0, 800)}`,
      };
      const detail = await generateSceneDetail({ styleBible, scene: beat, styleReference });
      setEndcards((p) => ({
        ...p,
        [kind]: {
          ...p[kind],
          description: detail.description || "",
          bgPrompt: detail.imagePrompt || "",
        },
      }));
    } catch (e) {
      setError(`${kind === "intro" ? "Intro" : "Outro"} description: ${e.message}`);
    } finally {
      setCardBusy((p) => ({ ...p, [`desc-${kind}`]: false }));
    }
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
    const bg = endcards[kind]?.bgPrompt
      ? `BACKGROUND SCENE: ${endcards[kind].bgPrompt} `
      : "";

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
        bg,
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
      bg,
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

  async function reviseScene(scene) {
    setError("");
    const notes = (editNotes[scene.sceneNumber] || "").trim();
    if (!notes) {
      setError(`Scene ${scene.sceneNumber}: add a revision note first (what to change).`);
      return;
    }
    setPerSceneBusy((p) => ({ ...p, [`rev-${scene.sceneNumber}`]: true }));
    try {
      const sorted = scenes.slice().sort((a, b) => a.sceneNumber - b.sceneNumber);
      const idx = sorted.findIndex((s) => s.sceneNumber === scene.sceneNumber);
      const prevScene = idx > 0
        ? { lyricSection: sorted[idx - 1].lyricSection, description: sorted[idx - 1].description }
        : null;
      const nextScene = idx < sorted.length - 1
        ? { lyricSection: sorted[idx + 1].lyricSection, description: sorted[idx + 1].description }
        : null;

      const detail = await generateSceneDetail({
        styleBible,
        scene: {
          sceneNumber: scene.sceneNumber,
          lyricSection: scene.lyricSection,
          beat: scene.description || scene.lyricSection,
        },
        styleReference,
        revisionNotes: notes,
        prevScene,
        nextScene,
      });

      setScenes((prev) => prev.map((s) =>
        s.sceneNumber === scene.sceneNumber
          ? {
              ...s,
              description: detail.description || s.description,
              imagePrompt: detail.imagePrompt || s.imagePrompt,
            }
          : s
      ));
      // Clear the note once applied.
      setEditNotes((p) => ({ ...p, [scene.sceneNumber]: "" }));
    } catch (e) {
      setError(`Revise scene ${scene.sceneNumber}: ${e.message}`);
    } finally {
      setPerSceneBusy((p) => ({ ...p, [`rev-${scene.sceneNumber}`]: false }));
    }
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
        <label className="btn btn-ghost" style={{ cursor: "pointer" }} title="Upload finished images; AI builds the scene outline from your lyrics + images (one scene per image)">
          Build outline from images
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { buildOutlineFromImages(e.target.files); e.target.value = ""; }}
          />
        </label>
        {scenes.length > 0 && (
          <button className="btn btn-ghost" onClick={exportPptx} title="Download a PowerPoint storyboard: intro, lyric dividers + scene images, outro">
            Export PowerPoint
          </button>
        )}
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
          fullPrompt={cardBackgroundPrompt("intro")}
          card={endcards.intro}
          busy={cardBusy.intro}
          descBusy={cardBusy["desc-intro"]}
          onGenerate={() => genCard("intro")}
          onDescribe={() => genCardDescription("intro")}
          onUpload={(e) => handleCardUpload("intro", e)}
          onDownloadImage={() => downloadCardImage("intro")}
          onDownloadText={() => downloadCardText("intro")}
        />
      )}

      {unmatched.length > 0 && (
        <div className="endcard-block" style={{ marginTop: 16 }}>
          <h3 className="endcard-h">Unmatched images ({unmatched.length})</h3>
          <p className="note" style={{ marginTop: 0 }}>
            These weren't auto-placed. Pick a scene for each, or leave them out.
          </p>
          <div className="unmatched-grid">
            {unmatched.map((url, i) => (
              <div key={i} className="unmatched-item">
                <img src={url} alt={`Unmatched ${i + 1}`} />
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!n) return;
                    setImages((p) => ({ ...p, [n]: url }));
                    setUnmatched((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  <option value="">Place in scene…</option>
                  {scenes.map((s) => (
                    <option key={s.sceneNumber} value={s.sceneNumber}>
                      Scene {s.sceneNumber} · {(s.lyricSection || "").slice(0, 30)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
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
                {scene.isTransition && <span className="saved-badge" style={{ background: "rgba(91,120,226,0.18)" }}>transition</span>}
                {isSaved && <span className="saved-badge">saved ✓</span>}
              </span>
              <span className="lyric-tag">{scene.lyricSection}</span>
            </div>
            <p className="desc">{scene.description}</p>

            <label className="field">
              <span className="lbl">Lyrics for this scene (shown on the slides)</span>
              <textarea
                value={scene.lyrics || ""}
                placeholder="The actual lyric line(s) this scene illustrates…"
                onChange={(e) => updateLyrics(scene.sceneNumber, e.target.value)}
                style={{ minHeight: 60 }}
              />
            </label>

            <label className="field">
              <span className="lbl">Image prompt (copy into ChatGPT, or generate below)</span>
              <textarea
                value={scene.imagePrompt}
                onChange={(e) => updatePrompt(scene.sceneNumber, e.target.value)}
                style={{ minHeight: 90 }}
              />
              <button
                className="btn btn-ghost"
                style={{ marginTop: 8, alignSelf: "flex-start" }}
                onClick={() => copyScenePrompt(scene.sceneNumber, scene.imagePrompt)}
                disabled={!scene.imagePrompt}
              >
                {copiedScene === scene.sceneNumber ? "Copied ✓" : "Copy prompt"}
              </button>
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
                Revision notes — used to revise the scene text or regenerate the image
              </span>
              <input
                type="text"
                placeholder="e.g. 'make this less like scene 3' or 'show resolve, not despair'"
                value={editNotes[scene.sceneNumber] || ""}
                onChange={(e) =>
                  setEditNotes((p) => ({ ...p, [scene.sceneNumber]: e.target.value }))
                }
              />
            </label>

            <div className="row end">
              <button
                className="btn btn-ghost"
                onClick={() => reviseScene(scene)}
                disabled={perSceneBusy[`rev-${scene.sceneNumber}`] || !(editNotes[scene.sceneNumber] || "").trim()}
                title="Rewrite this scene's description and image prompt using your notes"
              >
                {perSceneBusy[`rev-${scene.sceneNumber}`] && <span className="spinner" />}
                Revise scene text
              </button>
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

            <div className="row" style={{ justifyContent: "center", marginTop: 6 }}>
              <button
                className="btn btn-ghost insert-scene"
                onClick={() => insertSceneAfter(scene.sceneNumber)}
                disabled={perSceneBusy[`ins-${scene.sceneNumber}`]}
                title="Generate a connective scene right after this one"
              >
                {perSceneBusy[`ins-${scene.sceneNumber}`] && <span className="spinner" />}
                + Add transition scene after Scene {scene.sceneNumber}
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
          fullPrompt={cardBackgroundPrompt("outro")}
          card={endcards.outro}
          busy={cardBusy.outro}
          descBusy={cardBusy["desc-outro"]}
          onGenerate={() => genCard("outro")}
          onDescribe={() => genCardDescription("outro")}
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

function EndCard({ kind, label, text, fullPrompt, card, busy, descBusy, onGenerate, onDescribe, onUpload, onDownloadImage, onDownloadText }) {
  const img = card?.image;
  const description = card?.description || "";
  return (
    <div className="scene-card endcard">
      <div className="scene-head">
        <span className="scene-no">{label}</span>
        <span className="lyric-tag">{kind === "intro" ? "before Scene 1" : "after last scene"}</span>
      </div>

      <label className="field">
        <span className="lbl">Exact text (title, credits, disclaimer)</span>
        <textarea value={text} readOnly style={{ minHeight: 110 }} />
      </label>

      {description && (
        <label className="field">
          <span className="lbl">Background scene</span>
          <textarea value={description} readOnly style={{ minHeight: 80 }} />
        </label>
      )}

      <label className="field">
        <span className="lbl">Full image prompt (copy into ChatGPT to make the card)</span>
        <textarea value={fullPrompt} readOnly style={{ minHeight: 120 }} />
        <button
          className="btn btn-ghost"
          style={{ marginTop: 8, alignSelf: "flex-start" }}
          onClick={() => navigator.clipboard && navigator.clipboard.writeText(fullPrompt)}
        >
          Copy prompt
        </button>
      </label>

      {img ? (
        <img className="scene-image" src={img} alt={label} />
      ) : (
        <div className="scene-image placeholder">
          No image yet — copy the prompt into ChatGPT, make the card there, then upload it below
        </div>
      )}

      <div className="byo-image">
        <label className="byo-row">
          <span className="byo-label">Upload the finished card image</span>
          <input type="file" accept="image/*" onChange={onUpload} />
        </label>
        <span className="note" style={{ margin: "4px 0 0" }}>
          Recommended: copy the full prompt above into ChatGPT (or your image
          tool), generate the card with text baked in, then upload it here. This
          is the most reliable way and gives the cleanest text.
        </span>
      </div>

      <div className="row end" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={onDescribe} disabled={descBusy}>
          {descBusy && <span className="spinner" />}
          {description ? "Redescribe background" : "Describe background"}
        </button>
        <button className="btn btn-ghost" onClick={onDownloadText}>
          Download text
        </button>
        <button className="btn btn-ghost" onClick={onDownloadImage} disabled={!img}>
          Download image
        </button>
        <button className="btn btn-ghost" onClick={onGenerate} disabled={busy} title="Image generation can be slow and may time out; copy+upload is more reliable">
          {busy && <span className="spinner" />}
          Try generating here
        </button>
      </div>
    </div>
  );
}
