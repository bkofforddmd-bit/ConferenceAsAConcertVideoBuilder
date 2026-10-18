// src/components/SimpleTalkPicker.jsx — the Simple wizard's first step.
// Opens on the most recent General Conference (sessions → talks), with a
// conference chooser for any other one and a quick filter. Picking a talk loads
// its text and hands it to the app exactly like the Library does.
import React, { useEffect, useMemo, useState } from "react";

const officialUrl = (uri) => `https://www.churchofjesuschrist.org${uri}?lang=eng`;

// The newest conference that has (probably) happened: April and October, first weekend.
export function latestConference(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  if (m > 10 || (m === 10 && d >= 6)) return { year: y, month: "10" };
  if (m > 4 || (m === 4 && d >= 6)) return { year: y, month: "04" };
  return { year: y - 1, month: "10" };
}
function conferenceList(latest) {
  const out = [];
  let { year, month } = latest;
  while (year >= 1971) {
    out.push({ year, month, label: `${month === "10" ? "October" : "April"} ${year}` });
    if (month === "10") month = "04"; else { month = "10"; year -= 1; }
  }
  return out;
}
const previous = ({ year, month }) => (month === "10" ? { year, month: "04" } : { year: year - 1, month: "10" });

export default function SimpleTalkPicker({ onTalkLoaded, onOpenLibrary, current }) {
  const latest = useMemo(() => latestConference(), []);
  const all = useMemo(() => conferenceList(latest), [latest]);
  const [conf, setConf] = useState(latest);
  const [sessions, setSessions] = useState(null);
  const [state, setState] = useState("loading");
  const [q, setQ] = useState("");
  const [loadingUri, setLoadingUri] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setState("loading"); setSessions(null); setErr("");
      const load = async (c) => {
        const r = await fetch("/.netlify/functions/list-conference", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ year: String(c.year), month: c.month }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d.sessions) || !d.sessions.length) throw new Error(d.error || "No talks found for that conference.");
        return d.sessions;
      };
      try { const s = await load(conf); if (alive) { setSessions(s); setState("ready"); } }
      catch (e) {
        // The newest conference may not be published yet → fall back one.
        if (conf.year === latest.year && conf.month === latest.month) {
          const p = previous(latest);
          try { const s = await load(p); if (alive) { setConf(p); setSessions(s); setState("ready"); } return; } catch {}
        }
        if (alive) { setErr(e.message || String(e)); setState("error"); }
      }
    })();
    return () => { alive = false; };
  }, [conf.year, conf.month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(talk, sessionTitle) {
    setLoadingUri(talk.uri); setErr("");
    try {
      const res = await fetch("/.netlify/functions/fetch-talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: talk.uri }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load that talk.");
      onTalkLoaded({
        text: (data.paragraphs || []).join("\n\n"),
        title: data.title || talk.title || "", speaker: data.speaker || talk.speaker || "", speakerTitle: data.speakerTitle || "",
        year: String(conf.year), month: conf.month, session: sessionTitle || "", sourceUrl: data.sourceUrl || officialUrl(talk.uri),
      });
    } catch (e) { setErr(e.message || "Network problem loading the talk. Try again."); }
    setLoadingUri("");
  }

  const needle = q.trim().toLowerCase();
  const isLatest = conf.year === latest.year && conf.month === latest.month;
  return (
    <section className="panel">
      <h2>Choose a talk</h2>
      <p className="sub">Pick the conference message your song will carry. The newest conference is shown first.</p>
      {current && current.title && <p className="note">Working on: <strong>{current.title}</strong>{current.speaker ? ` — ${current.speaker}` : ""}. Choosing another talk starts a new concert (this one is saved in Projects).</p>}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" style={{ margin: 0, flex: "0 1 220px" }}>
          <span className="lbl">Conference</span>
          <select value={`${conf.year}-${conf.month}`} onChange={(e) => { const [y, m] = e.target.value.split("-"); setConf({ year: Number(y), month: m }); setQ(""); }}>
            {all.map((c) => <option key={`${c.year}-${c.month}`} value={`${c.year}-${c.month}`}>{c.label}{c.year === latest.year && c.month === latest.month ? " (latest)" : ""}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0, flex: "1 1 240px" }}>
          <span className="lbl">Find a talk or speaker</span>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Holland, faith, temple…" />
        </label>
        {!isLatest && <button className="btn btn-ghost btn-sm" onClick={() => setConf(latest)}>↺ Back to the latest</button>}
      </div>
      {state === "loading" && <p className="note"><span className="spinner" /> Loading the conference…</p>}
      {err && <div className="error">{err}</div>}
      {sessions && sessions.map((s) => {
        // conference business (sustainings, audit and statistical reports) is not a talk to sing
        const talks = (s.talks || []).filter((t) => !/^(the )?sustaining of|auditing department report|statistical report/i.test(t.title || "")).filter((t) => !needle || `${t.title} ${t.speaker}`.toLowerCase().includes(needle));
        if (!talks.length) return null;
        return (
          <div key={s.title} className="simple-session">
            <h3>{s.title}</h3>
            <div className="simple-talks">
              {talks.map((t) => (
                <button key={t.uri} className="simple-talk" onClick={() => choose(t, s.title)} disabled={Boolean(loadingUri)}>
                  <span className="simple-talk-title">{t.title}</span>
                  <span className="simple-talk-speaker">{t.speaker}</span>
                  {loadingUri === t.uri && <span className="note" style={{ margin: 0 }}><span className="spinner" /> loading…</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {onOpenLibrary && <p className="note" style={{ marginTop: 16 }}>Looking by speaker, topic or with AI search? <button className="btn btn-ghost btn-sm" onClick={onOpenLibrary}>Open the full Library</button></p>}
    </section>
  );
}
