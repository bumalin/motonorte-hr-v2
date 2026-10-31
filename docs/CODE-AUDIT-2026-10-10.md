# Code audit — localhost:3005 — 10 October 2026

Reviewed project: C:\Users\kcmat\MotonortePayroll. Running container: motonorte-office-app-1. Source is not a Git checkout, so there is no commit identity to cite. Running app image and complete source were backed up before any live modifications.

## Verdict

The existing application has a tested foundation, but should not be signed off as solid yet. A concurrency defect was reproduced on synthetic data in an isolated database. No live source, payroll records or credentials were changed during this review.

## Findings

1. **High: an in-flight source edit can commit after payroll approval.** The attendance/job/adjustment freeze trigger checks the current run status without a shared lock with submit/approval. In a real PostgreSQL reproduction, transaction A updated attendance while the run was a draft and held its commit. Transaction B submitted the run, recomputed the input hash (seeing the old committed attendance), and locked it. Transaction A then committed successfully. Result: run status locked and stored hash different from the live input hash. This bypasses the intended freeze. See db/migrations/004_freeze_and_caps.sql:guard_locked_day, app/(app)/payroll/actions.ts:submitRun and lockRun, and db/migrations/009_backdating_and_tab_access.sql:lock_run. Fix requires consistent transaction locking across source writes, generation, submission and approval, plus a concurrency regression test. Preserve applied migrations; add a new migration.

2. **Historical run versions are not retained as separate payroll snapshots after reopening.** unlock_run turns the existing record back into draft and clears locked_by/locked_at. save_draft then updates that run and deletes/replaces its payroll_lines and payroll_items. Audit records may retain old changes, but the original approved run is no longer a directly available immutable payroll version. Reproduced unlock result: status draft, locked_by null, locked_at null. See db/migrations/013_unlock_and_back_pay.sql:unlock_run and db/migrations/009_backdating_and_tab_access.sql:save_draft. If approved payroll must remain accessible as an unchanged historical version, preserve the old run and create a new revision for corrections.

3. **Migration protection is weaker than the previous project.** db/migrate.ts identifies applied migrations only by filename, with no checksum validation or cross-run migration lock. Its --reset option drops the public schema without a database/environment guard. Do not run db:reset on this live database. Add guardrails before operational changes.

## Existing access management

This project already implements arbitrary staff tab assignments in Settings: Dashboard, This week, Employees, Payroll, Incentive jobs, Reports, Settings and Audit log. Navigation filters these tabs. Pages and staff Server Actions use requireTab; reports CSV enforces its permission. User management and final approval remain owner-only. Password/role/active/email changes revoke sessions; tab changes are read from the database on the next request. The redesign can improve how this existing feature is presented instead of replacing the auth system.

## Rule alignment to resolve before changing payroll

This project's approved rule document and fixtures specify Sunday payday, full-day mechanics sharing a daily pool, and specialty jobs credited to one mechanic even when absent. Attendance uses full/half/absent/rest, with overtime separately. Those differ from the earlier 3110 brief (payday after Sunday, arbitrary partial hours, manual recipients per service). Treat this as a requirements reconciliation, not a UI change; no calculation rules were changed in this audit.

## Checks completed

- All 56 automated tests passed, including both database integration tests (none skipped in the final run).
- All db/tests/verify.sql checks passed on a separately initialized PostgreSQL 17 container with synthetic seed data and all 14 migrations.
- ESLint and TypeScript checks passed.
- Production Next.js build passed. An initial isolated-build failure was caused by an audit-container symlink outside the build root; rerunning with dependencies inside the root succeeded.
- Live app and PostgreSQL were healthy; identified the correct Compose source directory and volume.
- Backed up live source, environment, database, roles, exact app image and local HTTPS data. Isolated restore passed. Backup: backups\before-redesign-20261010-133051.
- Reproduced the concurrency defect and reopening behavior only on synthetic data, using a separate container/network with no published database ports.

## Pending

- Fix and regression-test the concurrent approval/source-write defect.
- Decide whether reopened runs require immutable versions, then implement that behavior if confirmed.
- Reconcile the payroll rule differences before changing calculations.
- Run the full browser E2E suite and desktop/mobile redesign checks after the fixes. They were not run in this audit.
- No redesign or new authentication system was installed on port 3005.

## 10 October 2026 follow-up

Findings 1 and 2 were addressed by migration 015 and transactional Server Action changes: attendance is admin-only, edit/approval operations serialize, and reopening archives the previous approved run. The exact race reproduction became a passing disposable-database regression test. The current source also includes the installed UI redesign and custom Team tab (migration 016). See ADMIN-ATTENDANCE-2026-10-10.md and UI-REDESIGN-2026-10-10.md for validation and rollback. Migration-runner guardrails (finding 3) and the documented rule reconciliation remain separate work; no calculation rules were silently changed.
