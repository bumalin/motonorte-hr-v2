"use client";
import { POSITIONS } from "@/lib/format.ts";
import { useActionState } from "react";
import { addTermsChange, type TermsState } from "../terms-actions.ts";

const input = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-1.5";

const pesos = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));

// Rate and allowance are one dated row (PR-020): pre-fill both so changing one never silently resets the other.
export function TermsForm({ employeeId, position, dailyRate, dailyAllowance, isOwner, minDate }: {
  employeeId: string; position: string; dailyRate: number | null; dailyAllowance: number | null; isOwner: boolean; minDate: string;
}) {
  const [state, action, pending] = useActionState<TermsState, FormData>(addTermsChange, undefined);
  return (
    <form action={action} className="max-w-2xl space-y-3 rounded-md border border-border bg-surface p-4">
      <h2 className="font-medium">Add change</h2>
      <input type="hidden" name="employee_id" value={employeeId} />
      <div className="grid grid-cols-4 gap-4">
        <label className="block text-sm">Effective from
          <input type="date" name="effective_from" required min={minDate} className={input} />
        </label>
        <label className="block text-sm">Position
          <select name="position" defaultValue={position} className={input}>
            {POSITIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="block text-sm">Daily rate (₱)
          <input name="daily_rate" required inputMode="decimal" defaultValue={pesos(dailyRate)} className={input} />
        </label>
        <label className="block text-sm">Daily allowance (₱)
          <input name="daily_allowance" inputMode="decimal" placeholder="0" defaultValue={pesos(dailyAllowance)} className={input} />
        </label>
      </div>
      {!isOwner && <p className="text-xs text-text-muted">Will be sent to the Owner for approval.</p>}
      <p role="alert" className="text-sm text-danger empty:hidden">{state?.error}</p>
      {state?.ok && <p aria-live="polite" className="text-sm text-success">{state.ok}</p>}
      <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60">
        {pending ? "Saving…" : isOwner ? "Save change" : "Propose change"}
      </button>
    </form>
  );
}
