// src/lib/audio-clip.js
//
// Cuts a segment of a talk's MP3 into a .wav clip (the format every
// presentation tool accepts), entirely in the browser:
//
//   1. Learn the file's exact byte rate (one 1-byte Range request gives the
//      total size; the caller supplies the known duration from the player).
//   2. Fetch ONLY the needed byte range (clip ± padding) through the
//      audio-proxy function (~16KB per second of audio).
//   3. Decode with WebAudio, trim precisely, mix down to mono 22.05kHz
//      (plenty for speech), and encode a 16-bit WAV.

const PROXY = "/.netlify/functions/audio-proxy";
const PAD = 4; // seconds of padding fetched each side, trimmed after decode

async function totalBytesOf(mp3Url) {
  const res = await fetch(`${PROXY}?src=${encodeURIComponent(mp3Url)}`, {
    headers: { Range: "bytes=0-1" },
  });
  const cr = res.headers.get("content-range") || "";
  const m = cr.match(/\/(\d+)\s*$/);
  if (res.body) { try { res.body.cancel(); } catch {} }
  if (!m) throw new Error("Couldn't size the audio file.");
  return parseInt(m[1], 10);
}

// Returns a Blob (audio/wav) of [startSec, endSec] from the talk's MP3.
export async function cutClipToWav(mp3Url, startSec, endSec, durationSec, onStatus) {
  if (!(endSec > startSec)) throw new Error("The clip's end must be after its start.");
  if (endSec - startSec > 600) throw new Error("Clips are limited to 10 minutes.");

  onStatus?.("Sizing the audio…");
  const total = await totalBytesOf(mp3Url);
  const rate = total / Math.max(1, durationSec); // effective bytes/second

  onStatus?.("Fetching the segment…");
  const fromByte = Math.max(0, Math.floor((startSec - PAD) * rate));
  const toByte = Math.min(total - 1, Math.ceil((endSec + PAD) * rate));
  const res = await fetch(`${PROXY}?src=${encodeURIComponent(mp3Url)}`, {
    headers: { Range: `bytes=${fromByte}-${toByte}` },
  });
  if (!res.ok && res.status !== 206) throw new Error("Couldn't fetch the audio segment.");
  const bytes = await res.arrayBuffer();

  onStatus?.("Decoding…");
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    ctx.close();
  }

  // Where our fetched range actually begins on the talk's timeline.
  const rangeStartSec = fromByte / rate;
  const clipStart = Math.max(0, Math.min(startSec - rangeStartSec, decoded.duration));
  const clipLen = Math.min(endSec - startSec, decoded.duration - clipStart);
  if (clipLen <= 0.2) throw new Error("The decoded segment came up empty — try again.");

  onStatus?.("Rendering the clip…");
  const OUT_RATE = 22050;
  const offline = new OfflineAudioContext(1, Math.ceil(clipLen * OUT_RATE), OUT_RATE);
  const srcNode = offline.createBufferSource();
  srcNode.buffer = decoded;
  srcNode.connect(offline.destination);
  srcNode.start(0, clipStart, clipLen);
  const rendered = await offline.startRendering();

  onStatus?.("Encoding WAV…");
  return encodeWav(rendered.getChannelData(0), OUT_RATE);
}

// Minimal 16-bit mono PCM WAV encoder.
function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);  // PCM
  v.setUint16(22, 1, true);  // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, "0")}s`;
};
