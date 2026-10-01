"use client";
import { POSITIONS } from "@/lib/format.ts";
import { useActionState } from "react";
import { createEmployee, updateProfile, type FormState } from "./actions.ts";

type Values = Record<string, string>;
const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const input = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-1.5";

/** Field-level error under the input, wired with aria-invalid / aria-describedby (UX §7). */
function FieldError({ name, errors }: { name: string; errors?: Values }) {
  return errors?.[name] ? <span id={`${name}-error`} className="mt-0.5 block text-xs text-danger">{errors[name]}</span> : null;
}
const aria = (name: string, errors?: Values) =>
  errors?.[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};

function Field({ name, label, v, errors, type = "text", required = false, hint }:
  { name: string; label: string; v: Values; errors?: Values; type?: string; required?: boolean; hint?: string }) {
  return (
    <label className="block text-sm">{label}{required && <span className="text-danger"> *</span>}
      <input name={name} type={type} defaultValue={v[name] ?? ""} required={required} className={input} {...aria(name, errors)} />
      {hint && <span className="mt-0.5 block text-xs text-text-muted">{hint}</span>}
      <FieldError name={name} errors={errors} />
    </label>
  );
}

/** mode "new": profile + gov't/bank + first pay terms (US-001). mode "edit": profile only. */
export function EmployeeForm({ mode, initial, isOwner }: { mode: "new" | "edit"; initial: Values; isOwner: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mode === "new" ? createEmployee : updateProfile, undefined);
  const v = state?.fields ?? initial;
  const fe = state?.fieldErrors;
  return (
    <form action={action} className="max-w-2xl space-y-6">
      {mode === "edit" && <input type="hidden" name="id" value={initial.id} />}
      <fieldset className="grid grid-cols-2 gap-4">
        <legend className="mb-2 font-medium">Profile</legend>
        <Field name="code" label="Employee code" v={v} errors={fe} required hint="e.g. M004 for a mechanic" />
        <Field name="full_name" label="Full name" v={v} errors={fe} required />
        <label className="block text-sm">Usual rest day<span className="text-danger"> *</span>
          <select name="rest_day" defaultValue={v.rest_day ?? "sun"} className={input} {...aria("rest_day", fe)}>
            {DAYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="mt-1 block text-xs text-text-muted">Default for “Fill empty cells”. R can still be marked on any day.</span>
          <FieldError name="rest_day" errors={fe} />
        </label>
        <Field name="hire_date" label="Hire date" v={v} errors={fe} type="date" required />
      </fieldset>

      {mode === "new" && (
        <>
          <fieldset className="grid grid-cols-2 gap-4">
            <legend className="mb-2 font-medium">Position & pay</legend>
            <label className="block text-sm">Position<span className="text-danger"> *</span>
              <select name="position" defaultValue={v.position ?? "mechanic"} className={input} {...aria("position", fe)}>
                {POSITIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <FieldError name="position" errors={fe} />
            </label>
            <Field name="daily_rate" label="Daily rate (₱)" v={v} errors={fe} required
              hint={isOwner ? "Active from the hire date" : "Will be sent to the Owner for approval"} />
            <Field name="daily_allowance" label="Daily allowance (₱)" v={v} errors={fe}
              hint="Paid per day worked: full day = full, half day = half. Leave blank for none." />
          </fieldset>
          <fieldset className="grid grid-cols-2 gap-4">
            <legend className="mb-2 font-medium">Government & bank</legend>
            <Field name="tin" label="TIN" v={v} errors={fe} />
            <Field name="sss_no" label="SSS no." v={v} errors={fe} />
            <Field name="philhealth_no" label="PhilHealth no." v={v} errors={fe} />
            <Field name="pagibig_no" label="Pag-IBIG no." v={v} errors={fe} />
            <Field name="bank_name" label="Bank" v={{ bank_name: "RCBC", ...v }} errors={fe} />
            <Field name="bank_account_no" label="Account no." v={v} errors={fe} />
          </fieldset>
        </>
      )}

      <p role="alert" className="text-sm text-danger empty:hidden">{state?.error ?? (fe ? "Please fix the highlighted fields." : "")}</p>
      {mode === "edit" && state?.ok && <p aria-live="polite" className="text-sm text-success">{state.note ?? "Saved ✓"}</p>}
      <button disabled={pending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60">
        {pending ? "Saving…" : mode === "new" ? "Create employee" : "Save profile"}
      </button>
    </form>
  );
}
