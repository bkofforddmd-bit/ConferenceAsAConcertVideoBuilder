// netlify/lib/keys.js
//
// One place that decides which API key a function uses.
//
//   1. A key the user pasted into the app's Settings panel (sent per request
//      as an `x-user-<service>-key` header, stored only in their browser), or
//   2. the site's environment variable (Netlify → Site settings → Environment).
//
// Headers win so a user can try a service before the site owner adds a key.
// Nothing here is ever echoed back to the browser.

const SERVICES = {
  anthropic: { env: "ANTHROPIC_API_KEY", header: "x-user-anthropic-key", label: "Anthropic (lyrics, scenes, insights)" },
  openai: { env: "OPENAI_API_KEY", header: "x-user-openai-key", label: "OpenAI (scene images)" },
  gemini: { env: "GEMINI_API_KEY", header: "x-user-gemini-key", label: "Google Gemini (Lyria music, Veo video)" },
  fal: { env: "FAL_KEY", header: "x-user-fal-key", label: "fal.ai (music + video fallback)" },
};

export function keyFor(req, service) {
  const def = SERVICES[service];
  if (!def) return "";
  const fromHeader = req && req.headers ? (req.headers.get(def.header) || "").trim() : "";
  if (fromHeader) return fromHeader;
  return (process.env[def.env] || "").trim();
}

// Which services have a key on the server (booleans only — never the keys).
export function serverKeyPresence() {
  const out = {};
  for (const [name, def] of Object.entries(SERVICES)) out[name] = Boolean((process.env[def.env] || "").trim());
  return out;
}

export function serviceLabels() {
  const out = {};
  for (const [name, def] of Object.entries(SERVICES)) out[name] = def.label;
  return out;
}

export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
