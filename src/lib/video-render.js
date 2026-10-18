// src/lib/video-render.js
//
// Assembles the finished music video entirely in the browser:
//
//   intro card → scene 1 → scene 2 → … → outro card, timed to the song.
//
// Each scene shows its generated clip (looped/held to fit its slot) or, when
// no clip exists, a slow Ken Burns drift over the still image. Lyrics can be
// overlaid as subtitles. Frames are painted onto a canvas; the canvas stream
// plus the song's audio feed a MediaRecorder, so a 3-minute song takes about
// 3 minutes to render (same real-time approach as video-clip.js).
//
// Input `plan`:
//   { width, height, fps, audioUrl, totalSec,
//     segments: [ { kind: "image"|"video", src, start, end, label, lyrics, transition } ],
//     lyricsOverlay: bool, watermark: string|"" }
// Returns { promise: Promise<{ blob, ext, mime }>, cancel() }.

const MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  'video/mp4;codecs="avc1.64001f,mp4a.40.2"',
  "video/mp4",
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
];

export function pickRenderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return "";
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Couldn't load a scene image."));
    im.src = src;
  });
}

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.loop = false; // play once, then hold the last frame (a looping cut is jarring)
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Couldn't load a scene clip."));
    v.src = src;
  });
}

// Draw `el` (image or video) covering the canvas, with optional zoom/pan.
function drawCover(ctx, el, W, H, zoom = 1, panX = 0, panY = 0) {
  const ew = el.videoWidth || el.naturalWidth || el.width;
  const eh = el.videoHeight || el.naturalHeight || el.height;
  if (!ew || !eh) return;
  const scale = Math.max(W / ew, H / eh) * zoom;
  const dw = ew * scale, dh = eh * scale;
  const dx = (W - dw) / 2 + panX * (dw - W) / 2;
  const dy = (H - dh) / 2 + panY * (dh - H) / 2;
  ctx.drawImage(el, dx, dy, dw, dh);
}

function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const raw of String(text || "").split(/\n/)) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxWidth && line) { out.push(line); line = w; }
      else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

// On-screen lyric size as a share of the frame height (chosen on the Video step).
export const LYRIC_SIZES = { small: 0.034, medium: 0.042, large: 0.062, xl: 0.085, huge: 0.11 };
export const lyricScale = (size) => LYRIC_SIZES[size] || LYRIC_SIZES.huge;

// Split a lyric block into the pieces shown one at a time: new lines, or
// " / " and " | " typed inside a line to break it into phrases.
export const lyricPieces = (text) => String(text || "").split(/\n|\s+\/\s+|\s+\|\s+/).map((x) => x.trim()).filter(Boolean);

// Captions for a talk clip: the speaker's words spread across the clip in
// short phrases, timed by word count (an estimate — there is no word-level
// timing for the recording). Returns [{ from, to, text }] in clip-local
// seconds. With several spliced sections and a matching number of " … "
// separated texts, each section gets its own words.
// The caption phrases for a text: one per line when the text has line
// breaks (the editor's "one caption per line"), else auto-chunked at
// punctuation into ≤ 10-word pieces.
export function captionPhrases(text) {
  const t = String(text || "").replace(/\r/g, "");
  if (/\n/.test(t.trim())) return t.split(/\n/).map((x) => x.trim()).filter(Boolean);
  return autoPhrases(t);
}
function autoPhrases(text) {
  const out = [];
  const raw = String(text).replace(/\s+/g, " ").split(/(?<=[.!?;:…])\s+|(?<=,)\s+|\s+[—–]\s+/).map((x) => x.trim()).filter(Boolean);
  for (let r of raw) {
    const w = r.split(" ");
    while (w.length > 10) { out.push(w.splice(0, 8).join(" ")); }
    if (w.length) out.push(w.join(" "));
  }
  const merged = [];
  for (const p of out) { if (merged.length && p.split(" ").length <= 2 && merged[merged.length - 1].split(" ").length <= 8) merged[merged.length - 1] += " " + p; else merged.push(p); }
  return merged;
}

export function captionSchedule(clip, len) {
  const caps = clip && clip.captions;
  if (!caps || !caps.on || !String(caps.text || "").trim() || !(len > 0)) return [];
  // Tapped-in times (seconds from the clip's start, one per phrase) win.
  const phrasesAll = captionPhrases(caps.text);
  const marks = Array.isArray(caps.marks) ? caps.marks : null;
  if (marks && marks.length === phrasesAll.length && marks.every((m) => typeof m === "number")) {
    return phrasesAll.map((text, i) => ({ from: marks[i], to: i + 1 < marks.length ? marks[i + 1] : len, text })).filter((c) => c.to > c.from);
  }
  const phrasesOf = (text) => {
    const out = [];
    const raw = String(text).replace(/\s+/g, " ").split(/(?<=[.!?;:…])\s+|(?<=,)\s+|\s+[—–]\s+/).map((x) => x.trim()).filter(Boolean);
    for (let r of raw) {
      const w = r.split(" ");
      while (w.length > 10) { out.push(w.splice(0, 8).join(" ")); }
      if (w.length) out.push(w.join(" "));
    }
    // merge very short tails into the previous phrase
    const merged = [];
    for (const p of out) { if (merged.length && p.split(" ").length <= 2 && merged[merged.length - 1].split(" ").length <= 8) merged[merged.length - 1] += " " + p; else merged.push(p); }
    return merged;
  };
  const spread = (text, from, to) => {
    const ph = /\n/.test(String(text).trim()) ? captionPhrases(text) : phrasesOf(text);
    const words = ph.map((p) => p.split(" ").length);
    const total = words.reduce((a, b) => a + b, 0) || 1;
    const span = to - from;
    let t = from;
    return ph.map((p, i) => { const d = (words[i] / total) * span; const seg = { from: t, to: t + d, text: p }; t += d; return seg; });
  };
  const segs = Array.isArray(clip.segments) ? clip.segments.filter((g) => Number(g.to) > Number(g.from)) : [];
  const parts = String(caps.text).split(/\s+…\s+/).map((x) => x.trim()).filter(Boolean);
  if (segs.length > 1 && parts.length === segs.length) {
    const out = [];
    let off = 0;
    segs.forEach((g, i) => { const l = Number(g.to) - Number(g.from); out.push(...spread(parts[i], off, off + l)); off += l; });
    return out;
  }
  return spread(caps.text, 0, len);
}

// Draw one sample frame (a scene image or a navy field, plus a lyric at the
// chosen size) into a canvas — the on-screen preview for the size setting.
export async function drawLyricPreview(canvas, { imageSrc = "", text = "", size = "medium" } = {}) {
  const W = canvas.width || 960, H = canvas.height || 540;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#00205B"; ctx.fillRect(0, 0, W, H);
  if (imageSrc) {
    try { const im = await loadImage(imageSrc); drawCover(ctx, im, W, H); } catch {}
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0b1b3f"); g.addColorStop(1, "#2b3f6b"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  drawLyrics(ctx, text || "Go, declare glad tidings, in the Savior's name", W, H, 1, lyricScale(size), size === "huge" ? 2 : size === "xl" ? 3 : 4);
}

function drawLyrics(ctx, text, W, H, alpha, size = LYRIC_SIZES.huge, maxLines = 2) {
  if (!text || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  const fontPx = Math.round(H * size);
  ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const lines = wrapLines(ctx, text, W * 0.84).slice(0, maxLines);
  const lineH = fontPx * 1.3;
  const blockH = lines.length * lineH + fontPx * 0.9;
  const y0 = H - blockH - H * 0.06;
  // soft band for legibility
  const grad = ctx.createLinearGradient(0, y0 - fontPx, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.35, "rgba(0,20,60,0.55)");
  grad.addColorStop(1, "rgba(0,20,60,0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y0 - fontPx, W, H - y0 + fontPx);
  ctx.fillStyle = "#F5F7FA";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = fontPx * 0.35;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + fontPx + i * lineH));
  ctx.restore();
}

// Camera motion for a still over its on-screen time. p = 0..1 progress,
// i = segment index (for the alternating "auto" drift). Returns the
// zoom / pan values drawCover understands (pan −1..1 = which edge is shown;
// a pan "left" moves the camera left, revealing more of the left side).
export const MOTIONS = [
  { id: "auto", label: "Gentle drift (auto)" },
  { id: "zoomIn", label: "Slow zoom in" },
  { id: "zoomOut", label: "Slow zoom out" },
  { id: "left", label: "Pan left" },
  { id: "right", label: "Pan right" },
  { id: "up", label: "Tilt up" },
  { id: "down", label: "Tilt down" },
  { id: "none", label: "Hold still" },
];
export function motionAt(motion, p, i = 0, strength = 1) {
  const q = Math.max(0, Math.min(1, p));
  const e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2; // ease in-out
  const z = 0.08 * strength;
  switch (motion) {
    case "zoomIn": return { zoom: 1 + z * e, panX: 0, panY: 0 };
    case "zoomOut": return { zoom: 1 + z * (1 - e), panX: 0, panY: 0 };
    case "left": return { zoom: 1 + 0.1 * strength, panX: -1 + 2 * e, panY: 0 };
    case "right": return { zoom: 1 + 0.1 * strength, panX: 1 - 2 * e, panY: 0 };
    case "up": return { zoom: 1 + 0.04 * strength, panX: 0, panY: -1 + 2 * e };
    case "down": return { zoom: 1 + 0.04 * strength, panX: 0, panY: 1 - 2 * e };
    case "none": return { zoom: 1, panX: 0, panY: 0 };
    default: {
      const dir = i % 2 === 0 ? 1 : -1;
      return { zoom: 1 + 0.06 * strength * q, panX: 0.35 * dir * (q - 0.5), panY: 0.2 * (0.5 - q) };
    }
  }
}

// ---- Custom camera paths ----
// A path is a list of keyframes over the shot's time (t = 0..1):
//   { t, cx, cy, w, ease }   cx/cy = frame centre in image-normalised units,
//                            w = frame width as a fraction of the image width
//                            (height follows the 16:9 output), ease = how the
//                            move INTO the next keyframe accelerates.
// Unequal spacing of t = variable speed; equal rects back to back = a hold.
export const EASES = [
  { id: "inout", label: "Ease in & out" },
  { id: "in", label: "Ease in (start slow)" },
  { id: "out", label: "Ease out (end slow)" },
  { id: "linear", label: "Constant speed" },
];
export const DEFAULT_PATH = {
  keyframes: [
    { t: 0, cx: 0.5, cy: 0.5, w: 1, ease: "inout" },
    { t: 1, cx: 0.5, cy: 0.5, w: 0.82, ease: "inout" },
  ],
};
function easeU(u, kind) {
  u = Math.max(0, Math.min(1, u));
  switch (kind) {
    case "linear": return u;
    case "in": return u * u;
    case "out": return 1 - (1 - u) * (1 - u);
    default: return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }
}
// Frame rect (image-normalised {cx, cy, w}) at progress p through the shot.
export function pathRectAt(path, p) {
  const kf = (path && Array.isArray(path.keyframes) ? path.keyframes : DEFAULT_PATH.keyframes)
    .slice().sort((a, b) => a.t - b.t);
  if (!kf.length) return { cx: 0.5, cy: 0.5, w: 1 };
  if (p <= kf[0].t || kf.length === 1) return { cx: kf[0].cx, cy: kf[0].cy, w: kf[0].w };
  const last = kf[kf.length - 1];
  if (p >= last.t) return { cx: last.cx, cy: last.cy, w: last.w };
  let i = 0;
  while (i + 1 < kf.length && kf[i + 1].t <= p) i++;
  const a = kf[i], b = kf[i + 1];
  const u = easeU((p - a.t) / Math.max(1e-6, b.t - a.t), a.ease);
  // zoom feels even when the width changes geometrically
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * u);
  return { cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u, w };
}
// Clamp a rect so the 16:9 frame stays inside the image.
export function clampRect(rect, iw, ih, W = 16, H = 9) {
  const maxW = Math.min(1, (ih / iw) * (W / H));
  const w = Math.max(0.12, Math.min(maxW, rect.w));
  const h = w * (iw / ih) * (H / W); // normalised height
  const cx = Math.max(w / 2, Math.min(1 - w / 2, rect.cx));
  const cy = Math.max(h / 2, Math.min(1 - h / 2, rect.cy));
  return { cx, cy, w, h };
}
// Draw the part of `el` inside `rect` so it fills the W×H frame.
export function drawViewport(ctx, el, W, H, rect) {
  const iw = el.videoWidth || el.naturalWidth || el.width;
  const ih = el.videoHeight || el.naturalHeight || el.height;
  if (!iw || !ih) return;
  const r = clampRect(rect, iw, ih, W, H);
  const sx = (r.cx - r.w / 2) * iw, sy = (r.cy - r.h / 2) * ih;
  ctx.drawImage(el, sx, sy, r.w * iw, r.h * ih, 0, 0, W, H);
}

// Which lyric text is on screen at time t for segment s, and how faded.
// mode: "one" (a line at a time, default), "two" (pairs), "all" (whole stanza).
// Lines share the scene's time slot equally, each fading in and out.
export function lyricAt(seg, t, mode = "one") {
  // A scene split into several shots shares one lyric span across them.
  const s = seg.lyricSpan ? { ...seg, start: seg.lyricSpan.start, end: seg.lyricSpan.end } : seg;
  const lines = lyricPieces(s.lyrics);
  if (!lines.length) return { text: "", alpha: 0 };

  // Tapped-in line times (absolute seconds, one per line) win over equal splits:
  // each line holds from its tap until the next tap (or the scene's end).
  const taps = Array.isArray(s.lineStarts) ? s.lineStarts.filter((x) => typeof x === "number") : [];
  if (taps.length === lines.length && taps.length > 0) {
    if (t < taps[0] - 0.3) return { text: "", alpha: 0, index: -1, count: lines.length };
    let idx = 0;
    for (let i = 0; i < taps.length; i++) if (t >= taps[i]) idx = i;
    const gs = taps[idx];
    const ge = idx + 1 < taps.length ? taps[idx + 1] : s.end;
    const fade = Math.min(0.35, Math.max(0.08, (ge - gs) / 4));
    const alpha = Math.max(0, Math.min(1, (t - gs + 0.3) / fade, (ge - t) / fade));
    return { text: lines[idx], alpha, index: idx, count: lines.length };
  }

  const size = mode === "all" ? lines.length : mode === "two" ? 2 : 1;
  const groups = [];
  for (let i = 0; i < lines.length; i += size) groups.push(lines.slice(i, i + size).join("\n"));
  const dur = Math.max(0.01, s.end - s.start);
  const n = groups.length;
  const slot = dur / n;
  let idx = Math.floor((t - s.start) / slot);
  idx = Math.max(0, Math.min(n - 1, idx));
  const gs = s.start + idx * slot;
  const ge = gs + slot;
  const fade = Math.min(0.45, slot / 4);
  const alpha = Math.max(0, Math.min(1, (t - gs) / fade, (ge - t) / fade));
  return { text: groups[idx], alpha, index: idx, count: n };
}

// A designed-looking title/closing card drawn from text alone, for projects
// whose intro/outro card images haven't been generated. Navy-to-air-blue
// gradient with a soft horizon glow, Michroma-style title, Inter credits.
// Render a drawn text card to a PNG data URL (so it can become the project's
// real intro/outro card image, saved and exported like any other).
export function textCardToDataUrl(card, W = 1536, H = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  drawTextCard(ctx, card || {}, W, H);
  return canvas.toDataURL("image/png");
}

function drawTextCard(ctx, card, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#00205B");
  g.addColorStop(0.6, "#16417F");
  g.addColorStop(1, "#2E5FA9");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, W * 0.6);
  glow.addColorStop(0, "rgba(245,247,250,0.28)");
  glow.addColorStop(1, "rgba(245,247,250,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(245,247,250,0.28)";
  ctx.lineWidth = Math.max(1, H * 0.0015);
  ctx.beginPath();
  ctx.arc(W / 2, H * 1.9, H * 1.35, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#F5F7FA";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = H * 0.01;
  let y = H * (card.small ? 0.3 : 0.38);
  if (card.kicker) {
    ctx.font = `400 ${Math.round(H * 0.022)}px Michroma, Inter, system-ui, sans-serif`;
    ctx.fillStyle = "#8FB4E6";
    ctx.fillText(String(card.kicker).toUpperCase(), W / 2, y);
    y += H * 0.07;
    ctx.fillStyle = "#F5F7FA";
  }
  if (card.title) {
    const px = Math.round(H * 0.07);
    ctx.font = `400 ${px}px Michroma, Inter, system-ui, sans-serif`;
    const tl = wrapLines(ctx, card.title, W * 0.8).slice(0, 2);
    tl.forEach((ln) => { ctx.fillText(ln, W / 2, y); y += px * 1.25; });
    y += H * 0.03;
  }
  ctx.font = `500 ${Math.round(H * 0.03)}px Inter, system-ui, sans-serif`;
  for (const ln of card.lines || []) {
    for (const w of wrapLines(ctx, ln, W * 0.8)) { ctx.fillText(w, W / 2, y); y += H * 0.045; }
  }
  if (card.small) {
    ctx.font = `400 ${Math.round(H * 0.019)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(245,247,250,0.8)";
    const sm = wrapLines(ctx, card.small, W * 0.86);
    let sy = H - H * 0.06 - (sm.length - 1) * H * 0.03;
    for (const w of sm) { ctx.fillText(w, W / 2, sy); sy += H * 0.03; }
  }
  ctx.shadowBlur = 0;
}

// ---- Q&A intro: a Conference As A Concert question card, written out letter
// by letter, that crossfades into the student's answer ----
// How long the question takes to "write" on a card of cardSec seconds.
export function questionTypeSeconds(question, cardSec = 4) {
  const n = String(question || "").length;
  return Math.max(0.8, Math.min(cardSec * 0.6, n * 0.045));
}
// Lines of the question at the card's text size (layout never shifts while
// typing): the biggest size that fits maxLines lines inside the width and height.
function questionLines(ctx, question, W, H, { width = 0.78, startPx = 0.078, maxLines = 3, maxHeight = 1 } = {}) {
  const q = String(question || "").trim() || "…";
  let px = Math.round(H * startPx);
  let lines = [];
  for (let k = 0; k < 10; k++) {
    ctx.font = `600 ${px}px Cinzel, Georgia, serif`;
    lines = wrapLines(ctx, q, W * width);
    if (lines.length <= maxLines && lines.length * px * 1.28 <= H * maxHeight) return { lines, px };
    px = Math.round(px * 0.9);
  }
  ctx.font = `600 ${px}px Cinzel, Georgia, serif`;
  return { lines: wrapLines(ctx, q, W * width).slice(0, maxLines + 1), px };
}

// The question typed out: whole-line layout first, then each line's prefix,
// with a gold caret while writing (blinking once done). centerY = block middle.
function drawTypedQuestion(ctx, { lines, px }, centerY, reveal, caret, t, W, H) {
  const total = lines.reduce((a, l) => a + l.length, 0) + Math.max(0, lines.length - 1);
  let shown = Math.round(Math.max(0, Math.min(1, reveal)) * total);
  const lh = px * 1.28;
  let ly = centerY - ((lines.length - 1) * lh) / 2 + px * 0.35;
  ctx.font = `600 ${px}px Cinzel, Georgia, serif`;
  ctx.textAlign = "left"; ctx.fillStyle = "#F5F7FA";
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = H * 0.014;
  let caretX = null, caretY = ly;
  for (const line of lines) {
    const full = ctx.measureText(line).width;
    const x0 = (W - full) / 2;
    const part = line.slice(0, Math.max(0, shown));
    if (part) ctx.fillText(part, x0, ly);
    if (shown >= 0 && shown <= line.length) { caretX = x0 + ctx.measureText(part).width; caretY = ly; }
    shown -= line.length + 1;
    ly += lh;
  }
  ctx.shadowBlur = 0;
  if (caret && caretX != null && (reveal < 1 || Math.floor(t * 2) % 2 === 0)) {
    ctx.fillStyle = "#f3c969";
    ctx.fillRect(caretX + px * 0.06, caretY - px * 0.82, Math.max(2, px * 0.06), px * 0.95);
  }
}

function spacedText(ctx, text, x, y, spacingPx) {
  if ("letterSpacing" in ctx) { ctx.letterSpacing = `${spacingPx}px`; ctx.fillText(text, x, y); ctx.letterSpacing = "0px"; }
  else ctx.fillText(text, x, y);
}

export function drawQuestionCard(ctx, { question = "", reveal = 1, index = 0, count = 1, logo = null, bg = null, caret = true, t = 0 } = {}, W, H) {
  const kicker = count > 1 ? `QUESTION ${index + 1} OF ${count}` : "WE ASKED";

  // ---- with the artwork background (temple at sunrise, golden staff, navy
  // panel, audience): the text lives inside the navy panel, ~45%–70% down ----
  if (bg && (bg.naturalWidth || bg.width)) {
    ctx.fillStyle = "#0b1b3f"; ctx.fillRect(0, 0, W, H);
    drawCover(ctx, bg, W, H, 1 + 0.025 * Math.min(1, t / 10)); // a slow, gentle push-in
    // soften the panel a touch so the words always read
    const pg = ctx.createRadialGradient(W / 2, H * 0.575, 0, W / 2, H * 0.575, W * 0.42);
    pg.addColorStop(0, "rgba(6,18,52,0.45)"); pg.addColorStop(1, "rgba(6,18,52,0)");
    ctx.fillStyle = pg; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f3d9a4";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = H * 0.008;
    ctx.font = `400 ${Math.round(H * 0.021)}px Michroma, Inter, system-ui, sans-serif`;
    spacedText(ctx, `CONFERENCE AS A CONCERT  ·  ${kicker}`, W / 2, H * 0.478, Math.round(H * 0.004));
    ctx.shadowBlur = 0;
    // a short gold rule under the kicker
    const rw = W * 0.09, ry = H * 0.498;
    ctx.strokeStyle = "rgba(243,217,164,0.7)"; ctx.lineWidth = Math.max(1, H * 0.0018);
    ctx.beginPath(); ctx.moveTo(W / 2 - rw, ry); ctx.lineTo(W / 2 + rw, ry); ctx.stroke();
    const layout = questionLines(ctx, question, W, H, { width: 0.7, startPx: 0.064, maxLines: 3, maxHeight: 0.18 });
    drawTypedQuestion(ctx, layout, H * 0.59, reveal, caret, t, W, H);
    return;
  }

  // ---- plain brand card (no artwork) ----
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#00153d"); g.addColorStop(0.55, "#0b2a5e"); g.addColorStop(1, "#1d4b8f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, W * 0.65);
  glow.addColorStop(0, "rgba(243,201,105,0.30)"); glow.addColorStop(1, "rgba(243,201,105,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = "rgba(243,217,164,0.22)"; ctx.lineWidth = Math.max(1, H * 0.0016);
  ctx.beginPath(); ctx.arc(W / 2, H * 1.95, H * 1.35, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  ctx.restore();
  // brand lockup at the top: the winged mark (transparent PNG) over the name in Michroma
  let y = H * 0.07;
  if (logo && (logo.naturalWidth || logo.width)) {
    const iw = logo.naturalWidth || logo.width, ih = logo.naturalHeight || logo.height;
    const dh = H * 0.13, dw = dh * (iw / ih);
    ctx.save(); ctx.shadowColor = "rgba(243,201,105,0.35)"; ctx.shadowBlur = H * 0.03;
    ctx.drawImage(logo, (W - dw) / 2, y, dw, dh);
    ctx.restore();
    y += dh + H * 0.045;
  } else {
    y += H * 0.03;
  }
  ctx.textAlign = "center"; ctx.fillStyle = "#C9D8F0";
  ctx.font = `400 ${Math.round(H * 0.028)}px Michroma, Inter, system-ui, sans-serif`;
  spacedText(ctx, "CONFERENCE AS A CONCERT", W / 2, y, Math.round(H * 0.006));
  y += H * 0.06;
  // gold rule with a diamond
  const ry = y, rw = W * 0.16;
  ctx.strokeStyle = "rgba(243,217,164,0.75)"; ctx.lineWidth = Math.max(1, H * 0.002);
  ctx.beginPath(); ctx.moveTo(W / 2 - rw, ry); ctx.lineTo(W / 2 - H * 0.016, ry); ctx.moveTo(W / 2 + H * 0.016, ry); ctx.lineTo(W / 2 + rw, ry); ctx.stroke();
  ctx.save(); ctx.translate(W / 2, ry); ctx.rotate(Math.PI / 4); ctx.strokeRect(-H * 0.006, -H * 0.006, H * 0.012, H * 0.012); ctx.restore();
  ctx.textAlign = "center"; ctx.fillStyle = "#f3d9a4";
  ctx.font = `500 ${Math.round(H * 0.024)}px Inter, system-ui, sans-serif`;
  ctx.fillText(kicker, W / 2, ry + H * 0.06);
  drawTypedQuestion(ctx, questionLines(ctx, question, W, H), H * 0.56, reveal, caret, t, W, H);
}

// The artwork behind the question cards (public/question-bg.webp).
export const QUESTION_BG = "/question-bg.webp";

// A still of the card (fully written) for the editor's preview.
export async function drawQuestionPreview(canvas, { question = "", index = 0, count = 1, logoSrc = "/logo-mark.png", bgSrc = QUESTION_BG } = {}) {
  const W = canvas.width || 960, H = canvas.height || 540;
  const ctx = canvas.getContext("2d", { alpha: false });
  try { await document.fonts.load(`600 ${Math.round(H * 0.078)}px Cinzel`); await document.fonts.load(`400 ${Math.round(H * 0.022)}px Michroma`); } catch {}
  let logo = null, bg = null;
  if (bgSrc) { try { bg = await loadImage(bgSrc); } catch {} }
  else if (logoSrc) { try { logo = await loadImage(logoSrc); } catch {} }
  drawQuestionCard(ctx, { question, reveal: 1, index, count, logo, bg, caret: false }, W, H);
}

function drawWatermark(ctx, text, W, H) {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.font = `500 ${Math.round(H * 0.022)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillStyle = "#F5F7FA";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  ctx.fillText(text, W - H * 0.03, H * 0.05);
  ctx.restore();
}

// True while a recording is in progress. The app pauses heavy background
// work (autosave serialisation) during that window — any main-thread stall
// drops frames in the real-time capture and shows up as a hitch in the video.
let rendering = false;
export function isRendering() { return rendering; }

export function renderMusicVideo(plan, { onProgress, onStatus, previewCanvas } = {}) {
  let cancelled = false;
  const cleanups = [];
  const cleanup = () => { rendering = false; for (const f of cleanups.splice(0)) { try { f(); } catch {} } };

  const promise = (async () => {
    const mime = pickRenderMime();
    if (!mime) throw new Error("This browser can't record video — use Chrome or Edge.");
    const W = plan.width || 1920, H = plan.height || 1080, fps = plan.fps || 30;
    const total = plan.totalSec;
    if (!(total > 0)) throw new Error("The song has no duration yet.");

    onStatus?.("Loading scenes…");
    const segs = plan.segments.slice().sort((a, b) => a.start - b.start);
    const assets = [];
    for (let i = 0; i < segs.length; i++) {
      if (cancelled) throw new Error("Cancelled.");
      const s = segs[i];
      try {
        assets[i] = s.kind === "video" ? await loadVideo(s.src) : s.kind === "textcard" ? { textcard: true } : await loadImage(s.src);
      } catch (e) {
        // Fall back to a dark frame rather than aborting the whole render.
        assets[i] = null;
      }
      onProgress?.(0, `Loaded ${i + 1} of ${segs.length} scenes`);
    }

    // Audio: play the song through WebAudio into the recording (not the speakers).
    const audioEl = document.createElement("audio");
    audioEl.crossOrigin = "anonymous";
    audioEl.src = plan.audioUrl;
    audioEl.preload = "auto";
    await new Promise((res, rej) => {
      audioEl.onloadedmetadata = res;
      audioEl.onerror = () => rej(new Error("Couldn't load the song audio."));
    });
    const ACtx = window.AudioContext || window.webkitAudioContext;
    const actx = new ACtx();
    const srcNode = actx.createMediaElementSource(audioEl);
    const dest = actx.createMediaStreamDestination();
    srcNode.connect(dest);
    cleanups.push(() => { try { actx.close(); } catch {} });

    // Opening / closing clips play with their own sound through the same
    // recording graph, before and after the song.
    const bookends = plan.bookends || {};
    const prepClip = async (clip) => {
      if (!clip || !clip.src) return null;
      const el = await loadVideo(clip.src);
      // loadVideo mutes clips (scene clips are silent); a bookend's own sound
      // must reach the recording, so unmute — the element feeds the WebAudio
      // graph only (not the speakers) once it has a MediaElementSource.
      el.muted = false;
      el.volume = 1;
      const node = actx.createMediaElementSource(el);
      const gain = actx.createGain(); // lets the sound fade with the picture
      node.connect(gain); gain.connect(dest);
      const inAt = Math.max(0, Number(clip.in) || 0);
      const outAt = Number(clip.out) > inAt ? Number(clip.out) : (Number.isFinite(el.duration) ? el.duration : inAt);
      const len = Math.max(0, outAt - inAt);
      return { el, gain, inAt, outAt, len, fade: clip.fade, captions: captionSchedule(clip, len) };
    };
    let pre = null, post = null;
    try { pre = await prepClip(bookends.pre); } catch { pre = null; }
    try { post = await prepClip(bookends.post); } catch { post = null; }
    // Q&A intro: [question card → the student's answer] × N, before everything else.
    const qaPlan = plan.qaIntro && Array.isArray(plan.qaIntro.items) ? plan.qaIntro : null;
    const qa = [];
    let qaLogo = null, qaBg = null;
    if (qaPlan) {
      onStatus?.("Loading the Q&A clips…");
      for (const it of qaPlan.items) {
        if (cancelled) throw new Error("Cancelled.");
        try { const c = await prepClip(it); if (c && c.len > 0.3) qa.push({ ...c, question: String(it.question || "").trim(), xfade: Math.max(0.2, Math.min(2, Number(it.fade) || Number(qaPlan.fade) || 0.8)) }); } catch {}
      }
      if (qaPlan.logoSrc) { try { qaLogo = await loadImage(qaPlan.logoSrc); } catch { qaLogo = null; } }
      if (qaPlan.bgSrc) { try { qaBg = await loadImage(qaPlan.bgSrc); } catch { qaBg = null; } }
      try { await document.fonts.load(`600 ${Math.round(H * 0.078)}px Cinzel`); } catch {}
    }
    const qaCardSec = qaPlan ? Math.max(2, Math.min(10, Number(qaPlan.cardSec) || 4)) : 0;
    const qaTotal = qa.reduce((a, c) => a + qaCardSec + c.len, 0);
    const lead = Math.max(0, Math.min(30, Number(plan.introLead) || 0)); // intro card held in silence before the music
    const endLogo = plan.endLogo && plan.endLogo.src ? { seconds: Math.max(2, Math.min(12, Number(plan.endLogo.seconds) || 4)), fade: Math.max(0.2, Math.min(3, Number(plan.endLogo.fade) || 0.8)), src: plan.endLogo.src, lines: (Array.isArray(plan.endLogo.lines) ? plan.endLogo.lines : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3) } : null;
    let endLogoImage = null;
    if (endLogo) { try { endLogoImage = await loadImage(endLogo.src); } catch { endLogoImage = null; } }
    const grand = qaTotal + (pre ? pre.len : 0) + lead + total + (post ? post.len : 0) + (endLogoImage ? endLogo.seconds : 0);
    const stamp = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

    const canvas = previewCanvas || document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false });
    const stream = canvas.captureStream(fps);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);

    // Play one bookend clip from in→out, drawing it full-frame with a short
    // fade at both ends. offset = seconds of output already recorded.
    const playClipPhase = (clip, offset, label) => new Promise((resolve, reject) => {
      const { el, inAt, outAt } = clip;
      const fade = Math.max(0, Math.min(5, Number(clip.fade) || 0.4));
      const draw = () => {
        if (cancelled) { reject(new Error("Cancelled.")); return; }
        const t = el.currentTime;
        if (t >= outAt - 0.04 || el.ended) { el.pause(); resolve(); return; }
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        drawCover(ctx, el, W, H);
        const a = Math.min(1, (t - inAt) / fade, (outAt - t) / fade);
        if (clip.captions && clip.captions.length) {
          const lt = t - inAt;
          const cap = clip.captions.find((c) => lt >= c.from && lt < c.to);
          if (cap) {
            const f = Math.min(0.3, (cap.to - cap.from) / 4);
            const ca = Math.max(0, Math.min(1, (lt - cap.from) / f, (cap.to - lt) / f));
            drawLyrics(ctx, cap.text, W, H, ca, lyricScale(plan.captionsSize || plan.lyricsSize) * 0.85, 3);
          }
        }
        if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, a)})`; ctx.fillRect(0, 0, W, H); }
        if (clip.gain) clip.gain.gain.value = Math.max(0, Math.min(1, a));
        const done = offset + (t - inAt);
        if (done - lastProgressAt >= 0.25) { lastProgressAt = done; onProgress?.(done / grand, `${label} · ${stamp(done)} of ${stamp(grand)}`); }
        raf = requestAnimationFrame(draw);
      };
      const begin = () => { el.removeEventListener("seeked", begin); el.play().then(() => { raf = requestAnimationFrame(draw); }).catch(reject); };
      el.addEventListener("seeked", begin);
      el.currentTime = inAt;
    });

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: plan.bitrate || 4_000_000, audioBitsPerSecond: 192_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });

    // Pre-roll: paint the first frame so the recording doesn't open on black.
    ctx.fillStyle = "#00205B"; ctx.fillRect(0, 0, W, H);

    onStatus?.("Rendering… keep this tab open and visible.");
    rendering = true;
    await actx.resume();
    rec.start(1000);
    const t0 = performance.now();

    let raf = 0;
    cleanups.push(() => cancelAnimationFrame(raf));
    const fadeSec = 0.6;
    let lastProgressAt = -1;
    const songOffset = qaTotal + (pre ? pre.len : 0) + lead;

    // ---- Q&A intro ----
    let qaTimer = 0;
    cleanups.push(() => clearTimeout(qaTimer));
    let qaOffset = 0;
    for (let qi = 0; qi < qa.length; qi++) {
      const item = qa[qi];
      const card = { question: item.question, index: qi, count: qa.length, logo: qaLogo, bg: qaBg };
      const typeSec = questionTypeSeconds(item.question, qaCardSec);
      const label = `Question ${qi + 1} of ${qa.length}`;
      // 1) the card: fades up, the question writes itself out, then holds.
      // Timer-driven so it always finishes, like the intro hold and closing logo.
      await new Promise((resolve, reject) => {
        const t0 = performance.now();
        const draw = () => {
          if (cancelled) { reject(new Error("Cancelled.")); return; }
          const t = (performance.now() - t0) / 1000;
          if (t >= qaCardSec) { resolve(); return; }
          drawQuestionCard(ctx, { ...card, reveal: Math.min(1, t / typeSec), t }, W, H);
          const a = Math.min(1, t / 0.6);
          if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, W, H); }
          const done = qaOffset + t;
          if (done - lastProgressAt >= 0.25) { lastProgressAt = done; onProgress?.(done / grand, `${label} · card · ${stamp(done)} of ${stamp(grand)}`); }
          qaTimer = setTimeout(draw, 33);
        };
        draw();
      });
      qaOffset += qaCardSec;
      // 2) the answer: crossfades in over the card (picture and sound), plays
      // with its captions, and fades out at the end.
      await new Promise((resolve, reject) => {
        const { el, inAt, outAt, xfade } = item;
        const draw = () => {
          if (cancelled) { reject(new Error("Cancelled.")); return; }
          const t = el.currentTime;
          if (t >= outAt - 0.04 || el.ended) { el.pause(); resolve(); return; }
          const lt = t - inAt;
          const aIn = Math.max(0, Math.min(1, lt / xfade));
          const aOut = Math.max(0, Math.min(1, (outAt - t) / xfade));
          if (aIn < 1) drawQuestionCard(ctx, { ...card, reveal: 1, caret: false, t: qaCardSec + lt }, W, H);
          else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
          ctx.save(); ctx.globalAlpha = aIn; drawCover(ctx, el, W, H); ctx.restore();
          if (item.captions && item.captions.length) {
            const cap = item.captions.find((c) => lt >= c.from && lt < c.to);
            if (cap) {
              const f = Math.min(0.3, (cap.to - cap.from) / 4);
              const ca = Math.max(0, Math.min(1, (lt - cap.from) / f, (cap.to - lt) / f));
              drawLyrics(ctx, cap.text, W, H, ca * aIn, lyricScale(plan.captionsSize || plan.lyricsSize) * 0.85, 3);
            }
          }
          if (aOut < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - aOut})`; ctx.fillRect(0, 0, W, H); }
          item.gain.gain.value = Math.min(aIn, aOut);
          const done = qaOffset + lt;
          if (done - lastProgressAt >= 0.25) { lastProgressAt = done; onProgress?.(done / grand, `${label} · answer · ${stamp(done)} of ${stamp(grand)}`); }
          raf = requestAnimationFrame(draw);
        };
        const begin = () => { el.removeEventListener("seeked", begin); item.gain.gain.value = 0; el.play().then(() => { raf = requestAnimationFrame(draw); }).catch(reject); };
        el.addEventListener("seeked", begin);
        el.currentTime = inAt;
      });
      qaOffset += item.len;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      await new Promise((r) => setTimeout(r, 150));
    }
    if (qa.length) await new Promise((r) => setTimeout(r, 200));

    if (pre) {
      await playClipPhase(pre, qaTotal, "Opening clip");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      await new Promise((r) => setTimeout(r, 250));
    }
    // Silent hold on the intro card before the music starts (the card is the
    // first segment; drawn still, so its motion begins with the song).
    let leadTimer = 0;
    cleanups.push(() => clearTimeout(leadTimer));
    if (lead > 0) {
      const s0 = segs[0], el0 = assets[0];
      const offset = qaTotal + (pre ? pre.len : 0);
      await new Promise((resolve, reject) => {
        const t0 = performance.now();
        const draw = () => {
          if (cancelled) { reject(new Error("Cancelled.")); return; }
          const t = (performance.now() - t0) / 1000;
          if (t >= lead) { resolve(); return; }
          ctx.fillStyle = "#00205B"; ctx.fillRect(0, 0, W, H);
          if (s0 && s0.kind === "textcard") drawTextCard(ctx, s0.card || {}, W, H);
          else if (el0 && s0 && s0.kind !== "video") {
            // the card's pan/zoom spans the hold AND its segment in the song: one continuous move
            const span = lead + Math.max(0.01, s0.end - s0.start);
            const p = Math.max(0, Math.min(1, t / span));
            if (s0.motion === "custom" && s0.path) drawViewport(ctx, el0, W, H, pathRectAt(s0.path, p));
            else { const mv = motionAt(s0.motion || "auto", p, 0, s0.isCard ? 0.5 : 1); drawCover(ctx, el0, W, H, mv.zoom, mv.panX, mv.panY); }
          }
          const a = Math.min(1, t / 0.6); // ease in from black
          if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, W, H); }
          if (offset + t - lastProgressAt >= 0.25) { lastProgressAt = offset + t; onProgress?.((offset + t) / grand, `Intro card · ${stamp(offset + t)} of ${stamp(grand)}`); }
          leadTimer = setTimeout(draw, 33); // a timer, so the hold always ends even if the tab loses focus
        };
        draw();
      });
    }
    audioEl.currentTime = 0;
    await audioEl.play();

    await new Promise((resolve, reject) => {
      const frame = () => {
        if (cancelled) { reject(new Error("Cancelled.")); return; }
        const t = audioEl.currentTime;
        if (t >= total - 0.05 || audioEl.ended) { resolve(); return; }

        ctx.fillStyle = "#00205B"; ctx.fillRect(0, 0, W, H);
        // Which segment(s) are showing: current, plus the next during a crossfade.
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (t < s.start - fadeSec || t >= s.end) continue;
          const el = assets[i];
          let alpha = 1;
          if (t < s.start) alpha = (t - (s.start - fadeSec)) / fadeSec; // fading in over the previous
          if (!el) continue;
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          if (s.kind === "textcard") {
            drawTextCard(ctx, s.card || {}, W, H);
          } else if (s.kind === "video") {
            if (el.paused && !el.ended && !el._started) { el._started = true; el.currentTime = 0; el.play().catch(() => {}); }
            // Once the clip has played out, hold its last frame with the scene's motion.
            if (el.ended) {
              const clipEnd = s.start + (el.duration || 0);
              const p = Math.max(0, Math.min(1, (t - clipEnd) / Math.max(0.01, s.end - clipEnd)));
              if (s.motion === "custom" && s.path) {
                drawViewport(ctx, el, W, H, pathRectAt(s.path, p));
              } else {
                const mv = motionAt(s.motion === "auto" || !s.motion ? "zoomIn" : s.motion, p, i, 0.6);
                drawCover(ctx, el, W, H, mv.zoom, mv.panX, mv.panY);
              }
            } else {
              drawCover(ctx, el, W, H);
            }
          } else {
            // Ken Burns on the still, per the shot's motion setting (or a custom path).
            // The intro card held before the music continues the move it began during the hold.
            const held = i === 0 && lead > 0 && s.isCard ? lead : 0;
            const p = Math.max(0, Math.min(1, (held + (t - s.start)) / Math.max(0.01, held + (s.end - s.start))));
            if (s.motion === "custom" && s.path) {
              drawViewport(ctx, el, W, H, pathRectAt(s.path, p));
            } else {
              const mv = motionAt(s.motion || "auto", p, i, s.isCard ? 0.5 : 1);
              drawCover(ctx, el, W, H, mv.zoom, mv.panX, mv.panY);
            }
          }
          ctx.restore();
          if (alpha >= 1 && plan.lyricsOverlay && s.lyrics) {
            const l = lyricAt(s, t, plan.lyricsMode || "one");
            drawLyrics(ctx, l.text, W, H, l.alpha, lyricScale(plan.lyricsSize), (plan.lyricsSize || "huge") === "huge" ? 2 : plan.lyricsSize === "xl" ? 3 : 4);
          }
        }
        // Pause any clip that isn't on screen so it doesn't burn CPU.
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i], el = assets[i];
          if (s.kind === "video" && el && !el.paused && (t < s.start - fadeSec || t >= s.end)) { el.pause(); el._started = false; }
        }
        drawWatermark(ctx, plan.watermark, W, H);
        // Progress updates re-render the studio UI, so report at most 4×/s —
        // not on every frame — to keep the capture loop smooth.
        if (songOffset + t - lastProgressAt >= 0.25) {
          lastProgressAt = songOffset + t;
          onProgress?.((songOffset + t) / grand, `${stamp(t)} of ${stamp(total)} (song)${grand > total ? ` · ${stamp(songOffset + t)} of ${stamp(grand)} total` : ""}`);
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      audioEl.onended = () => resolve();
    });

    // Tail: hold the last frame a beat so the end card isn't clipped.
    await new Promise((r) => setTimeout(r, 400));
    audioEl.pause();
    if (post) {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      await new Promise((r) => setTimeout(r, 250));
      await playClipPhase(post, songOffset + total, "Closing clip");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      await new Promise((r) => setTimeout(r, 300));
    }
    // Closing logo card: the Conference As A Concert mark fades up from black
    // on navy, holds, and fades back to black. Silent. Timer-driven so it
    // completes even when the tab is not in front.
    if (endLogoImage) {
      const offset = songOffset + total + (post ? post.len : 0);
      const { seconds, fade } = endLogo;
      const im = endLogoImage;
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const lines = endLogo.lines || [];
      const linePx = Math.round(H * 0.032);
      const textBlock = lines.length ? lines.length * linePx * 1.5 + linePx * 0.6 : 0;
      // The logo fills the frame: contained edge to edge (nothing cropped), over a
      // blurred, darkened copy of the same art that covers whatever is left.
      const scale = Math.min(W / iw, (H - textBlock) / ih);
      const dw = Math.round(iw * scale), dh = Math.round(ih * scale), dx = Math.round((W - dw) / 2), dy = Math.round((H - dh - textBlock) / 2);
      const cs = Math.max(W / iw, H / ih);
      const cw = Math.round(iw * cs), ch = Math.round(ih * cs), cx = Math.round((W - cw) / 2), cy = Math.round((H - ch) / 2);
      let logoTimer = 0;
      cleanups.push(() => clearTimeout(logoTimer));
      await new Promise((resolve, reject) => {
        const t0 = performance.now();
        const draw = () => {
          if (cancelled) { reject(new Error("Cancelled.")); return; }
          const t = (performance.now() - t0) / 1000;
          if (t >= seconds) { resolve(); return; }
          const a = Math.max(0, Math.min(1, t / fade, (seconds - t) / fade));
          ctx.fillStyle = "#0b1b3f"; ctx.fillRect(0, 0, W, H);
          ctx.save(); ctx.globalAlpha = a;
          if (dw < W - 2 || dh < H - textBlock - 2) {
            // background: the art stretched to cover, blurred and dimmed
            ctx.save(); ctx.filter = `blur(${Math.round(H * 0.03)}px)`; ctx.drawImage(im, cx, cy, cw, ch); ctx.restore();
            ctx.fillStyle = "rgba(5,14,38,0.55)"; ctx.fillRect(0, 0, W, H);
          }
          ctx.drawImage(im, dx, dy, dw, dh);
          if (lines.length) {
            ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
            ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = linePx * 0.4;
            lines.forEach((ln, i) => {
              ctx.font = `${i === 0 ? 600 : 500} ${linePx}px Inter, system-ui, sans-serif`;
              ctx.fillStyle = i === 0 ? "#F5F7FA" : "#C0C5CE";
              ctx.fillText(ln, W / 2, dy + dh + linePx * 1.4 + i * linePx * 1.5);
            });
          }
          ctx.restore();
          if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, W, H); }
          if (offset + t - lastProgressAt >= 0.25) { lastProgressAt = offset + t; onProgress?.((offset + t) / grand, `Closing logo · ${stamp(offset + t)} of ${stamp(grand)}`); }
          logoTimer = setTimeout(draw, 33);
        };
        draw();
      });
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      await new Promise((r) => setTimeout(r, 200));
    }
    rec.stop();
    await done;
    cleanup();
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext, mime: mime.split(";")[0], elapsedMs: performance.now() - t0 };
  })().catch((e) => { cleanup(); throw e; });

  return { promise, cancel: () => { cancelled = true; } };
}

// Splice several start→end slices of one video into a single clip, with a
// fade out / fade in (picture to black, sound to silence) at every join.
// Frames are drawn to a canvas and the element's sound runs through a gain
// node, so both can be faded. The recorder pauses while the video seeks to
// the next segment, so joins are tight. Real time.
export function captureSegments({ src, segments, fade = 0.5, onProgress }) {
  return new Promise(async (resolve, reject) => {
    const cleanups = [];
    const cleanup = () => { for (const f of cleanups.splice(0)) { try { f(); } catch {} } };
    try {
      const mime = pickRenderMime();
      if (!mime) throw new Error("This browser can't record video — use Chrome or Edge.");
      const segs = (segments || []).map((g) => ({ from: Math.max(0, Number(g.from) || 0), to: Number(g.to) || 0 })).filter((g) => g.to > g.from);
      if (!segs.length) throw new Error("No segments to capture.");
      const total = segs.reduce((a, g) => a + (g.to - g.from), 0);

      const el = document.createElement("video");
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.playsInline = true;
      el.src = src;
      await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = () => rej(new Error("The video couldn't be loaded.")); });
      const W = el.videoWidth || 1280, H = el.videoHeight || 720;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d", { alpha: false });

      const ACtx = window.AudioContext || window.webkitAudioContext;
      const actx = new ACtx();
      cleanups.push(() => { try { actx.close(); } catch {} });
      const srcNode = actx.createMediaElementSource(el);
      const gain = actx.createGain();
      const dest = actx.createMediaStreamDestination();
      srcNode.connect(gain); gain.connect(dest); // not to the speakers
      await actx.resume();

      const stream = canvas.captureStream(30);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      let started = false; // the recorder starts once the first section is in position (no black lead-in)
      // If the video stalls to buffer mid-section, hold the recording too —
      // otherwise the clip grows by every stall (frozen picture, silence).
      let holding = false; // true between sections (explicit pause)
      const onWaiting = () => { if (rec.state === "recording") rec.pause(); };
      const onPlaying = () => {
        if (!started) { rec.start(500); started = true; return; } // first real frame → start recording
        if (!holding && rec.state === "paused") rec.resume();
      };
      el.addEventListener("waiting", onWaiting);
      el.addEventListener("stalled", onWaiting);
      el.addEventListener("playing", onPlaying);
      cleanups.push(() => { el.removeEventListener("waiting", onWaiting); el.removeEventListener("stalled", onWaiting); el.removeEventListener("playing", onPlaying); });

      const seek = (t) => new Promise((res) => { const on = () => { el.removeEventListener("seeked", on); res(); }; el.addEventListener("seeked", on); el.currentTime = t; });
      let doneSec = 0;
      for (let i = 0; i < segs.length; i++) {
        const g = segs[i];
        const len = g.to - g.from;
        const f = Math.min(fade, len / 3);
        await seek(g.from);
        gain.gain.value = 0;
        holding = false;
        if (started && rec.state === "paused") rec.resume();
        await el.play();
        await new Promise((res, rej) => {
          const draw = () => {
            const t = el.currentTime;
            if (t >= g.to - 0.04 || el.ended) { res(); return; }
            if (el.readyState < 3 && rec.state === "paused") { setTimeout(draw, 100); return; } // buffering: wait it out
            // picture: fade from black at the start, to black at the end
            const a = f > 0 ? Math.max(0, Math.min(1, (t - g.from) / f, (g.to - t) / f)) : 1;
            ctx.drawImage(el, 0, 0, W, H);
            if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, W, H); }
            gain.gain.value = a;
            onProgress?.(Math.min(1, (doneSec + (t - g.from)) / total));
            setTimeout(draw, 33); // a timer, not requestAnimationFrame: keeps checking the end mark even when the tab is not in front
          };
          el.onerror = () => rej(new Error("Playback failed while capturing."));
          draw();
        });
        el.pause();
        gain.gain.value = 0;
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        doneSec += len;
        if (i < segs.length - 1) { holding = true; if (rec.state === "recording") rec.pause(); } // hold while we seek to the next section
      }
      await new Promise((r) => setTimeout(r, 150));
      if (!started) throw new Error("The video never started playing — try a lower quality or check the connection.");
      rec.stop();
      await stopped;
      cleanup();
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), ext, duration: total });
    } catch (e) { cleanup(); reject(e); }
  });
}

// Record a start→end slice of a video element's playback (picture + sound)
// into a local clip. Used for the closing clip cut from the talk's official
// video (served through our proxy so the frames are readable). Real time.
export function captureClip({ src, start, end, onProgress }) {
  // One section, no fades — same canvas + WebAudio path as splicing, so the
  // sound is captured reliably (an element's own captureStream can come out
  // silent when its volume is turned down).
  return captureSegments({ src, segments: [{ from: start, to: end }], fade: 0, onProgress });
}

// Splice several separate clips (e.g. a campus session's reaction and
// testimony clips) into ONE clip, in order, with a fade to black at every
// join. Each source is played in real time, drawn to a canvas, its sound
// routed through WebAudio, and the whole thing recorded — the same path as
// captureSegments, but across different files. Sources are letterboxed into
// a 16:9 frame so phone (portrait) clips and widescreen clips can mix.
//   sources: [{ src, in?, out? }]   (in/out in seconds; default = whole clip)
export function captureConcat({ sources, fade = 0.5, width = 1280, height = 720, onProgress }) {
  return new Promise(async (resolve, reject) => {
    const cleanups = [];
    const cleanup = () => { for (const f of cleanups.splice(0)) { try { f(); } catch {} } };
    try {
      const mime = pickRenderMime();
      if (!mime) throw new Error("This browser can't record video — use Chrome or Edge.");
      const list = (sources || []).filter((s) => s && s.src);
      if (!list.length) throw new Error("No clips to splice.");

      const W = width, H = height;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d", { alpha: false });
      const ACtx = window.AudioContext || window.webkitAudioContext;
      const actx = new ACtx();
      cleanups.push(() => { try { actx.close(); } catch {} });
      const gain = actx.createGain();
      const dest = actx.createMediaStreamDestination();
      gain.connect(dest);
      await actx.resume();

      const stream = canvas.captureStream(30);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);

      // Load every clip first so the total length is known for progress.
      const els = [];
      for (const s of list) {
        const el = document.createElement("video");
        el.crossOrigin = "anonymous"; el.preload = "auto"; el.playsInline = true; el.src = s.src;
        await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = () => rej(new Error("A clip couldn't be loaded — its link may have expired; reopen this step and try again.")); });
        const from = Math.max(0, Number(s.in) || 0);
        const to = Math.min(el.duration || 0, Number(s.out) > 0 ? Number(s.out) : (el.duration || 0));
        if (to > from) els.push({ el, from, to });
        cleanups.push(() => { try { el.pause(); el.removeAttribute("src"); el.load(); } catch {} });
      }
      if (!els.length) throw new Error("The clips have no playable length.");
      const total = els.reduce((a, x) => a + (x.to - x.from), 0);

      let started = false, doneSec = 0;
      for (let i = 0; i < els.length; i++) {
        const { el, from, to } = els[i];
        const node = actx.createMediaElementSource(el);
        node.connect(gain);
        const len = to - from;
        const f = Math.min(fade, len / 3);
        await new Promise((res) => { const on = () => { el.removeEventListener("seeked", on); res(); }; el.addEventListener("seeked", on); el.currentTime = from; });
        gain.gain.value = 0;
        // letterbox the clip into the frame
        const vw = el.videoWidth || W, vh = el.videoHeight || H;
        const scale = Math.min(W / vw, H / vh);
        const dw = Math.round(vw * scale), dh = Math.round(vh * scale), dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);
        await el.play();
        if (!started) { rec.start(500); started = true; }
        else if (rec.state === "paused") rec.resume();
        await new Promise((res, rej) => {
          const draw = () => {
            const t = el.currentTime;
            if (t >= to - 0.04 || el.ended) { res(); return; }
            const a = f > 0 ? Math.max(0, Math.min(1, (t - from) / f, (to - t) / f)) : 1;
            ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
            ctx.drawImage(el, dx, dy, dw, dh);
            if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, W, H); }
            gain.gain.value = a;
            onProgress?.(Math.min(1, (doneSec + (t - from)) / total));
            setTimeout(draw, 33);
          };
          el.onerror = () => rej(new Error("Playback failed while splicing."));
          draw();
        });
        el.pause();
        gain.gain.value = 0;
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        doneSec += len;
        if (i < els.length - 1 && rec.state === "recording") rec.pause();
      }
      await new Promise((r) => setTimeout(r, 150));
      if (!started) throw new Error("The clips never started playing.");
      rec.stop();
      await stopped;
      cleanup();
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), ext, duration: total });
    } catch (e) { cleanup(); reject(e); }
  });
}

// Even split helper: scene timings proportional to lyric word counts.
export function autoTimeline(scenes, totalSec, { introSec = 4, outroSec = 6, hasIntro = true, hasOutro = true } = {}) {
  const body = Math.max(1, totalSec - (hasIntro ? introSec : 0) - (hasOutro ? outroSec : 0));
  const weights = scenes.map((s) => Math.max(3, String(s.lyrics || s.description || "").split(/\s+/).filter(Boolean).length));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let t = hasIntro ? introSec : 0;
  const starts = {};
  scenes.forEach((s, i) => {
    starts[s.sceneNumber] = Math.round(t * 10) / 10;
    t += (weights[i] / sum) * body;
  });
  return starts;
}

// Crop a data-URL image to 16:9 (centered) — Kling takes aspect from the image.
export async function cropTo16x9(dataUrl, maxW = 1920) {
  const im = await loadImage(dataUrl);
  const w = im.naturalWidth, h = im.naturalHeight;
  let cw = w, ch = Math.round(w * 9 / 16);
  if (ch > h) { ch = h; cw = Math.round(h * 16 / 9); }
  const scale = Math.min(1, maxW / cw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(im, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

// Grab the last frame of a clip (object URL) as a JPEG data URL, for chaining.
export async function lastFrameOf(videoUrl) {
  const v = await loadVideo(videoUrl);
  v.loop = false;
  await new Promise((res) => {
    const target = Math.max(0, (v.duration || 1) - 0.08);
    v.onseeked = res;
    v.currentTime = target;
  });
  const canvas = document.createElement("canvas");
  canvas.width = v.videoWidth; canvas.height = v.videoHeight;
  canvas.getContext("2d").drawImage(v, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}
