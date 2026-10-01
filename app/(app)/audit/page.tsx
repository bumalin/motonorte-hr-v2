import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { todayManila, addDays } from "@/lib/format.ts";
import { EmptyState } from "@/components/ui.tsx";

// S-12 Audit log — US-060. Read-only for both roles; sensitive values are already masked in the log (001_init mask_private).
type Entry = { id: number; at: Date; who: string | null; actor: string | null; record: string | null; table_name: string; row_id: string | null; action: string;
  old: Record<string, unknown> | null; new: Record<string, unknown> | null };

const TABLES = ["employees", "employee_private", "pay_terms", "catalog_jobs", "catalog_amounts", "settings", "holidays",
  "attendance", "job_log", "adjustments", "payroll_runs", "users"];
const SKIP = new Set(["created_at", "updated_at", "updated_by", "created_by"]);
/** Keys that identify WHAT changed — always shown, even when unchanged on UPDATE (e.g. which attendance day). */
const IDENTIFY = ["employee_id", "date", "period_start", "key", "job_id", "effective_from", "code"];
const PAGE = 100;

/** Only the fields that changed (all fields for INSERT/DELETE/REVEAL). */
function changes(e: Entry): [string, unknown, unknown][] {
  const keys = new Set([...Object.keys(e.old ?? {}), ...Object.keys(e.new ?? {})]);
  return [...keys].filter((k) => !SKIP.has(k))
    .map((k) => [k, e.old?.[k], e.new?.[k]] as [string, unknown, unknown])
    .filter(([k, o, n]) => e.action !== "UPDATE" || IDENTIFY.includes(k) || JSON.stringify(o) !== JSON.stringify(n));
}
const show = (v: unknown) => (v === undefined ? "" : v === null ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const user = await requireTab("audit");
  const sp = await searchParams;
  const today = todayManila();
  // Real calendar dates only (2026-02-31 falls back to the default instead of erroring)
  const iso = (v: unknown, d: string) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return d;
    const t = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(v) ? v : d; // rejects 2026-13-01 and 2026-02-31
  };
  const from = iso(sp.from, addDays(today, -7)), to = iso(sp.to, today);
  const table = typeof sp.table === "string" && TABLES.includes(sp.table) ? sp.table : "";
  const who = typeof sp.who === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sp.who) ? sp.who : "";

  const { entries, users } = await withUser(user.id, async (tx) => ({
    entries: await tx<Entry[]>`
      select a.id, a.at, a.actor, user_name(a.actor) as who, a.table_name, a.row_id, a.action, a.old, a.new,
        -- Human label for the record: employee code where the row belongs to an employee
        (select code from employees where id::text = coalesce(a.new, a.old) ->> 'employee_id' or
          (a.table_name in ('employees', 'employee_private') and id::text = a.row_id)) as record
      from audit_log a
      where a.at >= (${from}::date)::timestamp at time zone 'Asia/Manila'
        and a.at < ((${to}::date + 1)::timestamp at time zone 'Asia/Manila')
        and (${table} = '' or a.table_name = ${table})
        and (${who} = '' or a.actor = ${who || null}::uuid)
      order by a.id desc limit ${PAGE}`,
    // Staff see only themselves in `users` (RLS); the filter lists whoever appears in the log
    users: await tx<{ id: string; name: string }[]>`
      select distinct a.actor as id, coalesce(user_name(a.actor), 'Unknown') as name
      from audit_log a where a.actor is not null order by name`,
  }));

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Audit log</h1>
      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label>From<input type="date" name="from" defaultValue={from} className="mt-1 block rounded-md border border-border px-2 py-1" /></label>
        <label>To<input type="date" name="to" defaultValue={to} className="mt-1 block rounded-md border border-border px-2 py-1" /></label>
        <label>Record type
          <select name="table" defaultValue={table} className="mt-1 block rounded-md border border-border px-2 py-1">
            <option value="">All</option>{TABLES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label>User
          <select name="who" defaultValue={who} className="mt-1 block rounded-md border border-border px-2 py-1">
            <option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <button className="rounded-md border border-border bg-surface px-3 py-1">Apply</button>
      </form>

      {entries.length === 0 ? <EmptyState title="No activity in this range." /> : (
        <table className="w-full rounded-md border border-border bg-surface text-sm">
          <thead className="bg-surface-2 text-left text-text-muted">
            <tr>{["When", "Who", "What", "Record", "Changes"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const c = changes(e);
              return (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{e.at.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td>
                  <td className="px-3 py-2">{e.who ?? (e.actor ? "Unknown user" : "System")}</td>
                  <td className="px-3 py-2"><span className="font-medium">{e.action}</span> {e.table_name.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-xs">
                    {e.record && <span className="font-mono">{e.record}</span>}
                    {(() => { const r = (e.new ?? e.old) as Record<string, unknown> | null; const d = r?.date ?? r?.period_start ?? r?.effective_from; return d ? <span className="ml-1 text-text-muted">{String(d)}</span> : null; })()}
                    {!e.record && !((e.new ?? e.old) as Record<string, unknown> | null)?.date && <span className="font-mono text-text-muted">{e.row_id?.slice(0, 8)}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs text-text-muted">{c.length} field{c.length === 1 ? "" : "s"}</summary>
                      <table className="mt-1 text-xs">
                        <tbody>
                          {c.map(([k, o, n]) => (
                            <tr key={k}>
                              <th scope="row" className="pr-3 text-left font-mono font-normal text-text-muted">{k}</th>
                              {e.action === "UPDATE" && <td className="pr-3 text-danger line-through">{JSON.stringify(o) === JSON.stringify(n) ? "" : show(o)}</td>}
                              <td className={e.action === "DELETE" ? "text-danger line-through" : ""}>{show(e.action === "DELETE" ? o : n)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {entries.length === PAGE && <p className="mt-2 text-xs text-text-muted">Showing the latest {PAGE}. Narrow the date range or filters to see older entries.</p>}
    </>
  );
}
