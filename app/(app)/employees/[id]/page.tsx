import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { formatDate, todayManila, positionLabel } from "@/lib/format.ts";
import { Money, StatusChip } from "@/components/ui.tsx";
import { ConfirmDialog } from "@/components/confirm-dialog.tsx";
import { EmployeeForm } from "../employee-form.tsx";
import { PrivateFields } from "./private-fields.tsx";
import { TermsForm } from "./terms-form.tsx";
import { DecideButtons } from "@/components/decide-buttons.tsx";
import { deactivateEmployee } from "../actions.ts";
import { removeTerms } from "../terms-actions.ts";

// S-04 Employee detail — US-001..003. Tabs: profile · private · terms
type Emp = { id: string; code: string; full_name: string; rest_day: string; hire_date: string; end_date: string | null; active: boolean; position: string | null; daily_rate: number | null; daily_allowance: number | null };
type Terms = { id: string; effective_from: string; position: string; daily_rate: number; daily_allowance: number; status: string; proposed_by: string | null; decided_by: string | null };

export default async function EmployeePage({ params, searchParams }: PageProps<"/employees/[id]">) {
  const user = await requireTab("employees");
  const { id } = await params;
  const tab = ((await searchParams).tab as string) ?? "profile";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await withUser(user.id, async (tx) => {
    const [e] = await tx<Emp[]>`select id, code, full_name, rest_day, hire_date::text, end_date::text, active, position, daily_rate, daily_allowance from v_employee_current where id = ${id}`;
    if (!e) return null;
    // Mask in SQL so full values never reach the page unless revealed
    const [p] = await tx<Record<string, string | null>[]>`
      select bank_name,
        case when tin is null or tin = '' then null else '••••' || right(tin, 4) end as tin,
        case when sss_no is null or sss_no = '' then null else '••••' || right(sss_no, 4) end as sss_no,
        case when philhealth_no is null or philhealth_no = '' then null else '••••' || right(philhealth_no, 4) end as philhealth_no,
        case when pagibig_no is null or pagibig_no = '' then null else '••••' || right(pagibig_no, 4) end as pagibig_no,
        case when bank_account_no is null or bank_account_no = '' then null else '••••' || right(bank_account_no, 4) end as bank_account_no
      from employee_private where employee_id = ${id}`;
    const terms = await tx<Terms[]>`select t.id, t.effective_from::text, t.position, t.daily_rate, t.daily_allowance, t.status,
        user_name(t.proposed_by) as proposed_by, user_name(t.decided_by) as decided_by
      from pay_terms t where t.employee_id = ${id} order by t.effective_from desc, t.created_at desc`;
    return { e, p: p ?? {}, terms, minDate: e.hire_date }; // past dates allowed; the DB refuses changes that would alter a locked week (009)
  });
  if (!data) notFound();
  const { e, p, terms, minDate } = data;
  const isOwner = user.role === "owner";

  const tabs = [["profile", "Profile"], ["private", "Government & bank"], ["terms", "Pay terms"]];
  return (
    <>
      <Link href="/employees" className="text-sm text-brand-700 hover:underline">← Employees</Link>
      <div className="mb-4 mt-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold"><span className="font-mono">{e.code}</span> · {e.full_name}</h1>
        <StatusChip status={e.active ? "active" : "inactive"} />
        {e.position && <span className="text-sm text-text-muted">{positionLabel(e.position)}</span>}
      </div>

      <nav aria-label="Employee sections" className="mb-6 flex gap-1 border-b border-border">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-text-muted hover:text-text"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "profile" && (
        <div className="space-y-8">
          <EmployeeForm mode="edit" isOwner={user.role === "owner"}
            initial={{ id: e.id, code: e.code, full_name: e.full_name, rest_day: e.rest_day, hire_date: e.hire_date }} />
          {e.active ? (
            <ConfirmDialog trigger="Deactivate employee" title={`Deactivate ${e.code}?`} confirmLabel="Deactivate" danger action={deactivateEmployee}
              body="They'll be excluded from new payroll runs. Their history is kept; nothing is deleted.">
              <input type="hidden" name="id" value={e.id} />
              <label className="block text-sm">Last day of employment
                <input type="date" name="end_date" required defaultValue={todayManila()} min={e.hire_date}
                  className="mt-1 block w-full rounded-md border border-border px-3 py-1.5" />
              </label>
            </ConfirmDialog>
          ) : (
            <p className="text-sm text-text-muted">Inactive since {e.end_date ? formatDate(e.end_date) : "—"}.</p>
          )}
        </div>
      )}

      {tab === "private" && <PrivateFields id={e.id} masked={p} bankName={p.bank_name ?? "—"} />}

      {tab === "terms" && (
        <div className="space-y-6">
        <table className="w-full max-w-2xl overflow-hidden rounded-md border border-border bg-surface text-sm">
          <thead className="bg-surface-2 text-left text-text-muted">
            <tr>{["Effective from", "Position", "Daily rate", "Daily allowance", "Status", "By", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2">{formatDate(t.effective_from)}</td>
                <td className="px-3 py-2">{positionLabel(t.position)}</td>
                <td className="px-3 py-2 text-right"><Money value={t.daily_rate} /></td>
                <td className="px-3 py-2 text-right"><Money value={t.daily_allowance} /></td>
                <td className="px-3 py-2"><StatusChip status={t.status} /></td>
                <td className="px-3 py-2 text-xs text-text-muted">
                  {t.proposed_by && t.proposed_by !== t.decided_by ? `Proposed by ${t.proposed_by}` : ""}
                  {t.proposed_by && t.decided_by && t.proposed_by !== t.decided_by ? " · " : ""}
                  {t.decided_by ? `${t.status === "rejected" ? "Rejected" : "Approved"} by ${t.decided_by}` : ""}
                </td>
                <td className="px-3 py-2">
                  {isOwner && t.status === "proposed" && <DecideButtons id={t.id} />}
                  {isOwner && t.status === "approved" && (
                    <ConfirmDialog trigger="Remove" danger confirmLabel="Remove" action={removeTerms}
                      title={`Remove the rate from ${formatDate(t.effective_from)}?`}
                      body={<>{positionLabel(t.position)}, ₱{(t.daily_rate / 100).toFixed(2)}/day. The previous rate then continues until the next one.
                        It stays in the history as rejected. Rates used in a locked week can&apos;t be removed.</>}>
                      <input type="hidden" name="id" value={t.id} />
                    </ConfirmDialog>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {e.active && <TermsForm employeeId={e.id} position={e.position ?? "mechanic"} dailyRate={e.daily_rate} dailyAllowance={e.daily_allowance} isOwner={isOwner} minDate={minDate} />}
        </div>
      )}
    </>
  );
}
