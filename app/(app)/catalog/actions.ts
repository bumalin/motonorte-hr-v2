"use server";
// Incentive job catalog — US-010, PR-050. Owner-only writes (RLS: catalog_*_owner); amounts are effective-dated.
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireOwner } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";
import { parsePesos } from "@/lib/format.ts";

export type CatalogState = { error?: string; ok?: string } | undefined;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date");
const amount = z.string().transform((v, ctx) => {
  const c = parsePesos(v);
  if (c === null || c <= 0) { ctx.addIssue({ code: "custom", message: "Enter an amount like 150 or 150.00" }); return z.NEVER; }
    if (c > 10000000) { ctx.addIssue({ code: "custom", message: "Amount can't exceed ₱100,000" }); return z.NEVER; }
  return c;
});

const Earner = z.union([z.literal(""), z.guid()]); // "" = shared pool (PR-051), else a specific mechanic (PR-055)

const NewJob = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "Code: 2–20 letters, digits or _ (e.g. TBC)"),
  name: z.string().trim().min(1, "Enter a job name").max(100),
  amount, effective_from: isoDate,
  specialist_id: Earner.default(""),
});

export async function addJob(_: CatalogState, form: FormData): Promise<CatalogState> {
  const user = await requireOwner();
  const j = NewJob.safeParse(Object.fromEntries(form));
  if (!j.success) return { error: j.error.issues[0].message };
  try {
    await withUser(user.id, async (tx) => {
      const [row] = await tx<{ id: string }[]>`insert into catalog_jobs (code, name, specialist_id)
        values (${j.data.code}, ${j.data.name}, ${j.data.specialist_id || null}) returning id`;
      await tx`insert into catalog_amounts (job_id, effective_from, amount) values (${row.id}, ${j.data.effective_from}, ${j.data.amount})`;
    });
  } catch (e) {
    return { error: dbErrorMessage(e, "That job code already exists.") };
  }
  revalidatePath("/catalog");
  return { ok: `${j.data.code} added.` };
}

const Change = z.object({ job_id: z.guid(), amount, effective_from: isoDate });

export async function changeAmount(_: CatalogState, form: FormData): Promise<CatalogState> {
  const user = await requireOwner();
  const c = Change.safeParse(Object.fromEntries(form));
  if (!c.success) return { error: c.error.issues[0].message };
  try {
    await withUser(user.id, (tx) => tx`insert into catalog_amounts ${tx(c.data)}`);
  } catch (e) {
    return { error: dbErrorMessage(e, "There's already an amount starting on that date.") };
  }
  revalidatePath("/catalog");
  return { ok: "New amount saved." };
}

export async function setJobActive(jobId: string, active: boolean): Promise<string | void> {
  const user = await requireOwner();
  const id = z.guid().safeParse(jobId);
  if (!id.success || typeof active !== "boolean") return "Invalid request.";
  try {
    const rows = await withUser(user.id, (tx) => tx`update catalog_jobs set active = ${active} where id = ${id.data} returning id`);
    if (rows.length === 0) return "Job not found.";
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath("/catalog");
}

/** Past-week entry (PR-072): every job whose first amount starts after `from` gets a copy of that first amount dated
 *  `from`, so incentives can be logged for earlier weeks. Later amount changes are untouched. The DB refuses a copy
 *  that would alter a locked week (guard_effective_date). */
export async function backdateAmounts(_: CatalogState, form: FormData): Promise<CatalogState> {
  const user = await requireOwner();
  const from = isoDate.safeParse(form.get("from"));
  if (!from.success) return { error: from.error.issues[0].message };
  try {
    const rows = await withUser(user.id, (tx) => tx`
      insert into catalog_amounts (job_id, effective_from, amount)
      select distinct on (job_id) job_id, ${from.data}::date, amount from catalog_amounts
      where job_id in (select job_id from catalog_amounts group by job_id having min(effective_from) > ${from.data}::date)
      order by job_id, effective_from
      returning job_id`);
    revalidatePath("/catalog");
    return { ok: rows.length ? `${rows.length} job amount(s) now apply from ${from.data}.` : "Every job already has an amount on that date." };
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
}

/** Owner: who earns a job (PR-055) — "" = shared pool, else one specific mechanic. Applies to jobs logged from now on;
 *  entries already logged keep whoever they were credited to. */
export async function setJobEarner(_: CatalogState, form: FormData): Promise<CatalogState> {
  const user = await requireOwner();
  const job = z.guid().safeParse(form.get("job_id"));
  const earner = Earner.safeParse(form.get("specialist_id") ?? "");
  if (!job.success || !earner.success) return { error: "Invalid request." };
  try {
    await withUser(user.id, (tx) => tx`update catalog_jobs set specialist_id = ${earner.data || null} where id = ${job.data}`);
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath("/catalog");
  return { ok: earner.data ? "Saved. This job now goes in full to that mechanic." : "Saved. This job goes to the shared pool." };
}
