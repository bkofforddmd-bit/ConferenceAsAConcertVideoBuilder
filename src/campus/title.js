// A starting title for the song: the first line of the chorus (what people
// remember), else the first sung line, trimmed of punctuation — editable on
// the song step.
export function guessTitle(lyrics, fallback = "") {
  const lines = String(lyrics || "").split(/\r?\n/).map((l) => l.trim());
  const isLabel = (l) => /^\[.*\]$/.test(l) || /^\(.*\)$/.test(l);
  const i = lines.findIndex((l) => /^\[(chorus|hook|refrain)/i.test(l));
  let line = "";
  if (i >= 0) line = lines.slice(i + 1).find((l) => l && !isLabel(l)) || "";
  if (!line) line = lines.find((l) => l && !isLabel(l) && !/^(title|===)/i.test(l)) || "";
  // Cut at the first comma/dash when what comes before it is a phrase of its own.
  const head = line.split(/[,;:—–]|\s-\s/)[0].trim();
  if (head.split(/\s+/).filter(Boolean).length >= 3) line = head;
  line = line.replace(/^[“"'(]+|[“”"',.;:!?)]+$/g, "").trim();
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length > 9) line = words.slice(0, 8).join(" ");
  return line || fallback || "My Song";
}
