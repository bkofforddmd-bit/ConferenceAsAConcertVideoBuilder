// netlify/functions/talk-coach.js
//
// The Talk builder's coach. Two streamed steps:
//
//   kind "skeleton" — given a seed quote (with citation), the speaker whose
//     CONSTRUCTION the user wants to emulate, optionally that speaker's
//     construction template (from a saved Talk-construction analysis), and
//     the user's assignment context: produce a personalized scaffold — the
//     emulated speaker's talk architecture applied to this quote, with
//     concrete coaching and prompts for what the user should supply.
//
//   kind "review" — given the scaffold sections filled in with the user's
//     own material: coach the draft — per-section feedback, transitions,
//     what to tighten, what's missing, next actions.
//
// Same streaming discipline as analyze.js: each invocation is ONE small
// model round (the platform kills streams at ~30s); on the output ceiling
// the stream ends with @@CONTINUE@@ and the browser calls again with
// continueFrom.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const CONTINUE_SENTINEL = "@@CONTINUE@@";

const COMMON = [
  "You are a warm, practical homiletics coach helping a member of The Church",
  "of Jesus Christ of Latter-day Saints prepare a sacrament meeting talk.",
  "You coach CONSTRUCTION — architecture, flow, proportion — in the style of",
  "a specific General Conference speaker. Important principles:",
  "- The user emulates the speaker's STRUCTURE and craft, never impersonates",
  "  them. The talk must be the user's own: their voice, their stories,",
  "  their testimony.",
  "- Be concrete and specific to the user's quote and assignment, never",
  "  generic. Short examples beat abstract advice.",
  "- Encouraging, direct, practical. No filler.",
  "- Do not use [n] citation markers. Do not include internal or system XML",
  "  tags in your response.",
].join("\n");

const SYSTEMS = {
  skeleton: COMMON + "\n\n" + [
    "Produce a personalized talk scaffold in markdown:",
    "- Open with 2-3 sentences: how this speaker would characteristically",
    "  approach a talk built around this quote, and the overall arc you",
    "  recommend.",
    "- Then the talk's sections in order, each as a numbered '## n. Section",
    "  name' heading (5-8 sections, matching the emulated speaker's typical",
    "  construction, with rough proportions like '~15%'). Under each heading",
    "  give exactly three short parts:",
    "  **What they do:** the speaker's habit for this section, in 1-2",
    "  sentences.",
    "  **With your quote:** how to apply it HERE — where the quote lands,",
    "  how to set it up or echo it, 2-3 sentences.",
    "  **Your move:** 1-3 pointed questions or tasks telling the user exactly",
    "  what to gather or write for this section (a story from their life, a",
    "  scripture, a doctrinal point, an invitation).",
    "- Close with '## A note on making it yours' — 2-3 sentences.",
  ].join("\n"),
  review: COMMON + "\n\n" + [
    "The user has filled in their outline. Review it in markdown:",
    "- Open with 2-3 sentences of honest overall assessment — what already",
    "  works, and the single biggest improvement.",
    "- Then one '## Section name' per section reviewing what they wrote:",
    "  what's strong, what to tighten or reorder, how well it serves the",
    "  emulated construction, and a concrete suggestion (including a possible",
    "  transition sentence into the next section where helpful).",
    "- If a section is empty, suggest specifically what could fill it.",
    "- Close with '## Next actions' — a short numbered list of the 3-5 most",
    "  valuable things to do next, in priority order.",
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

  const kind = SYSTEMS[body.kind] ? body.kind : "skeleton";
  const emulate = String(body.emulate || "").slice(0, 100);
  const context = String(body.context || "").slice(0, 1000);
  const continueFrom = String(body.continueFrom || "");
  const q = body.quote || {};
  const quoteBlock = q.text
    ? `Seed quote:\n“${String(q.text).slice(0, 2000)}”\n— ${q.speaker || ""}, “${q.title || ""},” ${q.when || ""} General Conference\n`
    : "";
  if (!emulate) return json({ error: "Name the speaker whose construction to emulate." }, 400);

  let userContent;
  if (kind === "skeleton") {
    const template = String(body.template || "").slice(0, 8000);
    userContent =
      `Speaker to emulate (construction only): ${emulate}\n\n` +
      quoteBlock +
      (context ? `\nThe user's assignment/context: ${context}\n` : "") +
      (template
        ? `\nThis construction template was distilled from an analysis of ${emulate}'s recent talks — follow it closely:\n${template}\n`
        : `\nNo saved construction analysis is attached — rely on your knowledge of how ${emulate} builds talks.\n`);
  } else {
    const sections = Array.isArray(body.sections) ? body.sections.slice(0, 12) : [];
    userContent =
      `Speaker being emulated (construction only): ${emulate}\n\n` +
      quoteBlock +
      (context ? `\nThe user's assignment/context: ${context}\n` : "") +
      `\nThe user's outline so far:\n\n` +
      sections
        .map(
          (s) =>
            `## ${String(s.name || "").slice(0, 120)}\n` +
            (String(s.userText || "").trim()
              ? String(s.userText).slice(0, 4000)
              : "(not filled in yet)")
        )
        .join("\n\n");
  }

  // Byte-identical base message with a cache breakpoint, so continuation
  // rounds read the input from the prompt cache.
  const baseMessages = [
    {
      role: "user",
      content: [{ type: "text", text: userContent, cache_control: { type: "ephemeral" } }],
    },
  ];
  const messages = continueFrom
    ? [
        ...baseMessages,
        { role: "assistant", content: continueFrom },
        {
          role: "user",
          content:
            "Your previous response hit the output length limit mid-sentence. " +
            "Continue EXACTLY where it left off — same document, same structure. " +
            "Do not repeat anything already written. Just continue to the end.",
        },
      ]
    : baseMessages;

  const encoder = new TextEncoder();
  let cancelled = false;
  let upstreamReader = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s) => { try { controller.enqueue(encoder.encode(s)); } catch {} };
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
            max_tokens: 1200,
            stream: true,
            thinking: { type: "disabled" },
            output_config: { effort: "medium" },
            system: SYSTEMS[kind],
            messages,
          }),
        });
        if (!upstream.ok) {
          const err = await upstream.json().catch(() => ({}));
          send(`\n\n*(Coaching failed: ${err?.error?.message || `the AI service responded ${upstream.status}`})*`);
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
        if (stopReason === "max_tokens") send(CONTINUE_SENTINEL);
        else if (stopReason === "refusal") send("\n\n*(The model declined this request.)*");
      } catch (e) {
        send(`\n\n*(Coaching failed: ${String(e && e.message)})*`);
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
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
