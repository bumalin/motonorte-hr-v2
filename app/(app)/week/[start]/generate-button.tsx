"use client";
// Generate payroll draft; on engine errors, list each one with a link to the exact place to fix it (UX S-08 error state).
import Link from "next/link";
import { useActionState } from "react";
import { generateDraft, type GenerateState } from "../../payroll/actions.ts";
import type { PayrollError } from "@/lib/payroll/types.ts";
import { formatDay } from "@/lib/format.ts";

const TEXT: Record<string, string> = {
  MISSING_ATTENDANCE: "Missing attendance",
  INVALID_OT: "Overtime on a day that isn't a full day",
  NO_ELIGIBLE_MECHANIC: "Incentive jobs logged but no full-day mechanic",
  NOT_EMPLOYED: "Attendance outside employment dates",
  NO_PAY_TERMS: "No approved daily rate",
  UNKNOWN_JOB: "Incentive job with no amount on that date",
  NO_SETTINGS: "No pay settings in effect",
  INVALID_SPECIALIST: "Job credited to a mechanic not employed that day",
};

function fixLink(e: PayrollError, start: string) {
  if (e.code === "NO_ELIGIBLE_MECHANIC" || e.code === "UNKNOWN_JOB" || e.code === "INVALID_SPECIALIST") return `/week/${start}?tab=jobs&day=${e.date}`;
  if (e.code === "NO_PAY_TERMS" && e.employeeId) return `/employees/${e.employeeId}?tab=terms`;
  if (e.code === "NO_SETTINGS") return "/settings";
  return e.employeeId ? `/week/${start}?tab=attendance&focus=${encodeURIComponent(`${e.employeeId}|${e.date}`)}` : `/week/${start}?tab=attendance`;
}

export function GenerateButton({ start, disabledReason }: { start: string; disabledReason?: string }) {
  const [state, action, pending] = useActionState<GenerateState, FormData>(generateDraft, undefined);
  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="period_start" value={start} />
        <button disabled={pending || !!disabledReason} title={disabledReason}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:brightness-90 disabled:opacity-50">
          {pending ? "Generating…" : "Generate payroll draft"}
        </button>
        {disabledReason && <span className="ml-3 text-xs text-text-muted">{disabledReason}</span>}
      </form>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.errors && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm">
          <p className="mb-2 font-medium text-danger">Payroll can&apos;t be generated yet — fix these first ({state.errors.length}):</p>
          <ul className="space-y-1">
            {state.errors.map((e, i) => (
              <li key={i}>
                {TEXT[e.code] ?? e.code}: {e.employeeCode ? `${e.employeeCode} on ` : ""}{formatDay(e.date)}{" "}
                <Link href={fixLink(e, start)} className="font-medium text-brand-700 hover:underline">Fix →</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
