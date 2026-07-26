// netlify/functions/ai-search.js
//
// AI-powered free-text topic search over the full conference archive
// (topics the curated list doesn't cover — "exaltation", "dealing with
// doubt", …). Two actions, both called by the browser:
//
//   {action:"expand", query}
//     -> {terms: [...]}  related words/phrases (Claude) so the client's
//        keyword index also matches synonyms and scriptural phrasing.
//
//   {action:"rerank", query, candidates:[{i,title,speaker,when}]}
//     -> {ranked: [{i, score, why}]}  Claude orders the keyword-matched
//        candidates by true relevance to the topic.
//
// If ANTHROPIC_API_KEY is missing or the model call fails, both actions
// return {fallback: true} with sensible non-AI results so search still
// works (plain keyword ranking).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const query = String(body.query || "").trim();
  if (!query) return json({ error: "Give me a topic to search for." }, 400);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (body.action === "expand") {
    if (!apiKey) return json({ fallback: true, terms: [query] });
    try {
      const data = await callClaude(apiKey, {
        model: MODEL,
        max_tokens: 4000,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                terms: {
                  type: "array",
                  items: { type: "string" },
                  description: "10-18 related words and short phrases",
                },
              },
              required: ["terms"],
              additionalProperties: false,
            },
          },
        },
        system:
          "You expand a search topic into related vocabulary for searching talks " +
          "from General Conference of The Church of Jesus Christ of Latter-day " +
          "Saints. Return 10-18 single words or 2-3 word phrases: synonyms, " +
          "scriptural terms, doctrinal phrases, and closely related concepts a " +
          "speaker would actually use. Include the original term.",
        messages: [{ role: "user", content: `Topic: ${query}` }],
      });
      const parsed = JSON.parse(textOf(data));
      const terms = (parsed.terms || []).map(String).filter(Boolean);
      return json({ terms: terms.length ? terms : [query] });
    } catch (e) {
      return json({ fallback: true, terms: [query], detail: String(e.message) });
    }
  }

  if (body.action === "rerank") {
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 80) : [];
    if (!candidates.length) return json({ ranked: [] });
    if (!apiKey) {
      return json({ fallback: true, ranked: candidates.map((c) => ({ i: c.i, score: 0, why: "" })) });
    }
    try {
      const list = candidates
        .map((c) => `${c.i}. "${c.title}" — ${c.speaker}, ${c.when}`)
        .join("\n");
      const data = await callClaude(apiKey, {
        model: MODEL,
        max_tokens: 8000,
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                ranked: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      i: { type: "integer", description: "candidate number" },
                      score: { type: "integer", description: "relevance 1-10" },
                      why: { type: "string", description: "≤12 words on why it's relevant" },
                    },
                    required: ["i", "score", "why"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["ranked"],
              additionalProperties: false,
            },
          },
        },
        system:
          "You rank General Conference talks by how directly they address a " +
          "topic, using your knowledge of these talks (titles, speakers, and " +
          "what they taught). Rank ALL candidates, most relevant first. Score " +
          "10 = the talk is squarely about the topic; 1 = barely related. " +
          "Keep 'why' to a short fragment, no period.",
        messages: [
          { role: "user", content: `Topic: ${query}\n\nCandidate talks:\n${list}` },
        ],
      });
      const parsed = JSON.parse(textOf(data));
      const seen = new Set();
      const ranked = (parsed.ranked || []).filter(
        (r) => Number.isInteger(r.i) && !seen.has(r.i) && seen.add(r.i)
      );
      return json({ ranked });
    } catch (e) {
      return json({
        fallback: true,
        ranked: candidates.map((c) => ({ i: c.i, score: 0, why: "" })),
        detail: String(e.message),
      });
    }
  }

  return json({ error: "Unknown action." }, 400);
};

async function callClaude(apiKey, payload) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude responded ${res.status}`);
  if (data.stop_reason === "refusal") throw new Error("The model declined this request.");
  return data;
}

function textOf(data) {
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
