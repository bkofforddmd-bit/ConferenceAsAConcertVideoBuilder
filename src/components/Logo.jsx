// src/components/Logo.jsx
//
// Brand mark and lockup. The mark is the winged-spire symbol from the
// Conference As A Concert Studio style bible (public/logo-mark.png, cut from
// the brand artwork with a transparent background); the words are set live in
// the brand typeface so they stay crisp at any size.

import React from "react";

export function AscentMark({ size = 48, title = "Conference As A Concert Studio" }) {
  // The artwork is wider than tall (about 1.39 : 1); `size` is its height.
  return (
    <img
      src="/logo-mark.png"
      alt={title}
      className="ascent-mark"
      style={{ height: size, width: "auto" }}
      draggable={false}
    />
  );
}

// Horizontal lockup: mark + "CONFERENCE AS A CONCERT" over a heavier "STUDIO".
export function Lockup({ compact = false }) {
  return (
    <div className={`lockup${compact ? " compact" : ""}`}>
      <AscentMark size={compact ? 40 : 64} />
      <div className="lockup-words">
        <span className="lockup-top">Conference As A Concert</span>
        <span className="lockup-studio">Studio</span>
      </div>
    </div>
  );
}

export default Lockup;
