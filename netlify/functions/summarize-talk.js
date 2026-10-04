// netlify/functions/summarize-talk.js
//
// Per-talk study notes for the Insights features (speaker journey, era
// focus). The browser orchestrates: it asks which talks already have notes
// (action "have"), fetches the text of only the missing ones via fetch-talk,
// and sends them here one at a time (action "summarize") — one talk per call
// keeps each request well inside Netlify's function time limit.
//
// Summaries are cached permanently in Netlify Blobs (store "talk-summaries",
// keyed by talk uri), so each talk in the archive is only ever summarized
// ONCE — analyses get cheaper and faster the more the app is used. In local
// dev without Blobs credentials an in-memory store keeps the flow testable.

import { keyFor as serviceKey } from "../lib/keys.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const CACHE_VERSION = 1; // bump to invalidate all cached summaries

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = await import("@netlify/blobs"));
} catch {
  getStoreFn = null;
}
const memStore = new Map();

async function cacheGet(key) {
  if (getStoreFn) {
    try {
      return await getStoreFn("talk-summaries").get(key, { type: "json" });
    } catch (e) {
      if (!process.env.NETLIFY) return memStore.get(key) || null;
      throw e;
    }
  }
  return memStore.get(key) || null;
}

async function cacheSet(key, value) {
  if (getStoreFn) {
    try {
      await getStoreFn("talk-summaries").setJSON(key, value);
      return;
    } catch (e) {
      if (!process.env.NETLIFY) { memStore.set(key, value); return; }
      throw e;
    }
  }
  memStore.set(key, value);
}

const keyFor = (uri) => `v${CACHE_VERSION}:${uri}`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Which of these talks already have cached notes? Returns the notes too,
  // so the client doesn't need a second round trip.
  if (body.action === "have") {
    const uris = Array.isArray(body.uris) ? body.uris.slice(0, 2000) : [];
    const found = {};
    // Blobs has no bulk-get; run lookups in small parallel batches.
    const BATCH = 25;
    for (let i = 0; i < uris.length; i += BATCH) {
      const chunk = uris.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map((u) => cacheGet(keyFor(u))));
      chunk.forEach((u, j) => { if (results[j]) found[u] = results[j]; });
    }
    return json({ found });
  }

  if (body.action === "summarize") {
    const t = body.talk || {};
    const uri = String(t.uri || "");
    const text = String(t.text || "");
    if (!uri || !text.trim()) return json({ error: "Need talk.uri and talk.text." }, 400);

    const cached = await cacheGet(keyFor(uri));
    if (cached) return json({ summary: cached, cached: true });

    const apiKey = serviceKey(req, "anthropic");
    if (!apiKey) return json({ error: "No Anthropic key. Add one under Settings → API keys (or set ANTHROPIC_API_KEY on the site)." }, 500);

    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          // Netlify functions have ~10s to answer; skip extended thinking so
          // the summary returns fast. (Allowed on claude-opus-5 at low effort.)
          thinking: { type: "disabled" },
          output_config: {
            effort: "low",
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  summary: {
                    type: "string",
                    description: "3-4 sentences: the talk's central message, key doctrinal points, and any distinctive framing or imagery",
                  },
                  themes: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-6 short theme tags",
                  },
                  context: {
                    type: "string",
                    description:
                      "Circumstances of the time the speaker EXPLICITLY names or clearly alludes to — wars, disasters, economic conditions, social or moral trends, technology, and Church efforts under way (temples announced or dedicated, missionary work and new areas, humanitarian or welfare initiatives, new programs or policies, a leader's passing) — as a short phrase list (e.g. \"Gulf War; recession; new temples announced\"). Empty string if the talk names none.",
                  },
                },
                required: ["summary", "themes", "context"],
                additionalProperties: false,
              },
            },
          },
          system:
            "You write compact study notes on General Conference talks for later " +
            "thematic analysis. Be specific to THIS talk — capture what made it " +
            "distinct, not generic gospel phrasing. Do not include internal or " +
            "system XML tags in your response.",
          messages: [
            {
              role: "user",
              content:
                `Talk: "${t.title || ""}" by ${t.speaker || ""}, ${t.when || ""}\n\n` +
                // Very long talks are truncated to keep the call fast; the
                // opening 3/4 carries the thesis and main development.
                text.slice(0, 22000),
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Claude responded ${res.status}`);
      if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
      const parsed = JSON.parse(
        (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")
      );
      const record = {
        summary: String(parsed.summary || ""),
        themes: (parsed.themes || []).map(String).slice(0, 6),
        context: String(parsed.context || "").slice(0, 300),
        model: MODEL,
        at: new Date().toISOString(),
      };
      if (!record.summary) throw new Error("Empty summary from model");
      await cacheSet(keyFor(uri), record);
      return json({ summary: record, cached: false });
    } catch (e) {
      return json({ error: "Couldn't summarize this talk.", detail: String(e.message) }, 502);
    }
  }

  return json({ error: "Unknown action." }, 400);
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
