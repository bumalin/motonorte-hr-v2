"use client";
import { useActionState, useEffect, useRef } from "react";
import { addAdjustment, type JobState } from "./actions.ts";

const input = "mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5";

export function AdjustmentForm({ start, employees, isOwner }: { start: string; employees: { id: string; code: string; name: string }[]; isOwner: boolean }) {
  const [state, action, pending] = useActionState<JobState, FormData>(addAdjustment, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state && !state.error) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-md border border-border bg-surface p-4">
      <h2 className="font-medium">{isOwner ? "Add deduction or back pay" : "Add deduction"}</h2>
      <p className="text-xs text-text-muted">Allowances are a fixed daily rate on each employee&apos;s pay terms and are added automatically.
        {isOwner && " Back pay adds money missed in an already-locked week."}</p>
      <input type="hidden" name="period_start" value={start} />
      <div className="grid grid-cols-6 gap-3">
        <label className="col-span-3 text-sm">Employee
          <select name="employee_id" required defaultValue="" className={input}>
            <option value="" disabled>Choose…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Type
          <select name="type" className={input}>
            <option value="cash_advance">Cash advance</option><option value="clawback">Clawback (comeback)</option>
            <option value="correction">Correction</option><option value="other">Other</option>
            {isOwner && <option value="back_pay">Back pay (adds to pay)</option>}
          </select>
        </label>
        <label className="text-sm">Amount (₱)<input name="amount" required inputMode="decimal" className={input} /></label>
        <label className="text-sm">WO ref<input name="work_order_ref" maxLength={40} className={input} /></label>
        <label className="col-span-6 text-sm">Reason<input name="reason" required maxLength={200} className={input} /></label>
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">{state?.error}</p>
      <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60">
        {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
