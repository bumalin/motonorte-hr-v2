// Turns database errors into plain-language messages for the UI. Unknown errors get a generic message
// (details stay in the server log).

const KNOWN: [RegExp, string][] = [
  [/would alter a locked payroll week|part of locked history/, "That change would alter a locked payroll week. Date it after that week, or add a later row that ends it before the locked week."],
  [/HISTORICAL_CARRY/, "This past week has deductions larger than its pay, and later weeks are already locked, so the balance could never be deducted. Reduce the deductions for this week."],
  [/pay_terms_one_active_per_day/, "That employee already has a rate starting on that date."],
  [/ADDITION_OWNER_ONLY/, "Only the Owner can add back pay; other adjustments are deductions."],
  [/RUN_NOT_LATEST/, "Only the most recent locked week can be reopened."],
  [/RUN_NOT_LOCKED/, "This run isn't locked."],
  [/PERIOD_LOCKED/, "That date is in a payroll week that is submitted or locked. If it's submitted, the Owner can send it back; if it's locked, add an adjustment on a later week."],
  [/NOT_EMPLOYED/, "That date is outside the employee's employment dates."],
  [/JOB_INACTIVE/, "That incentive job is inactive."],
  [/JOB_NO_AMOUNT/, "That incentive job has no amount on this date."],
  [/RUN_LOCKED|RUN_NOT_DRAFT/, "This payroll run can no longer be changed."],
  [/RUN_STALE/, "Attendance or jobs changed since this draft was generated. Regenerate it first."],
  [/EARLIER_RUN_UNLOCKED/, "Lock the earlier weeks first."],
  [/RUN_NOT_LOCKABLE|RUN_NOT_SUBMITTED/, "This run isn't in a state that allows that action."],
  [/NOTE_REQUIRED/, "A note is required."],
  [/LAST_OWNER/, "At least one active owner is required."],
  [/FORBIDDEN|row-level security|permission denied/, "You don't have permission to do that."],
];

export function dbErrorMessage(e: unknown, unique?: string): string {
  const err = e as { code?: string; message?: string };
  if (err?.code === "23505" && unique) return unique;
  const msg = err?.message ?? "";
  for (const [re, text] of KNOWN) if (re.test(msg)) return text;
  console.error(e);
  return "Something went wrong. Please try again.";
}
