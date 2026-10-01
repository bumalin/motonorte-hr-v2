import type { Position } from "@/lib/payroll/types.ts";
// S-06 Tab 2 — incentive job log with the day's pool summary (US-020). Server component.
import Link from "next/link";
import { withUser } from "@/lib/db/client.ts";
import { dayPool, effective, eligibleMechanics, splitPool } from "@/lib/payroll/engine.ts";
import { formatDay, formatMoney } from "@/lib/format.ts";
import { Money } from "@/components/ui.tsx";
import { ConfirmDialog } from "@/components/confirm-dialog.tsx";
import { AddJobEntryForm } from "./job-form.tsx";
import { removeJobEntry } from "./actions.ts";

type Job = { id: string; code: string; name: string; active: boolean; amounts: { from: string; amount: number }[];
  specialist: string | null };
type Entry = { id: string; date: string; job_id: string; qty: number; work_order_ref: string | null; plate_no: string | null; by: string | null;
  employee_id: string | null; done_by: string | null };
export type PoolEmployee = { id: string; code: string; hireDate: string; endDate: string | null; terms: { from: string; position: Position; dailyRate: number }[] };

export async function JobsTab({ userId, days, day, employees, cells, locked }: {
  userId: string; days: string[]; day: string; employees: PoolEmployee[]; cells: Record<string, { status: string }>; locked: boolean;
}) {
  const { jobs, entries } = await withUser(userId, async (tx) => ({ jobs: await tx<Job[]>`
    select j.id, j.code, j.name, j.active,
      (select code from employees where id = j.specialist_id) as specialist,
      coalesce(json_agg(json_build_object('from', a.effective_from, 'amount', a.amount)) filter (where a.id is not null), '[]') as amounts
    from catalog_jobs j left join catalog_amounts a on a.job_id = j.id group by j.id order by j.code`,
  entries: await tx<Entry[]>`
    select l.id, l.date::text, l.job_id, l.qty, l.work_order_ref, l.plate_no, user_name(l.created_by) as by,
      l.employee_id, (select code from employees where id = l.employee_id) as done_by
    from job_log l where l.date between ${days[0]} and ${days[6]} order by l.created_at` }));
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const amountOn = (jobId: string, d: string) => effective(byId.get(jobId)?.amounts ?? [], d)?.amount ?? 0;

  // Exactly the engine's pool rules (PR-051–053) — shared helpers, so the preview can't drift from payroll
  const catalog = new Map(jobs.map((j) => [j.id, j]));
  const jobEntries = entries.map((e) => ({ date: e.date, jobId: e.job_id, qty: e.qty, employeeId: e.employee_id }));
  const pool = (d: string) => dayPool(jobEntries, catalog, d).pool;
  const eligible = (d: string) => eligibleMechanics(employees, (id) => cells[`${id}|${d}`]?.status, d).map((e) => e.code);

  const p = pool(day), who = eligible(day);
  const shares = who.length ? splitPool(p, who) : [];
  const dayEntries = entries.filter((e) => e.date === day);
  const available = jobs.filter((j) => j.active && effective(j.amounts, day));

  return (
    <div className="space-y-4">
      <nav aria-label="Days" className="flex flex-wrap gap-2">
        {days.map((d) => (
          <Link key={d} href={`?tab=jobs&day=${d}`} aria-current={d === day ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${d === day ? "border-brand-600 bg-brand-50 text-brand-700" : "border-border bg-surface hover:bg-surface-2"}`}>
            {formatDay(d)} · <span className="tabular">{formatMoney(pool(d))}</span>
          </Link>
        ))}
      </nav>

      <div className={`rounded-md border p-4 text-sm ${p > 0 && who.length === 0 ? "border-danger/40 bg-danger/5" : "border-border bg-surface"}`} aria-live="polite">
        {p === 0 ? <span className="text-text-muted">No incentive jobs logged for {formatDay(day)}.</span>
          : who.length === 0 ? (
            <span role="alert" className="text-danger">Pool {formatMoney(p)} — no full-day mechanic on this day. Payroll can&apos;t be generated until attendance is fixed.</span>
          ) : shares.every((s) => s === shares[0]) ? (
            <span>Pool <strong><Money value={p} /></strong> ÷ {who.length} full-day mechanic{who.length > 1 ? "s" : ""} ({who.join(", ")}) = <strong><Money value={shares[0]} /></strong> each</span>
          ) : (
            <span>Pool <strong><Money value={p} /></strong> ÷ {who.length} full-day mechanics: {who.map((c, i) => `${c} ${formatMoney(shares[i])}`).join(", ")} (extra centavo to lowest code)</span>
          )}
      </div>

      {dayEntries.some((e) => e.done_by) && (
        <p className="rounded-md border border-border bg-surface px-4 py-2 text-sm">
          Paid in full to one mechanic (not in the pool): {dayEntries.filter((e) => e.done_by)
            .map((e) => `${e.done_by} ${formatMoney(e.qty * amountOn(e.job_id, day))} (${e.qty}× ${byId.get(e.job_id)?.code})`).join(" · ")}
        </p>
      )}
      <table className="w-full rounded-md border border-border bg-surface text-sm">
        <thead className="bg-surface-2 text-left text-text-muted">
          <tr>{["Job", "Qty", "Amount", "Goes to", "WO ref", "Plate", "Logged by", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {dayEntries.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-text-muted">Nothing logged yet.</td></tr>}
          {dayEntries.map((e) => {
            const j = byId.get(e.job_id);
            return (
              <tr key={e.id} className="border-t border-border">
                <td className="px-3 py-2"><span className="font-mono">{j?.code}</span> · {j?.name}</td>
                <td className="px-3 py-2">{e.qty}</td>
                <td className="px-3 py-2 text-right"><Money value={e.qty * amountOn(e.job_id, day)} /></td>
                <td className="px-3 py-2">{e.done_by ? <span className="font-medium">{e.done_by} only</span> : <span className="text-text-muted">Pool</span>}</td>
                <td className="px-3 py-2">{e.work_order_ref ?? "—"}</td>
                <td className="px-3 py-2">{e.plate_no ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{e.by ?? "—"}</td>
                <td className="px-3 py-2 text-right">{!locked && (
                  <ConfirmDialog trigger="Remove" danger title={`Remove ${e.qty}× ${j?.code}?`} body={`From ${formatDay(day)}'s pool.`} confirmLabel="Remove" action={removeJobEntry}>
                    <input type="hidden" name="id" value={e.id} />
                  </ConfirmDialog>
                )}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!locked && available.length === 0 && jobs.some((j) => j.active) && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/5 px-4 py-2 text-sm">
          No incentive amounts apply on {formatDay(day)} yet (they start later). The Owner can use &ldquo;Use these amounts for earlier
          weeks&rdquo; on the <Link href="/catalog" className="font-medium underline">Incentive jobs</Link> page.
        </p>
      )}
      {!locked && available.length > 0 && <AddJobEntryForm day={day} jobs={available.map((j) => ({ id: j.id,
        label: `${j.code} · ${j.name} (${formatMoney(effective(j.amounts, day)!.amount)})${j.specialist ? ` → ${j.specialist} only` : ""}` }))} />}
    </div>
  );
}
