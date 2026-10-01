"use server";
// Employees — US-001, US-003 (UX S-03/S-04). Every action checks the session; RLS enforces roles again.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { requireTab } from "@/lib/auth/session.ts";
import { moveHireEarlier } from "@/lib/db/hireDate.ts";
import { withUser } from "@/lib/db/client.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";
import { parsePesos, POSITION_KEYS } from "@/lib/format.ts";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; fields?: Record<string, string>; ok?: boolean; note?: string } | undefined;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const govId = z.string().trim().max(30).regex(/^[0-9A-Za-z-]*$/, "Digits, letters and dashes only");

const Profile = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}[0-9]{3,4}$/, "Code like M004 (1–3 letters + 3–4 digits)"),
  full_name: z.string().trim().min(1, "Required").max(120),
  rest_day: weekday,
  hire_date: isoDate,
});

const Private = z.object({
  tin: govId, sss_no: govId, philhealth_no: govId, pagibig_no: govId,
  bank_name: z.string().trim().max(60),
  bank_account_no: govId,
});

const Terms = z.object({
  position: z.enum(POSITION_KEYS),
  daily_rate: z.string().transform((v, ctx) => {
    const c = parsePesos(v);
    if (c === null || c <= 0) { ctx.addIssue({ code: "custom", message: "Enter a daily rate like 650 or 650.00" }); return z.NEVER; }
    if (c > 10000000) { ctx.addIssue({ code: "custom", message: "Daily rate can't exceed ₱100,000" }); return z.NEVER; }
    return c;
  }),
  daily_allowance: z.string().optional().transform((v, ctx) => {
    if (!v || v.trim() === "") return 0;
    const c = parsePesos(v);
    if (c === null) { ctx.addIssue({ code: "custom", message: "Enter an allowance like 100 or 100.00 (or leave blank)" }); return z.NEVER; }
    if (c > 1000000) { ctx.addIssue({ code: "custom", message: "Daily allowance can't exceed ₱10,000" }); return z.NEVER; }
    return c;
  }),
});

const Id = z.guid();
const DUP_CODE = { code: "That employee code is already used." };

/** First message per field, for errors shown under each input (US-001, UX S-04). */
function fieldErrors(...results: z.ZodSafeParseResult<unknown>[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of results) if (!r.success) for (const i of r.error.issues) out[String(i.path[0])] ??= i.message;
  return Object.keys(out).length ? out : undefined;
}
const isDupCode = (e: unknown) => (e as { code?: string; constraint_name?: string })?.code === "23505"
  && !(e as { constraint_name?: string }).constraint_name?.startsWith("pay_terms");

export async function createEmployee(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireTab("employees");
  const data = Object.fromEntries(form) as Record<string, string>;
  const p = Profile.safeParse(data), v = Private.safeParse(data), t = Terms.safeParse(data);
  const errs = fieldErrors(p, v, t);
  if (errs || !p.success || !v.success || !t.success) return { fieldErrors: errs, fields: data };

  let id: string;
  try {
    id = await withUser(user.id, async (tx) => {
      const [e] = await tx<{ id: string }[]>`insert into employees ${tx(p.data)} returning id`;
      await tx`insert into employee_private ${tx({ employee_id: e.id, ...v.data, bank_name: v.data.bank_name || "RCBC" })}`;
      // Owner's rate is active immediately; staff's goes to the Owner for approval (US-002)
      await tx`insert into pay_terms (employee_id, effective_from, position, daily_rate, daily_allowance, status)
        values (${e.id}, ${p.data.hire_date}, ${t.data.position}, ${t.data.daily_rate}, ${t.data.daily_allowance}, ${user.role === "owner" ? "approved" : "proposed"})`;
      return e.id;
    });
  } catch (e) {
    return isDupCode(e) ? { fieldErrors: DUP_CODE, fields: data } : { error: dbErrorMessage(e), fields: data };
  }
  revalidatePath("/employees");
  redirect(`/employees/${id}`);
}

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireTab("employees");
  const data = Object.fromEntries(form) as Record<string, string>;
  const id = Id.safeParse(data.id), p = Profile.safeParse(data);
  if (!id.success) return { error: "Invalid employee.", fields: data };
  if (!p.success) return { fieldErrors: fieldErrors(p), fields: data };
  try {
    const result = await withUser(user.id, async (tx) => {
      const [cur] = await tx<{ code: string; hire_date: string; paid: boolean }[]>`
        select code, hire_date::text, exists (select 1 from payroll_lines where employee_id = e.id) as paid
        from employees e where id = ${id.data}`;
      if (!cur) return "missing" as const;
      // Once on a payroll the code is fixed and the hire date may only move earlier (historical entry never drops paid days)
      if (cur.paid && (cur.code !== p.data.code || p.data.hire_date > cur.hire_date)) return "paid" as const;
      // Hire date moved earlier: copy the starting pay terms to it (lib/db/hireDate.ts)
      const earlier = p.data.hire_date < cur.hire_date;
      await tx`update employees set ${tx({ ...p.data, hire_date: earlier ? cur.hire_date : p.data.hire_date })} where id = ${id.data}`;
      if (earlier && await moveHireEarlier(tx, id.data, p.data.hire_date, user.role === "owner")) return "proposed" as const;
      return "ok" as const;
    });
    if (result === "missing") return { error: "Employee not found.", fields: data };
    if (result === "proposed") {
      revalidatePath(`/employees/${id.data}`);
      return { ok: true, fields: data, note: "Hire date saved. The starting rate for the earlier days was sent to the Owner for approval." };
    }
    if (result === "paid") return { fieldErrors: { code: "After the employee has been on a payroll, the code can't change and the hire date can only move earlier." }, fields: data };
  } catch (e) {
    return isDupCode(e) ? { fieldErrors: DUP_CODE, fields: data } : { error: dbErrorMessage(e), fields: data };
  }
  revalidatePath(`/employees/${id.data}`);
  return { ok: true, fields: data };
}

/** Blank fields are left unchanged, so masked values never have to be sent back to the browser. */
export async function updatePrivate(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireTab("employees");
  const data = Object.fromEntries(form) as Record<string, string>;
  const id = Id.safeParse(data.id), v = Private.safeParse(data);
  if (!id.success) return { error: "Invalid employee." };
  if (!v.success) return { fieldErrors: fieldErrors(v) };
  const changes = Object.fromEntries(Object.entries(v.data).filter(([, val]) => val !== ""));
  if (Object.keys(changes).length === 0) return { error: "Nothing to update — type a new value in a field first." };
  try {
    const rows = await withUser(user.id, (tx) => tx`update employee_private set ${tx(changes)} where employee_id = ${id.data} returning employee_id`);
    if (rows.length === 0) return { error: "Employee not found." };
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath(`/employees/${id.data}`);
  return { ok: true };
}

const PRIVATE_FIELDS = ["tin", "sss_no", "philhealth_no", "pagibig_no", "bank_account_no"] as const;

/** Returns one sensitive value and logs the reveal to the audit log (UX S-04). */
export async function revealField(employeeId: string, field: string): Promise<string> {
  const user = await requireTab("employees");
  const f = z.enum(PRIVATE_FIELDS).parse(field);
  const id = Id.parse(employeeId);
  return withUser(user.id, async (tx) => {
    const [row] = await tx`select ${tx(f)} as v from employee_private where employee_id = ${id}`;
    if (!row) throw new Error("not found");
    await tx`select log_reveal(${id}, ${f})`;
    return (row.v as string | null) ?? "";
  });
}

export async function deactivateEmployee(form: FormData): Promise<string | void> {
  const user = await requireTab("employees");
  const idp = Id.safeParse(form.get("id"));
  const end = isoDate.safeParse(form.get("end_date"));
  if (!idp.success) return "Invalid employee.";
  if (!end.success) return "Choose an end date.";
  const id = idp.data;
  try {
    const rows = await withUser(user.id, (tx) =>
      tx`update employees set end_date = ${end.data}, active = false where id = ${id} and hire_date <= ${end.data} returning id`);
    if (rows.length === 0) return "End date can't be before the hire date.";
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
}
