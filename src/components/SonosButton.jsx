// src/components/SonosButton.jsx
//
// 🔊 Play on Sonos — opens the home Sonos Bridge (a small program that runs on
// the home laptop; see Desktop\Sonos Bridge) with one talk, a list of talks,
// or a search preloaded, so the official talk recordings play on the house
// speakers. Works only on the home Wi-Fi. The bridge address is remembered
// per device (localStorage) and can be changed from the ⚙ next to the button.

import React, { useState } from "react";

const KEY = "sonosBridge";
const DEFAULT_ADDR = "192.168.1.237:5005";

function storedAddr() {
  try { return (localStorage.getItem(KEY) || "").trim(); } catch { return ""; }
}
function clean(a) {
  return String(a || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export default function SonosButton({ talk, talks, query, label = "🔊 Sonos", title, className = "", small = false }) {
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState(() => storedAddr() || DEFAULT_ADDR);

  function link(a) {
    const q = new URLSearchParams({ app: "talks" });
    if (talks && talks.length) q.set("talks", talks.join(","));
    else if (talk) q.set("song", talk);
    if (query) q.set("q", query);
    return `http://${clean(a)}/?${q.toString()}`;
  }
  function go(ev) {
    ev.stopPropagation();
    const a = storedAddr();
    if (!a) { setEditing(true); return; }
    window.open(link(a), "_blank", "noopener");
  }
  function save(ev) {
    ev && ev.stopPropagation();
    const a = clean(addr);
    if (!a) return;
    try { localStorage.setItem(KEY, a); } catch {}
    setEditing(false);
    window.open(link(a), "_blank", "noopener");
  }

  const btnStyle = small ? { padding: "2px 8px", fontSize: 12 } : undefined;
  return (
    <span className="sonos-btn-wrap" onClick={(ev) => ev.stopPropagation()}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <button type="button" className={className} style={btnStyle} onClick={go}
        title={title || "Play on the house Sonos (home Wi-Fi only)"}>
        {label}
      </button>
      {!editing && (
        <button type="button" onClick={(ev) => { ev.stopPropagation(); setEditing(true); }}
          title="Change the Sonos Bridge address"
          style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.7 }}>
          ⚙
        </button>
      )}
      {editing && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <input value={addr} onChange={(ev) => setAddr(ev.target.value)} placeholder={DEFAULT_ADDR}
            onKeyDown={(ev) => { if (ev.key === "Enter") save(ev); }}
            style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6, width: 170 }} />
          <button type="button" className={className} style={{ padding: "2px 10px", fontSize: 12 }} onClick={save}>Save</button>
          <button type="button" onClick={(ev) => { ev.stopPropagation(); setEditing(false); }}
            style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 12 }}>Cancel</button>
          <span style={{ fontSize: 11, opacity: 0.7, width: "100%" }}>
            Sonos Bridge address, as shown in its window on the home laptop. Works only on the home Wi-Fi.
          </span>
        </span>
      )}
    </span>
  );
}
