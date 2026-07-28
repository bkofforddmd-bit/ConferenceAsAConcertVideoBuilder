// src/components/SpeakerFace.jsx
//
// A small round portrait of a General Conference speaker, looked up by name
// in public/portraits-index.json (built by scripts/build-portraits-index.js).
// Falls back to an initials circle when no portrait exists (or while the
// index loads), so it can be dropped anywhere a speaker name appears.

import React, { useEffect, useState } from "react";

let portraitsPromise = null;
let portraitsMap = null; // normalized name -> url

// "President Dallin H. Oaks" / "Elder Neal A. Maxwell" -> "dallin h. oaks" etc.
function normName(name) {
  return String(name || "")
    .replace(/^\s*(?:by\s+)?(?:president|elder|sister|brother|bishop)\s+/i, "")
    .trim()
    .toLowerCase();
}

function loadPortraits() {
  if (!portraitsPromise) {
    portraitsPromise = fetch("/portraits-index.json")
      .then((r) => r.json())
      .then((data) => {
        const map = {};
        const src = data && data.portraits;
        if (src && typeof src === "object") {
          for (const [name, url] of Object.entries(src)) map[normName(name)] = url;
        }
        portraitsMap = map;
        return map;
      })
      .catch(() => {
        portraitsMap = {};
        return portraitsMap;
      });
  }
  return portraitsPromise;
}

export function portraitUrlFor(name) {
  return (portraitsMap && portraitsMap[normName(name)]) || "";
}

// The Church image server takes the size in the URL — swap in "max" for the
// full-resolution original (1600×1920 for current leaders). BYU portraits
// are already served at their largest size.
export function fullPortraitUrlFor(name) {
  const url = portraitUrlFor(name);
  return url.replace(/(\/imgs\/[^/]+\/full\/)[^/]+(\/0\/default)/, "$1max$2");
}

export { loadPortraits };

const initialsOf = (name) =>
  normName(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter((c, i, a) => i === 0 || i === a.length - 1)
    .join("")
    .toUpperCase();

export default function SpeakerFace({ name, size = 36, title }) {
  const [, setReady] = useState(!!portraitsMap);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!portraitsMap) loadPortraits().then(() => setReady(true));
  }, []);
  useEffect(() => setBroken(false), [name]);

  const url = portraitUrlFor(name);
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.34)) };
  if (url && !broken) {
    return (
      <img
        className="speaker-face"
        style={style}
        src={url}
        alt={name || ""}
        title={title || name || ""}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="speaker-face speaker-face-blank" style={style} title={title || name || ""}>
      {initialsOf(name) || "?"}
    </span>
  );
}
