// netlify/functions/analyze.js
//
// The synthesis step of the Insights features. Receives compact study notes
// for a set of talks (produced by summarize-talk.js) and asks Claude for a
// thematic analysis:
//
//   kind "speaker" — how one speaker's teaching progressed from their first
//                    talk to their most recent.
//   kind "era"     — what a group of speakers emphasized during a chosen
//                    period (e.g. the apostles during Pres. Hinckley's years).
//
// The essay is STREAMED back as plain text (markdown) so the browser renders
// it as it's written and long analyses aren't cut off by function timeouts.
// Talks are cited as [n] — the browser turns those into clickable chips.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "Server missing ANTHROPIC_API_KEY" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const kind = body.kind === "era" ? "era" : "speaker";
  const label = String(body.label || "").slice(0, 200);
  const items = Array.isArray(body.items) ? body.items.slice(0, 900) : [];
  if (items.length < 2) return json({ error: "Need at least 2 talks to analyze." }, 400);

  // Chronological, oldest first — progression reads forward through time.
  const lines = items.map((t, idx) => {
    const themes = (t.themes || []).join(", ");
    return `[${idx + 1}] "${t.title}" — ${t.speaker}, ${t.when}\n${t.summary}${themes ? `\nThemes: ${themes}` : ""}`;
  });

  const system =
    kind === "speaker"
      ? [
          "You are a thoughtful scholar of General Conference teaching. You will",
          "receive study notes on every conference talk one speaker has given, in",
          "chronological order, and you write an essay on the PROGRESSION of their",
          "teaching: how their themes, emphases, doctrinal focus, and voice evolved",
          "from their first talk to their most recent.",
          "",
          "Structure the essay in markdown:",
          "- Open with a 2-3 sentence overview of the arc.",
          "- Then 3-6 sections (## headings) — eras or threads in their teaching.",
          "  Ground every claim in specific talks, cited as [n] using the numbers",
          "  provided. Note pivot points: where a new theme appears, an old one",
          "  recedes, or their framing of a doctrine matures.",
          "- Close with '## Signature threads' — 3-5 through-lines that persist",
          "  across their whole ministry, each with citations.",
          "Be specific and evidence-based, never generic. Cite generously — every",
          "paragraph should carry at least one [n].",
        ].join("\n")
      : [
          "You are a thoughtful scholar of General Conference teaching. You will",
          "receive study notes on the conference talks given during a specific",
          "period, and you write an essay on what the speakers collectively",
          "emphasized during that era.",
          "",
          "Structure the essay in markdown:",
          "- Open with a 2-3 sentence overview of the era's dominant concerns.",
          "- Then 4-7 sections (## headings), one per major theme, ordered by how",
          "  dominant the theme was. In each: which speakers carried it, how it was",
          "  framed, and how it shifted within the era. Cite talks as [n] using the",
          "  numbers provided.",
          "- Include one section on what is NOTABLY ABSENT or fading compared to",
          "  what you'd expect — themes conspicuous by their rarity.",
          "- Close with '## The era in a sentence' — one distilled sentence.",
          "Be specific and evidence-based, never generic. Cite generously — every",
          "paragraph should carry at least one [n].",
        ].join("\n");

  const userContent =
    (kind === "speaker"
      ? `Speaker: ${label}\nTalks in chronological order:\n\n`
      : `Era: ${label}\nTalks (chronological):\n\n`) + lines.join("\n\n");

  // The whole model call happens INSIDE the returned stream, so the response
  // opens immediately (no gateway timeout waiting for first byte), and
  // newline heartbeats keep the connection alive while the model is thinking
  // before its first words — the essay renderer ignores blank lines.
  const encoder = new TextEncoder();
  let cancelled = false;
  let upstreamReader = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s) => { try { controller.enqueue(encoder.encode(s)); } catch {} };
      let gotFirstDelta = false;
      const heartbeat = setInterval(() => { if (!gotFirstDelta) send("\n"); }, 8000);
      try {
        const upstream = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 16000,
            stream: true,
            output_config: { effort: "medium" },
            system,
            messages: [{ role: "user", content: userContent }],
          }),
        });
        if (!upstream.ok) {
          const err = await upstream.json().catch(() => ({}));
          send(`\n\n*(Analysis failed: ${err?.error?.message || `the AI service responded ${upstream.status}`})*`);
          return;
        }
        upstreamReader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!cancelled) {
          const { done, value } = await upstreamReader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() || "";
          for (const evt of events) {
            const dataLine = evt.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const data = JSON.parse(dataLine.slice(6));
              if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
                gotFirstDelta = true;
                send(data.delta.text);
              } else if (data.type === "message_delta" && data.delta?.stop_reason === "refusal") {
                send("\n\n*(The model declined to complete this analysis.)*");
              }
            } catch {}
          }
        }
      } catch (e) {
        send(`\n\n*(Analysis failed: ${String(e && e.message)})*`);
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      cancelled = true;
      try { upstreamReader?.cancel(); } catch {}
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
