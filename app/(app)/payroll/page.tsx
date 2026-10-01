import Link from "next/link";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { formatDate, formatWeek } from "@/lib/format.ts";
import { EmptyState, Money, StatusChip } from "@/components/ui.tsx";
import { WeekPicker } from "@/components/week-picker.tsx";
import { hasTab } from "@/lib/auth/tabs.ts";

// S-07 Payroll runs — newest first
type Run = { id: string; period_start: string; payday: string; status: string; employees: number; net: number;
  submitted_by: string | null; submitted_at: Date | null; locked_by: string | null; locked_at: Date | null };

export default async function PayrollPage() {
  const user = await requireTab("payroll");
  const runs = await withUser(user.id, (tx) => tx<Run[]>`
    select r.id, r.period_start::text, r.payday::text, r.status,
      (select count(*)::int from payroll_lines where run_id = r.id) as employees,
      (select coalesce(sum(net), 0)::bigint from payroll_lines where run_id = r.id) as net,
      user_name(r.submitted_by) as submitted_by, r.submitted_at,
      user_name(r.locked_by) as locked_by, r.locked_at
    from payroll_runs r order by r.period_start desc`);
  const when = (d: Date | null, who: string | null) => d ? `${who ?? "—"}, ${d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}` : "—";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        {/* Past weeks too: open the week, enter attendance, then generate its payroll */}
        {hasTab(user, "week") && <WeekPicker />}
      </div>
      {runs.length === 0 ? <EmptyState title="No payroll runs yet. Go to This week to generate one." /> : (
        <table className="w-full rounded-md border border-border bg-surface text-sm">
          <thead className="bg-surface-2 text-left text-text-muted">
            <tr>{["Week", "Payday", "Status", "Employees", "Net total", "Submitted", "Locked"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2"><Link href={`/payroll/${r.id}`} className="text-brand-700 hover:underline">{formatWeek(r.period_start)}</Link></td>
                <td className="px-3 py-2">{formatDate(r.payday)}</td>
                <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                <td className="px-3 py-2">{r.employees}</td>
                <td className="px-3 py-2 text-right"><Money value={r.net} /></td>
                <td className="px-3 py-2 text-xs">{when(r.submitted_at, r.submitted_by)}</td>
                <td className="px-3 py-2 text-xs">{when(r.locked_at, r.locked_by)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
