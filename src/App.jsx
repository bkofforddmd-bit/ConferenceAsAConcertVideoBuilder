// src/App.jsx
//
// Conference As A Concert Studio — application shell.
//
//   Library  → the ConferencePicker (speakers, topics, AI search, insights,
//              quotes, talk builder, Becoming, browse) + the listen bar.
//              ALWAYS mounted (hidden when not shown) so playback survives.
//   Create   → the production pipeline, one step at a time:
//              1 Talk · 2 Lyrics · 3 Music · 4 Storyboard · 5 Video · 6 Export
//   Projects → named projects saved in this browser (IndexedDB) + .json files
//   Settings → API keys
//
// The autosave still writes the same localStorage key the previous version
// used (cmvs-autosave-v1), so anyone mid-project keeps their work.

import React, { useState, useRef, useEffect, useCallback } from "react";
import ConferencePicker from "./components/ConferencePicker.jsx";
import LyricCreator from "./components/LyricCreator.jsx";
import SceneOrganizer from "./components/SceneOrganizer.jsx";
import MusicStudio from "./components/MusicStudio.jsx";
import VideoStudio from "./components/VideoStudio.jsx";
import ProjectsPanel from "./components/ProjectsPanel.jsx";
import ConcertPublish from "./components/ConcertPublish.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import { Lockup } from "./components/Logo.jsx";
import { getConfig } from "./lib/api.js";
import { saveProject as idbSaveProject, loadProject as idbLoadProject, newProjectId, getMedia } from "./lib/project-store.js";
import { folderSupported, getFolderState, chooseFolder, reconnectFolder, exportBundle } from "./lib/export-folder.js";
import { isRendering } from "./lib/video-render.js";

const PROJECT_VERSION = 3;
const AUTOSAVE_KEY = "cmvs-autosave-v1";
const APP_ID = "conference-music-video-studio";

const EMPTY_META = { title: "", speaker: "", speakerTitle: "", conferenceMonthYear: "", session: "", sourceUrl: "" };
const EMPTY_SCENE = { styleBible: null, scenes: [], images: {}, saved: {}, meta: {}, endcards: {} };
const EMPTY_SONG = { versions: [], activeId: null };
const EMPTY_TIMELINE = { starts: {}, introSec: 4, outroSec: 6, lyricsOverlay: true };

const STEPS = [
  { id: "talk", n: "01", name: "Talk", sub: "Choose the message" },
  { id: "lyrics", n: "02", name: "Lyrics", sub: "Write the song" },
  { id: "music", n: "03", name: "Music", sub: "Sing it" },
  { id: "scenes", n: "04", name: "Storyboard", sub: "Scenes & images" },
  { id: "video", n: "05", name: "Video", sub: "Clips, timing, render" },
  { id: "export", n: "06", name: "Export", sub: "Download & share" },
];

export default function App() {
  const [view, setView] = useState("library"); // library | create | projects | settings
  const [step, setStep] = useState("talk");

  const [projectId, setProjectId] = useState(() => newProjectId());
  const [talkText, setTalkText] = useState("");
  const [talkMeta, setTalkMeta] = useState(EMPTY_META);
  const [lyrics, setLyrics] = useState("");
  const [finalLyrics, setFinalLyrics] = useState("");
  const [styleReference, setStyleReference] = useState("");
  const [lyricSources, setLyricSources] = useState(null); // which talk paragraph each lyric line came from
  const [song, setSong] = useState(EMPTY_SONG);
  const [clips, setClips] = useState({});
  const [timeline, setTimeline] = useState(EMPTY_TIMELINE);
  const [render, setRender] = useState(null);

  const sceneStateRef = useRef(EMPTY_SCENE);
  const [sceneSnap, setSceneSnap] = useState(EMPTY_SCENE); // reactive mirror for Music/Video/Export
  const [restoreState, setRestoreState] = useState(null);
  const [restoredNote, setRestoredNote] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [config, setConfig] = useState({ serverKeys: {}, providers: { music: [], video: [] } });
  const [projectsRefresh, setProjectsRefresh] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => { getConfig().then(setConfig); }, []);

  // Stable callback: SceneOrganizer lists it in an effect's deps, so a new
  // identity on every render would re-fire that effect and loop.
  const onSceneStateChange = useCallback((s) => {
    sceneStateRef.current = s;
    setSceneSnap(s);
  }, []);

  // ---- restore the last session ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && saved.app === APP_ID) {
        applyProject(saved);
        setRestoredNote(true);
        if (saved.talkText || saved.lyrics) setView("create");
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyProject(p) {
    setProjectId(p.projectId || newProjectId());
    setTalkText(p.talkText || "");
    setTalkMeta(p.talkMeta || EMPTY_META);
    setLyrics(p.lyrics || "");
    setFinalLyrics(p.finalLyrics || "");
    setStyleReference(p.styleReference || "");
    setLyricSources(p.lyricSources || null);
    setSong(p.song && Array.isArray(p.song.versions) ? p.song : EMPTY_SONG);
    setClips(p.clips && typeof p.clips === "object" ? p.clips : {});
    setTimeline(p.timeline && typeof p.timeline === "object" ? { ...EMPTY_TIMELINE, ...p.timeline } : EMPTY_TIMELINE);
    setRender(p.render || null);
    const sc = p.scene || EMPTY_SCENE;
    sceneStateRef.current = sc;
    setSceneSnap(sc);
    setRestoreState({ ...sc, _loadedAt: Date.now() });
    // Land on the furthest step that has content.
    if (p.render && p.render.mediaKey) setStep("export");
    else if (p.song && p.song.versions && p.song.versions.length && sc.scenes && sc.scenes.length) setStep("video");
    else if (sc.scenes && sc.scenes.length) setStep("scenes");
    else if (p.finalLyrics) setStep("music");
    else if (p.talkText) setStep("lyrics");
    else setStep("talk");
  }

  function buildProject() {
    return {
      app: APP_ID,
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      projectId,
      talkText, talkMeta, lyrics, finalLyrics, styleReference, lyricSources,
      scene: sceneStateRef.current,
      song, clips, timeline, render,
    };
  }

  function projectTitle() {
    const sc = sceneStateRef.current || {};
    return (sc.meta && sc.meta.songTitle) || talkMeta.title || "Untitled project";
  }

  function projectSummary() {
    const sc = sceneStateRef.current || {};
    const firstImg = sc.endcards?.intro?.image || Object.values(sc.images || {})[0] || "";
    return {
      speaker: talkMeta.speaker || "",
      thumb: firstImg ? firstImg.slice(0, 600000) : "", // data URL; capped so the list stays quick
      stages: {
        talk: Boolean(talkText),
        lyrics: Boolean(finalLyrics),
        song: Boolean(song.versions && song.versions.length),
        scenes: Boolean(sc.scenes && sc.scenes.length),
        clips: Object.values(clips || {}).some((c) => c && c.mediaKey),
        video: Boolean(render && render.mediaKey),
      },
    };
  }

  // ---- autosave: localStorage (fast, same key as before) + IndexedDB (named project) ----
  const hasContent = Boolean(talkText || lyrics || finalLyrics);
  // Serialising a project (scene images included) can take a noticeable
  // slice of main-thread time, so it only happens when something changed —
  // and never while a video is being recorded (each stall drops frames).
  const autosaveDirty = useRef(false);
  useEffect(() => {
    autosaveDirty.current = true;
    const save = () => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildProject())); } catch {}
    };
    const saveIdb = () => {
      if (!hasContent) return;
      idbSaveProject(projectId, projectTitle(), buildProject(), projectSummary()).catch(() => {});
    };
    const tick = () => {
      if (isRendering() || !autosaveDirty.current) return;
      autosaveDirty.current = false;
      save(); saveIdb();
    };
    const id = setInterval(tick, 5000);
    window.addEventListener("beforeunload", save);
    return () => { clearInterval(id); window.removeEventListener("beforeunload", save); };
  }, [talkText, lyrics, finalLyrics, styleReference, lyricSources, talkMeta, song, clips, timeline, render, projectId, hasContent, sceneSnap]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveNow() {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildProject())); } catch {}
    if (hasContent) await idbSaveProject(projectId, projectTitle(), buildProject(), projectSummary());
    setProjectsRefresh((n) => n + 1);
  }

  // ---- talk chosen in the Library ----
  // A different talk means a new concert: the current one is saved to
  // Projects and the lyrics / song / scenes / video pipeline starts empty.
  // Re-choosing the same talk just refreshes its text.
  async function handleTalkLoaded({ text, title, speaker, speakerTitle, year, month, session, sourceUrl }) {
    const sameTalk = Boolean(talkMeta.sourceUrl && sourceUrl && talkMeta.sourceUrl === sourceUrl) ||
      Boolean(!talkMeta.sourceUrl && talkMeta.title && title && talkMeta.title === title);
    if (hasContent && !sameTalk) {
      const previous = talkMeta.title || "the previous concert";
      await saveNow();
      resetProjectState();
      setSaveMsg(`Saved “${previous}” to Projects and started a new concert.`);
      setTimeout(() => setSaveMsg(""), 6000);
    }
    setTalkText(text);
    const monthName = month === "10" ? "October" : "April";
    setTalkMeta({
      title: title || "",
      speaker: speaker || "",
      speakerTitle: speakerTitle || "",
      conferenceMonthYear: year ? `${monthName} ${year}` : "",
      session: session || "",
      sourceUrl: sourceUrl || "",
    });
    setView("create");
    setStep("lyrics");
  }

  // Correct which talk this project points at (title, speaker, text, link)
  // WITHOUT touching lyrics, song, scenes or video — for when the stored talk
  // is wrong (e.g. an old bug kept the content but swapped the talk).
  async function fixTalk(uri) {
    const res = await fetch("/.netlify/functions/fetch-talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: uri }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load that talk.");
    const monthName = String(data.month) === "10" ? "October" : "April";
    const meta = {
      title: data.title || "",
      speaker: data.speaker || "",
      speakerTitle: data.speakerTitle || "",
      conferenceMonthYear: data.year ? `${monthName} ${data.year}` : "",
      session: "",
      sourceUrl: data.sourceUrl || `https://www.churchofjesuschrist.org${uri}?lang=eng`,
    };
    setTalkText((data.paragraphs || []).join("\n\n"));
    setTalkMeta(meta);
    setLyricSources(null); // any line index pointed at the old talk's paragraphs
    setSaveMsg(`Project talk corrected to “${meta.title}”.`);
    setTimeout(() => setSaveMsg(""), 6000);
    return meta;
  }

  function finalize() {
    setFinalLyrics(lyrics);
    setStep("music");
  }

  const [confirmNew, setConfirmNew] = useState(false);
  async function startNewProject() {
    if (!confirmNew && hasContent) {
      setConfirmNew(true);
      setTimeout(() => setConfirmNew(false), 5000);
      return;
    }
    setConfirmNew(false);
    await saveNow(); // keep the old one in Projects
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
    resetProjectState();
    setView("library");
    setStep("talk");
  }

  // Fresh project id and empty pipeline (talk, lyrics, song, scenes, video).
  function resetProjectState() {
    setProjectId(newProjectId());
    setTalkText("");
    setTalkMeta(EMPTY_META);
    setLyrics("");
    setFinalLyrics("");
    setStyleReference("");
    setLyricSources(null);
    setSong(EMPTY_SONG);
    setClips({});
    setTimeline(EMPTY_TIMELINE);
    setRender(null);
    sceneStateRef.current = EMPTY_SCENE;
    setSceneSnap(EMPTY_SCENE);
    setRestoreState({ ...EMPTY_SCENE, _loadedAt: Date.now() });
    setRestoredNote(false);
  }

  async function openProject(id) {
    await saveNow();
    const row = await idbLoadProject(id);
    if (!row || !row.data) { setSaveMsg("Couldn't open that project."); return; }
    applyProject(row.data);
    setView("create");
  }

  function downloadProject() {
    try {
      const project = buildProject();
      const jsonStr = JSON.stringify(project);
      const sizeMB = (jsonStr.length / (1024 * 1024)).toFixed(1);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `${projectTitle().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setSaveMsg(`Downloaded (${sizeMB} MB). Note: songs and video clips stay in this browser — the .json carries the talk, lyrics, scenes and images.`);
      setTimeout(() => setSaveMsg(""), 8000);
    } catch (e) {
      setSaveMsg(`Download failed: ${e.message}.`);
    }
  }

  async function loadProjectFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = JSON.parse(text);
      if (project.app !== APP_ID) { setSaveMsg("That doesn't look like a Studio project file."); return; }
      await saveNow();
      applyProject({ ...project, projectId: project.projectId || newProjectId() });
      setView("create");
    } catch {
      setSaveMsg("Couldn't read that project file. Is it a valid .json export?");
    } finally {
      e.target.value = "";
    }
  }

  // Let other steps (the Video step's drawn cards) write into the storyboard's
  // state: merge, mirror, and hand SceneOrganizer the merged state to restore.
  function patchSceneState(fn) {
    const merged = fn(sceneStateRef.current || EMPTY_SCENE);
    sceneStateRef.current = merged;
    setSceneSnap(merged);
    setRestoreState({ ...merged, _loadedAt: Date.now() });
  }
  // Scene numbers changed (a scene was inserted or deleted): re-key every map
  // that hangs off a scene number — clips, and the timeline's starts, line
  // times, extra shots, motion, weights and camera paths (keys are "n" or
  // "n:extra:id"). mapNum(old) → new number, or null when the scene is gone.
  function remapSceneKeys(obj, mapNum) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const m = /^(\d+)(.*)$/.exec(k);
      if (!m) { out[k] = v; continue; }
      const nn = mapNum(Number(m[1]));
      if (nn == null) continue;
      out[String(nn) + m[2]] = v;
    }
    return out;
  }
  function renumberScenes(mapNum) {
    setClips((prev) => remapSceneKeys(prev, mapNum));
    setTimeline((tl) => ({
      ...tl,
      starts: remapSceneKeys(tl.starts, mapNum),
      lineStarts: remapSceneKeys(tl.lineStarts, mapNum),
      extras: remapSceneKeys(tl.extras, mapNum),
      motion: remapSceneKeys(tl.motion, mapNum),
      weight: remapSceneKeys(tl.weight, mapNum),
      path: remapSceneKeys(tl.path, mapNum),
      syncFor: "",
    }));
  }
  function setSceneLyrics(map) {
    patchSceneState((s) => ({ ...s, scenes: (s.scenes || []).map((sc) => (map[sc.sceneNumber] != null ? { ...sc, lyrics: map[sc.sceneNumber] } : sc)) }));
  }
  function setCardImage(kind, dataUrl) {
    patchSceneState((s) => ({ ...s, endcards: { ...(s.endcards || {}), [kind]: { ...((s.endcards || {})[kind] || {}), image: dataUrl } } }));
  }

  // ---- export to a folder (Google Drive for Desktop, Dropbox, local…) ----
  const [folder, setFolder] = useState({ status: folderSupported() ? "none" : "unsupported", name: "", handle: null });
  const [exportMsg, setExportMsg] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  useEffect(() => { getFolderState().then(setFolder); }, []);

  async function pickFolder() {
    try { setFolder(await chooseFolder()); setExportMsg(""); } catch {}
  }
  async function reconnectPickedFolder() {
    if (!folder.handle) return;
    if (await reconnectFolder(folder.handle)) setFolder({ ...folder, status: "granted" });
  }
  async function exportToFolder() {
    if (!folder.handle || folder.status !== "granted") return;
    setExportBusy(true);
    setExportResult(null);
    setExportMsg("Gathering files…");
    try {
      const s = sceneStateRef.current || EMPTY_SCENE;
      const images = [];
      if (s.endcards?.intro?.image) images.push({ name: "00_Intro", dataUrl: s.endcards.intro.image });
      const ordered = (s.scenes || []).slice().sort((a, b) => a.sceneNumber - b.sceneNumber);
      for (const scn of ordered) {
        const n = scn.sceneNumber;
        const img = (s.saved || {})[n] || (s.images || {})[n];
        if (img) images.push({ name: `${String(n).padStart(2, "0")}_Scene${n}`, dataUrl: img });
      }
      if (s.endcards?.outro?.image) images.push({ name: "99_Outro", dataUrl: s.endcards.outro.image });
      const act = (song.versions || []).find((v) => v.id === song.activeId);
      const songRec = act && act.mediaKey ? await getMedia(act.mediaKey) : null;
      const vidRec = render && render.mediaKey ? await getMedia(render.mediaKey) : null;
      const result = await exportBundle(folder.handle, {
        title: projectTitle(),
        projectJson: JSON.stringify(buildProject()),
        lyrics: finalLyrics,
        images,
        song: songRec ? songRec.blob : null,
        video: vidRec ? vidRec.blob : null,
      }, setExportMsg);
      setExportResult(result);
      setExportMsg(`Saved to "${folder.name}/${result.folderName}" — ${result.files.length} files.`);
    } catch (e) {
      setExportMsg(`Export failed: ${e.message || e}`);
    } finally {
      setExportBusy(false);
    }
  }

  // ---- step availability ----
  const sc = sceneSnap || EMPTY_SCENE;
  const done = {
    talk: Boolean(talkText),
    lyrics: Boolean(finalLyrics),
    music: Boolean(song.versions && song.versions.length),
    scenes: Boolean(sc.scenes && sc.scenes.length && Object.keys(sc.images || {}).length),
    video: Boolean(render && render.mediaKey),
    export: false,
  };
  const enabled = {
    talk: true,
    lyrics: true,
    music: Boolean(finalLyrics),
    scenes: Boolean(finalLyrics),
    video: Boolean(finalLyrics),
    export: Boolean(finalLyrics),
  };

  function goStep(id) {
    if (id === "talk") { setView("library"); return; }
    setView("create");
    setStep(id);
  }

  const activeSong = (song.versions || []).find((v) => v.id === song.activeId) || null;

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead-inner">
          <a className="lockup" href="/" onClick={(e) => { e.preventDefault(); setView("library"); }}>
            <Lockup />
          </a>
          <div className="masthead-tag">
            Higher Ground Through Holier Sound
            <small>Turn General Conference into cinematic music experiences.</small>
          </div>
        </div>
      </header>

      <nav className="topnav" aria-label="Primary">
        <button className={`topnav-btn${view === "library" ? " active" : ""}`} onClick={() => setView("library")}>
          <span className="topnav-icon">📚</span> Library
        </button>
        <button className={`topnav-btn${view === "create" ? " active" : ""}`} onClick={() => setView("create")}>
          <span className="topnav-icon">✦</span> Create
          {hasContent && <span className="topnav-badge">{STEPS.find((s) => s.id === step)?.name}</span>}
        </button>
        <button className={`topnav-btn${view === "projects" ? " active" : ""}`} onClick={() => { setView("projects"); setProjectsRefresh((n) => n + 1); }}>
          <span className="topnav-icon">▦</span> Projects
        </button>
        <span className="topnav-spacer" />
        <button className="topnav-btn" onClick={startNewProject} title="Save this project and start a fresh one">
          {confirmNew ? "Click again to start fresh" : "+ New concert"}
        </button>
        <button className={`topnav-btn${view === "settings" ? " active" : ""}`} onClick={() => setView("settings")} title="API keys">
          ⚙ Settings
        </button>
      </nav>

      {saveMsg && (
        <div className="note" style={{ textAlign: "center", marginBottom: 12, color: "var(--sky)" }}>{saveMsg}</div>
      )}
      {restoredNote && (
        <div className="note" style={{ textAlign: "center", marginBottom: 12 }}>
          Restored your last session automatically.{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => setRestoredNote(false)}>Dismiss</button>
        </div>
      )}

      {/* ---------------- LIBRARY (always mounted) ---------------- */}
      <div style={{ display: view === "library" ? "block" : "none" }}>
        {hasContent && (
          <div className="talk-banner">
            <div className="talk-banner-text">
              <div className="talk-banner-title">Working on: {projectTitle()}</div>
              <div className="talk-banner-meta">{talkMeta.speaker ? `${talkMeta.speaker} · ` : ""}{talkMeta.conferenceMonthYear || ""} — pick another talk to start a new concert, or continue.</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setView("create")}>Continue →</button>
          </div>
        )}
        <ConferencePicker onTalkLoaded={handleTalkLoaded} />
      </div>

      {/* ---------------- CREATE pipeline ---------------- */}
      {view === "create" && (
        <>
          <div className="stepper" role="tablist">
            {STEPS.map((s) => (
              <button
                key={s.id}
                className={`step${step === s.id ? " active" : ""}`}
                onClick={() => goStep(s.id)}
                disabled={!enabled[s.id]}
                title={!enabled[s.id] ? "Finalize lyrics first" : s.sub}
              >
                <span className="step-n">{s.n} {done[s.id] && <span className="done">✓</span>}</span>
                <span className="step-name">{s.name}</span>
                <span className="step-sub">{s.sub}</span>
              </button>
            ))}
          </div>

          {talkMeta.title ? (
            <div className="talk-banner">
              <div className="talk-banner-text">
                <div className="talk-banner-title">{talkMeta.title}</div>
                <div className="talk-banner-meta">{talkMeta.speaker}{talkMeta.conferenceMonthYear ? ` · ${talkMeta.conferenceMonthYear}` : ""}{talkMeta.session ? ` · ${talkMeta.session}` : ""}</div>
              </div>
              {talkMeta.sourceUrl && <a className="btn btn-ghost btn-sm" href={talkMeta.sourceUrl} target="_blank" rel="noopener noreferrer">Read ↗</a>}
              <button className="btn btn-ghost btn-sm" onClick={() => setView("library")}>Change talk</button>
            </div>
          ) : (
            <div className="talk-banner empty">
              <div className="talk-banner-text">
                <div className="talk-banner-title">No talk chosen yet</div>
                <div className="talk-banner-meta">Pick one in the Library, or paste the text in the Lyrics step.</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setView("library")}>Open the Library</button>
            </div>
          )}

          <div style={{ display: step === "lyrics" ? "block" : "none" }}>
            <LyricCreator
              onSources={setLyricSources}
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

          {step === "music" && (
            <MusicStudio
              projectId={projectId}
              lyrics={finalLyrics}
              styleBible={sc.styleBible}
              styleReference={styleReference}
              title={(sc.meta && sc.meta.songTitle) || talkMeta.title || ""}
              song={song}
              setSong={setSong}
              config={config}
              onContinue={() => setStep("scenes")}
            />
          )}

          <div style={{ display: step === "scenes" ? "block" : "none" }}>
            <SceneOrganizer
              talkText={talkText}
              lyrics={finalLyrics}
              styleReference={styleReference}
              talkMeta={talkMeta}
              restoreState={restoreState}
              onStateChange={onSceneStateChange}
              onRenumber={renumberScenes}
            />
            {done.scenes && (
              <div className="row end" style={{ marginBottom: 20 }}>
                <button className="btn btn-primary" onClick={() => setStep("video")}>Continue → Video</button>
              </div>
            )}
          </div>

          {step === "video" && (
            <VideoStudio
              projectId={projectId}
              scenes={sc.scenes || []}
              images={{ ...(sc.images || {}), ...(sc.saved || {}) }}
              endcards={sc.endcards || {}}
              song={song}
              meta={sc.meta || {}}
              lyrics={finalLyrics}
              clips={clips}
              setClips={setClips}
              timeline={timeline}
              setTimeline={setTimeline}
              render={render}
              setRender={setRender}
              config={config}
              onContinue={() => setStep("export")}
              onSetCardImage={setCardImage}
              onSetSceneLyrics={setSceneLyrics}
              talkMeta={talkMeta}
              talkText={talkText}
              lyricSources={lyricSources}
              onLyricSources={setLyricSources}
              onFixTalk={fixTalk}
            />
          )}

          {step === "export" && (
            <ExportPanel
              project={{ talkMeta, finalLyrics, sc, activeSong, render, clips }}
              onGo={setStep}
              onDownloadJson={downloadProject}
              concertPublish={<ConcertPublish song={song} lyrics={finalLyrics} talkMeta={talkMeta} meta={sc.meta || {}} styleBible={sc.styleBible} styleReference={styleReference} render={render} />}
              folder={folder}
              onPickFolder={pickFolder}
              onReconnectFolder={reconnectPickedFolder}
              onExportFolder={exportToFolder}
              exportBusy={exportBusy}
              exportMsg={exportMsg}
              exportResult={exportResult}
            />
          )}
        </>
      )}

      {view === "projects" && (
        <ProjectsPanel
          currentId={hasContent ? projectId : null}
          refreshKey={projectsRefresh}
          onOpen={openProject}
          onNew={startNewProject}
          onSaveNow={saveNow}
          onDownload={downloadProject}
          onUploadClick={() => fileInputRef.current && fileInputRef.current.click()}
        />
      )}

      {view === "settings" && <SettingsPanel config={config} onClose={() => setView(hasContent ? "create" : "library")} />}

      <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={loadProjectFile} />

      <footer className="studio-foot">
        Conference As A Concert Studio is an independent creative tool. It is not an official production of,
        and is not endorsed by, The Church of Jesus Christ of Latter-day Saints. Talks © Intellectual Reserve, Inc.
      </footer>
    </div>
  );
}

// ---------------- Export ----------------
function ExportPanel({ project, onGo, onDownloadJson, folder, onPickFolder, onReconnectFolder, onExportFolder, exportBusy, exportMsg, exportResult, concertPublish }) {
  const { talkMeta, finalLyrics, sc, activeSong, render, clips } = project;
  const cardsSaved = ["intro", "outro"].filter((k) => sc?.endcards?.[k]?.image).length;
  const scenes = (sc && sc.scenes) || [];
  const imgCount = Object.keys((sc && sc.images) || {}).length;
  const clipCount = Object.values(clips || {}).filter((c) => c && c.mediaKey).length;
  const items = [
    {
      title: "Music video",
      ok: Boolean(render && render.mediaKey),
      body: render && render.mediaKey ? `Rendered ${new Date(render.createdAt).toLocaleDateString()} · ${render.sizeMB || "?"} MB ${String(render.ext || "mp4").toUpperCase()}` : "Not rendered yet.",
      action: { label: render && render.mediaKey ? "Open Video step to download" : "Go to Video", go: "video" },
    },
    {
      title: "Song audio",
      ok: Boolean(activeSong),
      body: activeSong ? `${activeSong.title} · ${Math.floor(activeSong.durationSec / 60)}:${String(Math.floor(activeSong.durationSec % 60)).padStart(2, "0")}` : "No song generated yet.",
      action: { label: activeSong ? "Open Music step to download" : "Go to Music", go: "music" },
    },
    {
      title: "Storyboard",
      ok: scenes.length > 0,
      body: scenes.length ? `${scenes.length} scenes · ${imgCount} images · ${cardsSaved} of 2 cards · ${clipCount} clips. PowerPoint, image .zip, lyrics .docx and the speaker portrait download from the Storyboard step.` : "No scenes yet.",
      action: { label: "Go to Storyboard", go: "scenes" },
    },
    {
      title: "Lyrics",
      ok: Boolean(finalLyrics),
      body: finalLyrics ? `${finalLyrics.split(/\n/).filter(Boolean).length} lines, finalized.` : "Not finalized.",
      action: { label: "Go to Lyrics", go: "lyrics" },
    },
  ];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Export</h2>
        <button className="btn btn-ghost btn-sm" onClick={onDownloadJson}>Download project .json</button>
      </div>
      <p className="sub">Everything this concert produced, in one place. {talkMeta.title ? `Based on "${talkMeta.title}"${talkMeta.speaker ? ` by ${talkMeta.speaker}` : ""}.` : ""}</p>

      {concertPublish}

      <div className="music-card" style={{ marginBottom: 16 }}>
        <h3>Save everything to a folder {folder.status === "granted" ? <span className="chip ok">{folder.name}</span> : folder.status === "prompt" ? <span className="chip warn">{folder.name} — reconnect</span> : <span className="chip">no folder yet</span>}</h3>
        <p className="note" style={{ marginTop: 0 }}>
          Writes a dated folder named after the song into the folder you choose — your Google Drive folder
          (with Google Drive for Desktop installed), Dropbox, OneDrive, or anywhere on this computer:
          <strong> project.json</strong>, <strong>lyrics.txt</strong>, an <strong>images</strong> folder
          (intro card, every scene, outro card), the <strong>song</strong>, and the <strong>video</strong>.
          Chrome or Edge required.
        </p>
        {folder.status === "unsupported" ? (
          <p className="note">This browser can't write to folders. Use Chrome or Edge, or download the pieces individually below.</p>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            {folder.status === "prompt" && <button className="btn btn-ghost btn-sm" onClick={onReconnectFolder}>🔓 Reconnect "{folder.name}"</button>}
            <button className="btn btn-ghost btn-sm" onClick={onPickFolder}>{folder.status === "none" ? "Choose folder…" : "Change folder…"}</button>
            <button className="btn btn-primary" onClick={onExportFolder} disabled={exportBusy || folder.status !== "granted"}>
              {exportBusy && <span className="spinner" />}
              {exportBusy ? "Saving…" : "Save everything now"}
            </button>
          </div>
        )}
        {exportMsg && <p className="note" style={{ color: exportMsg.startsWith("Export failed") ? "var(--danger)" : "var(--success)" }}>{exportMsg}</p>}
        {exportResult && (
          <div className="note" style={{ marginTop: 6 }}>
            {exportResult.files.map((f) => <div key={f}>✓ {f}</div>)}
            {exportResult.skipped.map((f) => <div key={f} style={{ opacity: 0.7 }}>– skipped: {f}</div>)}
          </div>
        )}
      </div>

      <div className="export-grid">
        {items.map((it) => (
          <div className="export-card" key={it.title}>
            <h3>{it.title} {it.ok ? <span className="chip ok">ready</span> : <span className="chip">pending</span>}</h3>
            <p>{it.body}</p>
            <div className="row"><button className="btn btn-ghost btn-sm" onClick={() => onGo(it.action.go)}>{it.action.label}</button></div>
          </div>
        ))}
      </div>
      <p className="note" style={{ marginTop: 18 }}>
        Before publishing: the intro and outro cards carry the disclaimer that this is not an official Church
        production. Talks are © Intellectual Reserve, Inc.; the song is an original paraphrase. Review the
        Church's terms of use for public distribution.
      </p>
    </section>
  );
}
