// src/components/Logo.jsx
//
// The "winged ascent" brand mark from the Conference As A Concert Studio
// style bible, drawn as an SVG so it scales from favicon to hero. Two wings
// sweep upward from a luminous center; a spire rises through a horizon arc;
// a four-point star marks the light source. Nothing here copies a protected
// insignia — it is aerospace-inspired geometry only.

import React from "react";

export function AscentMark({ size = 48, tone = "light", title = "Conference As A Concert Studio" }) {
  const fill = tone === "dark" ? "#00205B" : "#F5F7FA";
  const glow = tone === "dark" ? "#2E5FA9" : "#8FB4E6";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={title}
      className="ascent-mark"
    >
      <defs>
        <linearGradient id="am-wing" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={fill} stopOpacity="0.72" />
          <stop offset="1" stopColor={fill} />
        </linearGradient>
        <radialGradient id="am-glow" cx="0.5" cy="0.45" r="0.5">
          <stop offset="0" stopColor={glow} stopOpacity="0.55" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="56" r="46" fill="url(#am-glow)" />
      {/* horizon arc */}
      <path d="M14 70 A50 50 0 0 1 106 70" fill="none" stroke={fill} strokeOpacity="0.55" strokeWidth="2.2" strokeLinecap="round" />
      {/* left wing: three feathers rising outward */}
      <path d="M57 70 L8 56 Q24 62 40 60 Q26 50 12 42 Q30 46 46 52 Q34 40 24 30 Q44 40 56 56 Z" fill="url(#am-wing)" />
      {/* right wing (mirror) */}
      <path d="M63 70 L112 56 Q96 62 80 60 Q94 50 108 42 Q90 46 74 52 Q86 40 96 30 Q76 40 64 56 Z" fill="url(#am-wing)" />
      {/* spire */}
      <path d="M60 10 L66 44 L63 46 L63 74 L57 74 L57 46 L54 44 Z" fill={fill} />
      {/* luminous four-point star */}
      <path d="M60 78 L63 88 L73 91 L63 94 L60 104 L57 94 L47 91 L57 88 Z" fill={fill} />
    </svg>
  );
}

// Horizontal lockup: mark + "CONFERENCE AS A CONCERT" over a heavier "STUDIO".
export function Lockup({ compact = false }) {
  return (
    <div className={`lockup${compact ? " compact" : ""}`}>
      <AscentMark size={compact ? 34 : 56} />
      <div className="lockup-words">
        <span className="lockup-top">Conference As A Concert</span>
        <span className="lockup-studio">Studio</span>
      </div>
    </div>
  );
}

export default Lockup;
