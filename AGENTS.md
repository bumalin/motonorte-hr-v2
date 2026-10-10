<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Confirmed project and local release safeguards
- This is the live MotoNorte HR app at http://localhost:3005. Source: C:\Users\kcmat\MotonortePayroll. Compose project: motonorte-office. Live database volume: motonorte-office_pgdata. Do not confuse it with the older People pilot on 3110 or other HR checkouts.
- Preserve .env, passwords, government/bank data, payroll records and named volumes. Never run db:reset on the live database, delete pgdata, or docker compose down -v. Never print credentials or expanded Compose environment.
- Back up source, database and exact app image before changes. Restore-test in a separate disposable database/container. Ignore backup files in Git/build context. Applied migrations must stay unchanged; add new numbered files.
- Existing owner role is the administrator role. Attendance editing and final approval are admin-only; staff can view attendance if their assigned tab allows it. Correct the latest locked run via Reopen week with a reason, regenerate, submit and approve. Original approvals are archived in payroll_run_versions (migration 015).
- Complete payroll-source writes and calculations use the shared transaction advisory lock 76239146. Keep stale checks and state transitions inside the same withUser transaction. Do not bypass this lock in new mutations.
- Staff tabs are selected manually; no presets. Owners retain all tabs. Every page, export and action must enforce server authorization. Team members is /team; Employees remains /employees. Account management writes remain admin-only.
- Payroll rules in docs/02-payroll-rules.md describe this project's currently installed behavior. Do not silently substitute the rules from the 3110 pilot. UI changes must not alter calculations, recorded dates, source snapshots or approval permissions.
- Use synthetic data in an isolated database for mutation tests. integrity.db.test.ts commits data and is guarded to motonorte_integrity_test. Never run tests that delete records against live credentials merely because their transactions claim to roll back.
- Run relevant payroll/auth/database tests, lint, typechecking and production build, then check desktop/mobile and assigned/unassigned tabs. Report full E2E checks separately from targeted browser checks.
- Rollback scripts: scripts/rollback-ui.ps1 restores the pre-redesign app image; scripts/rollback-attendance.ps1 restores the original app image. Both retain the current live database and credentials. ValidateOnly checks archive hashes before any service changes.

## Employee portal
- Crew users have access_kind=crew and a unique employee_id. Their app_role() deliberately returns NULL so legacy office functions and policies cannot authorize them. app_employee_id() and explicit own-record SELECT policies provide portal access. Never change this to return staff.
- Crew tabs are manually selected from profile/mypay/payslips; an office tab assignment must never bypass the crew boundary. Users and employees remain distinct linked records.
- No email invitations. Admin creates or resets a 7-day one-use activation code, stored only as a hash and excluded from audit payloads. Never log or print activation codes/passwords.
- A payslip approval allows one POST PDF download for the employee's own request, not one physical print. Browser GET/HEAD/prefetch must not consume it. Approval snapshots are fixed; reopening payroll revokes unused approvals.
- Range selection uses scheduled payday and preserves complete weekly calculations. Payroll approved and payment recorded are distinct states.
- Payment entries are append-only, owner-only and limited to approved unpaid net; never insert real payments or approve real payroll during QA.
- New migration runner serializes runs and checks SHA-256. Existing migrations get a one-time baseline checksum; historical edits before that baseline cannot be detected. Reset requires *_test DB and ALLOW_TEST_DATABASE_RESET=1.
- rollback-mypay.ps1 restores the exact pre-portal app image, preserving live data. Employee portal functions need the new image after rollback.

## Printed payslips
- Admin browser-print and employee one-use PDF layouts follow the supplied A4 Payslip design. Exclude 13th-month estimates from print; My Pay viewing remains unchanged.
- Keep all PDF values in frozen approval snapshots. Do not query current payroll in the PDF renderer or recompute historical amounts. Missing legacy metadata must not be invented.
- Await PDF generation before consume_payslip inside the same transaction. Keep same-origin POST enforcement and one-use ownership checks.
- Preserve self-hosted print fonts, peso glyph support and OFL licenses. JetBrains-derived print font is renamed MotoNorte Slip Mono after adding the licensed Manrope peso glyph.
- Use scripts/rollback-payslip-design.ps1 for app-only layout rollback; it retains live database records and credentials.
- Monthly/multi-day payslip requests always include combined-category totals, even with one approved week. Keep employee preview, admin review and PDF totals consistent through lib/portal/summary.ts. Totals include approved weekly net by scheduled payday; never include drafts or recalculate weekly deductions/rounding. Closing carried balance is the latest week, not the sum of carried balances. Clearly mark absent approved paydays as a partial range. Preview is own-employee-only and no-store. App-only rollback: scripts/rollback-monthly-payslip.ps1.
