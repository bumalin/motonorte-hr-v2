import Link from "next/link";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { EmptyState, Money, StatusChip } from "@/components/ui.tsx";
import { formatDate, POSITIONS, positionLabel } from "@/lib/format.ts";

// S-03 Employee list — US-001, US-003
type Row = { id: string; code: string; full_name: string; position: string | null; rest_day: string; hire_date: string; daily_rate: number | null; active: boolean; pending: number };

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const user = await requireTab("employees");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const pos = typeof sp.pos === "string" ? sp.pos : "";
  const all = sp.all === "1";

  const rows = await withUser(user.id, (tx) => tx<Row[]>`
    select e.id, e.code, e.full_name, e.position, e.rest_day, e.hire_date::text, e.daily_rate::int as daily_rate, e.active,
           (select count(*)::int from pay_terms t where t.employee_id = e.id and t.status = 'proposed') as pending
    from v_employee_current e
    where (${all} or e.active)
      and (${q} = '' or e.code ilike ${"%" + q + "%"} or e.full_name ilike ${"%" + q + "%"})
      and (${pos} = '' or e.position::text = ${pos})
    order by e.code`);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Employees</h1>
        <Link href="/employees/new" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90">New employee</Link>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm">Search
          <input name="q" defaultValue={q} placeholder="Name or code" className="mt-1 block rounded-md border border-border bg-surface px-3 py-1.5" />
        </label>
        <label className="text-sm">Position
          <select name="pos" defaultValue={pos} className="mt-1 block rounded-md border border-border bg-surface px-3 py-1.5">
            <option value="">All</option>{POSITIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" name="all" value="1" defaultChecked={all} /> Show inactive
        </label>
        <button className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">Apply</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={q || pos ? "No employees match." : "No employees yet. Add your first employee."}
          action={{ href: "/employees/new", label: "New employee →" }} />
      ) : (
        <table className="w-full overflow-hidden rounded-md border border-border bg-surface text-sm">
          <thead className="bg-surface-2 text-left text-text-muted">
            <tr>{["Code", "Name", "Position", "Usual rest day", "Hire date", "Daily rate", "Status", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2 font-mono"><Link href={`/employees/${r.id}`} className="text-brand-700 hover:underline">{r.code}</Link></td>
                <td className="px-3 py-2">{r.full_name}</td>
                <td className="px-3 py-2">{positionLabel(r.position)}</td>
                <td className="px-3 py-2 capitalize">{r.rest_day}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.hire_date)}</td>
                <td className="px-3 py-2 text-right">{r.daily_rate === null ? "—" : <Money value={r.daily_rate} />}</td>
                <td className="px-3 py-2"><StatusChip status={r.active ? "active" : "inactive"} /></td>
                <td className="px-3 py-2">{r.pending > 0 && <StatusChip status="proposed" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
