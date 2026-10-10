# Payslip design correction — 2026-10-10

Installed locally on http://localhost:3005. The existing admin browser-print page and employee approved PDF now follow the supplied Payslip.dc.html A4 design: official logo, condensed header, red net-pay panel, days paid, earnings/deductions tables, signature lines and contact footer. The 13th-month field is excluded from print at the user's request; the My Pay estimate remains unchanged.

No migration or live data transformation. Payroll amount calculations, stored approvals, historical snapshots, activation credentials, sessions and download authorization are retained. Old approval snapshots remain readable; absent historical rate/day-count metadata displays a dash or calculation-detail reference rather than an invented value. New snapshot print metadata derives rates and days from the stored payroll items. Employee hire date and designated day off are frozen when the document is approved. Historical item provenance appears on additional pages. A multi-week request produces a range summary and one slip per week plus detail pages as needed. A single week starts directly with its payslip.

Print fonts are self-hosted Manrope, Barlow Condensed and JetBrains Mono. Latin + extended subsets are merged for Filipino names/currency. JetBrains Mono lacks the peso glyph, so the licensed Manrope peso outline is added to the renamed MotoNorte Slip Mono print font. Original OFL license files are in public/payslip-fonts. PDF generation now awaits completion inside the existing approval-consumption transaction; failure before completion does not consume approval. Download still requires a same-origin POST and one fresh admin approval per issue.

## Verification
- Backup source, .env, exact app image and PostgreSQL dump created before changes; dump restored into a network-isolated disposable PostgreSQL 17 container.
- Full 61/61 payroll/auth/portal regression tests passed, zero skips, on a fresh isolated motonorte_integrity_test DB. An initial fixture omission in the test container was corrected before the successful rerun.
- Existing SQL verification: ALL CHECKS PASSED.
- Final lint, type generation, TypeScript checks and production build passed.
- Actual QA admin browser sign-in and print preview verified; A4 sheet dimensions and footer bounds checked.
- Mobile 390px: page width375px; A4 preview scrolls inside its container. Desktop preview reviewed.
- Actual QA employee sign-in, approved request, PDF download and USED status/button removal verified with the production candidate. Generated PDF reopened and rendered with Poppler; peso glyph and net pay present, 13th-month field absent.
- Synthetic weekly and monthly PDF previews rendered and visually checked. 53-week pagination regression passed.
- Live employee/attendance/payroll_runs/payroll_lines/payroll_items fingerprints unchanged across app replacement; .env hash unchanged; volume motonorte-office_pgdata retained.
- Physical printer output and the operating-system browser print dialog were not tested. Full unrelated browser E2E suite was not rerun.
- npm audit reports existing production issues in Next.js16.3.6, sharp and source-map-js; no PDF rendering dependency findings. Framework/security upgrades remain separate work.

## Backup and rollback
Private backup: backups/before-payslip-design-20261010-160123. Contains source.zip, environment.env, database.dump, app-image.tar, app-image-id.txt, restore-verification.txt and SHA256SUMS.txt.
scripts/rollback-payslip-design.ps1 -ValidateOnly verifies archive integrity without changing services. Running it without ValidateOnly restores only the previous app image and retains the current DB, credentials and employee portal data. Do not restore the old database dump over newer HR writes to undo a layout change. Source remains updated; a rebuild rolls forward.

Candidate image: motonorte-office-app:payslip-design-20261010, also latest. Running image identity: sha256:b95f76d93eb2af06419d43f4ce3f8f4767e07edafb5c5af1898c44f957a73bee.
