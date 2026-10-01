import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTab } from "@/lib/auth/session.ts";
import { withUser } from "@/lib/db/client.ts";
import { currentRunHash } from "@/lib/db/runs.ts";
import { addDays, formatDate, formatMoney, formatWeek, positionLabel } from "@/lib/format.ts";
import { Money, StatusChip } from "@/components/ui.tsx";
import { ConfirmDialog } from "@/components/confirm-dialog.tsx";
import { DrillCell, type DrillItem } from "./drill-cell.tsx";
import { describeItem as describe, type RunItem as Item } from "@/lib/payroll/describe.ts";
import { lockRun, sendBackRun, submitRun, unlockRun } from "../actions.ts";

// S-08 Run review — US-030..032
type Run = { id: string; period_start: string; status: string; input_hash: string; generated_at: Date; generated_by: string | null;
  sent_back_note: string | null; locked_at: Date | null; locked_by: string | null; latest: boolean };
type Line = { employee_id: string; code: string; full_name: string; position: string | null; base: number; ot: number; incentive: number;
  allowances: number; deductions: number; carried_in: number; gross: number; net: number; carry_out: number };

export default async function RunPage({ params }: PageProps<"/payroll/[runId]">) {
  const user = await requireTab("payroll");
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(runId)) notFound();
  const data = await withUser(user.id, async (tx) => {
    const [run] = await tx<Run[]>`
      select r.id, r.period_start::text, r.status, r.input_hash, r.generated_at, user_name(r.generated_by) as generated_by,
        r.sent_back_note, r.locked_at, user_name(r.locked_by) as locked_by,
        not exists (select 1 from payroll_runs x where x.status = 'locked' and x.period_start > r.period_start) as latest
      from payroll_runs r where r.id = ${runId}`;
    if (!run) return null;
    const lines = await tx<Line[]>`
      select l.employee_id, e.code, e.full_name, (select t.position from pay_terms t where t.employee_id = e.id and t.status = 'approved' and t.effective_from <= r.period_start + 6 order by t.effective_from desc limit 1) as position, l.base, l.ot, l.incentive, l.allowances, l.deductions,
        l.carried_in, l.gross, l.net, l.carry_out
      from payroll_lines l join employees e on e.id = l.employee_id join payroll_runs r on r.id = l.run_id
      where l.run_id = ${runId} order by e.code`;
    const items = await tx<Item[]>`select employee_id, date::text, kind, amount, rule_id, source from payroll_items where run_id = ${runId} order by date nulls last, id`;
    return { run, lines, items };
  });
  if (!data) notFound();
  const { run, lines, items } = data;
  const isOwner = user.role === "owner";
  const stale = run.status !== "locked" && (await currentRunHash(user.id, run.id))?.hash !== run.input_hash;

  const itemsFor = (emp: string, kind: string): DrillItem[] =>
    items.filter((i) => i.employee_id === emp && i.kind === kind).map((i) => ({ text: describe(i), amount: i.amount, rule: i.rule_id }));
  const days = (emp: string) => {
    const b = items.filter((i) => i.employee_id === emp && i.kind === "base");
    const f = b.filter((i) => i.source.status === "F").length, h = b.filter((i) => i.source.status === "H").length;
    return h ? `${f} full + ${h} half` : `${f} full`;
  };
  const sum = (k: keyof Line) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const cols: [keyof Line, string, string, boolean?][] = [
    ["base", "Base", "base"], ["ot", "OT", "ot"], ["incentive", "Incentive", "incentive"], ["allowances", "Allowances", "allowance"],
    ["deductions", "Deductions", "deduction", true], ["carried_in", "Carried in", "carried_in", true],
  ];
  const hidden = <input type="hidden" name="run_id" value={run.id} />;

  return (
    <>
      <Link href="/payroll" className="text-sm text-brand-700 hover:underline">← Payroll</Link>
      <div className="mb-2 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Payroll {formatWeek(run.period_start)}</h1>
        <StatusChip status={run.status} />
        <Link href={`/week/${run.period_start}`} className="text-sm text-brand-700 hover:underline">Open week →</Link>
      </div>
      <p className="mb-4 text-xs text-text-muted">
        Generated {run.generated_at.toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by {run.generated_by ?? "—"}
        {run.locked_at && ` · Locked ${run.locked_at.toLocaleString("en-PH", { timeZone: "Asia/Manila" })} by ${run.locked_by}`}
      </p>

      {run.sent_back_note && run.status === "draft" && (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/5 px-4 py-2 text-sm">{run.sent_back_note.startsWith("Reopened") ? null : <strong>Sent back by the Owner: </strong>}{run.sent_back_note}</p>
      )}
      {stale && (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          Attendance, jobs, adjustments or rates changed since this draft was generated. <Link href={`/week/${run.period_start}`} className="font-medium underline">Regenerate it</Link> before submitting.
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {run.status === "draft" && !stale && (
          <ConfirmDialog trigger="Submit for approval" title="Submit for approval?" confirmLabel="Submit" action={submitRun}
            body={`${lines.length} employees · Net ${formatMoney(sum("net"))}. The Owner will review and lock it.`}>{hidden}</ConfirmDialog>
        )}
        {run.status === "submitted" && isOwner && (
          <>
            {!stale && (
              <ConfirmDialog trigger="Approve & lock" title={`Lock payroll ${formatWeek(run.period_start)}?`} confirmLabel="Approve & lock" action={lockRun}
                body={<><strong>{lines.length} employees · Net {formatMoney(sum("net"))}.</strong> Only the latest locked week can be reopened later; other corrections go in as adjustments on a later week.</>}>{hidden}</ConfirmDialog>
            )}
            <ConfirmDialog trigger="Send back" title="Send back to staff?" confirmLabel="Send back" danger action={sendBackRun} body="Tell them what to fix.">
              {hidden}
              <label className="block text-sm">Note<textarea name="note" required rows={3} className="mt-1 block w-full rounded-md border border-border px-3 py-2" /></label>
            </ConfirmDialog>
          </>
        )}
        {run.status === "submitted" && !isOwner && <p className="text-sm text-text-muted">Waiting for the Owner&apos;s approval.</p>}
        {run.status === "locked" && isOwner && run.latest && (
          <ConfirmDialog trigger="Reopen week" danger title={`Reopen payroll ${formatWeek(run.period_start)}?`} confirmLabel="Reopen" action={unlockRun}
            body={<>It goes back to draft so attendance, jobs and adjustments can be fixed; then regenerate, submit and lock it again.
              If it was already paid through the bank, pay any difference separately. The reason is kept in the audit log.</>}>
            {hidden}
            <label className="block text-sm">Reason<textarea name="note" required rows={3} className="mt-1 block w-full rounded-md border border-border px-3 py-2" /></label>
          </ConfirmDialog>
        )}
        {run.status === "locked" && (
          <Link href={`/payroll/${run.id}/payslips`} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90">Payslips</Link>
        )}
      </div>

      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm md:grid-cols-6">
        {[["Employees", String(lines.length)], ["Gross", formatMoney(sum("gross"))], ["Deductions", formatMoney(sum("deductions") + sum("carried_in"))],
          ["Net", formatMoney(sum("net"))], ["Incentive pool", formatMoney(sum("incentive"))], ["Carry-out", formatMoney(sum("carry_out"))]].map(([k, v]) => (
          <div key={k} className="rounded-md border border-border bg-surface p-3"><dt className="text-xs text-text-muted">{k}</dt><dd className="tabular text-lg font-medium">{v}</dd></div>
        ))}
      </dl>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="sticky top-0 bg-surface-2 text-text-muted">
            <tr>
              {["Employee", "Position", "Days"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}
              {[...cols.map((c) => c[1]), "Gross", "Net", "Carry out"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.employee_id} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal"><span className="font-mono">{l.code}</span> · {l.full_name}</th>
                <td className="px-3 py-2">{positionLabel(l.position)}</td>
                <td className="px-3 py-2">{days(l.employee_id)}</td>
                {cols.map(([k, label, kind, neg]) => (
                  <td key={k} className="px-3 py-2 text-right">
                    <DrillCell value={l[k] as number} negative={neg} label={`${label} for ${l.code}`} items={itemsFor(l.employee_id, kind)} />
                  </td>
                ))}
                <td className="px-3 py-2 text-right"><Money value={l.gross} /></td>
                <td className="px-3 py-2 text-right font-semibold"><Money value={l.net} /></td>
                <td className="px-3 py-2 text-right">{l.carry_out ? <Money value={l.carry_out} className="text-warning" /> : <span className="text-text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border bg-surface-2 font-medium">
            <tr>
              <th scope="row" colSpan={3} className="px-3 py-2 text-left">Total</th>
              {cols.map(([k, , , neg]) => <td key={k} className="px-3 py-2 text-right"><Money value={neg ? -sum(k) : sum(k)} /></td>)}
              <td className="px-3 py-2 text-right"><Money value={sum("gross")} /></td>
              <td className="px-3 py-2 text-right"><Money value={sum("net")} /></td>
              <td className="px-3 py-2 text-right"><Money value={sum("carry_out")} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-text-muted">Payday {formatDate(addDays(run.period_start, 6))}. Click any amount to see how it was calculated.</p>
    </>
  );
}
