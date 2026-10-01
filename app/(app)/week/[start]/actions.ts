"use server";
// Week workspace — attendance (US-021, US-023, PR-022). Locked weeks and employment dates are enforced by DB triggers; R is allowed on any day (PR-022).
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireTab } from "@/lib/auth/session.ts";
import { hasTab } from "@/lib/auth/tabs.ts";
import { moveHireEarlier } from "@/lib/db/hireDate.ts";
import { withUser } from "@/lib/db/client.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";
import { parsePesos, periodStartOf } from "@/lib/format.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Cell = z.object({
  employeeId: z.guid(),
  date: isoDate,
  status: z.enum(["", "F", "H", "A", "R"]),
  otHours: z.string().trim(),
});

/** Quarter-hour OT in hours ("1.5") → whole minutes, exact. null = invalid. */
function otMinutes(hours: string): number | null {
  if (hours === "") return 0;
  const hundredths = parsePesos(hours); // "1.25" → 125
  if (hundredths === null || hundredths % 25 !== 0 || hundredths > 1600) return null;
  return (hundredths * 60) / 100;
}

/** Saves one grid cell. Empty status clears the entry. Returns an error message or nothing. */
export async function saveCell(input: { employeeId: string; date: string; status: string; otHours: string }): Promise<string | void> {
  const user = await requireTab("week");
  const c = Cell.safeParse(input);
  if (!c.success) return "Invalid entry.";
  const ot = otMinutes(c.data.otHours);
  if (ot === null) return "OT must be in quarter hours, e.g. 1.5";
  if (ot > 0 && c.data.status !== "F") return "OT is only allowed on full days.";
  try {
    await withUser(user.id, async (tx) => {
      if (c.data.status === "") {
        await tx`delete from attendance where employee_id = ${c.data.employeeId} and date = ${c.data.date}`;
      } else {
        await tx`insert into attendance (employee_id, date, status, ot_minutes)
          values (${c.data.employeeId}, ${c.data.date}, ${c.data.status}, ${ot})
          on conflict (employee_id, date) do update set status = excluded.status, ot_minutes = excluded.ot_minutes`;
      }
    });
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath(`/week/${periodStartOf(c.data.date)}`);
}

/** Explicit bulk fill (UX S-06): only EMPTY cells of employed days — F on work days, R on the rest day. */
export async function fillEmptyCells(start: string): Promise<string | void> {
  const user = await requireTab("week");
  const s = isoDate.safeParse(start);
  if (!s.success) return "Invalid week.";
  try {
    await withUser(user.id, (tx) => tx`
      insert into attendance (employee_id, date, status)
      select e.id, d::date, case when weekday_of(d::date) = e.rest_day then 'R' else 'F' end::day_status_t
      from employees e, generate_series(${s.data}::date, ${s.data}::date + 6, interval '1 day') d
      where d::date >= e.hire_date and (e.end_date is null or d::date <= e.end_date)
      on conflict (employee_id, date) do nothing`);
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath(`/week/${s.data}`);
}


const JobEntry = z.object({
  date: isoDate,
  job_id: z.guid(),
  qty: z.coerce.number().int().min(1, "Qty must be 1–100").max(100, "Qty must be 1–100"),
  work_order_ref: z.string().trim().max(40),
  plate_no: z.string().trim().max(20),
});

export type JobState = { error?: string } | undefined;

/** Logs an incentive job for a day (US-020, PR-051). Active job + amount on that date are checked by triggers. */
export async function addJobEntry(_: JobState, form: FormData): Promise<JobState> {
  const user = await requireTab("week");
  const j = JobEntry.safeParse(Object.fromEntries(form));
  if (!j.success) return { error: j.error.issues[0].message };
  try {
    await withUser(user.id, (tx) => tx`insert into job_log ${tx({ ...j.data, work_order_ref: j.data.work_order_ref || null, plate_no: j.data.plate_no || null })}`);
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath(`/week/${periodStartOf(j.data.date)}`);
  return {};
}

export async function removeJobEntry(form: FormData): Promise<string | void> {
  const user = await requireTab("week");
  const id = z.guid().safeParse(form.get("id"));
  if (!id.success) return "Invalid entry.";
  try {
    const rows = await withUser(user.id, (tx) => tx<{ date: string }[]>`delete from job_log where id = ${id.data} returning date::text`);
    if (rows.length === 0) return "Entry not found.";
    revalidatePath(`/week/${periodStartOf(rows[0].date)}`);
  } catch (e) {
    return dbErrorMessage(e);
  }
}

const Adjustment = z.object({
  period_start: isoDate,
  employee_id: z.guid("Choose an employee"),
  type: z.enum(["cash_advance", "clawback", "correction", "other", "back_pay"]),
  amount: z.string().transform((v, ctx) => {
    const c = parsePesos(v);
    if (c === null || c <= 0) { ctx.addIssue({ code: "custom", message: "Enter an amount like 150 or 150.00" }); return z.NEVER; }
    if (c > 100000000) { ctx.addIssue({ code: "custom", message: "Amount can't exceed ₱1,000,000" }); return z.NEVER; }
    return c;
  }),
  reason: z.string().trim().min(1, "A reason is required").max(200),
  work_order_ref: z.string().trim().max(40),
});

/** Deduction (cash advance, clawback, correction, other) or, Owner only, back pay (an addition) for a pay week
 *  (US-033, PR-060, PR-063). Locked weeks and non-owner additions are rejected by triggers (013). */
export async function addAdjustment(_: JobState, form: FormData): Promise<JobState> {
  const user = await requireTab("week");
  const a = Adjustment.safeParse(Object.fromEntries(form));
  if (!a.success) return { error: a.error.issues[0].message };
  if (periodStartOf(a.data.period_start) !== a.data.period_start) return { error: "Invalid week." };
  const kind = a.data.type === "back_pay" ? "allowance" : "deduction";
  if (kind === "allowance" && user.role !== "owner") return { error: "Only the Owner can add back pay." };
  try {
    await withUser(user.id, (tx) => tx`insert into adjustments ${tx({ ...a.data, kind, work_order_ref: a.data.work_order_ref || null })}`);
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath(`/week/${a.data.period_start}`);
  return {};
}

export async function removeAdjustment(form: FormData): Promise<string | void> {
  const user = await requireTab("week");
  const id = z.guid().safeParse(form.get("id"));
  if (!id.success) return "Invalid entry.";
  try {
    const rows = await withUser(user.id, (tx) => tx<{ p: string }[]>`delete from adjustments where id = ${id.data} returning period_start::text as p`);
    if (rows.length === 0) return "Entry not found.";
    revalidatePath(`/week/${rows[0].p}`);
  } catch (e) {
    return dbErrorMessage(e);
  }
}

/** Past-week entry (PR-072): bring every active employee hired after this week into it by moving their hire date back
 *  to the week's Monday; their starting rate is copied to that date (Owner: approved; staff: proposed for the Owner). */
export async function includeCurrentEmployees(form: FormData): Promise<string | void> {
  const user = await requireTab("week");
  if (!hasTab(user, "employees")) return "You need the Employees tab to change hire dates.";
  const s = isoDate.safeParse(form.get("start"));
  if (!s.success || periodStartOf(s.data) !== s.data) return "Invalid week.";
  let proposed = 0;
  try {
    await withUser(user.id, async (tx) => {
      const later = await tx<{ id: string }[]>`
        select id from employees where active and end_date is null and hire_date > ${s.data}::date + 6 order by code`;
      for (const e of later) if (await moveHireEarlier(tx, e.id, s.data, user.role === "owner")) proposed++;
    });
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath(`/week/${s.data}`);
  revalidatePath("/employees");
  revalidatePath("/");
  if (proposed) return `Added. ${proposed} starting rate(s) were sent to the Owner for approval; payroll can be generated once they're approved.`;
}
