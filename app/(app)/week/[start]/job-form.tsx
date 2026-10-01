"use client";
import { useActionState, useEffect, useRef } from "react";
import { addJobEntry, type JobState } from "./actions.ts";

const input = "mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5";

export function AddJobEntryForm({ day, jobs }: { day: string; jobs: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<JobState, FormData>(addJobEntry, undefined);
  const ref = useRef<HTMLFormElement>(null);
  // Clear the row after a successful add so the next job can be typed straight away
  useEffect(() => { if (state && !state.error) { ref.current?.reset(); ref.current?.querySelector("select")?.focus(); } }, [state]);
  if (jobs.length === 0) return <p className="text-sm text-text-muted">No active incentive jobs have an amount on this date. Add them under Incentive jobs.</p>;
  return (
    <form ref={ref} action={action} className="grid grid-cols-[2fr_5rem_1fr_1fr_auto] items-end gap-3 rounded-md border border-border bg-surface p-3">
      <input type="hidden" name="date" value={day} />
      <label className="text-sm">Job<select name="job_id" required className={input}>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label>
      <label className="text-sm">Qty<input name="qty" type="number" min={1} max={100} defaultValue={1} required className={input} /></label>
      <label className="text-sm">WO ref<input name="work_order_ref" maxLength={40} className={input} /></label>
      <label className="text-sm">Plate<input name="plate_no" maxLength={20} className={input} /></label>
      <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60">Add</button>
      <p role="alert" className="col-span-5 text-sm text-danger empty:hidden">{state?.error}</p>
    </form>
  );
}
