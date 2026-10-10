# My Pay pre-change audit — 2026-10-10

## Verified deployment and scope
Source: C:\Users\kcmat\MotonortePayroll. Live URL: http://localhost:3005.
Compose: motonorte-office. Live image: sha256:2075a7357286524d7c73ebdfa646dcbcd6fcc63eac1a45c8e0d088f4b47b085c.
This audit changes no runtime application code, applied migrations, accounts or live business data.
README.md, UPDATE_WINDOWS.md and VERIFY.md are absent in this checkout; AGENTS.md, office runbook, payroll documentation and relevant source were reviewed instead. Do not substitute the older 3110 app's rules.

## Backup completed before audit changes
Private backup: backups/before-mypay-20261010-143852.
Contains source.zip, environment.env, database.dump, database-roles.sql, exact app-image.tar, app-image-id.txt, local HTTPS data/config archives, restore-verification.txt and SHA256SUMS.txt.
Permissions restricted to the current Windows user and SYSTEM. Backups excluded from Docker context and version control.
Custom-format dump restored with --exit-on-error into a separate network-isolated PostgreSQL 17 container; --no-owner/--no-privileges used for this data restore test. This proves data/schema restoration, not complete live-role recovery. Role definitions are separately backed up and must be handled privately during a disaster recovery.
Restored counts: 7 employees, 2 users, 3 payroll runs, 20 payroll lines, 316 payroll items, 0 archived versions. No live restore, schema reset or named-volume removal occurred.

## Findings and required design changes
1. High — existing staff role is an office operator, not an employee privacy boundary. db/migrations/001_init.sql policies allow staff to select all payroll lines/items and employee records; 015 permits staff to read archived versions. Do not give crew the existing Payroll/Reports tabs as their personal portal. Add an explicit crew access class, employee ownership lookup and database policies for own records; review every SECURITY DEFINER function, derived report, export, archive and direct URL as well as new pages. Deny all operator mutation functions for crew. Preserve manually assigned tabs for office staff/admin control.
2. High — accounts are not linked to employees. users has no employee_id and addUser currently requires an admin-selected temporary password (settings/actions.ts). Add a unique, admin-managed employee link without recreating employees or payroll. New-employee login must be disabled until activation. Implement one-time, expiring, hashed activation codes delivered manually, throttled verification, atomic consumption and forced password creation; email alone cannot prove identity. No invites or outgoing messages. No real accounts should be created during development tests.
3. High — there is no separate payslip request/approval or single-use issue control. Existing locked-run route loads all employee lines and PrintButton calls window.print(). Add own-employee requests, date ranges, an admin approval queue/notification badge, frozen document payload, audit records and an atomic one-use PDF endpoint. Concurrent requests must not issue twice; HEAD/prefetch must not consume authorization. Define retry behavior if generation or delivery fails. Never rely solely on hiding a button. A delivered PDF can be copied/reprinted outside the system; physical print counts cannot be enforced.
4. Medium — payroll approval does not establish that payment was made. Add recorded payment date, amount, method/reference and actor before labelling history Paid. Never infer payment from locked_at or scheduled payday. Existing historic runs should be shown Approved/payment unrecorded unless verified payment is recorded.
5. Medium — historical payslip presentation mixes immutable amounts with mutable employee identity. Existing payslip page joins employees for current code/name and pay_terms for position. Reopened calculations have archives, but this does not freeze an issued document. Save identity, employment details, source-approved version and all displayed numbers at issue approval. Reopening or employee edits must not silently alter an issued PDF; revoke unused approval for an outdated run version and preserve previously issued versions.
6. Medium — current drafts can be stale or missing. Label current earnings Estimated/Being prepared with an as-of timestamp and expose stale state. Do not silently show an old draft as current earnings. Gross/OT/incentives/allowances/deductions/net must come from authoritative server calculations; stored approved values must never be recalculated on PDF download.
7. Medium — supplied design omits the user's required month/custom range, approval states and profile access. Replace immediate Print/PDF with Request PDF; add Pending/Approved/Rejected/Used, in-app admin notification and exact included weeks. Monthly attribution by payday matches existing reporting but remains a proposed choice awaiting user confirmation. Preserve complete weekly payroll periods; never prorate weeks because a selected range cuts across them. A range PDF may have several pages, with a summary and weekly details.
8. Medium — migration runner has no applied-file checksum or concurrent-run lock, and --reset is not guarded against a live database (db/migrate.ts). Do not run --reset; do not alter applied SQL. Harden migration execution before the portal schema deployment and make a fresh dump/restore test immediately before that deployment.
9. Design handoff is a prototype: .dc.html requires missing support.js/design-canvas runtime and logo-full.png, embeds sample pay and uses fixed A4 overflow:hidden. Implement existing React components and official local logo/fonts, real data and robust pagination rather than copying prototype runtime. No external font dependency is necessary.

## Current safeguards reviewed
Scrypt password hashing, hashed session tokens, throttled sign-in, session revocation on credential/access changes, owner-only final approval, admin-only attendance, source/approval serialization under advisory lock 76239146, stale-run fingerprint verification and append-only prior approval archives are present. These controls passed existing regression tests; new crew rules will require additional tests.

## Validation
- Regression suite: 57 passed, 0 failed, 0 skipped in newly created synthetic motonorte_integrity_test database. The restored live-data database was never used for mutation tests.
- db/tests/verify.sql: ALL CHECKS PASSED against synthetic database.
- ESLint: passed. Next type generation and TypeScript: passed.
- Next.js 16.3.6 production build: passed from read-only source copy in disposable container.
- Initial test harness attempts omitted fixtures and used a dependency symlink outside Turbopack's project root; corrected harness passed. Those setup failures did not affect live code.
- Full browser E2E was not rerun in this audit; employee activation, private portal and PDF approval/range workflows do not exist yet and are pending implementation/testing.
- Local login HTTP 200 and app/database health checked after cleanup.

## Implementation sequence
1. Crew account linking and activation plus database ownership rules and negative access tests.
2. My Profile/My Pay using supplied responsive design; estimates, own approved history and recorded payments.
3. Range requests, admin notification/approval and immutable single-use PDFs; test unauthorized URLs, two concurrent downloads, rejected/expired requests and corrected payroll versions.
4. Desktop/mobile browser verification, reload persistence and isolated full payroll/portal regression; fresh backup before applying new schema.

## Rollback
Before deploying portal changes, add a dedicated rollback command using this backup's exact image and validate archive hashes. An app-image rollback should preserve live .env and PostgreSQL volume; never blindly restore an old dump over new live transactions. Schema compatibility must be checked before rolling an old image back. Existing rollback-ui.ps1 targets the earlier pre-redesign release, not this My Pay baseline.
