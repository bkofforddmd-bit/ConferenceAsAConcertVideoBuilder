// src/components/ProjectsPanel.jsx
//
// Named projects saved in this browser (IndexedDB) — open, delete, plus the
// existing download/upload of a .json project file for moving between
// computers. Media (song, clips, rendered video) travels with the project id.

import React, { useEffect, useState } from "react";
import { listProjects, deleteProject, storageEstimate } from "../lib/project-store.js";

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtBytes(n) {
  if (!n) return "0 MB";
  return (n / (1024 * 1024)).toFixed(n > 100 * 1024 * 1024 ? 0 : 1) + " MB";
}

export default function ProjectsPanel({ currentId, onOpen, onNew, onSaveNow, onDownload, onUploadClick, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [confirmId, setConfirmId] = useState(null);
  const [est, setEst] = useState({ usage: 0, quota: 0 });
  const [msg, setMsg] = useState("");

  async function refresh() {
    setRows(await listProjects());
    setEst(await storageEstimate());
  }
  useEffect(() => { refresh(); }, [refreshKey]);

  async function del(id) {
    if (confirmId !== id) { setConfirmId(id); setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 4000); return; }
    await deleteProject(id);
    setConfirmId(null);
    setMsg("Project deleted.");
    setTimeout(() => setMsg(""), 2500);
    refresh();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Projects</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={onNew}>+ New concert</button>
          <button className="btn btn-ghost btn-sm" onClick={async () => { await onSaveNow(); setMsg("Saved."); setTimeout(() => setMsg(""), 2000); refresh(); }}>Save current</button>
          <button className="btn btn-ghost btn-sm" onClick={onDownload} title="Download the current project as a .json file (talk, lyrics, scenes, images)">Download .json</button>
          <button className="btn btn-ghost btn-sm" onClick={onUploadClick} title="Open a .json project file">Open .json</button>
        </div>
      </div>
      <p className="sub">
        Every project auto-saves to this browser as you work. Songs, clips and rendered videos are stored
        here too ({fmtBytes(est.usage)} used{est.quota ? ` of ${fmtBytes(est.quota)}` : ""}).
      </p>
      {msg && <p className="note" style={{ color: "var(--success)" }}>{msg}</p>}

      {rows.length === 0 ? (
        <p className="note">No saved projects yet. Pick a talk in the Library and the project appears here as you build it.</p>
      ) : (
        <div className="project-grid">
          {rows.map((r) => (
            <div className={`project-card${r.id === currentId ? " current" : ""}`} key={r.id}>
              {r.summary?.thumb ? (
                <img className="project-thumb" src={r.summary.thumb} alt="" />
              ) : (
                <div className="project-thumb blank">♪</div>
              )}
              <div className="project-body">
                <div className="project-title">{r.title || "Untitled project"}</div>
                <div className="project-meta">
                  {r.summary?.speaker ? `${r.summary.speaker} · ` : ""}{fmtWhen(r.updatedAt)}
                </div>
                <div className="project-stage">
                  {["talk", "lyrics", "song", "scenes", "clips", "video"].map((k) => (
                    <span key={k} className={`stage-dot${r.summary?.stages?.[k] ? " on" : ""}`} title={k}>{k}</span>
                  ))}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  {r.id === currentId ? (
                    <span className="chip ok">open now</span>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => onOpen(r.id)}>Open</button>
                  )}
                  <button className={`btn btn-ghost btn-sm${confirmId === r.id ? " danger" : ""}`} onClick={() => del(r.id)}>
                    {confirmId === r.id ? "Really delete?" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
