// netlify/functions/concert-publish.js
//
// Relay to the Conference Concert app's upload function
// (conferenceconcert.netlify.app/.netlify/functions/upload). That function
// expects a band password in an x-upload-password header and doesn't answer
// cross-site browser preflights, so the Studio sends the small JSON calls
// (verify / sign / save) from here instead. The password comes from the user,
// is forwarded once, and is never stored.
//
// Body: { password, action: "verify" | "sign" | "save", payload }

import { json, readJson } from "../lib/keys.js";

const CONCERT_URL = (process.env.CONCERT_APP_URL || "https://conferenceconcert.netlify.app").replace(/\/$/, "");
const ALLOWED = new Set(["verify", "sign", "save"]);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const { password = "", action = "", payload = {} } = body;
  if (!ALLOWED.has(action)) return json({ error: `Unknown action "${action}"` }, 400);
  if (!String(password).trim()) return json({ error: "Enter the Conference Concert band password." }, 400);

  let resp;
  try {
    resp = await fetch(`${CONCERT_URL}/.netlify/functions/upload`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-upload-password": String(password) },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) {
    return json({ error: "Couldn't reach the Conference Concert app", detail: String(e).slice(0, 300) }, 502);
  }
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (resp.status === 401) return json({ error: "The Conference Concert app rejected the band password." }, 401);
  return json(data, resp.ok ? 200 : resp.status);
};
