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

export function saveKeys(keys) {
  try {
    const clean = {};
    for (const s of SERVICES) if (keys[s.id] && String(keys[s.id]).trim()) clean[s.id] = String(keys[s.id]).trim();
    localStorage.setItem(KEYS_KEY, JSON.stringify(clean));
  } catch {}
}

export function keyHeaders() {
  const keys = loadKeys();
  const h = {};
  for (const s of SERVICES) if (keys[s.id]) h[s.header] = keys[s.id];
  return h;
}

export function hasKey(service, serverKeys = {}) {
  const keys = loadKeys();
  return Boolean(keys[service]) || Boolean(serverKeys[service]);
}
