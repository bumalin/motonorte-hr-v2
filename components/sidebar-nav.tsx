// Desktop sidebar: links grouped under small labels, each with an icon. UI only — the item list and access checks
// come from lib/auth/tabs.ts via the layout.
import { NavLink } from "./nav-link.tsx";
import type { NavigationItem } from "./workspace-navigation.tsx";

const GROUPS: { label: string | null; keys: string[] }[] = [
  { label: null, keys: ["dashboard"] },
  { label: "Payroll", keys: ["week", "payroll", "catalog"] },
  { label: "People", keys: ["employees", "team", "requests"] },
  { label: "Admin", keys: ["reports", "settings", "audit"] },
];

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  week: <><rect x="3" y="4" width="18" height="17" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  payroll: <><rect x="2" y="6" width="20" height="12" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></>,
  catalog: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  employees: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
  team: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.4.8 4 2.8 4 5.7" /></>,
  requests: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>,
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  audit: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="square" aria-hidden="true">{ICONS[name] ?? <circle cx="12" cy="12" r="3" />}</svg>
  );
}

export function SidebarNav({ nav, pending }: { nav: NavigationItem[]; pending: number }) {
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const groups = [...GROUPS, { label: null, keys: nav.filter((n) => !known.has(n.key)).map((n) => n.key) }]
    .map((g) => ({ label: g.label, items: g.keys.map((k) => nav.find((n) => n.key === k)).filter((n): n is NavigationItem => !!n) }))
    .filter((g) => g.items.length > 0);
  return (
    <nav aria-label="Main" className="sidebar-groups">
      {groups.map((g, i) => (
        <div key={g.label ?? `g${i}`} className="nav-group" role="group" aria-label={g.label ?? undefined}>
          {g.label && <div className="nav-group-label" aria-hidden="true">{g.label}</div>}
          {g.items.map((n) => (
            <NavLink key={n.key} href={n.href} match={n.match}>
              <Icon name={n.key} />
              <span>{n.label}</span>
              {n.key === "requests" && pending > 0 && <span className="nav-badge" aria-label={`${pending} pending`}>{pending}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
