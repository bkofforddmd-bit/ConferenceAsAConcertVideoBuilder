// Church growth statistics (membership, missionaries, temples by region)
// compiled from the Church's annual statistical reports and temple
// dedication dates into public/church-stats.json. Loaded once per session.

let cache = null;
let inflight = null;

export function loadChurchStats() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/church-stats.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { cache = d; return d; })
      .catch(() => null);
  }
  return inflight;
}

export const REGION_COLORS = {
  "North America": "#2E5FA9",
  "Latin America": "#8FB4E6",
  Europe: "#F2C66D",
  Asia: "#7FD1A8",
  Pacific: "#E8938A",
  "Africa & Middle East": "#C0C5CE",
};

export const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
export const fmtM = (n) => (n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));

// Year range [from, to] covered by a timeframe ({from, to} as YYYYMM numbers)
// clamped to the years the dataset covers.
export function timeframeYears(stats, timeframe) {
  if (!stats || !stats.years.length) return null;
  const first = stats.years[0].year, last = stats.years[stats.years.length - 1].year;
  const from = Math.max(first, Math.floor((timeframe?.from || 0) / 100) || first);
  const to = Math.min(last, Math.floor((timeframe?.to || 999912) / 100) || last);
  return from <= to ? [from, to] : [first, last];
}

// Compact plain-text block for the essay prompt: what the numbers did across
// the years under study, and where temples went up.
export function statsBlock(stats, fromYear, toYear) {
  if (!stats) return "";
  const ys = stats.years.filter((y) => y.year >= fromYear && y.year <= toYear);
  if (!ys.length) return "";
  const a = ys[0], b = ys[ys.length - 1];
  const ta = stats.templesByYear.find((t) => t.year === a.year), tb = stats.templesByYear.find((t) => t.year === b.year);
  const line = (label, x, y) => (x == null && y == null ? null : `${label}: ${fmt(x)} (${a.year}) → ${fmt(y)} (${b.year})`);
  const out = [
    `Church statistics for ${a.year}–${b.year} (from the Church's annual statistical reports; year-end figures):`,
    line("Total membership", a.members, b.members),
    line("Full-time missionaries", a.missionaries, b.missionaries),
    line("Stakes", a.stakes, b.stakes),
    line("Missions", a.missions, b.missions),
    line("Operating temples", ta?.total, tb?.total),
  ].filter(Boolean);
  const converts = ys.map((y) => y.converts).filter((n) => n != null);
  if (converts.length) {
    const peak = ys.reduce((best, y) => (y.converts != null && y.converts > (best.converts || 0) ? y : best), {});
    out.push(`Convert baptisms per year: ${fmt(Math.min(...converts))}–${fmt(Math.max(...converts))} (peak ${peak.year})`);
  }
  if (ta && tb) {
    const growth = stats.regions.map((r) => [r, (tb.byRegion[r] || 0) - (ta.byRegion[r] || 0)]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
    if (growth.length) out.push(`Temples added by region: ${growth.map(([r, n]) => `${r} +${n}`).join(", ")}`);
  }
  const ded = stats.templesDedicated.filter((d) => d.year >= a.year && d.year <= b.year);
  if (ded.length) {
    const byYear = new Map();
    for (const d of ded) byYear.set(d.year, [...(byYear.get(d.year) || []), d.name]);
    const lines = [...byYear.entries()].sort((x, y) => x[0] - y[0]).map(([y, names]) => `${y}: ${names.length > 8 ? names.slice(0, 8).join(", ") + ` (+${names.length - 8} more)` : names.join(", ")}`);
    out.push("Temples dedicated: " + lines.join("; "));
  }
  return out.join("\n").slice(0, 4000);
}
