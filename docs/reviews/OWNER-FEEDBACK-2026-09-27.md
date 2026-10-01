# Review — Owner feedback change set (2026-09-27)

```json
{"task":"OWNER-FEEDBACK-2026-09-27","verdict":"REQUEST_CHANGES","iteration":1,
 "findings":[
  {"severity":"major","file":"app/(app)/employees/[id]/terms-form.tsx","line":25,
   "issue":"The daily-allowance input starts empty, and a blank value is saved as 0 (terms-actions.ts Change.daily_allowance). Because PR-020 makes rate and allowance one effective-dated row, any routine rate or position change where HR does not retype the allowance quietly sets the employee's allowance to ₱0 from that date. The Owner will not see this: approvals-panel.tsx:46 only shows the allowance when it is > 0, so a dropped allowance looks the same as 'no allowance'. The daily-rate field also starts empty, but if a rate is missing the form is rejected. If an allowance is missing, the employee is silently underpaid.",
   "fix_hint":"Pass the current allowance (and rate) from [id]/page.tsx into TermsForm as defaultValue. Also show the allowance in the approvals panel even when it is ₱0 or changed, e.g. '+ ₱0 allowance (was ₱80)'. At minimum, always render the allowance there."},
  {"severity":"major","file":"fixtures/payroll/weekly.json","line":224,
   "issue":"PR-062 says the allowance is 'not multiplied by rest-day or holiday multipliers', but no test fails if the engine multiplies it. F24–F26 have no holidays and use the default rest_day_worked_multiplier of 1.00. So changing engine.ts:126 to divRound(allowance*mNum, M) would still pass 52/52. Half-up rounding for H is also untested, because every H case uses an even allowance (10000/2).",
   "fix_hint":"Add one case to engine.rules.test.ts (no Owner sign-off needed) or a fixture F27 for the Owner to approve. It should have an F on a holiday (holiday_worked 2.00), an F on the usual rest day with rest_day_worked set above 1.00, and an H with an odd allowance (e.g. 5001 → 2501). Assert that allowances ignore both multipliers."},
  {"severity":"major","file":"lib/db/loadPeriodInput.test.ts","line":29,
   "issue":"The only thing that carries pay_terms.daily_allowance into the engine is the json_build_object in loadPeriodInput.ts:48, and nothing tests it. The fixtures skip the loader, the DB test inserts terms without an allowance, and the e2e flow uses ₱0 allowances. If that key were dropped or misspelled, the engine would default to 0 and every allowance would silently become ₱0 while CI stays green.",
   "fix_hint":"In the existing loader round-trip test, give one pay_terms insert a daily_allowance (e.g. 5000) and assert the expected line.allowances."},
  {"severity":"minor","file":"app/(app)/week/[start]/actions.ts","line":2,
   "issue":"The header comment still says rest days are 'enforced by DB triggers', and the docstring at line 122 still says 'Allowance / deduction / clawback'. Neither is true after PR-022/PR-060.",
   "fix_hint":"Update both comments."},
  {"severity":"minor","file":"app/(app)/week/[start]/actions.ts","line":110,
   "issue":"'Deductions only' is enforced in the server action alone. The DB still accepts new kind='allowance' rows (adj_kind_t, and RLS allows insert). It's acceptable because the action is the only write path, but it is weaker than the repo's usual 'DB enforces too' pattern.",
   "fix_hint":"Optional: add a new-rows-only constraint or trigger in a later migration (see suggested tasks)."},
  {"severity":"minor","file":"app/(app)/employees/actions.ts","line":38,
   "issue":"The daily_allowance zod transform is copied word for word in terms-actions.ts:23. The daily_rate copy is the same pre-existing pattern.",
   "fix_hint":"Optional: export one `pesosField` helper and use it in both places."},
  {"severity":"minor","file":"docs/04-ux-spec.md","line":128,
   "issue":"The spec still lists Kind 'Allowance' and the Meal/Transport types for new adjustments, and docs/06-task-queue.md:67 still lists INVALID_REST_DAY as an acceptance item. docs/07-test-report.md:43 cites the removed 'R only on the designated rest day' check, which is historical but now misleading.",
   "fix_hint":"Amend these doc lines, or add a note pointing to PR-022/060/062."},
  {"severity":"minor","file":"lib/payroll/hash.ts","line":14,
   "issue":"The input hash now includes dailyAllowance (0 for existing terms). After deploy, any draft or submitted run is shown as stale and lock_run fails with RUN_STALE. That is correct behaviour, but the Owner will need to send back and regenerate any week that is in flight during the upgrade. Locked runs are not affected.",
   "fix_hint":"Add one line to the release notes or runbook: lock or regenerate in-flight weeks around the upgrade."}
 ]}
```

## Summary

The change set is mostly correct and safe, but three money-path gaps block approval.

**What's correct**
- The engine applies PR-062 as written: F pays the full allowance, H pays a half-up half, and A/R pay nothing. The allowance is never multiplied, and `basic` (and therefore the 13th month, PR-080) is untouched. Integer centavos are used throughout.
- Rest days are handled correctly. Removing both the INVALID_REST_DAY trigger and the engine check matches PR-022, and the usual rest day still drives the PR-030 multiplier and the fill-empty default (PR-021).

**Incentive logic (Owner request 4)**
- `splitPool`, `dayPool`, `eligibleMechanics` and the pool loop are byte-for-byte the same as the 2026-09-26 baseline in the local Claude Code edit history (this folder is not a git repo, so git history was not available).
- The only engine differences are the removed rest-day check and the new allowance block. R was never eligible for the pool, so eligibility is unchanged.

**Migration 008 on an existing database**
- `ADD COLUMN ... NOT NULL DEFAULT 0` is metadata-only, and existing pay is unchanged until the Owner sets allowances.
- The view appends its new column last, and `employees` has had no new columns since 001, so `CREATE OR REPLACE VIEW` is valid.
- The trigger function is replaced in place, and locked runs are not touched.

**Security**
- Nothing new sends data to OpenAI, and all queries still go through `withUser()`.
- The `mn_theme` cookie is only ever read as `light` or `dark`.
- The proxy matcher now skips only `/brand/*`. No route lives under `/brand`, and every page still calls `requireUser()`, so nothing is exposed beyond the logo.
- The SVG has no script, event handlers, `foreignObject` or external references. It loads through `<img>` under nosniff and the CSP.

**Blockers (all major)**
1. The terms form saves a blank allowance as ₱0, so HR can silently remove an employee's allowance while changing the rate, and the approvals panel hides it.
2. No test checks that the allowance is never multiplied, or the half-up rounding for H.
3. No test covers the loader passing `daily_allowance` from the database to the engine.

## Suggested new tasks
- DB guard: a trigger that rejects INSERTs of `adjustments.kind = 'allowance'`. Legacy rows stay valid.
- Dashboard payroll chart: add an Allowances series, since allowances are now a recurring daily part of gross pay.

## Hand-off checklist
- [x] Correctness vs PR-020/021/022/060/062/080 checked
- [x] Incentive code compared against the pre-change baseline (unchanged)
- [x] Security: cookie, proxy matcher, SVG, RLS/withUser, OpenAI
- [x] Migration 008 safety on existing data
- [x] Leftover allowance-adjustment / fixed-rest-day references listed
- [ ] Majors 1–3 resolved (developer)

---

# Iteration 2 — re-review

```json
{"task":"OWNER-FEEDBACK-2026-09-27","verdict":"APPROVE","iteration":2,
 "findings":[
  {"severity":"minor","file":"app/(app)/employees/[id]/page.tsx","line":25,
   "issue":"The pre-fill comes from v_employee_current, which holds the terms in effect today. If an approved change is already dated in the future, the form pre-fills today's values instead. The approvals panel now always shows the allowance, so the Owner still sees exactly what is being approved.",
   "fix_hint":"None needed now. Revisit only if future-dated changes become common."}
 ]}
```

## Iteration 2 summary

All three majors from iteration 1 are fixed and verified.

1. **Terms form.** `terms-form.tsx` now pre-fills both the daily rate and the allowance from `v_employee_current`, passed in from `[id]/page.tsx:108`. `approvals-panel.tsx:46` shows "+ ₱X allowance" unconditionally, including ₱0.00, so a dropped allowance is visible to the Owner.
2. **Engine test.** `engine.test.ts:98` gives all six F days an allowance of 5001, including Monday as a holiday (×2.00) and the usual rest day Sunday (×1.30). The one H day must pay 2501 (2500.5 rounded half-up). The test asserts 6×5001 + 2501. It fails if the allowance is multiplied on either day or if H rounds down, so it covers the mutation I raised.
3. **Loader test.** `loadPeriodInput.test.ts` now inserts `daily_allowance` through `mk()`, and ZZM003 expects allowances 30000 (6 × ₱50) and net 410000 (360000 + 20000 + 30000). The arithmetic is correct, and the test fails if the loader drops the key.

**Minor fixes confirmed:**
- The comments in `week/[start]/actions.ts` (lines 2 and 122) are corrected.
- `INVALID_REST_DAY` no longer appears in `app/`, `lib/`, `components/`, `tests/`, the UX spec or the task queue.
- `07-test-report.md` and `runbook-office.md` §154 carry the stale-draft note.

**Deferrals accepted.** The DB guard against new allowance rows, the shared zod helper and the chart series remain suggested new tasks.

**No regressions.** Incentive code, migration 008 and the security surface are unchanged since iteration 1.

## Hand-off checklist (iteration 2)
- [x] Majors 1–3 verified fixed
- [x] Minors verified or accepted as deferred
- [x] No new blocker/major
- [x] Verdict: APPROVE
