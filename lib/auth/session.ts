// Server-side session handling (ADR-009). Cookie holds a random token; DB holds its hash.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { withAnon } from "../db/client.ts";
import { SESSION_COOKIE, SESSION_TTL_MS, hashToken, newToken } from "./token.ts";
import { hasTab, homeFor, type Tab } from "./tabs.ts";
import { periodStartOf, todayManila } from "../format.ts";

export type Role = "staff" | "owner";
export interface SessionUser { id: string; email: string; fullName: string; role: Role; tabs: string[]; accessKind: string; employeeId: string | null }

/** Client IP for the login throttle and audit. Trusted only when TRUST_PROXY=1 (the app sits behind Caddy, which
 *  replaces any client-sent X-Forwarded-For). Without a trusted proxy it returns null: throttling then falls back
 *  to per-email limits, and a client can't dodge limits by spoofing the header. */
export async function clientIp(): Promise<string | null> {
  if (process.env.TRUST_PROXY !== "1") return null;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim();
  return ip && /^[0-9a-fA-F.:]{3,45}$/.test(ip) ? ip : null;
}

export async function createSession(userId: string): Promise<void> {
  const token = newToken();
  const ua = (await headers()).get("user-agent");
  const ip = await clientIp();
  await withAnon((tx) => tx`select auth_create_session(${hashToken(token)}, ${userId},
    ${new Date(Date.now() + SESSION_TTL_MS)}, ${ip}, ${ua})`);
  // Browser-session cookie; idle expiry is enforced in the DB (12 h sliding)
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

/** Current user or null. Cached per request; slides the DB expiry. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await withAnon((tx) => tx<{ user_id: string; email: string; full_name: string; role: Role; tabs: string[]; access_kind: string; employee_id: string | null }[]>`
    select * from auth_get_session(${hashToken(token)}, ${new Date(Date.now() + SESSION_TTL_MS)})`);
  const r = rows[0];
  return r ? { id: r.user_id, email: r.email, fullName: r.full_name, role: r.role, tabs: r.tabs, accessKind: r.access_kind, employeeId: r.employee_id } : null;
});

export async function deleteSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await withAnon((tx) => tx`select auth_delete_session(${hashToken(token)})`);
  store.delete(SESSION_COOKIE);
}

/** For pages and Server Actions: signed-in user or redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/** Owner-only actions. The DB enforces this too (app_role() in RLS and functions). */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "owner" || user.accessKind === "crew") throw new Error("FORBIDDEN: owner only");
  return user;
}

/** Pages, Server Actions and route handlers of a tab: signed-in user with that tab, else redirect to one they have. */
export async function requireTab(tab: Tab): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasTab(user, tab)) redirect(homeFor(user, periodStartOf(todayManila())));
  return user;
}
