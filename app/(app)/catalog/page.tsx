import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { formatDate, todayManila } from "@/lib/format.ts";
import { EmptyState, Money, StatusChip } from "@/components/ui.tsx";
import { AddJobForm, ChangeAmountForm, EarnerForm, JobActiveButton, BackdateAmountsForm } from "./forms.tsx";

// S-05 Incentive catalog — US-010. Owner edits; staff read-only.
type Job = { id: string; code: string; name: string; active: boolean; amounts: { from: string; amount: number }[];
  specialist_id: string | null; specialist: string | null };

export default async function CatalogPage() {
  const user = await requireTab("catalog");
  const isOwner = user.role === "owner";
  const today = todayManila();
  const { jobs, mechanics } = await withUser(user.id, async (tx) => ({
    jobs: await tx<Job[]>`
      select j.id, j.code, j.name, j.active,
        j.specialist_id, (select code || ' · ' || full_name from employees where id = j.specialist_id) as specialist,
        coalesce(json_agg(json_build_object('from', a.effective_from, 'amount', a.amount) order by a.effective_from desc)
                 filter (where a.id is not null), '[]') as amounts
      from catalog_jobs j left join catalog_amounts a on a.job_id = j.id
      group by j.id order by j.code`,
    mechanics: await tx<{ id: string; code: string; full_name: string }[]>`
      select id, code, full_name from v_employee_current where active and position = 'mechanic' order by code`,
  }));

  const mechanicOptions = mechanics.map((m) => ({ id: m.id, label: `${m.code} · ${m.full_name}` }));
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Incentive jobs</h1>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">
        Each logged job adds its amount to that day&apos;s pool, which is split equally among mechanics present the full day. A job set to one specific mechanic goes to them in full instead.
        {!isOwner && " Only the Owner can change this list."}
      </p>

      {jobs.length === 0 ? (
        <EmptyState title={isOwner ? "Add the jobs that earn incentives, e.g. Throttle Body Cleaning ₱150." : "No jobs defined yet."} />
      ) : (
        <div className="mb-6 overflow-hidden rounded-md border border-border bg-surface">
          {jobs.map((j) => {
            const current = j.amounts.find((a) => a.from <= today);
            const upcoming = j.amounts.filter((a) => a.from > today).at(-1);
            return (
              <details key={j.id} className="border-b border-border last:border-0">
                <summary className="flex cursor-pointer items-center gap-4 px-4 py-3 text-sm hover:bg-surface-2">
                  <span className="w-20 font-mono">{j.code}</span>
                  <span className="flex-1">{j.name}
                    {j.specialist && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">Only {j.specialist}</span>}
                  </span>
                  <span className="w-28 text-right">{current ? <Money value={current.amount} /> : "—"}</span>
                  <span className="w-40 text-xs text-text-muted">
                    {current && `since ${formatDate(current.from)}`}
                    {upcoming && <><br />→ <Money value={upcoming.amount} /> from {formatDate(upcoming.from)}</>}
                  </span>
                  <StatusChip status={j.active ? "active" : "inactive"} />
                </summary>
                <div className="bg-surface-2 px-4 py-3 text-sm">
                  <h3 className="mb-1 font-medium">Amount history</h3>
                  <ul className="space-y-0.5">
                    {j.amounts.map((a) => <li key={a.from}>{formatDate(a.from)}: <Money value={a.amount} /></li>)}
                  </ul>
                  {isOwner && (
                    <>
                      <ChangeAmountForm jobId={j.id} />
                      <EarnerForm jobId={j.id} value={j.specialist_id} mechanics={mechanicOptions} />
                      <JobActiveButton jobId={j.id} active={j.active} />
                    </>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {isOwner && <div className="mt-4 space-y-4"><AddJobForm today={today} mechanics={mechanicOptions} /><BackdateAmountsForm /></div>}
    </>
  );
}
