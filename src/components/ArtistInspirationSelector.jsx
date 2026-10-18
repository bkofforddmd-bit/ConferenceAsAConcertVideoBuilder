// src/components/ArtistInspirationSelector.jsx — pick the artist whose style
// the song should follow. 269 artists in 13 groups (src/lib/artist-inspiration.json),
// a search box, and a free-text "your own artist or song" entry. The choice is
// the project's style reference: it shapes the lyrics, and the Music step's
// MelodyCraft "sound like" starts from it.
import React, { useMemo, useState } from "react";
import catalog from "../lib/artist-inspiration.json";

export const ARTISTS = catalog.artists || [];
export const ARTIST_CATEGORIES = catalog.categories || [];
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// The catalog entry for a style reference ("Coldplay", "coldplay", "in the style of Coldplay"…), if any.
export function artistFor(reference) {
  const r = norm(reference);
  if (!r) return null;
  return ARTISTS.find((a) => norm(a.name) === r) || ARTISTS.find((a) => r.includes(norm(a.name)) && norm(a.name).length > 3) || null;
}

export default function ArtistInspirationSelector({ value, onChange }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(!value);
  const picked = artistFor(value);
  const needle = norm(q);
  const groups = useMemo(() => ARTIST_CATEGORIES.map((c) => ({
    name: c,
    artists: ARTISTS.filter((a) => (a.categories || []).includes(c) && (!needle || norm(a.name).includes(needle))),
  })).filter((g) => g.artists.length), [needle]);
  const matches = groups.reduce((t, g) => t + g.artists.length, 0);

  return (
    <div className="artist-picker">
      <div className="artist-picker-head">
        <strong>Artist inspiration</strong>
        <span className="chip">{ARTISTS.length} artists</span>
        {value && !open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} style={{ marginLeft: "auto" }}>Change</button>}
      </div>
      {value && (
        <div className="artist-picked">
          <span>Sounds like <strong>{value}</strong>{picked ? "" : " (your own pick)"}</span>
          {picked && picked.lyricProfile && <span className="note" style={{ margin: 0 }}>Songwriting: {picked.lyricProfile}</span>}
        </div>
      )}
      {open && (
        <>
          <input type="text" className="artist-search" placeholder="Search artists…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="artist-groups">
            {groups.map((g) => (
              <div key={g.name} className="artist-group">
                <div className="artist-group-name">{g.name}</div>
                <div className="artist-chips">
                  {g.artists.map((a) => (
                    <button key={a.name} type="button" className={`artist-chip${picked && picked.name === a.name ? " on" : ""}`} title={a.lyricProfile || ""} onClick={() => { onChange(a.name); setOpen(false); setQ(""); }}>
                      {a.name}{a.lyricProfile ? <span className="artist-dot" aria-hidden="true">•</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!matches && (
              <p className="note">Not in the list?{q.trim() && <> <button type="button" className="btn btn-primary btn-sm" onClick={() => { onChange(q.trim()); setOpen(false); setQ(""); }}>Use “{q.trim()}”</button></>}</p>
            )}
          </div>
          {catalog.customArtistEnabled !== false && (
            <p className="note" style={{ margin: "6px 0 0" }}>Any artist or song works — type it in the search and choose “Use …”, or in the box below. A • marks artists with a songwriting profile the lyric writer follows.</p>
          )}
        </>
      )}
    </div>
  );
}
