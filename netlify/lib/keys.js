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

// fal.ai queue jobs: fal tells us the exact status/result URLs when a request
// is submitted (they do NOT simply mirror the submit URL), so we carry those
// URLs inside the job id instead of rebuilding them later.
export function encodeFalJob(submitData, submitUrl) {
  const id = submitData.request_id;
  // Fallback if fal ever omits the URLs: the app root is owner/alias (first two
  // path segments), e.g. fal-ai/minimax-music/v2 → fal-ai/minimax-music.
  const root = submitUrl.replace(/^https:\/\/queue\.fal\.run\//, "").split("/").slice(0, 2).join("/");
  const s = submitData.status_url || `https://queue.fal.run/${root}/requests/${id}/status`;
  const r = submitData.response_url || `https://queue.fal.run/${root}/requests/${id}`;
  return Buffer.from(JSON.stringify({ id, s, r }), "utf8").toString("base64url");
}

export function decodeFalJob(token) {
  try {
    const obj = JSON.parse(Buffer.from(String(token), "base64url").toString("utf8"));
    const ok = (u) => typeof u === "string" && /^https:\/\/queue\.fal\.run\//.test(u);
    if (!obj || !ok(obj.s) || !ok(obj.r)) return null;
    return obj;
  } catch {
    return null;
  }
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
