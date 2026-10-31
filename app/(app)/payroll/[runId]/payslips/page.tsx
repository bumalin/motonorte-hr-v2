import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { addDays, formatDay, formatWeek, todayManila } from "@/lib/format.ts";
import { type RunItem } from "@/lib/payroll/describe.ts";
import { PrintButton } from "./print-button.tsx";
import {PrintablePayslip} from "./printable-payslip.tsx";
import "./print.css";

// S-09 Payslips — US-034. Locked runs only; one A4 page per employee; browser "Save as PDF" (ADR-004).
type Line = { employee_id: string; code: string; full_name: string; position: string | null; hire_date: string; base: number; ot: number; incentive: number;
  allowances: number; deductions: number; carried_in: number; gross: number; net: number; carry_out: number };

export default async function PayslipsPage({ params, searchParams }: PageProps<"/payroll/[runId]/payslips">) {
  const user = await requireTab("payroll");
  const { runId } = await params;
  const emp = (await searchParams).emp;
  if (!/^[0-9a-f-]{36}$/.test(runId)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [run] = await tx<{ period_start: string; status: string; locked_at: Date | null }[]>`
      select period_start::text, status, locked_at from payroll_runs where id = ${runId}`;
    if (!run) return null;
    const lines = await tx<Line[]>`
      select l.employee_id, e.code, e.full_name, e.hire_date::text, (select t.position from pay_terms t where t.employee_id = e.id and t.status = 'approved' and t.effective_from <= r.period_start + 6 order by t.effective_from desc limit 1) as position,
        l.base, l.ot, l.incentive, l.allowances, l.deductions, l.carried_in, l.gross, l.net, l.carry_out
      from payroll_lines l join employees e on e.id = l.employee_id join payroll_runs r on r.id = l.run_id
      where l.run_id = ${runId} order by e.code`;
    const items = await tx<RunItem[]>`select employee_id, date::text, kind, amount, rule_id, source from payroll_items where run_id = ${runId} order by date nulls last, id`;
    // Rest days taken (R). Attendance in a locked week is frozen, so this is what the run was computed from.
    const rest = await tx<{ employee_id: string; date: string }[]>`
      select employee_id, date::text from attendance
      where status = 'R' and date between ${run.period_start}::date and ${run.period_start}::date + 6 order by date`;
    return { run, lines, items, rest };
  });
  if (!data) notFound();
  const { run, lines, items, rest } = data;

  if (run.status !== "locked") {
    return (
      <p role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm">
        Payslips are available once the Owner has approved and locked this run. <Link href={`/payroll/${runId}`} className="font-medium underline">Back to the run</Link>
      </p>
    );
  }
  const shown = typeof emp === "string" && emp ? lines.filter((l) => l.employee_id === emp) : lines;
  const payday = addDays(run.period_start, 6);

  return (
    <>
      <div className="print-slip-toolbar no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/payroll/${runId}`} className="text-sm text-brand-700 hover:underline">← Run</Link>
        <h1 className="text-xl font-semibold">Payslips · {formatWeek(run.period_start)}</h1>
        <form className="flex items-center gap-2 text-sm">
          <label htmlFor="emp">Employee</label>
          <select id="emp" name="emp" defaultValue={typeof emp === "string" ? emp : ""} className="rounded-md border border-border px-2 py-1">
            <option value="">All ({lines.length})</option>
            {lines.map((l) => <option key={l.employee_id} value={l.employee_id}>{l.code} · {l.full_name}</option>)}
          </select>
          <button className="rounded-md border border-border px-2 py-1">Show</button>
        </form>
        <PrintButton />
      </div>

      <div className="print-slip-preview">{shown.map(l=><PrintablePayslip key={l.employee_id} line={l} period={run.period_start} payday={payday} locked={run.locked_at?todayManila(run.locked_at):payday} preparedBy={user.fullName} items={items.filter(i=>i.employee_id===l.employee_id)} restDays={rest.filter(r=>r.employee_id===l.employee_id).map(r=>formatDay(r.date))}/>)}</div>    </>
  );
}
