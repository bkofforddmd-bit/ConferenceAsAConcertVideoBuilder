// src/lib/card-prompts.js — the intro / outro title-card image prompts.
// Shared by the Scenes step (SceneOrganizer) and the server-side scene
// pipeline (netlify/functions/scene-pipeline-background.js), so a card made
// in the background is identical to one made on the page. Plain JS.

export const DISCLAIMER =
  "This music and video presentation is not an official production of " +
  "The Church of Jesus Christ of Latter-day Saints and is not endorsed by " +
  "the Church. The creators of this presentation fully and wholeheartedly " +
  "sustain and support the Church, its leaders, doctrines, and teachings.";

// kind: "intro" | "outro"; m: { songTitle, speaker, conferenceMonthYear, session, scripture }
// styleBible: { artStyle, colorPalette, lighting } | null; bgPrompt: optional background scene text
export function cardBackgroundPrompt(kind, m = {}, styleBible = null, bgPrompt = "") {
  const sb = styleBible || {};
  const styleBits = [
    sb.artStyle ? `Art style: ${sb.artStyle}.` : "",
    sb.colorPalette ? `Color palette: ${sb.colorPalette}.` : "",
    sb.lighting ? `Lighting: ${sb.lighting}.` : "",
  ].filter(Boolean).join(" ");

  // Quote helper so the model treats text as exact strings to render.
  const q = (s) => `"${(s || "").replace(/"/g, "'")}"`;
  const bg = bgPrompt ? `BACKGROUND SCENE: ${bgPrompt} ` : "";

  if (kind === "intro") {
    const creditParts = [
      m.speaker ? `A song inspired by ${m.speaker}` : "",
      m.conferenceMonthYear ? `Based on a message from ${m.conferenceMonthYear} General Conference` : "",
      m.session ? `${m.session}` : "",
      "of The Church of Jesus Christ of Latter-day Saints",
    ].filter(Boolean);

    return [
      "A cinematic, reverent TITLE CARD for a Latter-day Saint music video,",
      "wide 3:2 landscape, golden-hour atmosphere.",
      bg,
      styleBits,
      "Render the following text cleanly and legibly, baked into the image,",
      "spelled EXACTLY as written, in an elegant serif typeface:",
      `Large title at top: ${q(m.songTitle || "Untitled")}.`,
      creditParts.length ? `Centered credit lines below the title: ${creditParts.map(q).join(", then ")}.` : "",
      "A small disclaimer in a subtle band across the bottom, smaller text,",
      `reading exactly: ${q(DISCLAIMER)}.`,
      "Spelling must be perfect. Keep text crisp, high-contrast, and readable.",
      "Tasteful, uplifting, doctrinally appropriate imagery; no Church logo.",
    ].filter(Boolean).join(" ");
  }

  const outroScripture = m.scripture ? `Near the bottom left, an italic scripture quote rendered exactly: ${q(m.scripture)}.` : "";
  return [
    "A cinematic, reverent CLOSING CARD for a Latter-day Saint music video,",
    "wide 3:2 landscape, warm golden-hour atmosphere.",
    bg,
    styleBits,
    "Render all text cleanly and legibly, baked into the image, spelled",
    "EXACTLY as written, in an elegant serif typeface:",
    `Large title at top: ${q(m.songTitle || "Untitled")}.`,
    m.speaker ? `Italic credit line below the title: ${q("A song inspired by " + m.speaker)}.` : "",
    `An upper-left invitation in a few lines, reading exactly: ${q("If this message touched your heart, please share this video with someone who may need hope.")}`,
    "Below that, a vertical stack of three call-to-action rows on the left,",
    "each with a small gold circular icon and a label, reading exactly:",
    `a thumbs-up icon with ${q("LIKE THE VIDEO")}, a play-button icon with ${q("SUBSCRIBE TO THE CHANNEL")}, and a bell icon with ${q("TURN ON NOTIFICATIONS")}.`,
    outroScripture,
    "A small disclaimer in a subtle band across the very bottom, smaller text,",
    `reading exactly: ${q(DISCLAIMER)}.`,
    "Spelling must be perfect. Keep all text crisp, high-contrast, readable.",
    "Tasteful, uplifting, doctrinally appropriate imagery; no Church logo.",
  ].filter(Boolean).join(" ");
}
