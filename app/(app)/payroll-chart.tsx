// 12-week stacked column chart of locked payroll: base / OT / incentives (US-050). Server-rendered SVG, no chart library.
// Hover: week-total rect sits BEHIND the segments so each segment's own <title> wins; table view is the full-data fallback.
// Palette: dataviz reference slots 1–3, light steps validated on #ffffff, dark steps on #141414 (theme vars in globals.css; aqua light WARN → table view below).
import { formatMoney, formatWeek } from "@/lib/format.ts";

export type WeekTotals = { period_start: string; base: number; ot: number; incentive: number; net: number };
const SERIES = [
  { key: "base", label: "Base pay", color: "var(--series-1)" },
  { key: "ot", label: "Overtime", color: "var(--series-2)" },
  { key: "incentive", label: "Incentives", color: "var(--series-3)" },
] as const;

const W = 720, H = 220, PAD = { l: 64, r: 8, t: 8, b: 28 }, BAR = 24, GAP = 2;

/** Clean tick step (1, 2, 5 × 10^n) for ~4 gridlines. */
function niceStep(max: number) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
}

export function PayrollChart({ weeks }: { weeks: WeekTotals[] }) {
  const total = (w: WeekTotals) => w.base + w.ot + w.incentive;
  const step = niceStep(Math.max(...weeks.map(total), 1));
  const max = step * Math.ceil(Math.max(...weeks.map(total), 1) / step);
  const plotH = H - PAD.t - PAD.b, band = (W - PAD.l - PAD.r) / Math.max(weeks.length, 1);
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);

  return (
    <figure className="rounded-md border border-border bg-surface p-4">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Base, overtime &amp; incentives, last {weeks.length} locked week{weeks.length === 1 ? "" : "s"}</span>
        <span className="flex gap-4 text-xs text-text-muted" aria-hidden="true">
          {SERIES.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Stacked columns of base pay, overtime and incentives for ${weeks.length} weeks. Table below.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
            <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-muted)" className="tabular">
              {t >= 100000 ? `₱${(t / 100000).toLocaleString("en-PH")}K` : formatMoney(t).replace(".00", "")}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = PAD.l + i * band + (band - BAR) / 2;
          let acc = 0;
          const segs = SERIES.filter((s) => w[s.key] > 0);
          return (
            <g key={w.period_start}>
              <rect x={PAD.l + i * band} y={PAD.t} width={band} height={plotH} fill="transparent">
                <title>{`${formatWeek(w.period_start)}\nBase ${formatMoney(w.base)} · OT ${formatMoney(w.ot)} · Incentives ${formatMoney(w.incentive)}\nNet ${formatMoney(w.net)}`}</title>
              </rect>
              {segs.map((s, j) => {
                const v = w[s.key], top = y(acc + v), bottom = y(acc) - (j > 0 ? GAP : 0);
                acc += v;
                const h = Math.max(bottom - top, 1), last = j === segs.length - 1, r = last ? Math.min(4, h) : 0;
                // 4px rounded data-end on the top segment only; square at the baseline
                const d = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + BAR - r} Q${x + BAR},${top} ${x + BAR},${top + r} V${top + h} Z`;
                return (
                  <path key={s.key} d={d} fill={s.color}>
                    <title>{`${formatWeek(w.period_start)} · ${s.label}: ${formatMoney(v)}`}</title>
                  </path>
                );
              })}
              <text x={x + BAR / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{formatWeek(w.period_start).replace(/,.*$/, "").split(" – ")[0]}</text>
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-text-muted">Show as table</summary>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-text-muted"><tr>{["Week", ...SERIES.map((s) => s.label), "Net"].map((h) => <th key={h} scope="col" className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.period_start} className="border-t border-border">
                <th scope="row" className="px-2 py-1 text-left font-normal">{formatWeek(w.period_start)}</th>
                {SERIES.map((s) => <td key={s.key} className="tabular px-2 py-1 text-right">{formatMoney(w[s.key])}</td>)}
                <td className="tabular px-2 py-1 text-right">{formatMoney(w.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
