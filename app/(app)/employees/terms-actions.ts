"use server";
// Effective-dated position + daily rate (US-002, PR-020). Staff propose; the Owner approves or rejects.
// RLS enforces the same rules (pay_terms_insert / pay_terms_decide); triggers block dates in locked weeks.
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireOwner, requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";
import { TermsFields } from "@/lib/terms-schema.ts";

export type TermsState = { error?: string; ok?: string } | undefined;

const Change = TermsFields.extend({
  employee_id: z.guid(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date"),
});

export async function addTermsChange(_: TermsState, form: FormData): Promise<TermsState> {
  const user = await requireTab("employees");
  const c = Change.safeParse(Object.fromEntries(form));
  if (!c.success) return { error: c.error.issues[0].message };
  const status = user.role === "owner" ? "approved" : "proposed";
  try {
    await withUser(user.id, (tx) => tx`insert into pay_terms ${tx({ ...c.data, status })}`);
  } catch (e) {
    return { error: dbErrorMessage(e, "There's already a change on that date. Reject it first or pick another date.") };
  }
  revalidatePath(`/employees/${c.data.employee_id}`);
  revalidatePath("/");
  return { ok: status === "approved" ? "Change saved." : "Sent to the Owner for approval." };
}

export async function decideTerms(form: FormData): Promise<string | void> {
  const user = await requireOwner();
  const id = z.guid().safeParse(form.get("id"));
  const decision = z.enum(["approved", "rejected"]).safeParse(form.get("decision"));
  if (!id.success || !decision.success) return "Invalid request.";
  try {
    const rows = await withUser(user.id, (tx) =>
      tx`update pay_terms set status = ${decision.data} where id = ${id.data} and status = 'proposed' returning employee_id`);
    if (rows.length === 0) return "This change was already decided.";
    revalidatePath(`/employees/${rows[0].employee_id}`);
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath("/");
}

/** Owner: withdraw an approved rate entered by mistake. It stays in history as rejected (audited); the date is free
 *  again for a corrected row. The DB refuses this if it would change a locked week (guard_effective_date). */
export async function removeTerms(form: FormData): Promise<string | void> {
  const user = await requireOwner();
  const id = z.guid().safeParse(form.get("id"));
  if (!id.success) return "Invalid request.";
  try {
    const rows = await withUser(user.id, (tx) =>
      tx`update pay_terms set status = 'rejected' where id = ${id.data} and status = 'approved' returning employee_id`);
    if (rows.length === 0) return "This rate was already removed.";
    revalidatePath(`/employees/${rows[0].employee_id}`);
  } catch (e) {
    return dbErrorMessage(e);
  }
}
