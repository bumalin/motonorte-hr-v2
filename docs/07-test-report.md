> Note: QA bug IDs renumbered TASK-024/025 → TASK-026/027 (the security audit filed TASK-024/025 concurrently).

# Test Report — Motonorte HR & Payroll (Phase 4)

Status: **v1** · Owner agent: qa-tester · Date: 2026-09-26
Inputs: `01-prd.md` v2, `02-payroll-rules.md` v1, `04-ux-spec.md` v1, `06-task-queue.md`, `docs/reviews/*`, `fixtures/payroll/*.json`, the running app
Outputs: `tests/e2e/*` (Playwright), `playwright.config.ts`, `npm run test:e2e`, this report, TASK-026 and TASK-027 in `06-task-queue.md`

## Summary

| Suite | Command | Result |
|---|---|---|
| Unit + fixtures + DB integration | `npm test` | **49 / 49 pass**: all 24 Owner-approved fixtures (F01–F23, T01), 2 DB integration tests |
| DB checks (RLS, triggers, functions; rolled back) | `npm run db:verify` | **67 / 67 PASS**, `ALL CHECKS PASSED` |
| End to end (Edge, e2e DB, production build) | `npm run test:e2e` | **23 / 24 pass, 1 fail** (E2E-RUN-06 → TASK-026) |
| Lint / typecheck | `npm run lint`, `npm run typecheck` | clean, including the new test files |

- **Must stories:** 17 in total. 16 are testable (US-035 is BLOCKED). All 16 are covered; **15 pass and 1 fails** (US-032, Owner approve & lock).
- **Bugs:** 2 found: TASK-026 (Critical) and TASK-027 (Minor).
- **Parallel run:** not possible yet, because there's no real past payroll. The substitute is described in §4.

The final e2e suite was run 3 times back to back, each from a fresh reset. The same single test failed each time, and nothing was flaky.

## 1. Traceability matrix

Test ID key:
- **E2E-*** tests are in `tests/e2e/auth.spec.ts` and `tests/e2e/payroll-cycle.spec.ts`.
- **F##/T01** are fixture cases run by `lib/payroll/engine.test.ts`.
- **ENG-R** means `lib/payroll/engine.rules.test.ts`.
- **INT-F07** means `lib/db/loadPeriodInput.test.ts`, and **INT-REP** means `lib/db/reports.db.test.ts`.
- **AUTH-U** means `lib/auth/auth.test.ts`, and **HASH** means `lib/payroll/hash.test.ts`.
- **V:"…"** is a check label in `db/tests/verify.sql`.

### Must

| Story | Tests | Result |
|---|---|---|
| **US-001** Create employee | E2E-EMP-01 (create; an invalid rate gives a field error and saves nothing, checked in the DB; the employee appears in the list), E2E-AUD-01 (INSERT employees audited with actor) · V:"staff sees all employees", V:"audit records the actor" | **PASS** |
| **US-002** Effective-dated rates | E2E-EMP-01 (staff rate is only *proposed*), E2E-EMP-02 (Owner approves from the dashboard), E2E-EMP-03 (approved ₱680 used: M004 net = 6 × ₱680) · F17 · ENG-R "position on THAT day" ×2 · V:"staff cannot insert an approved rate", V:"staff can propose a rate", V:"staff cannot approve a rate", V:"locked week: rate change cannot start inside it", V:"rate change after locked week allowed, decision stamped" | **PASS** |
| **US-003** Deactivate, not delete | E2E-EMP-03 (end date Oct 13: shown Mon–Tue of that week, gone the next week, excluded from the new run, still on the locked run) · F21 · V:"attendance before hire date rejected" | **PASS** |
| **US-010** Incentive catalog | E2E-CAT-01 (Owner sets TBC to ₱180 from Oct 19; week of Oct 12 still offers ₱150, week of Oct 19 offers ₱180), E2E-WEEK-02 (₱150/₱100/₱200 enter the pool), E2E-SEC-02 (staff read-only) · F18 · INT-F07 (inactive job keeps its amount) · V:"staff cannot change catalog amounts", V:"locked week: incentive amount cannot start inside it" | **PASS** |
| **US-020** Job log + daily pool | E2E-WEEK-02 (₱600 ÷ 3 = ₱200 each; ₱200 ÷ 3 = 66.67/66.67/66.66 with the extra centavo to the lowest code), E2E-WEEK-01 (half-day mechanic drops out of the footer count) · F06–F13 · V:"submitted week is frozen: job log" | **PASS** |
| **US-021** Attendance | E2E-WEEK-01 (half day, OT hours, clear a cell) · F01–F05, F19, F20, F23 · ENG-R ×4 · V:"R allowed on any day" (PR-022, 2026-09-27), V:"OT only on full days" | **PASS** |
| **US-023** Locked week read-only | E2E-LOCK-01 (banner "…add adjustments on a later week", every cell disabled, no Generate/Fill/Add/Remove), E2E-RUN-03 (submitted week read-only) · V:"locked week: attendance frozen", "…job log frozen", "…adjustments frozen", V:"submitted week is frozen: attendance" | **PASS** |
| **US-030** Generate draft | E2E-RUN-01 (MISSING_ATTENDANCE listed with a working Fix link; the draft equals the hand calculation to the centavo, §3), E2E-RUN-05 (stale banner, regenerate) · F01–F23 · "deterministic: same input, same output" · INT-F07 (same data gives the same hash; a change gives a new hash) · HASH ×3 · V:"draft saved with 4 lines", V:"draft is regenerable", V:"regenerate replaced items" | **PASS** (see TASK-027, cosmetic) |
| **US-031** Drill-down | E2E-RUN-02 (incentive dialog lists both days' jobs, co-present mechanics and PR-053; OT dialog shows the formula) | **PASS** |
| **US-032** Submit / approve / lock | E2E-RUN-03 (staff submits; no Approve or Send back for staff), E2E-RUN-04 (Owner sends back with a note), E2E-RUN-05 (resubmit), E2E-SEC-01 (staff's direct call to the lock action is refused), **E2E-RUN-06 (Owner approve & lock: FAIL)** · V:"staff cannot lock", V:"staff cannot send back", V:"owner locked the run", V:"stale draft cannot be locked", V:"draft cannot be locked without submit", V:"cannot lock a week while an earlier week is unlocked" | **FAIL → TASK-026** |
| **US-033** Allowances / deductions | E2E-WEEK-03 (cash advance −₱500), E2E-RUN-05 (meal +₱100), E2E-SLIP-01 (deduction on the payslip) · F14–F16 · INT-F07 (carry-over net 405000) · INT-REP (carried_in/carry_out reconcile) · V:"adjustment amounts are capped", V:"carry-over flows to next week", V:"carry-over survives a week the employee is absent from" | **PASS** (carry-over on two consecutive payslips is covered by F15/F16 and the DB, not by e2e) |
| **US-034** Payslips | E2E-SLIP-01 (6 slips; M001 has the OT line, the Thu pool jobs and net; S002 has the cash advance and net; Print button) | **PASS** (print-to-PDF layout still needs the Owner's print-preview check, TASK-016) |
| **US-035** RCBC bank file | — | **BLOCKED / not testable**: TASK-017 waits for the Owner's RCBC template (OQ-18a) |
| **US-040** Monthly summary | E2E-REP-01 (Oct 2026 totals equal the locked run; CSV export returns 200) · INT-REP (locked only, payday attribution Dec/Jan) · `reports.test.ts` ×2 (CSV escaping, pesos) · V:"monthly summary by payday month" | **PASS** |
| **US-050** Dashboard | E2E-DASH-01 (latest locked week selected; Net ₱23,103, Incentives ₱800, 6 jobs, per-mechanic ₱266.67, top jobs; approvals panel empty) | **PASS** |
| **US-060** Audit | E2E-AUD-01 (payroll_runs updates by E2E Staff and E2E Owner, incl. `locked` and the send-back note; attendance and adjustments rows; staff can view) · V:"audit masks sensitive fields", V:"audit records the actor", V:"audit never stores password hashes", V:"audit log is append-only", V:"reveal is logged" | **PASS** |
| **US-061** Sign-in, roles | E2E-AUTH-01 (redirect; no sign-up link), E2E-AUTH-02 (generic error), E2E-AUTH-03 (role badge; logout kills the session, and replaying the old cookie fails), E2E-AUTH-04 (6th failure: "Too many attempts. Try again in 15 minutes."), E2E-SEC-01, E2E-SEC-02 · AUTH-U ×5 · V:"anon sees no employees", V:"failed logins counted (case-insensitive)", V:"success resets the failure window", V:"valid session returns user", V:"logout invalidates session", V:"role change / password reset / deactivation ends that user's sessions" | **PASS** |

### Should / Could

| Story | Status | Tests | Result |
|---|---|---|---|
| US-041 13th month | built | E2E-REP-01 (M003 basic ₱3,300.00 → ₱275.00), T01, INT-REP (390006 → 32501) | **PASS** |
| US-022 CSV import | skipped by the Owner | — | n/a |
| US-051 Explain payslip (AI) | skipped by the Owner | — | n/a |
| US-052, US-053 | not built (backlog) | — | n/a |

## 2. End-to-end tests (Playwright)

**How to run**
1. Start the Postgres container (`docker compose up -d db`). `.env` must contain `DATABASE_URL`, `DATABASE_URL_OWNER`, `DEV_OWNER_PASSWORD` and `DEV_STAFF_PASSWORD`.
2. Run `npm run test:e2e`. It takes about 3 minutes, most of it for `next build`. Port 3100 must be free.

**What it does**
- **Database:** `tests/e2e/global-setup.ts` creates `motonorte_e2e` in the same container if it's missing, then runs `revoke temporary on database motonorte_e2e from public`. Every run it does `node db/migrate.ts --reset`, `db/seed.sql`, and `scripts/create-user.ts` for owner@ and staff@motonorte.test, with passwords taken from the environment. It refuses any URL whose database isn't `motonorte_e2e`, so the dev DB can't be hit. The e2e DB is left in place for reruns.
- **Server:** Playwright's `webServer` runs `next build && next start -p 3100` with `DATABASE_URL` pointed at `motonorte_e2e`. The process environment overrides `.env` in Next. The server is stopped when the run ends.
- **Browser:** the Microsoft Edge already installed (`channel: "msedge"`). No browser was downloaded. Traces are off because they would record typed passwords; screenshots are taken on failure only.
- **Order:** tests run in file order on one worker. Run and employee IDs are looked up in the DB, so one failure doesn't hide the later steps.
- **Direct-call test (E2E-SEC-01):** the Owner's real "Approve & lock" Server Action request is captured and aborted, then replayed from the staff user's browser session. The server answers "Only the Owner can approve and lock payroll.", and the run stays `submitted`.
- **Workaround:** until TASK-026 is fixed, the tests after E2E-RUN-06 run under `ensureLocked()`. It locks the run exactly as `lockRun` would, as `app_user` with the Owner's identity via `lock_run(id, fresh hash)`, just without the failing `FOR UPDATE`. It also adds a `workaround` annotation to the run. Once the bug is fixed, `ensureLocked()` does nothing.

| ID | Role | Critical path | Result |
|---|---|---|---|
| E2E-AUTH-01 | — | Unauthenticated → /login; no sign-up link | pass |
| E2E-AUTH-02 | staff | Wrong password → "Email or password is incorrect." | pass |
| E2E-AUTH-03 | staff | Sign in (name + role badge), sign out; old cookie no longer works | pass |
| E2E-AUTH-04 | — | 6th failure in 15 min → throttle message | pass |
| E2E-EMP-01 | staff | Create employee M004; invalid rate → field error, nothing saved; rate proposed, no Approve | pass |
| E2E-EMP-02 | owner | Approve M004's rate from the dashboard approvals panel | pass |
| E2E-WEEK-01 | staff | Attendance: M003 half day, M001 2 h OT, clear S001 Thu; footer counts | pass |
| E2E-WEEK-02 | staff | Log 1× CARB on Thu; pool summaries for Tue and Thu | pass |
| E2E-WEEK-03 | staff | Deduction: S002 cash advance ₱500 | pass |
| E2E-RUN-01 | staff | Generate → "Missing attendance: S001 on Thu Oct 8" → Fix → cell focused → Fill → draft nets = §3 | pass |
| E2E-RUN-02 | staff | Drill-down dialogs (incentive, OT) | pass |
| E2E-RUN-03 | staff | Submit; no Approve / Send back; week read-only | pass |
| E2E-RUN-04 | owner | Send back with note | pass |
| E2E-RUN-05 | staff | Note visible; add allowance; stale banner; regenerate; resubmit | pass |
| E2E-SEC-01 | staff | Direct call to the owner-only lock action refused | pass |
| **E2E-RUN-06** | owner | Approve & lock (dialog restates "6 employees · Net ₱23,103.13.") | **FAIL → TASK-026** |
| E2E-LOCK-01 | staff | Locked week read-only (attendance, jobs, adjustments) | pass* |
| E2E-SLIP-01 | staff | Payslips render, itemized | pass* |
| E2E-REP-01 | staff | Monthly summary, 13th month, CSV | pass* |
| E2E-DASH-01 | owner | Dashboard KPIs for the locked week | pass* |
| E2E-AUD-01 | both | Audit shows the actions and actors | pass* |
| E2E-SEC-02 | staff | No owner controls on catalog/settings/dashboard | pass* |
| E2E-EMP-03 | staff | Deactivate S002 → excluded from the next run, kept on the locked one | pass* |
| E2E-CAT-01 | owner | Change incentive amount effective a future Monday | pass* |

\* Ran with the `ensureLocked()` workaround described above, because of TASK-026.

## 3. Payroll regression

**Fixtures.** `npm test` runs all 24 Owner-approved fixtures (23 weekly cases plus T01) and passes all 24, to the centavo.

**Hand-calculated draft for the seeded week (Oct 5–11, 2026), asserted in E2E-RUN-01 against `payroll_lines` and the page.**

The seed mirrors F07:
- **Rates:** S001 and S002 ₱550, T001 ₱750, M001 ₱650, M002 ₱700, M003 ₱600.
- **Attendance:** everyone F Mon–Sat and R Sun.
- **Tuesday pool:** 2× TBC ₱150 + 3× CHAIN ₱100 = ₱600.00.

The e2e staff then made these changes:
1. M001 gets 2 h OT on Mon: round(65000 × 120 × 1.25 ÷ 480) = round(20312.5) = **20313** (PR-040, PR-002).
2. M003 is marked H on Wed: base = 5 × 60000 + 30000 = **330000** (PR-031). No jobs were logged on Wed.
3. 1× CARB ₱200 is logged on Thu, with 3 full-day mechanics. floor(20000 ÷ 3) = 6666, remainder 2, so the extra centavo goes to the first two codes: M001 **6667**, M002 **6667**, M003 **6666** (PR-053).
4. The Tuesday pool of 60000 ÷ 3 gives **20000** each.
5. S002 gets a cash advance deduction of **50000**.

| Emp | Base | OT | Incentive | Allow. | Deduct. | **Net (first draft)** |
|---|---|---|---|---|---|---|
| S001 | 6 × 55000 = 330000 | 0 | 0 | 0 | 0 | **330000** (₱3,300.00) |
| S002 | 330000 | 0 | 0 | 0 | 50000 | **280000** (₱2,800.00) |
| T001 | 6 × 75000 = 450000 | 0 | 0 | 0 | 0 | **450000** (₱4,500.00) |
| M001 | 6 × 65000 = 390000 | 20313 | 20000 + 6667 = 26667 | 0 | 0 | **436980** (₱4,369.80) |
| M002 | 6 × 70000 = 420000 | 0 | 20000 + 6667 = 26667 | 0 | 0 | **446667** (₱4,466.67) |
| M003 | 330000 | 0 | 20000 + 6666 = 26666 | 0 | 0 | **356666** (₱3,566.66) |
| **Total** | | | 80000 | | | **2300313** (₱23,003.13) |

After the Owner's send-back, staff added a meal allowance of 10000 for M003, so M003 = 366666 (₱3,666.66). The final total is **2310313 (₱23,103.13)**. E2E-RUN-05, E2E-RUN-06 (lock dialog), E2E-REP-01 (monthly total) and E2E-DASH-01 (rounded tile ₱23,103) assert this total.

**13th month for M003 (E2E-REP-01):** basic = 5 × 60000 + round(60000 × 0.5) = 330000, and round(330000 ÷ 12) = **27500** (₱275.00). The meal allowance and incentives are excluded (PR-080).

**Second week (E2E-EMP-03, week of Oct 19):** M004 is at the Owner-approved ₱680 with 6 F days and Sun as rest day, so net = 6 × 68000 = **408000**. S002 is absent from the run.

## 4. Parallel run

**Not possible yet.** The Owner has no real past payroll export to compare against, so there are no per-employee differences to report.

**Substitute used:** the 24 Owner-approved fixtures (F01–F23, T01), exercised end to end:
- by the pure engine in `lib/payroll/engine.test.ts` and `engine.rules.test.ts`;
- from the database through `loadPeriodInput → computeWeek → save_draft` in `lib/db/loadPeriodInput.test.ts` (F07 figures, carry-over, same-data-same-hash);
- through the UI in E2E-RUN-01, which reproduced the hand-calculated nets in §3 to the centavo.

**Launch requirement (for `09-launch-checklist.md`):** run the first live week in parallel with the manual payroll. Report differences per employee to the centavo, and either explain each non-zero difference or file it as a bug before switching over.

## 5. Bugs

| Task | Severity | Title | Found by |
|---|---|---|---|
| **TASK-026** | Critical | Owner cannot Approve & lock any payroll run | E2E-RUN-06 |
| **TASK-027** | Minor | Run review "Days" shows `5 + 1½` for 5 full + 1 half day | manual review of the run page |

**TASK-026 repro**
1. Staff generates the draft for a week and submits it.
2. The Owner opens `/payroll/<id>`, clicks **Approve & lock** and confirms.
3. The dialog shows "You don't have permission to do that." and the run stays `submitted`.

**Cause:** `app/(app)/payroll/actions.ts:96` runs `select period_start … from payroll_runs where id = … for update` as `app_user`. `FOR UPDATE` requires UPDATE privilege, but `app_user` has SELECT only (001_init.sql:648). I confirmed on `motonorte_e2e` that the query fails with "permission denied for table payroll_runs" and succeeds without `for update`.

**Why earlier checks missed it:** verify.sql and the integration tests call `lock_run()` directly, and this is the first test that goes through the Server Action.

**Suggested fix:** drop `for update`, because `lock_run()` already locks the row. This isn't fixed here, since QA only reports.

**TASK-027 repro:** mark an employee H on one day, generate, and look at the Days column. It shows `5 + 1½`, which reads as 6.5 days.

**Checked and not a bug:** in a fresh seed, the two Tuesday jobs share `created_at`, so the drill-down lists them in UUID order (TBC, CHAIN or CHAIN, TBC). Amounts are identical, and the hash is stable for any given DB state. E2E-RUN-02 accepts either order.

## 6. Not tested / limits

- **US-035 RCBC file:** blocked on the Owner's template (TASK-017).
- **Print-to-PDF layout (TASK-016):** the Owner's print-preview check is still pending. E2E only checks that the payslips render.
- **Parallel run:** no real payroll data (§4).
- **CI:** the e2e suite isn't in `.github/workflows/ci.yml`, because it needs a browser and a build. It runs locally. The CI workflow itself has still never run, because there's no GitHub remote.
- **Not exercised in e2e:** the NO_ELIGIBLE_MECHANIC warning in the UI, carry-over across two consecutive payslips, gov't ID reveal, and settings/holiday/user admin. These are covered by fixtures F11, F15 and F16 and by verify.sql (reveal, users, sessions), not by e2e.
- **Where the tests ran:** `db:verify` and `npm test` ran against the dev DB as the project defines them (both roll back). Afterwards the dev DB still shows only its hand-made runs (2026-10-12 locked, 2026-10-19 submitted). The dev server (3000) and the Docker app (3001) were not touched.

## Hand-off checklist

- [ ] 100% of Must criteria covered and passing: 16/16 testable Must stories are covered, but only 15 pass. **US-032 fails (TASK-026).** US-035 is BLOCKED (not testable).
- [x] All fixtures pass: 24/24 (`npm test` 49/49), plus `db:verify` 67/67.
- [ ] Parallel run, zero unexplained difference: **not possible yet**, because there's no real past payroll. The substitute (24 fixtures, end to end) passes, and a live parallel first week is required on the launch checklist.
- [x] Every failing test filed as a bug with repro steps: TASK-026, and TASK-027 from the manual review, both in `06-task-queue.md`.
- [x] E2E runs against a separate DB (`motonorte_e2e`), repeatable (reset each run), `npm run test:e2e` documented.


## Re-run after fixes (2026-09-27)

After TASK-026 (lockRun `FOR UPDATE` removed) and the security fixes (TASK-024/025, M-1, M-3, M-4, L-5, L-7) and TASK-027:
`npm run test:e2e` → **24 passed / 0 failed** on a fresh production build. The TASK-026 DB-lock workaround was removed from
`tests/e2e/payroll-cycle.spec.ts`: E2E-RUN-06 now locks through the Owner's real "Approve & lock" dialog, and the
post-lock tests assert the UI locked the week. `npm test` 49/49, `db:verify` 74/74 (7 new checks for migration 006).
US-032 now PASSES → 16 of 16 testable Must stories pass.
