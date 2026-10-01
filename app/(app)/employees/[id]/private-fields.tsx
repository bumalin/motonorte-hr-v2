"use client";
import { useActionState, useState, useTransition } from "react";
import { revealField, updatePrivate, type FormState } from "../actions.ts";

const LABELS: [string, string][] = [
  ["tin", "TIN"], ["sss_no", "SSS no."], ["philhealth_no", "PhilHealth no."], ["pagibig_no", "Pag-IBIG no."], ["bank_account_no", "Account no."],
];

/** Values arrive masked from the server; "Show" fetches one value and writes a REVEAL audit entry. */
export function PrivateFields({ id, masked, bankName }: { id: string; masked: Record<string, string | null>; bankName: string }) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [state, action, saving] = useActionState<FormState, FormData>(updatePrivate, undefined);
  return (
    <div className="max-w-2xl space-y-6">
      <dl className="grid grid-cols-[10rem_1fr_auto] items-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface p-4 text-sm">
        <dt className="text-text-muted">Bank</dt><dd className="col-span-2">{bankName}</dd>
        {LABELS.map(([k, label]) => (
          <div key={k} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd className="font-mono">{shown[k] ?? masked[k] ?? "—"}</dd>
            <dd>{masked[k] && !(k in shown) && (
              <button type="button" disabled={pending} aria-label={`Show ${label}`}
                onClick={() => start(async () => { const v = await revealField(id, k); setShown((s) => ({ ...s, [k]: v })); })}
                className="text-sm text-brand-700 hover:underline disabled:opacity-60">Show</button>
            )}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-muted">Each “Show” is recorded in the audit log.</p>

      <form action={action} className="space-y-3">
        <h2 className="font-medium">Update details</h2>
        <p className="text-xs text-text-muted">Only fields you fill in are changed.</p>
        <input type="hidden" name="id" value={id} />
        <div className="grid grid-cols-2 gap-4">
          {[["bank_name", "Bank"], ...LABELS].map(([k, label]) => (
            <label key={k} className="block text-sm">{label}
              <input name={k} autoComplete="off" className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-1.5" />
            </label>
          ))}
        </div>
        <p role="alert" className="text-sm text-danger empty:hidden">
          {state?.error ?? Object.entries(state?.fieldErrors ?? {}).map(([k, m]) => `${LABELS.find(([f]) => f === k)?.[1] ?? "Bank"}: ${m}`).join(" · ")}
        </p>
        {state?.ok && <p aria-live="polite" className="text-sm text-success">Saved ✓</p>}
        <button disabled={saving} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:opacity-60">
          {saving ? "Saving…" : "Save details"}
        </button>
      </form>
    </div>
  );
}
