"use server";
// Change your own password (security report M-4). The current password goes through the same throttled check as
// sign-in; auth_change_password() replaces the hash and the users trigger ends ALL of this user's sessions.
import { redirect } from "next/navigation";
import * as z from "zod";
import { requireUser, createSession, clientIp } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password.ts";
import { checkPassword } from "@/lib/auth/credentials.ts";
import { dbErrorMessage } from "@/lib/db/errors.ts";

export type PwState = { error?: string; ok?: boolean } | undefined;

const Change = z.object({
  current: z.string().min(1, "Enter your current password").max(200),
  next: z.string().min(MIN_PASSWORD_LENGTH, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
  confirm: z.string(),
}).refine((v) => v.next === v.confirm, { message: "The new passwords don't match", path: ["confirm"] })
  .refine((v) => v.next !== v.current, { message: "Choose a password you haven't just used", path: ["next"] });

export async function changePassword(_: PwState, form: FormData): Promise<PwState> {
  const user = await requireUser();
  const c = Change.safeParse(Object.fromEntries(form));
  if (!c.success) return { error: c.error.issues[0].message };
  const check = await checkPassword(user.email, c.data.current, await clientIp());
  if (!check.ok) return { error: check.reason === "throttled" ? "Too many attempts. Try again in 15 minutes." : "Current password is incorrect." };
  if (check.userId !== user.id) return { error: "Current password is incorrect." };
  try {
    const hash = await hashPassword(c.data.next);
    await withUser(user.id, (tx) => tx`select auth_change_password(${hash})`);
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  // The change is committed and every session was revoked. Keep this browser signed in; if that fails,
  // send the user to sign in with the new password rather than to an error page.
  let signedIn = true;
  try { await createSession(user.id); } catch { signedIn = false; }
  if (!signedIn) redirect("/login?changed=1");
  return { ok: true };
}
