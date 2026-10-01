// Throttled password check shared by sign-in and "change password" (security report H-1/M-4).
// Counts the attempt as a failure BEFORE verifying, under advisory locks on the IP and the email, so concurrent
// requests can't slip past auth_throttle(); scrypt runs outside the transaction. A correct password records success.
import { withAnon } from "../db/client.ts";
import { verifyDummy, verifyPassword } from "./password.ts";

export type CheckResult = { ok: true; userId: string } | { ok: false; reason: "throttled" | "invalid" };

export async function checkPassword(email: string, password: string, ip: string | null): Promise<CheckResult> {
  const pre = await withAnon(async (tx) => {
    if (ip) await tx`select pg_advisory_xact_lock(hashtext(${"ip:" + ip}))`; // IP first, then email: fixed order, no deadlock
    await tx`select pg_advisory_xact_lock(hashtext(${email}))`;
    await tx`select auth_housekeeping()`;
    const [{ verdict }] = await tx<{ verdict: string }[]>`select auth_throttle(${email}, ${ip}) as verdict`;
    if (verdict !== "ok") return "THROTTLED" as const;
    const [u] = await tx<{ id: string; password_hash: string; active: boolean }[]>`select * from auth_login_lookup(${email})`;
    await tx`select auth_record_attempt(${email}, ${ip}, false)`;
    return u?.active ? u : null;
  });
  if (pre === "THROTTLED") return { ok: false, reason: "throttled" };
  const ok = pre ? await verifyPassword(password, pre.password_hash) : await verifyDummy(password);
  if (!ok || !pre) return { ok: false, reason: "invalid" };
  await withAnon((tx) => tx`select auth_record_attempt(${email}, ${ip}, true)`);
  return { ok: true, userId: pre.id };
}
