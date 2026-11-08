# Employer government contributions

Status: proposed implementation design for owner review. No product code or database migration has been applied.

## Purpose and approved business rules

Record manually supplied monthly SSS, PhilHealth and Pag-IBIG amounts per employee, entirely funded by the employer. Make weekly allocations visible in payroll and payslips, and show monthly funding requirements on the dashboard and in a dedicated report.

- Contributions are informational employer costs. They do not enter basic pay, base pay, gross, deductions, net, carry-over, 13th-month calculations or employee payment balances.
- Amounts repeat each month until changed. Changes become effective on the first of the next month, using Asia/Manila calendar dates.
- Ordinary allocation divides each benefit's monthly amount across the actual Sunday paydays in its month, four or five. A complete weekly payroll is never split.
- September 28–October 4 belongs to October for ordinary contributions; October 26–November 1 belongs to November.
- Joining on the 1st through 5th qualifies for the full joining month. Joining on the 6th onward starts eligibility on the first of the next month.
- Leaving during an eligible month still qualifies for that month's full contribution. The outstanding allocation is recorded on the final weekly payroll.
- Approved contribution values are frozen. Existing payroll approvals and existing payslip approval snapshots must not be rewritten.
- An allocation does not certify remittance to an agency. Actual remittance tracking is outside this feature.

## Approach

Use effective-dated employee contribution settings and a separate contribution allocation table attached to payroll runs. This makes benefit months and final-payroll adjustments explicit without adding employer costs to earnings.

Alternatives considered:

1. Adding three columns directly to payroll lines is simpler, but cannot clearly represent a final payroll containing a settlement for a different benefit month.
2. Recomputing historical displays from current employee settings uses less storage, but changes old figures after edits and conflicts with frozen approval requirements.

The separate allocation table is recommended. A pure calculator produces allocation values; database functions validate and save them in the existing payroll transaction.

## Initial rollout policy proposed for review

Start recording contributions from the first of the next month after rollout. If rollout occurs during October 2026, the start is November 1, 2026. Initial entries can be supplied beforehand and become recurring from that month. This deliberately avoids silently allocating new values to October payroll that is already approved.

There is no automatic backfill. Historical weeks and payslip snapshots without contribution metadata show “Not recorded” rather than an invented zero. A genuine explicitly entered zero is displayed as zero.

Future employee setup uses the joining cutoff above, subject to the rollout start. If a month's payroll is already approved before a new employee's amounts are configured, refuse retroactive setup and explain the next permitted effective month. No live payroll is reopened automatically.

## Calculation and month boundaries

Use safe integer centavos. For each benefit, divide its monthly amount by the count of Sunday paydays in the benefit month. Take the integer quotient and distribute remaining centavos to the earliest scheduled paydays. An unchanged complete month's allocations sum exactly to the entered monthly amount.

An employee hired on the 5th can miss a Sunday on the 1st–4th. In that case, include the missed scheduled allocation on their first payroll with a payday in the eligible month. Do not create employment or earnings for the earlier week. Label the extra benefit allocation as a joining-month catch-up.

For a known departure, final payroll receives the monthly amount minus allocations already recorded in earlier approved runs for that employee and benefit month. It replaces that final week's ordinary allocation, rather than adding the ordinary share again. If employment ends before any regular payday, the entire eligible monthly amount goes to final payroll.

Final payroll can fall in the next month. Example: employment ends September 30 and final payroll covers September 28–October 4. The settlement remains a September contribution, stored with September as its benefit month. The employee receives no October entitlement after September departure.

The contribution report and dashboard group by benefit month. Payslip range selection continues to group complete payroll weeks by scheduled payday, as the existing app does. Therefore an October payslip may contain a clearly labelled September final settlement paid through an October payroll. No amount is silently reassigned to October.

Absent days, half days and zero earnings do not prorate the employer contribution. Entire months after departure and months before eligibility have no entitlement.

Prior approved allocations, effective settings, eligibility dates and settlement inputs must be part of the deterministic payroll fingerprint. Exclude the current run from prior-allocation inputs. Never subtract unapproved drafts, archived versions or another month's amounts.

Reject over-allocation instead of silently clamping it. Backfilled runs must not duplicate a catch-up or final settlement already recorded in a later approved run. Any backfill that would change a later frozen contribution requires an explicit correction workflow and is refused by this feature.

## Storage and database enforcement

Add a new numbered migration after 017; preserve all applied migration files.

Conceptual tables:

- `employee_contribution_terms`: employee ID, effective month, SSS/PhilHealth/Pag-IBIG monthly centavos, creation/change metadata. Unique employee and effective month. Amounts nonnegative and bounded to safe integer values. Effective month is always the first day of a month.
- `payroll_contributions`: run ID, employee ID, benefit month, the three allocated amounts, monthly entitlement snapshot, ordinary/catch-up/final-settlement classification, calculation version and frozen provenance. Unique run/employee/benefit month. Multiple benefit months may attach to one run when required by an explicit settlement.

Keep historical terms; do not replace earlier effective-month records. Repeated edits before the next month's effective date may replace that pending record with an audit trail. Once a record can affect approved payroll, it is immutable.

All setting writes and complete payroll calculation/save/approval operations acquire advisory transaction lock 76239146 through `withUser`. Database functions also enforce roles, states, frozen-row rules and contribution caps. Draft saves replace the current run's contribution rows atomically alongside payroll lines and items. Submit/approve stale checks include contribution inputs in the same transaction.

Update archive behavior via the new migration so reopening stores the original contribution rows in `payroll_run_versions`. Existing latest-run/reason restrictions remain. Reopening removes that run from approved totals, makes dependent drafts stale and continues to revoke unused payslip approvals. Old archived versions remain unchanged.

Employment-date edits affecting frozen contribution eligibility or settlement amounts must be refused with an actionable message. A later-known departure cannot silently change already locked payroll; the established latest-week reopen workflow remains necessary when applicable.

## Authorization

- Only owners create or change monthly contribution settings. Staff employee-tab access does not grant contribution-write access.
- Payroll staff may generate drafts through the existing payroll authorization; only owners approve or reopen.
- Office dashboard/report access follows existing assigned-tab guards. The dedicated report uses the existing Reports permission, with a separate page at `/reports/contributions` and a separate export.
- Crew can read only their own contribution settings/allocations through explicit own-employee SELECT policies. Preserve `app_role() = NULL` for crew. Do not expose company totals in crew pages.
- Every page, preview, export and action checks authorization on the server. Sensitive exports/previews use no-store.

## Application integration

### Employee information

Add an owner-editable Employer government contributions section to employee details. Display current recurring monthly amounts, eligibility start, and pending next-month changes with an explicit effective date. Require a value for each category; permit explicit zero. Do not infer amounts from agency rates or employee salary.

### Payroll and My Pay

Show three separate SSS, PhilHealth and Pag-IBIG columns on office payroll, with a labelled combined employer-cost total outside earnings totals. Provide a detail view for benefit month and catch-up/final settlement. Crew history shows only the employee's recorded employer contributions alongside their unchanged pay breakdown.

### Payslips

Add an Employer government contributions section to admin print and employee PDF layouts. Values come from payroll allocations copied into the approval snapshot, not current terms. Weekly payslips show allocation and benefit month. Monthly/multi-week previews, admin request review and PDF use the shared range summary to sum the recorded category amounts, including settlements and recording-coverage warnings.

If selected weeks contain legacy unknown contribution metadata, label the contribution total as partial/unknown; do not claim a complete monthly contribution. Payroll earnings remain available as before. Preserve fonts, A4 design, peso glyphs, one-use ownership and PDF-before-consume transaction order.

### Dashboard

Add a selectable benefit-month panel, independent of the existing selected payroll week. Show planned full-month SSS, PhilHealth, Pag-IBIG and combined totals for eligible employees. Beside these show approved recorded totals and the remaining planned allocation. Never include drafts in approved totals. Label missing/legacy coverage and any inconsistent totals; do not disguise over-allocation as zero remaining.

### Dedicated report

Add an Employer government contributions report with month selection, employee rows and company totals. Show planned category values, approved recorded category values, combined values and remaining allocation. Include a weekly breakdown showing run period, scheduled payday, benefit month and settlement type. Keep it separate from existing salary and 13th-month reports. Provide a UTF-8 CSV export with the existing formula-injection safeguards.

## Verification

- Four/five Sunday months, December/January rollover, February/leap years and overlapping payroll weeks.
- Exact centavo conservation, explicit zero versus missing metadata and safe-integer rejection.
- Hire dates 1/3/5 versus 6/15; joining-month missed Sunday catch-up; no attendance proration.
- Mid-month departure, departure before first Sunday and next-month final payday retaining the earlier benefit month.
- Next-month changes, repeated pending edits, stale drafts, concurrent saves/approvals, reopening archives and backfill rejection.
- Regression checks proving identical basic/base/gross/deductions/net/carry-over/13th-month/payment balances before and after adding contributions.
- Isolated database tests for owner-only writes, staff restrictions, crew own-row access, frozen rows and report aggregation.
- Preview/admin/PDF/report consistency; old snapshots still render; one-use approvals remain untouched on failed PDF generation.
- Desktop/mobile and assigned/unassigned tabs; production build, lint, typechecking and relevant tests.

Fix the previously identified unsafe integration-test guards and E2E reset-name mismatch as testing prerequisites. Use a disposable database and synthetic employees. No live approvals, payments, activation resets, attendance edits or test data inserts.

## Release and rollback

The verified source backup already exists under `backups/source-2026-10-11T18-58-37-597Z`. Before product-code changes, create a fresh source backup if the working tree changed, a live database backup and an archive of the exact running image; record hashes and restore-test in an isolated container.

Implement and validate without replacing the live app. After successful verification, present the tested changes and migration effects for release approval. Preserve `.env`, credentials, existing payroll data, named volumes and all uncommitted user changes.

Use an additive schema so an app-image rollback retains newly recorded contribution data. Verify compatibility of changed database functions with the old image in the isolated restore before deployment. Never drop new tables during an app rollback or overwrite the live database with the pre-change backup; database recovery is a separately scoped emergency action.

## Review choices

The approved business rules are captured above. Owner review of this written design specifically includes the proposed next-month initial rollout, the joining-month catch-up rule and the benefit-month label retained for a final settlement paid the following month. Product implementation follows written-design approval and review of the implementation plan.
