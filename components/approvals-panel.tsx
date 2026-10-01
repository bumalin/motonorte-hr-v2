// Owner approvals panel (UX S-02, F-5): payroll runs awaiting approval + proposed rate changes.
// Server component; renders nothing when empty or for staff.
import Link from "next/link";
import type { SessionUser } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { formatDate, formatMoney, formatWeek, positionLabel } from "@/lib/format.ts";
import { Money } from "./ui.tsx";
import { DecideButtons } from "./decide-buttons.tsx";

type Pending = { id: string; employee_id: string; code: string; full_name: string; effective_from: string; position: string; daily_rate: number; daily_allowance: number; proposed_by: string | null };
type Run = { id: string; period_start: string; employees: number; net: number; submitted_by: string | null };

export async function ApprovalsPanel({ user }: { user: SessionUser }) {
  if (user.role !== "owner") return null;
  const { terms, runs } = await withUser(user.id, async (tx) => ({
    runs: await tx<Run[]>`
      select r.id, r.period_start::text, user_name(r.submitted_by) as submitted_by,
        (select count(*)::int from payroll_lines where run_id = r.id) as employees,
        (select coalesce(sum(net), 0)::bigint from payroll_lines where run_id = r.id) as net
      from payroll_runs r where r.status = 'submitted' order by r.period_start`,
    terms: await tx<Pending[]>`
      select t.id, t.employee_id, e.code, e.full_name, t.effective_from::text, t.position, t.daily_rate, t.daily_allowance,
             user_name(t.proposed_by) as proposed_by
      from pay_terms t join employees e on e.id = t.employee_id
      where t.status = 'proposed' order by t.created_at`,
  }));
  const count = runs.length + terms.length;
  if (count === 0) return null;
  return (
    <section aria-labelledby="approvals" className="mb-6 rounded-md border border-warning/40 bg-warning/5 p-4">
      <h2 id="approvals" className="mb-3 font-medium">Waiting for your approval ({count})</h2>
      <ul className="space-y-2 text-sm">
        {runs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Payroll {formatWeek(r.period_start)}</strong>: {r.employees} employees · Net {formatMoney(r.net)}
              {r.submitted_by && <span className="text-text-muted"> · submitted by {r.submitted_by}</span>}
            </span>
            <Link href={`/payroll/${r.id}`} className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:brightness-90">Review</Link>
          </li>
        ))}
        {terms.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Link href={`/employees/${r.employee_id}?tab=terms`} className="font-mono text-brand-700 hover:underline">{r.code}</Link>{" "}
              {r.full_name}: <span>{positionLabel(r.position)}</span> at <Money value={r.daily_rate} />/day + <Money value={r.daily_allowance} /> allowance from {formatDate(r.effective_from)}
              {r.proposed_by && <span className="text-text-muted"> · proposed by {r.proposed_by}</span>}
            </span>
            <DecideButtons id={r.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
