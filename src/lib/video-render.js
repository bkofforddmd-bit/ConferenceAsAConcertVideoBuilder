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

function drawLyrics(ctx, text, W, H, alpha) {
  if (!text || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  const fontPx = Math.round(H * 0.042);
  ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const lines = wrapLines(ctx, text, W * 0.8).slice(0, 4);
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
  const lines = String(s.lyrics || "").split(/\n/).map((x) => x.trim()).filter(Boolean);
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

export function renderMusicVideo(plan, { onProgress, onStatus, previewCanvas } = {}) {
  let cancelled = false;
  const cleanups = [];
  const cleanup = () => { for (const f of cleanups.splice(0)) { try { f(); } catch {} } };

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

    const canvas = previewCanvas || document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false });
    const stream = canvas.captureStream(fps);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: plan.bitrate || 4_000_000, audioBitsPerSecond: 192_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });

    // Pre-roll: paint the first frame so the recording doesn't open on black.
    ctx.fillStyle = "#00205B"; ctx.fillRect(0, 0, W, H);

    onStatus?.("Rendering… keep this tab open and visible.");
    await actx.resume();
    rec.start(1000);
    const t0 = performance.now();
    audioEl.currentTime = 0;
    await audioEl.play();

    let raf = 0;
    cleanups.push(() => cancelAnimationFrame(raf));
    const fadeSec = 0.6;

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
            const p = Math.max(0, Math.min(1, (t - s.start) / Math.max(0.01, s.end - s.start)));
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
            drawLyrics(ctx, l.text, W, H, l.alpha);
          }
        }
        // Pause any clip that isn't on screen so it doesn't burn CPU.
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i], el = assets[i];
          if (s.kind === "video" && el && !el.paused && (t < s.start - fadeSec || t >= s.end)) { el.pause(); el._started = false; }
        }
        drawWatermark(ctx, plan.watermark, W, H);
        onProgress?.(t / total, `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} of ${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}`);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      audioEl.onended = () => resolve();
    });

    // Tail: hold the last frame a beat so the end card isn't clipped.
    await new Promise((r) => setTimeout(r, 400));
    rec.stop();
    audioEl.pause();
    await done;
    cleanup();
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext, mime: mime.split(";")[0], elapsedMs: performance.now() - t0 };
  })().catch((e) => { cleanup(); throw e; });

  return { promise, cancel: () => { cancelled = true; } };
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
