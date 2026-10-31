# Admin attendance correction — 10 October 2026

The owner role is the administrator role in this app. Attendance editing (including empty-cell filling and deletion) is owner-only in the UI, Server Actions and PostgreSQL policies/triggers. Staff with the This week tab can view attendance; assigning a tab does not grant admin authority.

To correct the latest locked payroll: open its Payroll run, choose Reopen week, provide a reason, correct attendance, regenerate the draft, submit and approve again. Sending a submitted run back also remains owner-only. Reopening an older locked week is still blocked by the existing carry-over ordering rule. Calculations and incentive rules are unchanged.

Migration 015 retains each original approval with all payroll lines/items and employee labels before reopening. Previous approved versions appear on the run page. They cannot be edited through the app or removed with ordinary UPDATE/DELETE, and remain unchanged on regeneration.

The small office app serializes its withUser transactions and payroll-source writes using a common transaction-scoped advisory lock. Submission's stale check is now in the same transaction as submit_run. This prevents an edit in flight from committing after approval. Requests briefly queue behind each other; this deliberately prioritizes correctness for this local pilot.

Rollback: scripts\rollback-attendance.ps1 -ValidateOnly checks the original archive; running without the switch restores only the exact prior app image. The database, volume, .env, admin-only DB rules and archived versions stay in place. The old UI does not show archived versions. Do not drop migration 015 or restore over the live database to undo a UI release. Use a separately restored database only for deliberate disaster recovery.

Backup: backups\before-redesign-20261010-133051. A fresh pre-migration dump is saved there before live installation. Existing payroll snapshot digests are compared before/after the additive migration.

Validation: 57 automated tests passed on synthetic data in a disposable PostgreSQL instance, including staff insert/update/delete denial, both concurrency orderings and immutable versions after admin corrections. SQL verification passed. Lint, typecheck and production build passed. Targeted browser verification confirmed staff read-only controls, admin editing and reload persistence, and visible archived approvals. The inherited phone sidebar/layout still needs the planned redesign. The full Playwright suite was updated for the new permission but has not been rerun end-to-end.
