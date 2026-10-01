// Builds the pay engine's PeriodInput for one week from the DB (TASK-014). Every list is ordered, so the
// input — and its hash — is deterministic. Money (bigint) arrives as exact JS numbers via PG_TYPES in client.ts.
import type { Tx } from "./client.ts";
import { effective } from "../payroll/engine.ts";
import type { PeriodInput, Settings, DayStatus, Position, Weekday } from "../payroll/types.ts";

const KEYS = {
  rest_day_worked_multiplier: "restDayWorked",
  holiday_worked_multiplier: "holidayWorked",
  holiday_unworked_multiplier: "holidayUnworked",
  ot_multiplier: "ot",
} as const;

/** Per-key effective-dated settings rows → one complete bundle per distinct effective date (review TASK-001..004 #10). */
export function mergeSettings(rows: { key: string; from: string; value: number }[]): Settings[] {
  const dates = [...new Set(rows.map((r) => r.from))].sort();
  const out: Settings[] = [];
  for (const from of dates) {
    const b: Partial<Settings> = { from };
    let complete = true;
    for (const [key, field] of Object.entries(KEYS)) {
      const hit = effective(rows.filter((r) => r.key === key), from);
      if (!hit) complete = false; else b[field] = hit.value;
    }
    if (complete) out.push(b as Settings);
  }
  return out;
}

export async function loadPeriodInput(tx: Tx, periodStart: string): Promise<PeriodInput> {
  const end = await tx<{ d: string }[]>`select (${periodStart}::date + 6)::text as d`.then((r) => r[0].d);

  const settingsRows = await tx<{ key: string; from: string; value: number }[]>`
    select key, effective_from::text as from, value_hundredths as value from settings order by key, effective_from`;
  const holidays = await tx<{ date: string }[]>`select date::text from holidays where date between ${periodStart} and ${end} order by date`;
  const carried = await tx<{ employee_id: string; carried_in: number }[]>`
    select employee_id, carried_in from carried_in_for(${periodStart}) order by employee_id`;
  const adjustments = await tx<{ employee_id: string; kind: "allowance" | "deduction"; type: string; amount: number; reason: string }[]>`
    select employee_id, kind, type, amount, reason from adjustments where period_start = ${periodStart} order by created_at, id`;

  // Employed on any day of the week, owed/owing money, or with attendance entered (so NOT_EMPLOYED can fire)
  const attendanceIds = await tx<{ employee_id: string }[]>`
    select distinct employee_id from attendance where date between ${periodStart} and ${end}`;
  const ids = [...new Set([...carried.map((c) => c.employee_id), ...adjustments.map((a) => a.employee_id), ...attendanceIds.map((a) => a.employee_id)])];
  const employees = await tx<{ id: string; code: string; rest_day: Weekday; hire_date: string; end_date: string | null;
    terms: { from: string; position: Position; dailyRate: number; dailyAllowance: number }[] }[]>`
    select e.id, e.code, e.rest_day, e.hire_date::text, e.end_date::text,
      coalesce((select json_agg(json_build_object('from', t.effective_from, 'position', t.position, 'dailyRate', t.daily_rate, 'dailyAllowance', t.daily_allowance)
                                order by t.effective_from)
                from pay_terms t where t.employee_id = e.id and t.status = 'approved'), '[]') as terms
    from employees e
    where (e.hire_date <= ${end} and (e.end_date is null or e.end_date >= ${periodStart})) or e.id = any(${ids}::uuid[])
    order by e.code`;

  const catalog = await tx<{ id: string; code: string; name: string; amounts: { from: string; amount: number }[] }[]>`
    select j.id, j.code, j.name,
      coalesce((select json_agg(json_build_object('from', a.effective_from, 'amount', a.amount) order by a.effective_from)
                from catalog_amounts a where a.job_id = j.id), '[]') as amounts
    from catalog_jobs j order by j.code`;
  const attendance = await tx<{ employeeId: string; date: string; status: DayStatus; otMinutes: number }[]>`
    select employee_id as "employeeId", date::text, status, ot_minutes as "otMinutes"
    from attendance where date between ${periodStart} and ${end} order by employee_id, date`;
  const jobRows = await tx<{ date: string; jobId: string; qty: number; employeeId: string | null }[]>`
    select date::text, job_id as "jobId", qty, employee_id as "employeeId"
    from job_log where date between ${periodStart} and ${end} order by date, created_at, id`;
  // Pool entries keep their old shape (no employeeId key), so existing drafts' input hashes don't change
  const jobs = jobRows.map(({ employeeId, ...j }) => (employeeId ? { ...j, employeeId } : j));

  return {
    periodStart,
    settings: mergeSettings(settingsRows),
    holidays: holidays.map((h) => h.date),
    employees: employees.map((e) => ({ id: e.id, code: e.code, restDay: e.rest_day, hireDate: e.hire_date, endDate: e.end_date, terms: e.terms })),
    catalog,
    attendance: [...attendance],
    jobs: [...jobs],
    adjustments: [...adjustments].map((a) => ({ employeeId: a.employee_id, kind: a.kind, type: a.type, amount: a.amount, reason: a.reason })),
    carriedIn: Object.fromEntries(carried.map((c) => [c.employee_id, c.carried_in])),
  };
}
