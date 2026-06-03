// src/App.jsx
import React, { useState } from "react";
import LyricCreator from "./components/LyricCreator.jsx";
import SceneOrganizer from "./components/SceneOrganizer.jsx";

export default function App() {
  const [tab, setTab] = useState("lyrics");
  const [lyrics, setLyrics] = useState("");
  const [finalLyrics, setFinalLyrics] = useState(""); // what the organizer consumes
  const [styleReference, setStyleReference] = useState("");

  function finalize() {
    setFinalLyrics(lyrics);
    setTab("scenes");
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <h1>
          Conference <span className="accent">Music Video</span> Studio
        </h1>
        <p>From talk, to song, to a consistent visual story.</p>
      </header>

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
        <SceneOrganizer lyrics={finalLyrics} styleReference={styleReference} />
      )}
    </div>
  );
}
