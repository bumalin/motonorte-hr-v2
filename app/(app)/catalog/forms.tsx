"use client";
import { useActionState, useState, useTransition } from "react";
import { addJob, backdateAmounts, changeAmount, setJobActive, setJobEarner, type CatalogState } from "./actions.ts";

const input = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-1.5";
const button = "rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60";

function Status({ state }: { state: CatalogState }) {
  return (
    <>
      <p role="alert" className="text-sm text-danger empty:hidden">{state?.error}</p>
      {state?.ok && <p aria-live="polite" className="text-sm text-success">{state.ok}</p>}
    </>
  );
}

export function AddJobForm({ today, mechanics }: { today: string; mechanics: Mechanic[] }) {
  const [state, action, pending] = useActionState<CatalogState, FormData>(addJob, undefined);
  return (
    <form action={action} className="space-y-3 rounded-md border border-border bg-surface p-4">
      <h2 className="font-medium">Add job</h2>
      <div className="grid grid-cols-4 gap-3">
        <label className="block text-sm">Code<input name="code" required placeholder="TBC" className={input} /></label>
        <label className="col-span-2 block text-sm">Job name<input name="name" required placeholder="Throttle Body Cleaning" className={input} /></label>
        <label className="block text-sm">Amount (₱)<input name="amount" required inputMode="decimal" placeholder="150" className={input} /></label>
        <label className="block text-sm">Effective from<input type="date" name="effective_from" required defaultValue={today} className={input} /></label>
        <div className="col-span-2"><EarnerSelect mechanics={mechanics} /></div>
      </div>
      <Status state={state} />
      <button disabled={pending} className={button}>{pending ? "Adding…" : "Add job"}</button>
    </form>
  );
}

export function ChangeAmountForm({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState<CatalogState, FormData>(changeAmount, undefined);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="job_id" value={jobId} />
      <label className="block text-sm">New amount (₱)<input name="amount" required inputMode="decimal" className={input} /></label>
      <label className="block text-sm">Effective from<input type="date" name="effective_from" required className={input} /></label>
      <button disabled={pending} className={button}>{pending ? "Saving…" : "Change amount"}</button>
      <div className="w-full"><Status state={state} /></div>
    </form>
  );
}

export function JobActiveButton({ jobId, active }: { jobId: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <p className="mt-3">
      <button type="button" disabled={pending} className="text-sm text-brand-700 hover:underline disabled:opacity-60"
        onClick={() => start(async () => setError((await setJobActive(jobId, !active)) ?? undefined))}>
        {active ? "Deactivate job" : "Activate job"}
      </button>
      {error && <span role="alert" className="ml-2 text-sm text-danger">{error}</span>}
    </p>
  );
}

/** Owner: make each job's first amount also apply from an earlier date (for entering past weeks). */
export function BackdateAmountsForm() {
  const [state, action, pending] = useActionState<CatalogState, FormData>(backdateAmounts, undefined);
  return (
    <form action={action} className="space-y-2 rounded-md border border-border bg-surface p-4">
      <h2 className="font-medium">Use these amounts for earlier weeks</h2>
      <p className="text-xs text-text-muted">Jobs can only be logged on days that have an amount. Pick the first day you&apos;ll enter
        past payroll for; each job&apos;s starting amount will also apply from that date. Later amount changes stay as they are.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Apply from<input type="date" name="from" required className={input} /></label>
        <button disabled={pending} className={button}>Apply</button>
      </div>
      <Status state={state} />
    </form>
  );
}

type Mechanic = { id: string; label: string };

/** "Who earns it": the shared pool, or one specific mechanic (PR-055). */
function EarnerSelect({ mechanics, value, label = "Who earns it" }: { mechanics: Mechanic[]; value?: string | null; label?: string }) {
  return (
    <label className="block text-sm">{label}
      <select name="specialist_id" defaultValue={value ?? ""} className={input}>
        <option value="">Shared pool (full-day mechanics)</option>
        {mechanics.map((m) => <option key={m.id} value={m.id}>Only {m.label}</option>)}
      </select>
    </label>
  );
}

export function EarnerForm({ jobId, mechanics, value }: { jobId: string; mechanics: Mechanic[]; value: string | null }) {
  const [state, action, pending] = useActionState<CatalogState, FormData>(setJobEarner, undefined);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="job_id" value={jobId} />
      <div className="w-72"><EarnerSelect mechanics={mechanics} value={value} /></div>
      <button disabled={pending} className={button}>Save</button>
      <Status state={state} />
    </form>
  );
}
