// src/App.jsx
import React, { useState, useRef } from "react";
import LyricCreator from "./components/LyricCreator.jsx";
import SceneOrganizer from "./components/SceneOrganizer.jsx";

const PROJECT_VERSION = 1;

export default function App() {
  const [tab, setTab] = useState("lyrics");
  const [lyrics, setLyrics] = useState("");
  const [finalLyrics, setFinalLyrics] = useState("");
  const [styleReference, setStyleReference] = useState("");

  // Snapshot of the Scene Organizer's state, kept current via onStateChange.
  const sceneStateRef = useRef({ styleBible: null, scenes: [], images: {}, saved: {} });
  // When a project is loaded, we pass this into SceneOrganizer to restore it.
  const [restoreState, setRestoreState] = useState(null);

  const fileInputRef = useRef(null);

  function finalize() {
    setFinalLyrics(lyrics);
    setTab("scenes");
  }

  function saveProject() {
    const project = {
      app: "conference-music-video-studio",
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      lyrics,
      finalLyrics,
      styleReference,
      scene: sceneStateRef.current,
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `music-video-project-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
      setLyrics(project.lyrics || "");
      setFinalLyrics(project.finalLyrics || "");
      setStyleReference(project.styleReference || "");
      const sc = project.scene || { styleBible: null, scenes: [], images: {}, saved: {} };
      sceneStateRef.current = sc;
      setRestoreState({ ...sc, _loadedAt: Date.now() }); // change identity to trigger restore
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
          Save downloads a .json with your lyrics, scenes, and images. Load restores it.
        </span>
      </div>

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

      {tab === "lyrics" ? (
        <LyricCreator
          lyrics={lyrics}
          setLyrics={setLyrics}
          styleReference={styleReference}
          setStyleReference={setStyleReference}
          onFinalize={finalize}
          finalized={Boolean(finalLyrics) && finalLyrics === lyrics}
        />
      ) : (
        <SceneOrganizer
          lyrics={finalLyrics}
          styleReference={styleReference}
          restoreState={restoreState}
          onStateChange={(s) => { sceneStateRef.current = s; }}
        />
      )}
    </div>
  );
}
