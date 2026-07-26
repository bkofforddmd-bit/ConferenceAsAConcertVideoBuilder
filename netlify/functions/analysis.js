// netlify/functions/analysis.js
//
// Save & share finished Insights analyses. A saved analysis (essay markdown +
// the cited-talk list) gets a short id in Netlify Blobs; the share link
// /?analysis=<id> re-renders it inside the app, so citations stay clickable
// and playable for anyone who opens it.
//
//   POST {action:"save", analysis:{kind,label,essay,items:[...]}} -> {id}
//   POST {action:"get", id}                                       -> {analysis}

let getStoreFn = null;
try {
  ({ getStore: getStoreFn } = await import("@netlify/blobs"));
} catch {
  getStoreFn = null;
}
const memStore = new Map(); // local-dev fallback

async function readOne(id) {
  if (getStoreFn) {
    try {
      return await getStoreFn("shared-analyses").get(id, { type: "json" });
    } catch (e) {
      if (!process.env.NETLIFY) return memStore.get(id) || null;
      throw e;
    }
  }
  return memStore.get(id) || null;
}

async function writeOne(id, value) {
  if (getStoreFn) {
    try {
      await getStoreFn("shared-analyses").setJSON(id, value);
      return;
    } catch (e) {
      if (!process.env.NETLIFY) { memStore.set(id, value); return; }
      throw e;
    }
  }
  memStore.set(id, value);
}

function makeId() {
  let s = "";
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    if (body.action === "save") {
      const a = body.analysis || {};
      const essay = String(a.essay || "");
      const items = Array.isArray(a.items) ? a.items.slice(0, 900) : [];
      if (!essay.trim() || items.length < 1) {
        return json({ error: "Nothing to share yet — run an analysis first." }, 400);
      }
      if (essay.length > 200000) return json({ error: "Analysis too large to share." }, 413);
      const record = {
        kind: ["era", "construction"].includes(a.kind) ? a.kind : "speaker",
        label: String(a.label || "").slice(0, 200),
        essay,
        items: items.map((t) => ({
          uri: String(t.uri || ""),
          title: String(t.title || "").slice(0, 300),
          speaker: String(t.speaker || "").slice(0, 100),
          when: String(t.when || "").slice(0, 40),
        })),
        createdAt: new Date().toISOString(),
      };
      let id = "";
      for (let i = 0; i < 5; i++) {
        id = makeId();
        if (!(await readOne(id))) break;
      }
      await writeOne(id, record);
      return json({ id });
    }

    if (body.action === "get") {
      const id = String(body.id || "").trim().toLowerCase();
      if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: "That doesn't look like an analysis link." }, 400);
      const analysis = await readOne(id);
      if (!analysis) return json({ error: "This shared analysis wasn't found — the link may be incomplete." }, 404);
      return json({ analysis });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({
      error: "Shared-analysis storage isn't available right now — try again shortly.",
      detail: String(e && e.message),
    }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
