// src/App.jsx
import React, { useState, useRef, useEffect } from "react";
import LyricCreator from "./components/LyricCreator.jsx";
import SceneOrganizer from "./components/SceneOrganizer.jsx";

const PROJECT_VERSION = 2;
const AUTOSAVE_KEY = "cmvs-autosave-v1";

export default function App() {
  const [tab, setTab] = useState("lyrics");
  const [talkText, setTalkText] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [finalLyrics, setFinalLyrics] = useState("");
  const [styleReference, setStyleReference] = useState("");

  const sceneStateRef = useRef({ styleBible: null, scenes: [], images: {}, saved: {}, meta: {}, endcards: {} });
  const [restoreState, setRestoreState] = useState(null);
  const [restoredNote, setRestoredNote] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const fileInputRef = useRef(null);

  // On first load, offer to restore the last auto-saved session (if any).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && saved.app === "conference-music-video-studio") {
        setTalkText(saved.talkText || "");
        setLyrics(saved.lyrics || "");
        setFinalLyrics(saved.finalLyrics || "");
        setStyleReference(saved.styleReference || "");
        const sc = saved.scene || sceneStateRef.current;
        sceneStateRef.current = sc;
        setRestoreState({ ...sc, _loadedAt: Date.now() });
        if (saved.finalLyrics) setTab("scenes");
        setRestoredNote(true);
      }
    } catch {}
  }, []);

  // Auto-save to the browser periodically and on changes, so an accidental
  // reload or closed tab doesn't lose work. This is local to the browser only.
  useEffect(() => {
    const save = () => {
      try {
        const payload = {
          app: "conference-music-video-studio",
          version: PROJECT_VERSION,
          savedAt: new Date().toISOString(),
          talkText, lyrics, finalLyrics, styleReference,
          scene: sceneStateRef.current,
        };
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      } catch {}
    };
    const id = setInterval(save, 5000);
    window.addEventListener("beforeunload", save);
    return () => { clearInterval(id); window.removeEventListener("beforeunload", save); };
  }, [talkText, lyrics, finalLyrics, styleReference]);

  function finalize() {
    setFinalLyrics(lyrics);
    setTab("scenes");
  }

  function startNewProject() {
    const ok = window.confirm(
      "Start a new project? This clears the current talk, lyrics, scenes, and images from the app. " +
      "Make sure you've saved anything you want to keep (Save project)."
    );
    if (!ok) return;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
    setTalkText("");
    setLyrics("");
    setFinalLyrics("");
    setStyleReference("");
    const empty = { styleBible: null, scenes: [], images: {}, saved: {}, meta: {}, endcards: {} };
    sceneStateRef.current = empty;
    setRestoreState({ ...empty, _loadedAt: Date.now() });
    setRestoredNote(false);
    setTab("lyrics");
  }

  function saveProject() {
    try {
      const sc = sceneStateRef.current || {};
      const imgCount = Object.keys(sc.images || {}).length + Object.keys(sc.saved || {}).length;
      const project = {
        app: "conference-music-video-studio",
        version: PROJECT_VERSION,
        savedAt: new Date().toISOString(),
        talkText,
        lyrics,
        finalLyrics,
        styleReference,
        scene: sc,
      };
      const jsonStr = JSON.stringify(project);
      const sizeMB = (jsonStr.length / (1024 * 1024)).toFixed(1);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `music-video-project-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setSaveMsg(`Saved (${sizeMB} MB, ${imgCount} image${imgCount === 1 ? "" : "s"}). Check your Downloads folder.`);
      setTimeout(() => setSaveMsg(""), 6000);
    } catch (e) {
      setSaveMsg(`Save failed: ${e.message}. Try again.`);
    }
  }

  async function loadProjectFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = JSON.parse(text);
      if (project.app !== "conference-music-video-studio") {
        alert("That doesn't look like a Music Video Studio project file.");
        return;
      }
      setTalkText(project.talkText || "");
      setLyrics(project.lyrics || "");
      setFinalLyrics(project.finalLyrics || "");
      setStyleReference(project.styleReference || "");
      const sc = project.scene || { styleBible: null, scenes: [], images: {}, saved: {}, meta: {}, endcards: {} };
      sceneStateRef.current = sc;
      setRestoreState({ ...sc, _loadedAt: Date.now() });
      setTab(project.finalLyrics ? "scenes" : "lyrics");
    } catch (err) {
      alert("Couldn't read that project file. Is it a valid .json export?");
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <h1>
          Conference <span className="accent">Music Video</span> Studio
        </h1>
        <p>From talk, to song, to a consistent visual story.</p>
      </header>

      <div className="project-bar">
        <button className="btn btn-ghost" onClick={saveProject}>
          Save project
        </button>
        <button className="btn btn-ghost" onClick={startNewProject} title="Clear everything and begin a fresh project">
          Start new
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
        >
          Load project
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={loadProjectFile}
        />
        <span className="note" style={{ margin: 0 }}>
          Save downloads a .json with your talk, lyrics, scenes, and images. Load restores it.
        </span>
      </div>

      {saveMsg && (
        <div className="note" style={{ textAlign: "center", marginBottom: 12, color: "var(--gold)" }}>
          {saveMsg}
        </div>
      )}
      {restoredNote && (
        <div className="note" style={{ textAlign: "center", marginBottom: 12 }}>
          Restored your last session automatically.{" "}
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 10px", fontSize: 13 }}
            onClick={() => setRestoredNote(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      <nav className="tabs">
        <button
          className={`tab ${tab === "lyrics" ? "active" : ""}`}
          onClick={() => setTab("lyrics")}
        >
          1 · Lyric Creator
        </button>
        <button
          className={`tab ${tab === "scenes" ? "active" : ""}`}
          onClick={() => setTab("scenes")}
          disabled={!finalLyrics}
          title={!finalLyrics ? "Finalize lyrics first" : ""}
        >
          2 · Movie Scene Organizer
        </button>
      </nav>

      <div style={{ display: tab === "lyrics" ? "block" : "none" }}>
        <LyricCreator
          talkText={talkText}
          setTalkText={setTalkText}
          lyrics={lyrics}
          setLyrics={setLyrics}
          styleReference={styleReference}
          setStyleReference={setStyleReference}
          onFinalize={finalize}
          finalized={Boolean(finalLyrics) && finalLyrics === lyrics}
        />
      </div>

      <div style={{ display: tab === "scenes" ? "block" : "none" }}>
        <SceneOrganizer
          talkText={talkText}
          lyrics={finalLyrics}
          styleReference={styleReference}
          restoreState={restoreState}
          onStateChange={(s) => { sceneStateRef.current = s; }}
        />
      </div>
    </div>
  );
}
