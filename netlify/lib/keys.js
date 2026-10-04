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

// Google accepts an API key either as the x-goog-api-key header or as a Bearer
// token, but rejects a request that looks like it carries both ("Multiple
// authentication credentials received"). Newer AI Studio keys (prefix "AQ.")
// trip this on some endpoints. Try the header style first, and if Google
// complains about multiple credentials, retry once as a Bearer token.
export async function googleFetch(url, key, init = {}) {
  const base = { ...init };
  const styles = {
    header: () => ({ u: url, h: { "x-goog-api-key": key } }),
    bearer: () => ({ u: url, h: { Authorization: `Bearer ${key}` } }),
    query: () => ({ u: url + (url.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key), h: {} }),
  };
  // Order by what each key style is most likely to accept.
  const order = key.startsWith("AQ.") ? ["bearer", "header", "query"] : ["header", "query", "bearer"];
  const retryable = /Multiple authentication credentials|API key not valid|UNAUTHENTICATED|invalid authentication credentials/i;

  let resp = null;
  let lastText = "";
  for (const name of order) {
    const { u, h } = styles[name]();
    resp = await fetch(u, { ...base, headers: { ...(init.headers || {}), ...h } });
    if (resp.status !== 400 && resp.status !== 401) return resp;
    lastText = await resp.clone().text();
    if (!retryable.test(lastText)) return resp;
  }
  // Every style failed on authentication. Explain the one case we can name.
  if (/Multiple authentication credentials/i.test(lastText)) {
    const hint = key.startsWith("AQ.")
      ? "Your Google key starts with \"AQ.\" — Google's newer key format, which this Google service rejects. " +
        "Create a key that starts with \"AIza\" at aistudio.google.com/apikey (choose an existing Google Cloud project), " +
        "then replace GEMINI_API_KEY on Netlify (or in Settings) and try again."
      : "Google rejected the key as ambiguous. Create a fresh key at aistudio.google.com/apikey and replace GEMINI_API_KEY.";
    return new Response(JSON.stringify({ error: { message: hint, code: "invalid_key_format", google: lastText.slice(0, 200) } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  return resp;
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
