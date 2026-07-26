// netlify/functions/analyze.js
//
// The synthesis step of the Insights features. Streams a markdown essay from
// Claude for one of three analysis kinds:
//
//   "speaker"      — how one speaker's teaching progressed first talk → last
//                    (input: per-talk study notes from summarize-talk.js)
//   "era"          — what speakers emphasized during a period
//                    (input: study notes)
//   "construction" — HOW a speaker builds a talk: openings, scripture and
//                    story deployment, transitions, testimony, closings,
//                    signature devices — ending with a reusable template
//                    (input: the FULL TEXT of a sample of their talks)
//
// Long essays: each invocation streams exactly ONE model round (a fresh
// function-time budget every time). If the model hits its output ceiling,
// the stream ends with the @@CONTINUE@@ sentinel; the browser immediately
// calls again with `continueFrom` (everything so far) and appends the next
// round seamlessly. Talks are cited as [n]; the browser renders playable
// chips.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
export const CONTINUE_SENTINEL = "@@CONTINUE@@";

const SYSTEMS = {
  speaker: [
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
  ].join("\n"),
  era: [
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
  ].join("\n"),
  construction: [
    "You are a scholar of homiletics — the craft of sermon construction. You",
    "will receive the FULL TEXT of several General Conference talks by one",
    "speaker, and you write an essay on HOW this speaker BUILDS a talk: the",
    "architecture and craft, not the doctrinal content.",
    "",
    "Structure the essay in markdown, citing talks as [n] and QUOTING short",
    "phrases (a few words) as evidence:",
    "- Open with 2-3 sentences characterizing their construction style.",
    "- '## How they open' — their opening moves (story? scripture? question?",
    "  headline claim?), with examples.",
    "- '## The scaffolding' — how the body is organized: numbered points,",
    "  question-and-answer, single extended metaphor, scripture exposition,",
    "  braided stories? How do they signal transitions?",
    "- '## Stories, scripture, and doctrine' — the mix and placement: where",
    "  stories sit relative to doctrine, how scripture is deployed (proof,",
    "  narrative, close reading), how application is drawn.",
    "- '## Signature devices' — recurring rhetorical habits: repeated",
    "  refrains, coined phrases, direct address, rhetorical questions,",
    "  humor, second-person invitations.",
    "- '## How they land it' — endings: testimony placement and phrasing,",
    "  invitation/blessing patterns, how the close ties back to the opening.",
    "- '## How consistent is the formula' — do they follow one construction",
    "  or several? What varies by topic or audience?",
    "- Close with '## The construction template' — a NUMBERED, step-by-step",
    "  reusable outline of this speaker's typical talk (with rough",
    "  proportions, e.g. 'opening story ~15%'), written so that someone",
    "  preparing their own sacrament meeting talk could follow it as a",
    "  scaffold. Make each step concrete and actionable.",
    "Be specific and evidence-based; every observation needs a [n] citation.",
  ].join("\n"),
};

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

  const kind = SYSTEMS[body.kind] ? body.kind : "speaker";
  const label = String(body.label || "").slice(0, 200);
  const continueFrom = String(body.continueFrom || "");
  const maxItems = kind === "construction" ? 16 : 900;
  const items = Array.isArray(body.items) ? body.items.slice(0, maxItems) : [];
  if (items.length < 2) return json({ error: "Need at least 2 talks to analyze." }, 400);

  // Chronological, oldest first — analyses read forward through time.
  const lines = items.map((t, idx) => {
    if (kind === "construction") {
      // Full text, per-talk cap so the payload stays reasonable.
      return `[${idx + 1}] "${t.title}" — ${t.speaker}, ${t.when}\n---\n${String(t.text || "").slice(0, 16000)}\n---`;
    }
    const themes = (t.themes || []).join(", ");
    return `[${idx + 1}] "${t.title}" — ${t.speaker}, ${t.when}\n${t.summary}${themes ? `\nThemes: ${themes}` : ""}`;
  });

  const intro =
    kind === "speaker"
      ? `Speaker: ${label}\nTalks in chronological order:\n\n`
      : kind === "era"
      ? `Era: ${label}\nTalks (chronological):\n\n`
      : `Speaker: ${label}\nFull talk texts (chronological):\n\n`;

  // The big source block is byte-identical on every round and carries a
  // cache breakpoint, so continuation rounds read it from the prompt cache
  // (~10% of the normal input price) instead of re-paying for it.
  const baseMessages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: intro + lines.join("\n\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
    },
  ];
  const messages = continueFrom
    ? [
        ...baseMessages,
        { role: "assistant", content: continueFrom },
        {
          role: "user",
          content:
            "Your previous response hit the output length limit and stopped " +
            "mid-sentence. Continue EXACTLY where it left off — same essay, " +
            "same structure, same citation style. Do not repeat anything " +
            "already written, do not restart a section, do not add a preamble. " +
            "Just continue seamlessly to the end of the essay.",
        },
      ]
    : baseMessages;

  const encoder = new TextEncoder();
  let cancelled = false;
  let upstreamReader = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s) => { try { controller.enqueue(encoder.encode(s)); } catch {} };
      // Invisible keep-alive pulse while the model thinks before its first
      // words (zero-width space — harmless wherever it lands).
      let lastDelta = Date.now();
      const heartbeat = setInterval(() => {
        if (Date.now() - lastDelta > 8000) send("​");
      }, 8000);
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
            // The platform kills any response stream at ~30s, so each round
            // writes a small slice and the browser chains rounds via the
            // @@CONTINUE@@ sentinel. ~1200 tokens streams in ~15-20s.
            max_tokens: 1200,
            stream: true,
            // No extended thinking on essay rounds — it would spend the
            // 30s window (and the token budget) before any text appears.
            thinking: { type: "disabled" },
            output_config: { effort: "medium" },
            system:
              SYSTEMS[kind] +
              "\n\nDo not include internal or system XML tags in your response.",
            messages,
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
        let stopReason = null;
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
                lastDelta = Date.now();
                send(data.delta.text);
              } else if (data.type === "message_delta" && data.delta?.stop_reason) {
                stopReason = data.delta.stop_reason;
              }
            } catch {}
          }
        }
        // Hand the baton back to the browser: it calls again with
        // continueFrom and a fresh function-time budget.
        if (stopReason === "max_tokens") send(CONTINUE_SENTINEL);
        else if (stopReason === "refusal") send("\n\n*(The model declined to complete this analysis.)*");
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
