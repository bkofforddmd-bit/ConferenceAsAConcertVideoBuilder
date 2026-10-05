// Church growth charts for the Insights → Topic study tab: membership,
// full-time missionaries, and operating temples by world region, year by
// year since 1971, aligned under the topic timeline with the same timeframe
// highlighted. Data: public/church-stats.json (see src/lib/church-stats.js).

import React, { useMemo, useState } from "react";
import { REGION_COLORS, fmt, fmtM, timeframeYears } from "../lib/church-stats.js";

const W = 920, L = 52, R = 10, T = 10;

function useScale(stats) {
  return useMemo(() => {
    if (!stats) return null;
    const years = stats.years.map((y) => y.year);
    const min = years[0], max = years[years.length - 1];
    const bw = (W - L - R) / (max - min + 1);
    return { years, min, max, bw, x: (y) => L + (y - min) * bw };
  }, [stats]);
}

// One small chart: a filled line (series) or stacked areas (stack), with a
// timeframe band, hover columns and click-to-pick-year.
function MiniChart({ stats, scale, height, title, unit, series, stack, stackOf, timeframe, onPickYear, tooltip, format = fmt }) {
  const H = height, B = 22, plotH = H - T - B;
  const rows = stats.years;
  const [from, to] = timeframeYears(stats, timeframe) || [scale.min, scale.max];
  // stackOf(year) → { region: value } for stacked charts
  const values = stack
    ? rows.map((y) => { const r = stackOf(y.year) || {}; return Object.values(r).reduce((a, v) => a + (v || 0), 0); })
    : rows.map((y) => series(y));
  const maxV = Math.max(1, ...values.filter((v) => v != null));
  const yOf = (v) => T + plotH - (v / maxV) * plotH;
  const ticks = [0.5, 1].map((f) => maxV * f);

  let shapes = null;
  if (stack) {
    // stacked areas, region by region (bottom = first region)
    const regions = stats.regions;
    const acc = rows.map(() => 0);
    shapes = regions.map((r) => {
      const lower = acc.slice();
      rows.forEach((y, i) => { const row = stackOf(y.year) || {}; acc[i] += row[r] || 0; });
      const top = rows.map((y, i) => `${scale.x(y.year) + scale.bw / 2},${yOf(acc[i])}`);
      const bottom = rows.map((y, i) => `${scale.x(y.year) + scale.bw / 2},${yOf(lower[i])}`).reverse();
      return <polygon key={r} points={[...top, ...bottom].join(" ")} fill={REGION_COLORS[r]} opacity="0.85"><title>{r}</title></polygon>;
    });
  } else {
    const pts = rows.map((y, i) => (values[i] == null ? null : `${scale.x(y.year) + scale.bw / 2},${yOf(values[i])}`)).filter(Boolean);
    const firstIdx = values.findIndex((v) => v != null);
    const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v != null);
    const area = pts.length
      ? `${scale.x(rows[firstIdx].year) + scale.bw / 2},${yOf(0)} ${pts.join(" ")} ${scale.x(rows[lastIdx].year) + scale.bw / 2},${yOf(0)}`
      : "";
    shapes = (
      <>
        {area && <polygon points={area} className="cg-area" />}
        <polyline points={pts.join(" ")} className="cg-line" />
      </>
    );
  }

  return (
    <div className="cg-chart">
      <div className="cg-chart-title">{title}{unit ? <span className="note" style={{ margin: 0 }}> · {unit}</span> : null}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="cg-svg" role="img" aria-label={title}>
        <rect x={scale.x(from)} y={T} width={scale.x(to) + scale.bw - scale.x(from)} height={plotH} className="cg-band" />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={yOf(v)} y2={yOf(v)} className="grid" />
            <text x={L - 6} y={yOf(v) + 4} textAnchor="end" className="axis">{fmtM(Math.round(v))}</text>
          </g>
        ))}
        {shapes}
        {rows.map((y, i) => (
          <g key={y.year} className="cg-col" onClick={() => onPickYear && onPickYear(y.year)}>
            <rect x={scale.x(y.year)} y={T} width={scale.bw} height={plotH} />
            <title>{tooltip(y, values[i])}</title>
          </g>
        ))}
        {scale.years.map((y) => (y % 10 === 0 || y === scale.min || y === scale.max) && (
          <text key={y} x={scale.x(y) + scale.bw / 2} y={H - 6} textAnchor="middle" className="axis">{y}</text>
        ))}
      </svg>
    </div>
  );
}

export default function ChurchGrowth({ stats, timeframe, onPickYear }) {
  const scale = useScale(stats);
  const [open, setOpen] = useState(true);
  if (!stats || !scale) return null;
  const [from, to] = timeframeYears(stats, timeframe);
  const ya = stats.years.find((y) => y.year === from), yb = stats.years.find((y) => y.year === to);
  const ta = stats.templesByYear.find((t) => t.year === from), tb = stats.templesByYear.find((t) => t.year === to);
  const temp = (year) => stats.templesByYear.find((t) => t.year === year);
  const mbr = (year) => (stats.membersByRegion || {})[year] || null;
  const hasMbr = !!stats.membersByRegion;
  const ma = mbr(from), mb = mbr(to);
  const memTotal = Object.values(stats.membersByRegion2025).reduce((a, b) => a + b, 0);
  const future = {};
  for (const f of stats.templesFuture) future[f.region] = (future[f.region] || 0) + 1;
  const dedicatedInRange = stats.templesDedicated.filter((d) => d.year >= from && d.year <= to);
  const delta = (a, b) => (a == null || b == null ? null : b - a);
  const pct = (a, b) => (a && b ? Math.round(((b - a) / a) * 100) : null);
  const span = from === to ? `${from}` : `${from}–${to}`;

  return (
    <div className="church-growth">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div className="topic-timeline-title">Church growth in these years <span className="note" style={{ margin: 0 }}>· {span}</span></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <>
          <div className="cg-stats">
            <Stat label="Members" a={ya?.members} b={yb?.members} from={from} to={to} />
            <Stat label="Full-time missionaries" a={ya?.missionaries} b={yb?.missionaries} from={from} to={to} />
            <Stat label="Operating temples" a={ta?.total} b={tb?.total} from={from} to={to} />
            <Stat label="Stakes" a={ya?.stakes} b={yb?.stakes} from={from} to={to} />
          </div>

          {hasMbr ? (
            <MiniChart stats={stats} scale={scale} height={170} title="Membership by region" unit="stacked; approximate regional split, exact Church total" timeframe={timeframe} onPickYear={onPickYear}
              stack stackOf={(year) => mbr(year)}
              tooltip={(y) => { const r = mbr(y.year); return `${y.year}: ${fmt(y.members)} members` + (r ? ` — ${stats.regions.map((k) => `${k} ${fmtM(r[k] || 0)} (${Math.round(((r[k] || 0) / y.members) * 100)}%)`).join(", ")}` : "") + (y.converts ? ` · ${fmt(y.converts)} converts baptized` : "") + ` — click to study ${y.year}`; }} />
          ) : (
            <MiniChart stats={stats} scale={scale} height={150} title="Membership" unit="total members at year end" timeframe={timeframe} onPickYear={onPickYear}
              series={(y) => y.members} tooltip={(y, v) => `${y.year}: ${fmt(v)} members${y.converts ? ` · ${fmt(y.converts)} converts baptized` : ""} — click to study ${y.year}`} />
          )}
          <MiniChart stats={stats} scale={scale} height={130} title="Full-time missionaries" unit="serving at year end (not published before 1977)" timeframe={timeframe} onPickYear={onPickYear}
            series={(y) => y.missionaries} tooltip={(y, v) => `${y.year}: ${v == null ? "not published" : fmt(v) + " missionaries"} · ${fmt(y.missions)} missions — click to study ${y.year}`} />
          <MiniChart stats={stats} scale={scale} height={170} title="Operating temples by region" unit="stacked; includes temples closed for renovation" timeframe={timeframe} onPickYear={onPickYear} stack stackOf={(year) => temp(year)?.byRegion}
            tooltip={(y, v) => { const t = temp(y.year); return `${y.year}: ${v} temples` + (t ? ` — ${stats.regions.map((r) => `${r} ${t.byRegion[r] || 0}`).join(", ")}` : "") + ` — click to study ${y.year}`; }} />
          <div className="topic-timeline-legend" style={{ marginTop: 4 }}>
            {stats.regions.map((r) => <span key={r}><i className="sw" style={{ background: REGION_COLORS[r] }} /> {r}</span>)}
          </div>

          <div className="cg-where">
            <div className="cg-where-title">Where the growth is</div>
            <table className="cg-table">
              <thead>
                <tr><th>Region</th><th>Temples {from}</th><th>Temples {to}</th><th>Added</th><th>Announced / building</th>{hasMbr && from !== to && <th>Members {from}</th>}<th>Members {hasMbr ? to : "(2025)"}</th>{hasMbr && from !== to && <th>Growth</th>}</tr>
              </thead>
              <tbody>
                {stats.regions
                  .map((r) => ({ r, a: ta?.byRegion[r] || 0, b: tb?.byRegion[r] || 0, f: future[r] || 0, m: hasMbr ? (mb?.[r] || 0) : (stats.membersByRegion2025[r] || 0), m0: hasMbr ? (ma?.[r] || 0) : null }))
                  .sort((x, y) => (hasMbr && from !== to ? (y.m - y.m0) - (x.m - x.m0) : (y.b - y.a) - (x.b - x.a)) || y.m - x.m)
                  .map(({ r, a, b, f, m, m0 }) => (
                    <tr key={r}>
                      <td><i className="sw" style={{ background: REGION_COLORS[r] }} /> {r}</td>
                      <td>{a}</td><td>{b}</td>
                      <td className={b - a > 0 ? "pos" : ""}>{b - a > 0 ? `+${b - a}` : "—"}</td>
                      <td>{f || "—"}</td>
                      {hasMbr && from !== to && <td>{fmt(m0)} <span className="note" style={{ margin: 0 }}>({Math.round((m0 / (ya?.members || 1)) * 100)}%)</span></td>}
                      <td>{fmt(m)} <span className="note" style={{ margin: 0 }}>({Math.round((m / (hasMbr ? (yb?.members || 1) : memTotal)) * 100)}%)</span></td>
                      {hasMbr && from !== to && <td className={m - m0 > 0 ? "pos" : ""}>{m0 ? `+${fmt(m - m0)} (${m - m0 >= 0 ? "+" : ""}${Math.round(((m - m0) / m0) * 100)}%)` : "—"}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
            {dedicatedInRange.length > 0 && (
              <details className="cg-details">
                <summary>{dedicatedInRange.length} temple{dedicatedInRange.length === 1 ? "" : "s"} dedicated {from === to ? `in ${from}` : `${from}–${to}`}</summary>
                <div className="cg-dedicated">
                  {dedicatedInRange.map((d) => <span key={d.name + d.year}><b>{d.year}</b> {d.name} <i style={{ color: REGION_COLORS[d.region] }}>●</i></span>)}
                </div>
              </details>
            )}
            <p className="note" style={{ marginTop: 6 }}>
              {hasMbr
                ? "Regional membership is approximate: the Church's reports give only a world total, so the split comes from Church Almanac country figures at roughly ten-year points, interpolated between them, with North America as the remainder. Temple counts and the Church totals are exact."
                : "Membership by region is a 2025 snapshot — the Church's reports don't publish historical membership by region."}
              {" "}Sources: the Church's annual statistical reports 1971–2025, temple dedication records, and Deseret News Church Almanac country figures. Click any year to study it.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, a, b, from, to }) {
  const d = a == null || b == null ? null : b - a;
  const p = a && b ? Math.round(((b - a) / a) * 100) : null;
  return (
    <div className="cg-stat">
      <div className="cg-stat-label">{label}</div>
      <div className="cg-stat-value">{fmt(b)}</div>
      <div className="cg-stat-delta">
        {from === to ? `in ${to}` : d == null ? `${fmt(a)} → ${fmt(b)}` : `${d >= 0 ? "+" : ""}${fmt(d)} since ${from}${p != null ? ` (${p >= 0 ? "+" : ""}${p}%)` : ""}`}
      </div>
    </div>
  );
}
