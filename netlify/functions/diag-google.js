// netlify/functions/diag-google.js
//
// TEMPORARY diagnostic (remove after use). Creates one tiny, cheap background
// interaction on a text model, then polls it with every authentication style
// and reports Google's status/message for each. Never returns the key itself —
// only its prefix and length. Costs a fraction of a cent per call.

import { keyFor, json } from "../lib/keys.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-flash-latest"];

async function tryFetch(url, headers, init = {}) {
  try {
    const r = await fetch(url, { ...init, headers });
    const t = await r.text();
    return { status: r.status, body: t.replace(/\s+/g, " ").slice(0, 220) };
  } catch (e) {
    return { status: 0, body: String(e).slice(0, 200) };
  }
}

export default async (req) => {
  const key = keyFor(req, "gemini");
  if (!key) return json({ error: "No Gemini key configured." }, 400);
  const out = { keyPrefix: key.slice(0, 3), keyLength: key.length, create: [], get: {} };

  // 1) create a background interaction with the header style (what the app does)
  let id = "";
  for (const model of MODELS) {
    const r = await tryFetch(BASE, { "content-type": "application/json", "x-goog-api-key": key }, {
      method: "POST",
      body: JSON.stringify({ model, input: "Reply with the single word: hello", background: true }),
    });
    let got = "";
    try { got = JSON.parse(r.body.length < 220 ? r.body : "{}").id || ""; } catch {}
    if (!got && r.status === 200) {
      // body was truncated; re-run quickly to capture the id
      const rr = await fetch(BASE, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ model, input: "Reply with the single word: hello", background: true }) });
      const j = await rr.json().catch(() => ({}));
      got = j.id || "";
      out.create.push({ model, status: rr.status, id: got ? `${got.slice(0, 8)}… (len ${got.length})` : "", keys: Object.keys(j).slice(0, 12) });
    } else {
      out.create.push({ model, status: r.status, id: got ? `${got.slice(0, 8)}… (len ${got.length})` : "", body: got ? undefined : r.body });
    }
    if (got) { id = got; out.model = model; break; }
  }
  if (!id) return json(out);

  // 2) poll it every way
  const url = `${BASE}/${encodeURIComponent(id)}`;
  const styles = {
    header: { u: url, h: { "x-goog-api-key": key } },
    headerWithRevision: { u: url, h: { "x-goog-api-key": key, "Api-Revision": "2026-05-20" } },
    bearer: { u: url, h: { Authorization: `Bearer ${key}` } },
    query: { u: `${url}?key=${encodeURIComponent(key)}`, h: {} },
    headerRawId: { u: `${BASE}/${id}`, h: { "x-goog-api-key": key } },
  };
  for (const [name, s] of Object.entries(styles)) out.get[name] = await tryFetch(s.u, s.h, { method: "GET" });
  out.idShape = { hasSlash: id.includes("/"), hasDot: id.includes("."), sample: id.slice(0, 6) + "…" };
  return json(out);
};
