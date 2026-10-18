// src/components/YouTubeCard.jsx — getting the finished video onto the
// ConferenceAsAConcert YouTube channel: a ready title, description and tags
// (each with a Copy button, plus Copy all), the MP4 to download, and a button
// that opens YouTube's upload page. Uploading straight from the app would need
// a Google Cloud sign-in setup and YouTube's API review — not wired yet.
import React, { useEffect, useMemo, useState } from "react";
import { getMedia } from "../lib/project-store.js";
import { DISCLAIMER } from "../lib/card-prompts.js";

const CHANNEL = "ConferenceAsAConcert";
const sungLines = (lyrics) => String(lyrics || "").replace(/\r/g, "").trim();

export function youtubeText({ songTitle, talk = {}, lyrics }) {
  const song = songTitle || talk.title || "Untitled";
  const speaker = talk.speaker || "";
  const title = [song, speaker && `Inspired by ${speaker}`, "Conference As A Concert"].filter(Boolean).join(" | ").slice(0, 100);
  const description = [
    `♪ "${song}" — an original song inspired by${talk.title ? ` "${talk.title}"` : " a General Conference talk"}${speaker ? ` by ${speaker}` : ""}${talk.conferenceMonthYear ? `, ${talk.conferenceMonthYear} General Conference` : ""}.`,
    "",
    talk.sourceUrl ? `Read or watch the talk: ${talk.sourceUrl}` : "",
    "More conference songs: https://conferenceconcert.netlify.app",
    "",
    "If this message touched your heart, please share this video with someone who may need hope.",
    "👍 Like the video · 🔔 Subscribe to the channel · Turn on notifications",
    "",
    "LYRICS",
    sungLines(lyrics),
    "",
    DISCLAIMER,
    "",
    `#GeneralConference #ConferenceAsAConcert #ComeUntoChrist${speaker ? ` #${speaker.replace(/^(Elder|President|Sister|Bishop|Brother)\s+/i, "").replace(/[^A-Za-z]/g, "")}` : ""}`,
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").slice(0, 4900);
  const tags = ["General Conference", "Conference As A Concert", "Latter-day Saint music", "Come unto Christ", speaker, talk.title, song, talk.conferenceMonthYear && `${talk.conferenceMonthYear} General Conference`]
    .filter(Boolean).map((t) => String(t).replace(/,/g, " ").trim()).filter((t, i, a) => a.indexOf(t) === i).join(", ").slice(0, 480);
  return { title, description, tags };
}

export default function YouTubeCard({ talkMeta, meta, lyrics, render, missingVideo }) {
  const auto = useMemo(() => youtubeText({ songTitle: (meta && meta.songTitle) || "", talk: talkMeta || {}, lyrics }), [meta, talkMeta, lyrics]);
  const [f, setF] = useState(auto);
  useEffect(() => { setF(auto); }, [auto]);
  const [copied, setCopied] = useState("");
  const [msg, setMsg] = useState("");
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 1600); } catch { setMsg("Couldn't copy — select the text and copy it by hand."); } };

  async function downloadVideo() {
    setMsg("");
    try {
      const rec = render && render.mediaKey ? await getMedia(render.mediaKey) : null;
      if (!rec) { setMsg("The rendered video isn't in this browser yet — render it first (or attach it on this page)."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(rec.blob);
      a.download = `${(f.title.split(" | ")[0] || "music-video").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${render.ext || "mp4"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setMsg(e.message || String(e)); }
  }

  const field = (key, label, rows) => (
    <label className="field" style={{ margin: "8px 0" }}>
      <span className="lbl row" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <span>{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(f[key], key)}>{copied === key ? "Copied ✓" : "📋 Copy"}</button>
      </span>
      {rows ? <textarea value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} style={{ minHeight: rows * 18 }} /> : <input type="text" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />}
    </label>
  );

  return (
    <div className="music-card" style={{ marginBottom: 16 }}>
      <h3>Post to YouTube <span className="chip">@{CHANNEL}</span></h3>
      <ol className="note" style={{ marginTop: 0, paddingLeft: 18 }}>
        <li>Download the MP4 (or use the copy you saved to the folder).</li>
        <li>Open YouTube's upload page — signed in to the <strong>{CHANNEL}</strong> channel — and choose the file.</li>
        <li>Paste the title, description and tags below.</li>
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={downloadVideo} disabled={!render || !render.mediaKey || missingVideo}>⬇ Download the MP4</button>
        <a className="btn btn-primary" href="https://www.youtube.com/upload" target="_blank" rel="noopener noreferrer">▶ Open YouTube upload</a>
        <button className="btn btn-ghost" onClick={() => copy(`${f.title}\n\n${f.description}\n\nTags: ${f.tags}`, "all")}>{copied === "all" ? "Copied ✓" : "📋 Copy all"}</button>
      </div>
      {field("title", `Title (${f.title.length}/100)`)}
      {field("description", "Description", 10)}
      {field("tags", "Tags")}
      {msg && <p className="note" style={{ color: "var(--danger)" }}>{msg}</p>}
      <p className="note" style={{ marginBottom: 0 }}>One-click upload straight from the app needs a Google sign-in set up for the channel (a Google Cloud project, plus YouTube's API review before public uploads) — say the word and it can be added.</p>
    </div>
  );
}
