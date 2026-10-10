# Monthly payslip totals — 2026-10-10

Installed on http://localhost:3005. Image motonorte-office-app:monthly-payslip-20261010; running identity sha256:bf3cfea362ffbc824977eaaa23e8ff1190d8fe3cd24d55c523ac4519cf5c22c7.

## Corrected behavior
The reported October1–31 requests did contain the selected month, but each frozen snapshot had only one approved week. The old renderer omitted range summaries with one week. Monthly or multi-day requests now always begin with a totals page, including when only one approved week exists.

Employee range selection displays combined basic/base pay, overtime, incentives, allowances, gross, deductions, carried-in balances and total net before requesting approval. Admin pending-request review displays the same totals and the included weeks. The PDF totals page uses frozen approved weekly amounts and retains individual weekly slips and calculation detail.

Totals sum integer centavos; monthly net is the sum of approved weekly net, preserving weekly debt/rounding decisions. The closing carried balance is the latest included week, not the sum of repeated carried balances. Period inclusion remains by scheduled Sunday payday, not prorated calendar work dates. Missing scheduled paydays are identified as excluded; unapproved and draft payroll is never silently included. A partial month is labelled clearly. A calendar month can have four or five scheduled paydays.

Preview GET is authenticated, limited to the linked employee's own ID and assigned payslips tab, validates the range and returns private/no-store JSON. Range changes abort obsolete client previews. Creating a request still requires approved payroll and fresh admin approval. Every issued PDF consumes one approval through the existing POST transaction; historical snapshots remain unchanged.

13th-month pay remains excluded from print. My Pay viewing is unchanged.

## Validation
- Fresh source, .env, database dump and exact running image backup before changes; PostgreSQL dump restored in a network-isolated disposable PG17 container.
- 66/66 regression tests, zero skipped, including integer category totals, draft exclusion, single-week monthly summary, carried balance, leap-year month and unsafe-number checks.
- SQL verification: ALL CHECKS PASSED.
- Lint, type generation, TypeScript and production build passed. Final caption spacing edit passed8 targeted tests and a final production build.
- Actual synthetic UI: selected September1–30, employee preview showed4 weeks/grossPHP12,600/deductionsPHP40/netPHP12,560; submitted request; admin review showed identical totals; approved once; employee downloaded actual9-page PDF; request changed to USED with button removed.
- Actual downloaded PDF reopened: first-page totals correct, all4 weekly periods present, no13th-month field. Full-month and one-approved-week partial-month totals rendered and visually reviewed.
- Phone390px: pagewidth375px, totals readable without overflow. Desktop employee/admin review tested.
- Live employee, attendance, payroll runs/lines/items and historical payslip request fingerprints unchanged; .env unchanged and motonorte-office_pgdata retained. Installed tested image, apphealthy and loginHTTP200.
- Full unrelated browser E2E suite and physical printing not rerun. No real payroll approvals, payments or synthetic live accounts created.

## Backup and rollback
Private backup: backups/before-monthly-payslip-20261010-163946; source.zip,environment.env,database.dump,app-image.tar,app-image-id.txt,restore-verification.txt,SHA256SUMS.txt.
scripts/rollback-monthly-payslip.ps1 -ValidateOnly checks archive integrity. Without ValidateOnly restores only the previous app image, preserving current live DB/env/accounts/approvals. Source remains updated; rebuilding rolls forward. Never restore an older DB dump over new writes to roll back this display change.

Already downloaded PDFs remain as issued. Used approvals cannot be reused; request a fresh monthly document for the corrected format.
