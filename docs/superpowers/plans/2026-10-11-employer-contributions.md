# Employer Government Contributions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Record recurring employer-funded SSS, PhilHealth and Pag-IBIG allocations in payroll snapshots, payslips, a monthly dashboard and a dedicated report while preserving earnings and live history.

**Architecture:** Effective-month employee settings feed a pure contribution calculator. Separate per-run, per-employee, per-benefit-month allocation rows are saved atomically with payroll, frozen on approval and copied into payslip snapshots. Reports group by benefit month; payslips select complete weeks by payday.

**Tech Stack:** Existing Next.js 16.3.8, React, TypeScript, PostgreSQL 17, postgres.js, Zod, PDFKit, Node test runner and Playwright. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-employer-contributions-design.md`

## Global Constraints

- No changes to earnings, deductions, net pay, carry-over, 13th-month rules or payment balances.
- Production is localhost:3005, Compose project motonorte-office, named volume motonorte-office_pgdata. Preserve credentials and live history.
- Initial eligibility cannot precede 2026-11-01 for this rollout. Subsequent amount edits start on the first of next month in Asia/Manila.
- Full eligible monthly entitlement; hire days 1–5 inclusive qualify that month, 6 onward qualify next month. Departure settlement retains its benefit month.
- Money is safe integer centavos; four/five Sunday allocation with earliest-payday remainder centavos.
- All complete calculations and source writes use withUser/advisory transaction lock 76239146. Never edit existing migrations.
- Crew app_role remains NULL. Owner-only settings writes. Existing tab and PDF-consumption boundaries remain.
- Product-code execution starts after this written plan is reviewed; live deployment is a separate final approval step.

## Review Focus

- A known termination is changed after its final run is approved: reject changes that invalidate frozen entitlement (Task 3).
- A final September settlement paid October 4 must stay September in reports and appear labelled September in an October payslip (Tasks 2, 5, 6).
- Legacy missing metadata mixed with recorded zero must produce incomplete contribution coverage, not an invented total (Tasks 4–6).
- A past run generated after a later catch-up or settlement must not double-count benefits (Tasks 2–3).
- Two administrators edit pending next-month amounts or approve different drafts concurrently: preserve atomic stale checks, cap and audit history (Tasks 1, 3).

## Task 1: Safe test harness and recovery checks

**Files:** Modify `package.json`, `lib/db/loadPeriodInput.test.ts`, `lib/db/reports.db.test.ts`, `playwright.config.ts`, `tests/e2e/global-setup.ts`; create `scripts/test-unit.cjs`, `lib/db/testSafety.ts`, `lib/db/testSafety.test.ts`.

**Interfaces:** `requireDisposableDatabase(url: string | undefined, expectedName: string): string` validates exact database identity before creating a client. Unit runner explicitly enumerates pure tests, including contributions, without loading `.env`.

- [x] Back up source, live database and exact app image. Restore database into isolated container; compare consistent snapshot fingerprints. Evidence: `backups/before-contributions-2026-10-11T20-14-13-546Z/verification.json`.
- [ ] Add failing guard tests: live-like DB names rejected; `motonorte_integrity_test` accepted only when explicitly supplied; missing credentials cause integration tests to skip before connecting.
- [ ] Run `node --test lib/db/testSafety.test.ts`; confirm the expected failure, then implement guards.
- [ ] Make ordinary `npm test` invoke the unit runner. Database tests require explicit disposable credentials; E2E uses `motonorte_e2e_test` and sets `ALLOW_TEST_DATABASE_RESET=1` only in the setup child environment. Never weaken the migration reset guard.
- [ ] Run the pure tests and exact-name guard tests. Preserve serial database testing in CI. Add a safe disposable test environment helper for later tasks; do not output URLs/passwords.

## Task 2: Pure allocation model

**Files:** Create `lib/contributions/types.ts`, `lib/contributions/calculate.ts`, `lib/contributions/calculate.test.ts`.

**Interfaces:** `BenefitAmounts = {sss:number; philhealth:number; pagibig:number}`; `ContributionTerm = {id:string; effectiveMonth:string; amounts:BenefitAmounts}`; `ContributionAllocation = {employeeId:string; benefitMonth:string; amounts:BenefitAmounts; monthly:BenefitAmounts; classification:'ordinary'|'joining_catchup'|'final_settlement'; provenance:Record<string,unknown>}`. `ContributionInput` contains employee ID, hire/end dates, period start, payday, rollout month, effective terms, and other approved allocations with run ID/payday/benefit month/amounts. `calculateContributions(input:ContributionInput):ContributionAllocation[]`. `benefitEligibilityMonth(hireDate:string,rolloutMonth:string):string` and `monthPaydays(month:string):string[]` are shared by reporting.

- [ ] Add failing tests: October 2026 100000 centavos yields four 25000 shares; November has five Sundays; 100001 splits 25001/25000/25000/25000. Hire October 5 catches up October 4 on its first eligible payroll; October 6 starts November.
- [ ] Add departure tests: 100000 entitlement with two approved 25000 allocations leaves 50000 final settlement; September 30 departure on October 4 has benefitMonth September and no October allocation. Employment ending before eligibility yields none.
- [ ] Add tests for zero/unknown terms, unsafe integers, already allocated later catch-up, late backfill and cross-year/month boundaries. Exclude current run from approved inputs; reject rather than clamp over-allocation.
- [ ] Run failing tests, implement the pure calculator, then rerun. Exercise unaffected earnings regression against all existing payroll fixtures.

## Task 3: Schema, authorizations and atomic payroll integration

**Files:** Create `db/migrations/018_employer_contributions.sql`, `lib/contributions/data.ts`, `lib/contributions/contributions.db.test.ts`; modify `lib/payroll/types.ts`, `lib/db/loadPeriodInput.ts`, `app/(app)/payroll/actions.ts`, `lib/db/runs.ts` as required.

**Interfaces:** `loadContributionInputs(tx:Tx,periodStart:string,excludeRunId?:string):Promise<ContributionInput[]>`; `loadRunContributions(tx:Tx,runId:string):Promise<ContributionAllocation[]|null>` (null denotes pre-feature run). Payroll `PeriodInput` includes deterministic contribution source inputs; pure wage calculation continues ignoring these. SQL `save_draft_with_contributions(date,text,jsonb,jsonb,jsonb,jsonb)` wraps existing save behavior and inserts allocation rows atomically; old save_draft signature remains for old-image compatibility and marks contribution coverage as legacy.

- [ ] Write isolated integration tests before migration: owner-only terms mutations, exact own-row crew reads, immutable locked rows, draft rollback, term effectiveness, safe casts and total caps. No real records or live owner credentials.
- [ ] Create terms and allocations with FKs, unique constraints, benefit month checks, nonnegative integer checks, audit and serialization triggers. Allow recurring term edits only for next month's pending record. New functions revoke PUBLIC execute and use fixed search_path.
- [ ] Define owner settings function `set_employee_contributions(uuid,bigint,bigint,bigint)`. For an existing configuration, calculate next-month effectiveness in DB. For a first configuration, use the latest of rollout month, employee eligibility month and current month; if that month already has approved payroll for the employee, require next-month start instead. This lets future early-month hires qualify for their full joining month without altering locked history. Grant writes only through the function.
- [ ] Include input changes in submit/lock stale comparisons. Save settings, terms and allocations with the shared lock; validate entitlement and provenance on approve in SQL. Preserve the old application's save/approve interfaces on rollback, using explicit legacy coverage without new computed allocations.
- [ ] Extend archive_approved_run through the new migration to capture contributions; protect employment-date changes that invalidate locked allocations. Reopen contribution totals and archived snapshots correctly; revoke unused requests through the existing trigger.
- [ ] Test racing term edits/approvals, late backfill, final settlement, stale drafts and reopen/archive. Test old app against migrated isolated restore before accepting compatibility.

## Task 4: Employee configuration, office payroll and My Pay

**Files:** Create `app/(app)/employees/contribution-actions.ts`, `app/(app)/employees/[id]/contribution-form.tsx`, `components/employer-contributions.tsx`; modify `app/(app)/employees/[id]/page.tsx`, `app/(app)/payroll/[runId]/page.tsx`, `app/(app)/my-pay/page.tsx`, `lib/portal/types.ts`, `lib/portal/data.ts`.

**Interfaces:** `saveContributions(previous:ContributionFormState,form:FormData):Promise<ContributionFormState>` uses requireOwner, safe peso parsing and the Task 3 setting function. Shared display consumes `ContributionAllocation[]|null` and shows category values, benefit month and classification, with “Not recorded” for null.

- [ ] Add settings UI for current recurring values and explicit pending next-month values; staff can read as permitted but cannot mutate. Each category is required, explicit zero allowed.
- [ ] Show separate employer contribution columns/section in office payroll and crew's own history. Earnings totals and existing actions are unchanged.
- [ ] Verify owner/staff/crew server-action restrictions in the isolated DB; browser check employee setup, pending edits, absence of office links in crew, and null versus zero display at desktop/mobile widths.

## Task 5: Frozen payslip summary and PDF

**Files:** Modify `lib/portal/summary.ts`, `lib/portal/summary.test.ts`, `lib/portal/pdf.ts`, `lib/portal/data.ts`, `app/(app)/my-payslips/forms.tsx`, `app/(app)/requests/page.tsx`, `app/(app)/payroll/[runId]/payslips/page.tsx`, `app/(app)/payroll/[runId]/payslips/printable-payslip.tsx`; add `lib/contributions/payslip.test.ts`.

**Interfaces:** Add optional `contributions:ContributionAllocation[]|null` to PayWeek; absent/null is legacy. Shared `summarizeRange` includes `{sss,philhealth,pagibig,total,recordedWeeks,missingWeeks,benefitMonths}` employer contribution summary. PDF uses this frozen summary only; no queries/current terms in renderer.

- [ ] Add failing tests proving category sums, single-week full-month summary, mixed zero/legacy coverage, and September settlement appearing under an October payday selection with its September label.
- [ ] Copy saved allocations into new request approvals; strengthen new-migration review_payslip verification to compare contribution rows/provenance as well as net/gross/version. Existing request snapshots remain byte-for-byte unchanged.
- [ ] Render contribution section consistently in employee preview, admin request review, admin print and employee PDF. Keep A4 fonts, no 13th-month estimate, and clear informational labels.
- [ ] Test old snapshot PDFs, long date ranges/pagination, failure rollback and one-use POST; use synthetic requests in the isolated database only.

## Task 6: Dashboard and separate monthly report

**Files:** Create `lib/contributions/reports.ts`, `lib/contributions/reports.db.test.ts`, `app/(app)/reports/contributions/page.tsx`, `app/(app)/reports/contributions/export/route.ts`; modify `app/(app)/page.tsx`, `app/(app)/reports/page.tsx`.

**Interfaces:** `contributionReport(tx:Tx,month:string):Promise<{employees:ContributionReportRow[];allocations:ContributionReportAllocation[];totals:ContributionReportTotals}>`; rows provide planned/approved/remaining BenefitAmounts, explicit coverage and combined totals. Allocations expose run period/payday/benefit month/classification. Planned eligibility shares Task 2 rules; approved numbers come solely from frozen allocations on locked runs.

- [ ] Write isolated report tests for four/five payday months, excluded drafts, zero versus unknown, full departing-employee plan, settlement grouped by benefit month and reopen subtraction.
- [ ] Add dashboard contribution-month selector independent of week selector, showing planned/approved/remaining by category and combined. Before rollout show “Recording starts November 2026”; no invented historical approval values.
- [ ] Add a separate report link using existing Reports tab permission, monthly employee table, company totals and weekly reconciliation. Validate month; enforce hasTab on export and requireTab on page; return 401/403 appropriately.
- [ ] Export category/planned/approved/remaining fields and reconciliation rows as UTF-8 CSV using shared toCsv protection. Test formula-like employee names and matching browser/export totals.

## Task 7: Release verification and deployment handoff

**Files:** Update `docs/02-payroll-rules.md`, `docs/runbook.md`, add `docs/EMPLOYER-CONTRIBUTIONS-2026-10-11.md`; create isolated browser tests `tests/e2e/contributions.spec.ts` and use recovery files already under backups.

- [ ] Run pure tests, isolated payroll/auth/database tests, lint, typecheck and production build. Investigate Turbopack worker failure if reproduced; do not claim success from typecheck alone.
- [ ] Run full E2E on disposable `motonorte_e2e_test`: owner entry/pending edits, staff assigned/unassigned tabs, crew own values, reports/export, PDF snapshot consistency, final settlement and reopen. Existing production approvals and one-use requests are untouched.
- [ ] Conduct targeted desktop/mobile checks separately and document results distinctly from full E2E.
- [ ] Review the whole change against the approved spec with an independent reviewer. Resolve verified important issues, preserve user uncommitted work, and verify no old migration or credential file changed.
- [ ] Validate recovery archive hashes and old-image schema compatibility. Present diff, checks, migration impact and exact release/rollback commands for final deployment approval. Do not restart the live app or apply migration until authorized for that tested release.

## Execution review

Backups are verified. Product implementation is pending review of this plan and selection of native execution or subagent-driven execution under the Superpowers workflow. Native execution means this agent implements tasks sequentially in this chat with independent review at completion. Subagent-driven execution means task-by-task independent implementation and review.
