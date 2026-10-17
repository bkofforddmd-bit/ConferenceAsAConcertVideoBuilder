// netlify/lib/image-rules.js
//
// House rules for every generated scene image. They go into the AI prompts
// that write scene descriptions and image prompts (Claude), AND are appended
// to every image prompt at generation time (gpt-image / Gemini), so a prompt
// edited by hand still obeys them.
//
// Why: image models render the sacrament inconsistently with Latter-day Saint
// practice (wrong vessels, wine, kneeling at rails), so it is never depicted.
// Missionary companionships are always two men or two women — never a mixed
// pair, and never a lone missionary presented as a companionship.

export const IMAGE_RULES = [
  "HARD CONTENT RULES (never break these):",
  "- NEVER depict the sacrament: no bread, water, trays, cups or anything being blessed, passed or taken at church. If the talk is about the sacrament, show its meaning indirectly (a reverent congregation, a chapel, light, a remembering heart) — never the emblems or the ordinance itself.",
  "- Missionary companionships are ALWAYS two men together or two women together, both in modest missionary dress with name tags. NEVER a man and a woman as a missionary pair. Never a missionary alone presented as a companionship.",
  "- Temple interiors, garments, and the details of temple ordinances are never shown; temple exteriors are fine.",
  "- Depictions of Deity: Jesus Christ may be shown reverently; God the Father is never depicted (light or presence only).",
].join("\n");

// Appended to the prompt actually sent to the image model.
export const IMAGE_PROMPT_SUFFIX =
  " Hard rules: do not depict the sacrament (no bread, water, trays or cups being blessed, passed or taken); " +
  "any missionaries appear only as a pair of two men or a pair of two women with name tags, never a man and a woman together; " +
  "no temple interiors or ordinances; never depict God the Father.";

export function applyImageRules(prompt) {
  const p = String(prompt || "").trim();
  if (!p) return p;
  return p.includes("Hard rules: do not depict the sacrament") ? p : p + IMAGE_PROMPT_SUFFIX;
}
