// src/lib/video-clip.js
//
// Records a segment of a talk's official MP4 into a standalone video clip,
// entirely in the browser. MP4 files can't be byte-sliced the way MP3s can
// (frames depend on each other and the index lives elsewhere in the file),
// so instead we RE-RECORD the segment in real time:
//
//   1. Load the official video through the audio-proxy function (the Church's
//      CDN allows playback from anywhere but blocks capture of cross-origin
//      media; the same-origin proxy lifts that restriction).
//   2. Seek to the clip's start and play it silently (audio is routed into
//      the recording instead of the speakers).
//   3. Capture the playing video + audio with the browser's MediaRecorder —
//      MP4 (H.264) where supported (Chrome/Edge), WebM elsewhere.
//
// A 30-second clip therefore takes ~30 seconds to record. If the network
// stalls mid-recording, the recorder pauses with it so the clip never
// contains frozen frames.

const PROXY = "/.netlify/functions/audio-proxy";

const MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  "video/mp4",
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
];

export function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {}
  }
  return "";
}

// Starts a real-time recording of [startSec, endSec] from videoUrl.
// Returns { promise, cancel } — promise resolves to { blob, ext }.
// `container`: a DOM node to show the playing video in while it records.
export function recordClipToVideo({ videoUrl, startSec, endSec, container, onStatus, onProgress }) {
  let cancelled = false;
  const cleanups = [];
  const cleanup = () => {
    for (const f of cleanups.splice(0)) {
      try { f(); } catch {}
    }
  };

  const promise = (async () => {
    if (!(endSec > startSec)) throw new Error("The clip's end must be after its start.");
    if (endSec - startSec > 600) throw new Error("Clips are limited to 10 minutes.");
    const mime = pickRecorderMime();
    if (!mime) throw new Error("this browser can't record video — use Chrome or Edge");

    onStatus?.("Loading the video…");
    const el = document.createElement("video");
    el.playsInline = true;
    el.preload = "auto";
    el.src = `${PROXY}?src=${encodeURIComponent(videoUrl)}`;
    el.style.width = "100%";
    el.style.borderRadius = "8px";
    el.style.background = "#000";
    (container || document.body).appendChild(el);
    cleanups.push(() => el.remove());
    cleanups.push(() => {
      try { el.pause(); el.removeAttribute("src"); el.load(); } catch {}
    });

    await new Promise((resolve, reject) => {
      el.addEventListener("loadedmetadata", resolve, { once: true });
      el.addEventListener("error", () => reject(new Error("couldn't load the talk video")), { once: true });
    });
    if (cancelled) throw new Error("cancelled");

    el.currentTime = Math.max(0, startSec);
    await new Promise((resolve) => el.addEventListener("seeked", resolve, { once: true }));
    if (cancelled) throw new Error("cancelled");

    // Route the element's audio into the recording and away from the speakers.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const actx = new Ctx();
    cleanups.push(() => { try { actx.close(); } catch {} });
    const srcNode = actx.createMediaElementSource(el);
    const dest = actx.createMediaStreamDestination();
    srcNode.connect(dest);

    const cap = el.captureStream?.() || el.mozCaptureStream?.();
    if (!cap) throw new Error("this browser can't capture video — use Chrome or Edge");
    const stream = new MediaStream([...cap.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    cleanups.push(() => stream.getTracks().forEach((t) => { try { t.stop(); } catch {} }));

    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve, reject) => {
      rec.onstop = resolve;
      rec.onerror = () => reject(new Error("the recorder failed"));
    });

    // If the stream stalls to buffer, pause the recorder with it.
    el.addEventListener("waiting", () => { if (rec.state === "recording") { try { rec.pause(); } catch {} } });
    el.addEventListener("playing", () => { if (rec.state === "paused") { try { rec.resume(); } catch {} } });

    const stopAll = () => {
      try { el.pause(); } catch {}
      try { if (rec.state !== "inactive") rec.stop(); } catch {}
    };
    const tick = () => {
      if (cancelled) return stopAll();
      onProgress?.(Math.max(0, el.currentTime - startSec));
      if (el.currentTime >= endSec || el.ended) stopAll();
    };
    el.addEventListener("timeupdate", tick);
    const iv = setInterval(tick, 250);
    cleanups.push(() => clearInterval(iv));

    onStatus?.("Recording in real time — keep this tab open…");
    rec.start(500);
    await actx.resume().catch(() => {});
    await el.play();
    await done;
    if (cancelled) throw new Error("cancelled");

    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    if (blob.size < 20_000) throw new Error("the recording came out empty — try again");
    return { blob, ext: mime.includes("mp4") ? "mp4" : "webm" };
  })();

  promise.finally(cleanup).catch(() => {});
  return { promise, cancel: () => { cancelled = true; } };
}
