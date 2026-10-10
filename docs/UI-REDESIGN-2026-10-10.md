# UI redesign release — 10 October 2026

Live project: C:\Users\kcmat\MotonortePayroll, http://localhost:3005, Compose project motonorte-office. Adapted from D:\Downloads\MotoNorte-HR-Redesign.

## Installed
- Shared desktop sidebar, sticky breadcrumb/account header, square surfaces, MotoNorte red accents, condensed headings, larger touch targets and consistent financial typography.
- Phone bottom navigation shows only assigned tabs. More is a keyboard-accessible native modal. Main content fits the phone viewport instead of keeping the desktop sidebar alongside it.
- Existing list/breakdown tables become labelled employee/run/report cards on phones. Attendance has a dedicated expandable employee card with day-by-day controls; administrators can edit and staff remain read-only.
- Dedicated /team screen for sign-in accounts and manually selected tab switches. No fixed staff presets: new staff accounts start with no tabs checked. Existing tab assignments were preserved by migration 016. Owners/admins keep all tabs. Account creation still uses temporary passwords shared privately; no email invitation service was added.
- Existing Settings account editor remains available as a compatible entry point and links to Team members.
- Official existing logo and self-hosted fonts preserved. The design's Manrope/JetBrains font files and canvas runtime were not supplied; local Inter and system monospace are used with the supplied Barlow condensed brand font. Existing light mode remains available.
- Migration 015 admin attendance permissions, atomic payroll transactions and archived approvals were installed before this UI release. The payroll engine and the project's currently installed calculation rules were not changed by the redesign.

## Validation
- 57 automated tests passed, including real PostgreSQL regression tests, staff write denial, edit-versus-approval ordering and immutable approved versions after corrections.
- SQL integrity/permission verification passed on an isolated PostgreSQL database with migrations 001–016.
- ESLint and TypeScript checks passed; final production Docker build passed.
- Browser checked at desktop 1366×900 and phone 390×844: Team screen, employee cards, attendance cards, payroll cards, Reports and the More modal. Phone employee page had no page-wide horizontal overflow.
- In the disposable app, an administrator selected only Payroll + Reports for a synthetic staff account. Selection persisted after reload; the staff menu contained only those pages, and direct Employees/Team URLs redirected away. Test passwords and synthetic records were never added to the live database.
- Fresh live backups before migrations 015 and 016 were restored successfully in separate disposable databases. Payroll and source data digests matched before/after the live migrations.
- Full Playwright E2E suite was updated for administrator-only attendance but has not been rerun as a complete suite. Targeted browser checks and database workflow tests are separate from that claim.

## Rollback

Pre-UI rollback (includes attendance safeguards): backups\before-ui-20261010-135912.
Original full backup: backups\before-redesign-20261010-133051 (includes database roles and local HTTPS data).

From the project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback-ui.ps1 -ValidateOnly
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rollback-ui.ps1
```

The second command restores only the exact pre-UI app image. It keeps PostgreSQL, .env, current payroll data, archived approvals, and the additive migration protections. Current source stays redesigned; a rebuild would roll forward. Database recovery must always be verified in a separate database before an intentional connection switch. Never down -v or reset the live database.
