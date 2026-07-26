// src/lib/search-text.js
//
// Shared text tokenizer for the AI talk search. Used by BOTH the index
// builder (scripts/build-search-index.js) and the browser-side scorer —
// they must tokenize identically or search quality quietly degrades.

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","been","but","by","can","could","did",
  "do","does","for","from","had","has","have","he","her","him","his","i","if",
  "in","into","is","it","its","may","me","might","must","my","not","of","on",
  "or","our","she","should","so","that","the","their","them","then","there",
  "these","they","this","those","to","us","was","we","were","what","when",
  "which","who","will","with","would","you","your","shall","unto","said",
  "also","one","two","many","more","most","such","upon","every","because",
  "brothers","sisters","brethren","today","thing","things","time","just",
  "even","now","know","come","came","let","yet","own","each","much","how",
  "than","about","after","before","all","am","any","being","both","get",
  "like","made","make","no","only","other","out","over","same","some","up",
  "very","way","well","where","while","why","through","during","against",
  "between","here","again","once","few","don","t","s","re","ve","ll","d",
]);

// Light stemmer: fold common English suffixes so "covenants", "covenant"
// and "covenanted" score together. Deliberately conservative.
function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) return w.slice(0, -2);
  return w;
}

// Text -> array of normalized terms (stopwords removed, stemmed).
export function tokenize(text) {
  const out = [];
  const words = String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z]+/);
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    const t = stem(w);
    if (t.length >= 3) out.push(t);
  }
  return out;
}
