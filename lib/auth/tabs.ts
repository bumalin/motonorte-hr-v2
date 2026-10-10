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
  { key: "team", label: "Team members", match: "/team" },
  { key: "audit", label: "Audit log", match: "/audit" },
  { key: "mypay", label: "My Pay", match: "/my-pay" },
  { key: "profile", label: "My Profile", match: "/my-profile" },
  { key: "payslips", label: "Payslip requests", match: "/my-payslips" },
  { key: "requests", label: "Employee requests", match: "/requests" },
] as const;

export type Tab = (typeof TABS)[number]["key"];
export const TAB_KEYS = TABS.map((t) => t.key) as Tab[];

export function hasTab(user: { role: string; tabs: readonly string[]; accessKind?: string }, tab: Tab): boolean {
    const personal = ["mypay", "profile", "payslips"].includes(tab);
  if (user.accessKind === "crew") return personal && user.tabs.includes(tab);
  if (personal) return false;
  if (tab === "requests") return user.role === "owner";
  return user.role === "owner" || user.tabs.includes(tab);
}

/** Where to send a user who opened a tab they don't have: their first allowed tab, else their account page. */
export function homeFor(user: { role: string; tabs: readonly string[]; accessKind?: string }, week: string): string {
  const t = TABS.find((x) => hasTab(user, x.key));
  if (!t) return "/account";
  return t.key === "week" ? `/week/${week}` : t.key === "dashboard" ? "/" : t.match;
}
