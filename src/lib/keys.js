// src/lib/keys.js
//
// Personal API keys the user pastes into Settings. They live ONLY in this
// browser's localStorage and ride along on each request as x-user-*-key
// headers; the Netlify functions prefer them over the site's own env keys.

const KEYS_KEY = "cac-api-keys";

export const SERVICES = [
  { id: "gemini", label: "Google Gemini", hint: "Lyria music + Veo video. aistudio.google.com → Get API key", header: "x-user-gemini-key" },
  { id: "fal", label: "fal.ai", hint: "Kling video clips + MiniMax music fallback. fal.ai/dashboard/keys", header: "x-user-fal-key" },
  { id: "openai", label: "OpenAI", hint: "Scene images (gpt-image-2). platform.openai.com/api-keys", header: "x-user-openai-key" },
  { id: "anthropic", label: "Anthropic", hint: "Lyrics, scenes, insights (Claude). console.anthropic.com", header: "x-user-anthropic-key" },
];

export function loadKeys() {
  try {
    const raw = localStorage.getItem(KEYS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

// A pasted key sometimes carries a line break, a space, or a smart quote from
// the clipboard. HTTP headers can't hold those, and the browser then refuses
// to send the request at all ("Failed to fetch"), so keep only plain
// printable ASCII.
export function cleanKey(v) {
  return String(v || "").replace(/[^\x21-\x7E]/g, "");
}

export function saveKeys(keys) {
  try {
    const clean = {};
    for (const s of SERVICES) {
      const v = cleanKey(keys[s.id]);
      if (v) clean[s.id] = v;
    }
    localStorage.setItem(KEYS_KEY, JSON.stringify(clean));
  } catch {}
}

export function keyHeaders() {
  const keys = loadKeys();
  const h = {};
  for (const s of SERVICES) {
    const v = cleanKey(keys[s.id]);
    if (v) h[s.header] = v;
  }
  return h;
}

export function hasKey(service, serverKeys = {}) {
  const keys = loadKeys();
  return Boolean(keys[service]) || Boolean(serverKeys[service]);
}
