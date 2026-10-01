// Per-user tab access (migration 009). Owners always have every tab; the Owner picks tabs for each staff user.
// Pure module: used by the nav, the Settings user editor and the server guards.
export const TABS = [
  { key: "dashboard", label: "Dashboard", match: "/" },
  { key: "week", label: "This week", match: "/week" },
  { key: "employees", label: "Employees", match: "/employees" },
  { key: "payroll", label: "Payroll", match: "/payroll" },
  { key: "catalog", label: "Incentive jobs", match: "/catalog" },
  { key: "reports", label: "Reports", match: "/reports" },
  { key: "settings", label: "Settings", match: "/settings" },
  { key: "audit", label: "Audit log", match: "/audit" },
] as const;

export type Tab = (typeof TABS)[number]["key"];
export const TAB_KEYS = TABS.map((t) => t.key) as Tab[];

export function hasTab(user: { role: string; tabs: readonly string[] }, tab: Tab): boolean {
  return user.role === "owner" || user.tabs.includes(tab);
}

/** Where to send a user who opened a tab they don't have: their first allowed tab, else their account page. */
export function homeFor(user: { role: string; tabs: readonly string[] }, week: string): string {
  const t = TABS.find((x) => hasTab(user, x.key));
  if (!t) return "/account";
  return t.key === "week" ? `/week/${week}` : t.key === "dashboard" ? "/" : t.match;
}
