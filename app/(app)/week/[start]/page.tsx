import type { Position } from "@/lib/payroll/types.ts";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { addDays, formatDate, formatDay, formatWeek, periodStartOf } from "@/lib/format.ts";
import { effective, eligibleMechanics } from "@/lib/payroll/engine.ts";
import { StatusChip } from "@/components/ui.tsx";
import { hasTab } from "@/lib/auth/tabs.ts";
import { WeekPicker } from "@/components/week-picker.tsx";
import { ConfirmDialog } from "@/components/confirm-dialog.tsx";
import { includeCurrentEmployees } from "./actions.ts";
import { AttendanceGrid, type GridEmployee } from "./attendance-grid.tsx";
import { JobsTab } from "./jobs-tab.tsx";
import { AdjustmentsTab } from "./adjustments-tab.tsx";
import { GenerateButton } from "./generate-button.tsx";
import { todayManila } from "@/lib/format.ts";

// S-06 Week workspace — US-020, 021, 023, 033
type Emp = { id: string; code: string; full_name: string; rest_day: string; hire_date: string; end_date: string | null;
  terms: { from: string; position: Position; dailyRate: number }[] };

export default async function WeekPage({ params, searchParams }: PageProps<"/week/[start]">) {
  const user = await requireTab("week");
  const { start } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) notFound();
  if (periodStartOf(start) !== start) redirect(`/week/${periodStartOf(start)}`);
  const sp = await searchParams;
  const tab = (sp.tab as string) ?? "attendance";
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const data = await withUser(user.id, async (tx) => ({
    run: (await tx<{ id: string; status: string }[]>`select id, status from payroll_runs where period_start = ${start}`)[0],
    // Everyone employed on any day of the week, by hire/end dates (not the active flag)
    employees: await tx<Emp[]>`
      select e.id, e.code, e.full_name, e.rest_day, e.hire_date::text, e.end_date::text,
        coalesce((select json_agg(json_build_object('from', t.effective_from, 'position', t.position, 'dailyRate', t.daily_rate))
                  from pay_terms t where t.employee_id = e.id and t.status = 'approved'), '[]') as terms
      from employees e
      where e.hire_date <= ${end} and (e.end_date is null or e.end_date >= ${start})
      order by e.code`,
    attendance: await tx<{ employee_id: string; date: string; status: string; ot_minutes: number }[]>`
      select employee_id, date::text, status, ot_minutes from attendance where date between ${start} and ${end}`,
    holidays: await tx<{ date: string; name: string }[]>`select date::text, name from holidays where date between ${start} and ${end}`,
    // Current employees hired after this week — offered for past-week entry (PR-072)
    laterHires: await tx<{ code: string }[]>`
      select code from employees where active and end_date is null and hire_date > ${end} order by code`,
  }));

  const status = data.run?.status ?? "open";
  const locked = status === "locked" || status === "submitted"; // frozen for edits either way (DB trigger, 004)
  const cells = Object.fromEntries(data.attendance.map((a) =>
    [`${a.employee_id}|${a.date}`, { status: a.status, otHours: a.ot_minutes ? String(a.ot_minutes / 60) : "" }]));
  const employees: GridEmployee[] = data.employees.map((e) => ({
    id: e.id, code: e.code, name: e.full_name, restDay: e.rest_day,
    position: effective(e.terms, end)?.position ?? effective(e.terms, start)?.position ?? "staff",
    employed: days.map((d) => d >= e.hire_date && (!e.end_date || d <= e.end_date)),
  }));
  // Pool eligibility preview: mechanic by position ON THAT DAY, full-day status (PR-052)
  const poolPeople = data.employees.map((e) => ({ id: e.id, code: e.code, hireDate: e.hire_date, endDate: e.end_date, terms: e.terms }));
  const mechanicsFullDay = days.map((d) => eligibleMechanics(poolPeople, (id) => cells[`${id}|${d}`]?.status, d).length);

  const tabs = [["attendance", "Attendance"], ["jobs", "Incentive jobs"], ["adjustments", "Adjustments"]];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/week/${addDays(start, -7)}`} className="rounded-md border border-border bg-surface px-2 py-1 text-sm" aria-label="Previous week">‹</Link>
        <h1 className="text-xl font-semibold">{formatWeek(start)}</h1>
        <Link href={`/week/${addDays(start, 7)}`} className="rounded-md border border-border bg-surface px-2 py-1 text-sm" aria-label="Next week">›</Link>
        <span className="text-sm text-text-muted">Payday {formatDate(end)}</span>
        <StatusChip status={status} />
        <span className="ml-auto"><WeekPicker value={start} /></span>
        {data.run && hasTab(user, "payroll") && <Link href={`/payroll/${data.run.id}`} className="text-sm font-medium text-brand-700 hover:underline">View payroll {status === "draft" ? "draft" : "run"} →</Link>}
      </div>
      {!locked && data.laterHires.length > 0 && hasTab(user, "employees") && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-info/40 bg-info/5 px-4 py-2 text-sm">
          <span>{data.laterHires.length} current employee{data.laterHires.length === 1 ? " was" : "s were"} hired after this week
            ({data.laterHires.map((e) => e.code).join(", ")}), so they aren&apos;t listed.</span>
          <ConfirmDialog trigger="Include current employees" title="Add them to this week?" confirmLabel="Include them"
            action={includeCurrentEmployees}
            body={<>Their hire date moves back to {formatDate(start)}, and their current starting rate and allowance are copied to that
              date. If someone&apos;s rate was different back then, add a rate change on their Terms tab afterwards.</>}>
            <input type="hidden" name="start" value={start} />
          </ConfirmDialog>
        </div>
      )}
      {!locked && hasTab(user, "payroll") && (
        <div className="mb-4">
          <GenerateButton start={start} />
        </div>
      )}
      {locked && (
        <p role="status" className="mb-4 rounded-md border border-success/30 bg-success/5 px-4 py-2 text-sm">
          {status === "locked" ? "This week is locked. An administrator can reopen the latest locked payroll run with a reason to correct attendance."
            : "Submitted for approval — this week is read-only. The Owner can send it back if changes are needed."}
        </p>
      )}
      <nav aria-label="Week sections" className="mb-4 flex gap-1 border-b border-border">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-text-muted hover:text-text"}`}>{label}</Link>
        ))}
      </nav>
      {tab === "attendance" && user.role !== "owner" && <p role="status" className="mb-4 text-sm text-text-muted">Attendance is view-only. An administrator can correct entries.</p>}
      {tab === "attendance" && (
        <AttendanceGrid start={start} days={days} dayLabels={days.map(formatDay)} locked={locked || user.role !== "owner"}
          holidays={Object.fromEntries(data.holidays.map((h) => [h.date, h.name]))}
          employees={employees} cells={cells} mechanicsFullDay={mechanicsFullDay} focus={typeof sp.focus === "string" ? sp.focus : undefined} />
      )}
      {tab === "jobs" && (
        <JobsTab userId={user.id} days={days} locked={locked} cells={cells}
          day={days.includes(sp.day as string) ? (sp.day as string) : days.includes(todayManila()) ? todayManila() : start}
          employees={poolPeople} />
      )}
      {tab === "adjustments" && (
        <AdjustmentsTab userId={user.id} isOwner={user.role === "owner"} start={start} locked={locked}
          employees={data.employees.map((e) => ({ id: e.id, code: e.code, name: e.full_name }))} />
      )}
    </>
  );
}
