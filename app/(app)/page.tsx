import Link from "next/link";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { formatMoney, formatWeek, periodStartOf, todayManila } from "@/lib/format.ts";
import { EmptyState, StatusChip } from "@/components/ui.tsx";
import { ApprovalsPanel } from "@/components/approvals-panel.tsx";
import { PayrollChart, type WeekTotals } from "./payroll-chart.tsx";

// S-02 Dashboard — US-050. Figures come from LOCKED runs only; the header chip shows this calendar week's run status.
type Kpi = { net: number; incentive: number; jobs: number; rate: number | null };

function Tile({ label, value, prev, fmt, points = false }: { label: string; value: number | null; prev: number | null; fmt: (n: number) => string; points?: boolean }) {
  // Percentages compare in points; everything else as a relative change
  const delta = value === null || prev === null ? null : points ? value - prev : prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value === null ? "—" : fmt(value)}</p>
      {delta !== null && (
        <p className="mt-1 text-xs text-text-muted">
          <span aria-hidden="true">{delta >= 0 ? "▲" : "▼"} </span><span className="sr-only">{delta >= 0 ? "Up" : "Down"} </span>
          {Math.abs(delta).toFixed(1)}{points ? " pts" : "%"} vs previous week
        </p>
      )}
    </div>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const user = await requireTab("dashboard");
  const sp = await searchParams;
  const thisWeek = periodStartOf(todayManila());
  const data = await withUser(user.id, async (tx) => {
    const thisStatus = (await tx<{ status: string }[]>`select status from payroll_runs where period_start = ${thisWeek}`)[0]?.status ?? "open";
    const weeks = await tx<WeekTotals[]>`
      select r.period_start::text, sum(l.base)::bigint as base, sum(l.ot)::bigint as ot, sum(l.incentive)::bigint as incentive, sum(l.net)::bigint as net
      from payroll_runs r join payroll_lines l on l.run_id = r.id
      where r.status = 'locked' group by r.period_start order by r.period_start desc limit 12`;
    const chosen = typeof sp.week === "string" && weeks.some((w) => w.period_start === sp.week) ? sp.week : weeks[0]?.period_start;
    if (!chosen) return { weeks, chosen: null, thisStatus };
    const prev = weeks[weeks.findIndex((w) => w.period_start === chosen) + 1]?.period_start ?? null;
    const kpi = async (start: string | null): Promise<Kpi | null> => {
      if (!start) return null;
      const [k] = await tx<Kpi[]>`
        select
          (select coalesce(sum(l.net), 0)::bigint from payroll_lines l join payroll_runs r on r.id = l.run_id where r.period_start = ${start}) as net,
          (select coalesce(sum(l.incentive), 0)::bigint from payroll_lines l join payroll_runs r on r.id = l.run_id where r.period_start = ${start}) as incentive,
          (select coalesce(sum(qty), 0)::int from job_log where date between ${start} and ${start}::date + 6) as jobs,
          (select round(100.0 * sum(case status when 'F' then 1 when 'H' then 0.5 else 0 end) / nullif(count(*) filter (where status <> 'R'), 0), 1)::float8
             from attendance where date between ${start} and ${start}::date + 6) as rate`;
      return k;
    };
    const mechanics = await tx<{ code: string; full_name: string; incentive: number; full_days: number }[]>`
      select e.code, e.full_name, l.incentive,
        (select count(*)::int from payroll_items i where i.run_id = r.id and i.employee_id = e.id and i.kind = 'base' and i.source->>'status' = 'F') as full_days
      from payroll_lines l join payroll_runs r on r.id = l.run_id join employees e on e.id = l.employee_id
      where r.period_start = ${chosen} and l.incentive > 0 order by l.incentive desc, e.code`;
    const topJobs = await tx<{ code: string; name: string; qty: number; amount: number }[]>`
      select j.code, j.name, sum(l.qty)::int as qty,
        sum(l.qty * (select a.amount from catalog_amounts a where a.job_id = j.id and a.effective_from <= l.date order by a.effective_from desc limit 1))::bigint as amount
      from job_log l join catalog_jobs j on j.id = l.job_id
      where l.date between ${chosen} and ${chosen}::date + 6 group by j.id order by amount desc limit 5`;
    return { weeks, chosen, thisStatus, cur: await kpi(chosen), prev: await kpi(prev), mechanics, topJobs };
  });

  const peso = (n: number) => formatMoney(Math.round(n / 100) * 100).replace(/\.00$/, ""); // whole pesos, rounded
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <span className="text-sm text-text-muted">This week ({formatWeek(thisWeek)}):</span> <StatusChip status={data.thisStatus} />
        {data.chosen && (
          <form className="flex items-center gap-2 text-sm">
            <label htmlFor="week">Week</label>
            <select id="week" name="week" defaultValue={data.chosen} className="rounded-md border border-border px-2 py-1">
              {data.weeks.map((w) => <option key={w.period_start} value={w.period_start}>{formatWeek(w.period_start)}</option>)}
            </select>
            <button className="rounded-md border border-border px-2 py-1">Show</button>
          </form>
        )}
      </div>
      <ApprovalsPanel user={user} />

      {!data.chosen ? (
        <EmptyState title="No locked payroll yet." action={{ href: `/week/${thisWeek}`, label: "Start with This week →" }} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Net payroll" value={data.cur!.net} prev={data.prev?.net ?? null} fmt={peso} />
            <Tile label="Incentives paid" value={data.cur!.incentive} prev={data.prev?.incentive ?? null} fmt={peso} />
            <Tile label="Incentive jobs logged" value={data.cur!.jobs} prev={data.prev?.jobs ?? null} fmt={(n) => n.toLocaleString("en-PH")} />
            <Tile label="Attendance rate" value={data.cur!.rate} prev={data.prev?.rate ?? null} fmt={(n) => `${n}%`} points />
          </div>

          <PayrollChart weeks={[...data.weeks].reverse()} />

          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-md border border-border bg-surface p-4">
              <h2 className="mb-2 font-medium">Incentives per mechanic</h2>
              {data.mechanics!.length === 0 ? <p className="text-sm text-text-muted">No incentives this week.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-text-muted"><tr><th scope="col" className="py-1 font-medium">Mechanic</th><th scope="col" className="py-1 text-right font-medium">Full days</th><th scope="col" className="py-1 text-right font-medium">Incentive</th><th scope="col" className="py-1 text-right font-medium">Share</th></tr></thead>
                  <tbody>
                    {data.mechanics!.map((m) => (
                      <tr key={m.code} className="border-t border-border">
                        <th scope="row" className="py-1 text-left font-normal"><span className="font-mono">{m.code}</span> · {m.full_name}</th>
                        <td className="tabular py-1 text-right">{m.full_days}</td>
                        <td className="tabular py-1 text-right">{formatMoney(m.incentive)}</td>
                        <td className="tabular py-1 text-right">{data.cur!.incentive ? `${((100 * m.incentive) / data.cur!.incentive).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="rounded-md border border-border bg-surface p-4">
              <h2 className="mb-2 font-medium">Top incentive jobs</h2>
              {data.topJobs!.length === 0 ? <p className="text-sm text-text-muted">No jobs logged this week.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-text-muted"><tr><th scope="col" className="py-1 font-medium">Job</th><th scope="col" className="py-1 text-right font-medium">Qty</th><th scope="col" className="py-1 text-right font-medium">Pool ₱</th></tr></thead>
                  <tbody>
                    {data.topJobs!.map((j) => (
                      <tr key={j.code} className="border-t border-border">
                        <th scope="row" className="py-1 text-left font-normal"><span className="font-mono">{j.code}</span> · {j.name}</th>
                        <td className="tabular py-1 text-right">{j.qty}</td>
                        <td className="tabular py-1 text-right">{formatMoney(j.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
          <p className="text-xs text-text-muted"><Link href="/payroll" className="text-brand-700 hover:underline">All payroll runs →</Link></p>
        </div>
      )}
    </>
  );
}
