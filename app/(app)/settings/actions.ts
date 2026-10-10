"use server";
// Settings — PR-030 multipliers, holidays, user accounts (UX S-11). Owner-only writes; RLS enforces the same.
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireOwner } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";
import { Email } from "@/lib/auth/email.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password.ts";
import { parsePesos } from "@/lib/format.ts";
import { TAB_KEYS } from "@/lib/auth/tabs.ts";

export type SettingsState = { error?: string; ok?: string } | undefined;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const KEYS = ["rest_day_worked_multiplier", "holiday_worked_multiplier", "holiday_unworked_multiplier", "ot_multiplier"] as const;

const Multiplier = z.object({
  key: z.enum(KEYS),
  effective_from: isoDate,
  // "1.25" -> 125 hundredths, exact (same parser as pesos -> centavos; no float math, ADR-003)
  value: z.string().trim().regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter a multiplier like 1.25").transform((v) => parsePesos(v)!),
});

export async function setMultiplier(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireOwner();
  const m = Multiplier.safeParse(Object.fromEntries(form));
  if (!m.success) return { error: m.error.issues[0].message };
  if (m.data.value > 1000) return { error: "Multiplier can't exceed 10.00." };
  try {
    await withUser(user.id, (tx) => tx`insert into settings (key, effective_from, value_hundredths)
      values (${m.data.key}, ${m.data.effective_from}, ${m.data.value})
      on conflict (key, effective_from) do update set value_hundredths = excluded.value_hundredths`);
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath("/settings");
  revalidatePath("/team");
  return { ok: "Saved." };
}

const Holiday = z.object({ date: isoDate, name: z.string().trim().min(1, "Enter a name").max(80), type: z.enum(["regular", "special"]) });

export async function addHoliday(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireOwner();
  const h = Holiday.safeParse(Object.fromEntries(form));
  if (!h.success) return { error: h.error.issues[0].message };
  try {
    await withUser(user.id, (tx) => tx`insert into holidays ${tx(h.data)}`);
  } catch (e) {
    return { error: dbErrorMessage(e, "There's already a holiday on that date.") };
  }
  revalidatePath("/settings");
  revalidatePath("/team");
  return { ok: `${h.data.name} added.` };
}

export async function removeHoliday(form: FormData): Promise<string | void> {
  const user = await requireOwner();
  const d = isoDate.safeParse(form.get("date"));
  if (!d.success) return "Invalid date.";
  try {
    await withUser(user.id, (tx) => tx`delete from holidays where date = ${d.data}`);
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath("/settings");
  revalidatePath("/team");
}

const Password = z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200);
const FullName = z.string().trim().min(1, "Enter a name").max(120);
const NewUser = z.object({ email: Email, full_name: FullName, role: z.enum(["staff", "owner"]), password: Password });
/** Optional contact details (011): trimmed, blank → null. */
const optional = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`).transform((v) => v || null);
const Contact = z.object({
  phone: optional(40), address: optional(300), emergency_contact: optional(120), emergency_contact_phone: optional(40),
});
const contactOf = (form: FormData) => Contact.safeParse({
  phone: form.get("phone") ?? "", address: form.get("address") ?? "",
  emergency_contact: form.get("emergency_contact") ?? "", emergency_contact_phone: form.get("emergency_contact_phone") ?? "",
});

/** Checked tab boxes; unknown values dropped. Owners always see every tab, so theirs are stored as all. */
const tabsOf = (form: FormData, role: string) =>
  role === "owner" ? TAB_KEYS : TAB_KEYS.filter((t) => form.getAll("tabs").includes(t));

export async function addUser(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireOwner();
  const u = NewUser.safeParse(Object.fromEntries(form));
  if (!u.success) return { error: u.error.issues[0].message };
  const c = contactOf(form);
  if (!c.success) return { error: c.error.issues[0].message };
  try {
    const password_hash = await hashPassword(u.data.password);
    const row = { email: u.data.email, full_name: u.data.full_name, role: u.data.role, password_hash, tabs: tabsOf(form, u.data.role), ...c.data };
    await withUser(user.id, (tx) => tx`insert into users ${tx(row)}`);
  } catch (e) {
    return { error: dbErrorMessage(e, "A user with that email already exists.") };
  }
  revalidatePath("/settings");
  revalidatePath("/team");
  return { ok: `${u.data.email} can now sign in with the temporary password.` };
}

/** Edit name, email, role, tab access and (optionally) password. The DB ends that user's sessions on a password or
 *  role change and keeps one active owner (002/003). Tab changes apply on the user's next page load. */
export async function updateUser(_: SettingsState, form: FormData): Promise<SettingsState> {
  const owner = await requireOwner();
  const id = z.guid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid user." };
  const role = z.enum(["staff", "owner"]).safeParse(form.get("role"));
  const email = Email.safeParse(form.get("email"));
  const name = FullName.safeParse(form.get("full_name"));
  const pw = String(form.get("password") ?? "");
  if (!role.success) return { error: "Choose a role." };
  if (!email.success) return { error: "Enter a valid email." };
  if (!name.success) return { error: name.error.issues[0].message };
  const c = contactOf(form);
  if (!c.success) return { error: c.error.issues[0].message };
  if (id.data === owner.id && role.data !== "owner") return { error: "You can't demote your own account." };
  if (id.data === owner.id && pw) return { error: "Change your own password on the Account page (it asks for the current one)." };
  const [account] = await withUser(owner.id, tx => tx`select access_kind from users where id=${id.data}`);
  if (account?.access_kind === "crew") return { error: "Edit employee access on Team members." };
  const changes: Record<string, unknown> = { role: role.data, email: email.data, full_name: name.data, tabs: tabsOf(form, role.data), ...c.data };
  if (pw) {
    const p = Password.safeParse(pw);
    if (!p.success) return { error: p.error.issues[0].message };
    changes.password_hash = await hashPassword(p.data);
  }
  try {
    const rows = await withUser(owner.id, (tx) => tx`update users set ${tx(changes)} where id = ${id.data} returning id`);
    if (rows.length === 0) return { error: "User not found." };
  } catch (e) {
    return { error: dbErrorMessage(e, "Another user already has that email.") };
  }
  revalidatePath("/settings");
  revalidatePath("/team");
  return { ok: pw ? "Saved. Password reset — they've been signed out." : "Saved." };
}

/** Deactivate / reactivate (confirm dialog, UX §4). Deactivation signs the user out (002). */
export async function setUserActive(form: FormData): Promise<string | void> {
  const owner = await requireOwner();
  const id = z.guid().safeParse(form.get("id"));
  const active = form.get("active");
  if (!id.success || (active !== "true" && active !== "false")) return "Invalid request.";
  if (id.data === owner.id) return "You can't deactivate your own account.";
  try {
    const rows = await withUser(owner.id, (tx) => tx`update users set active = ${active === "true"} where id = ${id.data} returning id`);
    if (rows.length === 0) return "User not found.";
  } catch (e) {
    return dbErrorMessage(e);
  }
  revalidatePath("/settings");
  revalidatePath("/team");
}
