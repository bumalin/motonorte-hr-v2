import Link from "next/link";
import { requireUser } from "@/lib/auth/session.ts";
import { periodStartOf, todayManila, formatWeek } from "@/lib/format.ts";
import { NavLink } from "@/components/nav-link.tsx";
import { TABS, hasTab } from "@/lib/auth/tabs.ts";
import { ThemeSwitch } from "@/components/theme-switch.tsx";
import { cookies } from "next/headers";
import { logout } from "../login/actions.ts";

// Global layout — docs/04-ux-spec.md §1. Every page under (app) requires a signed-in user.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const week = periodStartOf(todayManila());
  const theme = (await cookies()).get("mn_theme")?.value === "light" ? "light" : "dark";
  // Only the tabs this user may open (owners: all). Pages and actions enforce the same with requireTab().
  const nav = TABS.filter((t) => hasTab(user, t.key))
    .map((t) => ({ href: t.key === "week" ? `/week/${week}` : t.key === "dashboard" ? "/" : t.match, match: t.match, label: t.label }));
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-border bg-surface p-4">
        <Link href="/" className="mb-6 block px-2" aria-label="MotoNorte Payroll — dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no optimisation needed */}
          <img src="/brand/motonorte-logo.svg" alt="MotoNorte" width={200} height={40} className="h-auto w-full" />
          <p className="font-display mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">HR &amp; Payroll</p>
        </Link>
        <nav aria-label="Main" className="space-y-1">
          {nav.map((n) => <NavLink key={n.href} href={n.href} match={n.match}>{n.label}</NavLink>)}
        </nav>
        <p className="mt-6 px-3 text-xs text-text-muted">This week: {formatWeek(week)}</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header flex items-center justify-end gap-3 border-b-2 border-brand-600 bg-surface px-6 py-3">
          <ThemeSwitch initial={theme} />
          <Link href="/account" className="text-sm hover:underline">{user.fullName}</Link>
          <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium uppercase text-brand-700">{user.role}</span>
          <form action={logout}>
            <button className="rounded-md border border-border px-3 py-1 text-sm hover:bg-surface-2">Sign out</button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
