# Review: Owner requests 2026-09-27 (b): dark dropdowns, historical payroll, per-user tab access

```json
{"task":"OWNER-REQUEST-2026-09-27b","verdict":"REQUEST_CHANGES","iteration":1,
 "findings":[
  {"severity":"blocker","file":"db/migrations/001_init.sql","line":495,
   "issue":"carried_in_for() was not updated for backdating, so a backfilled week can deduct a carry-over a second time (PR-061, PR-071, PR-072). The function returns the carry_out of the employee's latest locked line before the period. It does not check whether a later locked week has already deducted that balance. Example: W-2 is locked with carry_out ₱250 for S002. W-1 has no run, and W1 is locked with carried_in ₱250, so the balance is already deducted. Now the Owner backfills W-1: carried_in_for(W-1) returns W-2's ₱250 again, and the engine deducts it a second time. HISTORICAL_CARRY only checks the backfilled week's carry_out, not its carried_in. The week locks, and the employee has been underpaid permanently. The adjustments tab (adjustments-tab.tsx:23) shows the same wrong balance. verify.sql does not cover this: its only historical week (2026-09-28) has no locked week before it.",
   "fix_hint":"In migration 009, create or replace carried_in_for so it returns 0 for an employee who has a locked payroll_line in a week after p_period_start. That balance was already deducted by the next locked line, which survives absences as today. Add a verify.sql case: lock a week with carry_out > 0, lock a later week that deducts it, then assert that carried_in_for(a gap week between them) has no row for that employee."},
  {"severity":"major","file":"app/(app)/employees/actions.ts","line":100,
   "issue":"For staff, moving the hire date leaves the pay terms behind without any error. pay_terms_decide RLS (001:609) allows UPDATE for the owner only, so for an HR staff user this statement matches 0 rows and does not error. The employees row still moves. The employee is now 'employed' on days that have no pay terms, and every week covering those days fails generation with NO_PAY_TERMS. This breaks the acceptance item 'the terms row that started at the old hire date moves with it' for the main users of this form. It is also untested: no unit, DB or e2e test covers updateProfile's hire-date move or the terms shift.",
   "fix_hint":"Check the terms update's row count and roll back with a clear message when no row moved. Alternatively, restrict an earlier hire date to the Owner, or make the shift a SECURITY DEFINER function with its own role check. Add a DB or e2e test that asserts both employees.hire_date and the first pay_terms.effective_from after the move, run as both owner and staff."},
  {"severity":"major","file":"db/migrations/009_backdating_and_tab_access.sql","line":52,
   "issue":"After the first lock, the hire-date move required by PR-072 fails for anyone who has been paid, which is the case PR-072 describes. The guard rejects any change whose old span [o, next_o) touches a locked week. When the first terms row moves from o to an earlier d, its old span still covers the employee's locked weeks, so the move is rejected with PERIOD_LOCKED. That is the 'after they've been paid' case PR-072 promises. The values applied to those locked days do not change, but the guard rejects the move anyway. The span check is also not tied to the employee (overlaps_locked looks at every locked run). So a terms row for someone who was not employed in a locked week is still rejected, for example the new [d, o) days of a backfilled hire. This works on the office DB today only because it has no locked runs. The user sees the 'would alter a locked payroll week' message, which does not explain a hire-date edit.",
   "fix_hint":"The simplest correct option: in updateProfile, don't move the row. Insert a copy of the starting terms (same position, rate and allowance, approved) at the new hire date. Its span is only [d, o). In the pay_terms branch of guard_effective_date, count only locked weeks where the employee has a payroll_line (join payroll_lines on employee_id). Then the copy passes because the employee had no lines before o, and genuine rate changes to paid locked weeks are still refused. Add verify.sql cases for both paths."},
  {"severity":"minor","file":"db/tests/verify.sql","line":166,
   "issue":"Only rejections of the new span guard are tested. No case shows that a backdated row which ends before the next locked week is accepted (e.g. a catalog amount dated in a gap week, with a later row that starts before the locked week). If the guard went back to the old 'nothing on or before the last locked day' rule, every test would still pass except the historical-draft ones.",
   "fix_hint":"Add one expect-success case for a gap-week insert whose span stops before a locked week."},
  {"severity":"minor","file":"docs/02-payroll-rules.md","line":107,
   "issue":"PR-072 says 'Weeks are still locked oldest first', but a backfilled week is by definition locked after later weeks. lock_run only orders the runs that exist.",
   "fix_hint":"Reword: 'a week can't be locked while an earlier week has an unlocked run'."},
  {"severity":"minor","file":"app/(app)/settings/page.tsx","line":84,
   "issue":"Remove is still hidden for holidays on or before last_locked_day(). With backdating, the DB (guard_locked_day, per week) allows removing a holiday in an unlocked gap week, but the UI does not offer it.",
   "fix_hint":"Show Remove unless that holiday's own week is submitted or locked (is_period_locked(period_start_of(date)))."},
  {"severity":"minor","file":"db/migrations/003_review_fixes.sql","line":30,
   "issue":"users_after_update ends sessions on password, role or active changes, but not on an email change, which is new in 009. If the Owner reassigns an account by changing its email, the previous holder stays signed in. Throttle history also stays under the old email, but only the Owner can trigger this, so it is not an attack path.",
   "fix_hint":"Add `or new.email is distinct from old.email` to the session-revoke condition in users_after_update (new migration)."},
  {"severity":"minor","file":"app/(app)/settings/forms.tsx","line":102,
   "issue":"The Owner's own row now has a 'New password' field that resets their password without the current password. This bypasses the current-password check in account/actions.ts changePassword, and it signs the Owner out, because users_after_update revokes their own sessions.",
   "fix_hint":"Hide the password field when self is true and point to /account."},
  {"severity":"minor","file":"app/(app)/payroll/page.tsx","line":28,
   "issue":"A staff user with the Payroll tab but not This week can submit runs but can't generate drafts. Generate is only on the week page, which needs the week tab.",
   "fix_hint":"Document it in the Access column help text, or treat week as required for payroll in TabBoxes. Owner decision."}
 ]}
```

## Summary

The authorization side of this change set is sound. `requireTab` is the first statement in every page and Server Action under `app/(app)`, always outside `try`, so `redirect()` is not swallowed. The export route returns 403. `generateDraft` requires `payroll` even when called from the week page. Owner-only actions still use `requireOwner`, and `hasTab` always returns true for owners. `tabsOf` whitelists values against `TAB_KEYS` and the DB CHECK constraint enforces the same. Staff cannot change their own tabs or email, because `users_owner_update` RLS limits updates to owners regardless of the new column grants. Tab changes apply on the next request, because `auth_get_session` reads `tabs` live. `homeFor` cannot loop because `/account` only needs sign-in.

Migration 009 is safe on the office DB, which has one draft run and no locked runs:
- The constant-default column add is metadata-only.
- Existing users default to all tabs.
- The draft is untouched.
- `auth_get_session` is dropped and recreated with its grants restored.

The dark-mode CSS rule is correct and uses variables that exist.

The problems are in backdating money integrity:
- **Blocker:** `carried_in_for` was not made history-aware. A week backfilled between locked weeks deducts a carry-over that a later locked week has already deducted, and once that week is locked the underpayment is permanent.
- **Major:** for HR staff, the hire-date move silently leaves the starting pay terms behind, because RLS makes the update affect 0 rows.
- **Major:** once any week is locked, the new guard refuses the PR-072 hire-date move for every paid employee. It checks the row's whole old span, and it checks against all employees' locked weeks rather than the employee's own.

Neither the carry case nor the hire-date move is tested. Fix the three findings; the minors are optional.

**Contact details:** the Owner asked for them, but it isn't specified what they are (phone? address? on users or on employees?), so this should go back to the Owner as a question rather than be invented. See the suggested tasks.

## Suggested new tasks
- **Owner question:** which "contact details" are needed (e.g. user phone number, or employee phone and address), and on which record? Then add them as a separate task. PII rules apply, and they must not be sent to OpenAI.
- e2e check that a Server Action (e.g. `generateDraft`) redirects or refuses for a user without the tab, not only pages.
- Name the blocking week in the `EARLIER_RUN_UNLOCKED` message, since a forgotten historical draft now blocks locking the current week.

## Hand-off checklist
- [x] Correctness vs Owner requests and PR-061/071/072 checked
- [x] Security: tab guards, RLS reliance, column grants, `withUser()` usage, no OpenAI/PII changes
- [x] Money: carry-over, locked-run immutability, integer centavos (no floats introduced)
- [x] Tests assessed (verify.sql, access.spec.ts)
- [x] Migration safety on the office DB assessed
- [ ] Blocker and majors fixed by developer

---

# Iteration 2

```json
{"task":"OWNER-REQUEST-2026-09-27b","verdict":"APPROVE","iteration":2,
 "findings":[
  {"severity":"minor","file":"db/tests/verify.sql","line":226,
   "issue":"The new 'starting terms copied to an earlier hire date after locks' case does not test the per-employee scoping. Its span [2024-12-02, 2025-01-01) contains no locked week at all, so it would also pass with the old global overlaps_locked guard. Only the reject path of overlaps_locked_for is covered (line 166, a004 into 2026-09-14).",
   "fix_hint":"Add a case where [d, o) contains a locked week in which the employee has no payroll_line, but another employee does. Expect success, and assert that the same insert for an employee who has a line in that week fails."},
  {"severity":"minor","file":"app/(app)/employees/actions.ts","line":100,
   "issue":"The copy takes the earliest non-rejected terms, which can be a still-pending proposal. When the Owner edits the hire date, that proposed rate is inserted as approved for the earlier days, without an explicit decision. Also, if a non-rejected row already exists on the new hire date (possible after an earlier unpaid move later and back), pay_terms_one_active_per_day raises 23505, and isDupCode shows 'That employee code is already used.'",
   "fix_hint":"Copy only from status = 'approved' (fall back to proposed for staff-created, not-yet-approved hires). Skip the insert when a non-rejected row already exists at that date, or map this 23505 to its own message."},
  {"severity":"minor","file":"app/(app)/employees/actions.ts","line":106,
   "issue":"For staff, the hire date is saved immediately, but the starting rate is only proposed. Until the Owner approves it, any week covering the new days fails with NO_PAY_TERMS. If the Owner rejects it, the earlier hire date remains with no rate. This is acceptable and the user sees a note about it, but the Owner's approvals panel does not say the proposal comes from a hire-date change.",
   "fix_hint":"Optional: when rejecting a proposal dated before any approved terms, mention that the hire date may need to be set back."}
 ]}
```

## Iteration 2 summary

All three findings from iteration 1 are fixed.

- **Blocker (double-deducted carry-over) — fixed.** `carried_in_for` (010:7) now drops a balance when the employee has a locked line after the period. That line has already deducted the balance, because the source row is the latest locked line before the period. The existing rule that a balance survives a week the employee is absent is kept. The new verify case (08-03 → 08-17, gap 08-10) would fail if the clause were removed.
- **Major 1 (staff hire-date move) — fixed.** `updateProfile` now inserts a copy of the starting terms instead of updating the row under owner-only RLS. Staff get a proposed row, which the `pay_terms_insert` policy allows, and a visible note. The Owner gets an approved row.
- **Major 2 (guard too broad) — fixed.** The copy's span is only [new hire date, old hire date), and the pay_terms guard now counts only locked weeks with a line for that employee. So the move passes after locks, and a real backdated rate change into the employee's paid locked weeks is still refused (verify line 166). Catalog amounts and settings still use the global guard, which is correct because they affect everyone.

The minors from iteration 1 are addressed:
- PR-072 wording is fixed.
- Holiday Remove now depends on each holiday's own week.
- Changing a user's email now ends their sessions, and this is tested.
- The Owner can no longer reset their own password from the user editor; this is refused in both the UI and the action.

The remaining findings are minor and don't block: the new scoping test doesn't exercise the scoping, and the terms-copy edge cases above. Payroll-without-week access and the contact details remain Owner questions, as listed under Suggested new tasks.

## Hand-off checklist (iteration 2)
- [x] Blocker (carry-over double deduction) verified fixed and tested
- [x] Major 1 (staff hire-date RLS no-op) verified fixed
- [x] Major 2 (guard scope) verified fixed; reject path still tested
- [x] Iteration-1 minors checked
- [ ] Optional minors above (developer's discretion)
- [ ] Owner answers: contact details; payroll-without-week access
