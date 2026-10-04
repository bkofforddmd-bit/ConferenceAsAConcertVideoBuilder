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

// Which lyric text is on screen at time t for segment s, and how faded.
// mode: "one" (a line at a time, default), "two" (pairs), "all" (whole stanza).
// Lines share the scene's time slot equally, each fading in and out.
export function lyricAt(s, t, mode = "one") {
  const lines = String(s.lyrics || "").split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return { text: "", alpha: 0 };
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
        assets[i] = s.kind === "video" ? await loadVideo(s.src) : await loadImage(s.src);
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
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
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
          if (s.kind === "video") {
            if (el.paused && !el.ended && !el._started) { el._started = true; el.currentTime = 0; el.play().catch(() => {}); }
            // Once the clip has played out, hold its last frame with a slow push-in.
            const over = el.ended ? Math.max(0, t - (s.start + (el.duration || 0))) : 0;
            drawCover(ctx, el, W, H, 1 + Math.min(0.08, over * 0.006));
          } else {
            // Ken Burns: slow 6% zoom with a gentle drift, direction alternating by scene.
            const p = Math.max(0, Math.min(1, (t - s.start) / Math.max(0.01, s.end - s.start)));
            const dir = i % 2 === 0 ? 1 : -1;
            drawCover(ctx, el, W, H, 1 + 0.06 * p, 0.35 * dir * (p - 0.5), 0.2 * (0.5 - p));
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
