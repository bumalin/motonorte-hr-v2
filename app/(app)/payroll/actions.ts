"use server";
// Payroll runs — generate draft (US-030, TASK-014). The engine is pure; this action loads, computes and saves atomically.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";
import { loadPeriodInput } from "@/lib/db/loadPeriodInput.ts";
import { computeWeek } from "@/lib/payroll/engine.ts";
import { inputHash } from "@/lib/payroll/hash.ts";
import { currentRunHash } from "@/lib/db/runs.ts";
import type { PayrollError } from "@/lib/payroll/types.ts";

export type GenerateState = { error?: string; errors?: PayrollError[] } | undefined;

export async function generateDraft(_: GenerateState, form: FormData): Promise<GenerateState> {
  const user = await requireTab("payroll");
  const start = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(form.get("period_start"));
  if (!start.success) return { error: "Invalid week." };

  let runId: string;
  try {
    const result = await withUser(user.id, async (tx) => {
      const input = await loadPeriodInput(tx, start.data);
      const r = computeWeek(input);
      if (!r.ok) return { errors: r.errors };
      const lines = r.lines.map((l) => ({
        employee_id: l.employeeId, basic: l.basic, base: l.base, ot: l.ot, incentive: l.incentive, allowances: l.allowances,
        deductions: l.deductions, carried_in: l.carriedIn, gross: l.gross, net: l.net, carry_out: l.carryOut,
      }));
      const items = r.items.map((i) => ({ employee_id: i.employeeId, date: i.date, kind: i.kind, amount: i.amount, rule_id: i.ruleId, source: i.source }));
      const snapshot = { settings: input.settings, catalog: input.catalog, holidays: input.holidays };
      const [{ id }] = await tx<{ id: string }[]>`
        select save_draft(${start.data}, ${inputHash(input)}, ${JSON.stringify(snapshot)}::text::jsonb, ${JSON.stringify(lines)}::text::jsonb, ${JSON.stringify(items)}::text::jsonb) as id`;
      return { id };
    });
    if ("errors" in result) return { errors: result.errors };
    runId = result.id;
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath(`/week/${start.data}`);
  revalidatePath("/payroll");
  redirect(`/payroll/${runId}`);
}

const RunId = z.guid();

async function afterChange(runId: string, start?: string) {
  revalidatePath(`/payroll/${runId}`);
  revalidatePath("/payroll");
  revalidatePath("/");
  if (start) revalidatePath(`/week/${start}`);
}

export async function submitRun(form: FormData): Promise<string | void> {
  const user = await requireTab("payroll");
  const id = RunId.safeParse(form.get("run_id"));
  if (!id.success) return "Invalid run.";
  try {
    const now = await currentRunHash(user.id, id.data);
    const [run] = await withUser(user.id, (tx) => tx<{ input_hash: string }[]>`select input_hash from payroll_runs where id = ${id.data}`);
    if (!now || !run) return "Run not found.";
    if (now.hash !== run.input_hash) return dbErrorMessage(new Error("RUN_STALE"));
    await withUser(user.id, (tx) => tx`select submit_run(${id.data})`);
    await afterChange(id.data, now.start);
  } catch (e) {
    return dbErrorMessage(e);
  }
}

export async function sendBackRun(form: FormData): Promise<string | void> {
  const user = await requireTab("payroll");
  if (user.role !== "owner") return "Only the Owner can send a run back."; // send_back_run() checks too
  const id = RunId.safeParse(form.get("run_id"));
  const note = z.string().trim().min(1, "A note is required.").max(500).safeParse(form.get("note"));
  if (!id.success) return "Invalid run.";
  if (!note.success) return note.error.issues[0].message;
  try {
    await withUser(user.id, (tx) => tx`select send_back_run(${id.data}, ${note.data})`);
    await afterChange(id.data);
  } catch (e) {
    return dbErrorMessage(e);
  }
}

/** Owner only. The server recomputes the week's fingerprint; lock_run refuses if the draft is stale (RUN_STALE). */
export async function lockRun(form: FormData): Promise<string | void> {
  const user = await requireTab("payroll");
  if (user.role !== "owner") return "Only the Owner can approve and lock payroll.";
  const id = RunId.safeParse(form.get("run_id"));
  if (!id.success) return "Invalid run.";
  try {
    const start = await withUser(user.id, async (tx) => {
      const [r] = await tx<{ start: string }[]>`select period_start::text as start from payroll_runs where id = ${id.data}`; // lock_run() takes the row lock (app_user can't SELECT … FOR UPDATE)
      if (!r) return null;
      await tx`select lock_run(${id.data}, ${inputHash(await loadPeriodInput(tx, r.start))})`;
      return r.start;
    });
    if (!start) return "Run not found.";
    await afterChange(id.data, start);
  } catch (e) {
    return dbErrorMessage(e);
  }
}

/** Owner only: reopen the latest locked week (unlock_run checks role, "latest" and the reason; audited). */
export async function unlockRun(form: FormData): Promise<string | void> {
  const user = await requireTab("payroll");
  if (user.role !== "owner") return "Only the Owner can reopen a locked week.";
  const id = RunId.safeParse(form.get("run_id"));
  const note = z.string().trim().min(1, "A reason is required.").max(500).safeParse(form.get("note"));
  if (!id.success) return "Invalid run.";
  if (!note.success) return note.error.issues[0].message;
  try {
    const [r] = await withUser(user.id, async (tx) => {
      await tx`select unlock_run(${id.data}, ${note.data})`;
      return tx<{ start: string }[]>`select period_start::text as start from payroll_runs where id = ${id.data}`;
    });
    await afterChange(id.data, r?.start);
  } catch (e) {
    return dbErrorMessage(e);
  }
}
