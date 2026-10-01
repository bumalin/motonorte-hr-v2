// S-06 Tab 3 — allowances, deductions, clawbacks + carried-in balances (US-033, PR-060/061). Server component.
import { withUser } from "@/lib/db/client.ts";
import { Money } from "@/components/ui.tsx";
import { ConfirmDialog } from "@/components/confirm-dialog.tsx";
import { AdjustmentForm } from "./adjustment-form.tsx";
import { removeAdjustment } from "./actions.ts";

type Adj = { id: string; employee_id: string; code: string; full_name: string; kind: string; type: string; amount: number;
  reason: string; work_order_ref: string | null; by: string | null };
const TYPE: Record<string, string> = { meal: "Meal", transport: "Transport", cash_advance: "Cash advance", clawback: "Clawback", correction: "Correction", other: "Other", back_pay: "Back pay" };

export async function AdjustmentsTab({ userId, isOwner, start, employees, locked }: {
  userId: string; isOwner: boolean; start: string; employees: { id: string; code: string; name: string }[]; locked: boolean;
}) {
  const { rows, carried } = await withUser(userId, async (tx) => ({
    rows: await tx<Adj[]>`
      select a.id, a.employee_id, e.code, e.full_name, a.kind, a.type, a.amount, a.reason, a.work_order_ref,
        user_name(a.created_by) as by
      from adjustments a join employees e on e.id = a.employee_id
      where a.period_start = ${start} order by e.code, a.created_at`,
    carried: await tx<{ code: string; full_name: string; carried_in: number }[]>`
      select e.code, e.full_name, c.carried_in
      from carried_in_for(${start}) c join employees e on e.id = c.employee_id order by e.code`,
  }));

  return (
    <div className="space-y-4">
      {carried.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="font-medium">Carried in from earlier weeks (deducted automatically):</p>
          <ul className="mt-1">{carried.map((c) => <li key={c.code}><span className="font-mono">{c.code}</span> {c.full_name}: <Money value={c.carried_in} /></li>)}</ul>
        </div>
      )}
      <table className="w-full rounded-md border border-border bg-surface text-sm">
        <thead className="bg-surface-2 text-left text-text-muted">
          <tr>{["Employee", "Kind", "Type", "Amount", "Reason", "WO ref", "By", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-text-muted">No allowances or deductions this week.</td></tr>}
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="px-3 py-2"><span className="font-mono">{a.code}</span> · {a.full_name}</td>
              <td className="px-3 py-2 capitalize">{a.kind}</td>
              <td className="px-3 py-2">{TYPE[a.type]}</td>
              <td className="px-3 py-2 text-right"><Money value={a.kind === "deduction" ? -a.amount : a.amount} /></td>
              <td className="px-3 py-2">{a.reason}</td>
              <td className="px-3 py-2">{a.work_order_ref ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-text-muted">{a.by ?? "—"}</td>
              <td className="px-3 py-2 text-right">{!locked && (
                <ConfirmDialog trigger="Remove" danger title={`Remove this ${a.kind}?`} body={`${a.code}: ${TYPE[a.type]} — ${a.reason}`} confirmLabel="Remove" action={removeAdjustment}>
                  <input type="hidden" name="id" value={a.id} />
                </ConfirmDialog>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!locked && <AdjustmentForm start={start} employees={employees} isOwner={isOwner} />}
    </div>
  );
}
