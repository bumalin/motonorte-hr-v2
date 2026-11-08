# Employer government contributions

Deployed October 12, 2026 at approximately 08:15 Riyadh time after the authorized reset window. Migrations 018–020 applied successfully; the exact tested app image is healthy at localhost:3005. Fresh backup and isolated restore matched all 21 original tables, and post-deployment comparison confirmed original table values unchanged. Live browser check reached sign-in; authenticated owner/crew checks remain isolated-test verification.

## Behavior

Administrators enter recurring monthly SSS, PhilHealth and Pag-IBIG under Employees → Employer contributions. These are entirely employer-funded costs, excluded from basic/base/gross/deductions/net/carry-over/13th-month/payment balances. Edits start next month; an initial future hire's pending amounts can be corrected before their effective month.

Recording starts November 1, 2026. Existing payroll and approval snapshots are not backfilled. Ordinary allocation divides monthly centavos across the actual Sunday paydays, distributing remainder centavos to the earliest Sundays. Overlapping weeks follow payday attribution.

Hires on days 1–5 qualify for the full joining month, catching up missed early Sundays on their first payroll; later hires start next month. Departures retain the full eligible month, settled on final payroll. A next-month final payday retains the earlier benefit-month label.

The dashboard and separate `/reports/contributions` report show planned, approved and remaining totals by benefit month, with employee rows, weekly reconciliation and CSV export. Unknown configuration/legacy metadata is distinct from zero. My Pay, weekly print/PDF and monthly PDF summaries use frozen allocations. These amounts do not confirm agency remittance.

## Verification

- Pure tests: 71 passed, one database-dependent case safely skipped.
- Fresh synthetic database regressions: eight passed. Contribution tests also verify cross-month final settlement, frozen termination dates, snapshots, unknown coverage and old-image legacy approval.
- Full isolated Edge E2E: 34 passed. Targeted contribution workflow: two passed, including owner configuration, staff/crew denial, report/CSV, actual payroll generation/approval, crew preview, PDF download and one-use repeat refusal.
- Lint/typechecking passed. Standard Linux production build passed in a separately tagged Docker candidate. Windows native builds encountered worker-process/file-permission failures; release verification uses the Linux image.
- Synthetic PDF: category values, unchanged net and peso glyph verified; four pages rendered and visually reviewed. Desktop print and mobile report/My Pay screenshots saved in ignored `test-results`.
- Independent review identified three issues; failing isolated regression tests reproduced them, and migration020/coverage handling fixed all three.
- Exact candidate migrations were also applied to a restored live backup on an internal temporary network with no published ports. All original values in the 21 original tables matched after excluding the new metadata columns and the three new migration entries. Evidence: `backups/contributions-upgrade-verification.json`.

## Recovery and release

Original source: `backups/source-2026-10-11T20-14-00-820Z/source.tar.gz`.
Original database and exact app image: `backups/before-contributions-2026-10-11T20-14-13-546Z/`.
Database restored in a separate network-isolated tmpfs container; all 21 table fingerprints matched a consistent source snapshot. Restore container removed. Archive hashes and rollback-script syntax validated.

New additive migrations are 018–020; all prior applied migration checksums remain unchanged. Candidate image is `motonorte-office-app:contributions-candidate`; live `latest` and localhost:3005 were not replaced during QA.

Verified candidate image ID: `sha256:6bbbd8b91a9ebd8823c23668535bada31549f59b1144885f0c0f285f357cdfa6`. Use this exact image for the tested release.

After deployment approval: refresh the live database backup, run migrations from the candidate using the existing Compose migrate-service environment/network, confirm success, then replace only the app through a candidate-image Compose override. Preserve `.env`, live records and named volumes; do not rebuild or change database/Caddy/backup services. Check owner/crew read-only paths without real approvals/payments.

App-only recovery script: `backups/before-contributions-2026-10-11T20-14-13-546Z/rollback-app.ps1`. It retains the current database and credentials. Windows execution policy may require equivalent commands in the current shell. Database restoration requires separate review because it would discard later records.

Legacy request approvals without contribution metadata remain supported by an old app image. Requests involving newly recorded contributions require the new app's complete snapshot; an old app cannot approve incomplete new snapshots. Return to the candidate/new image for contribution functionality.

## Execution rulings

- Reused the current codex feature checkout, preserving existing uncommitted reports/dashboard changes and verified backups. Cost if wrong: accidental source edits require comparing/restoring the source backup. No merge or push.
- Added 019 and 020 rather than changing already applied migrations. Cost: three additive migrations instead of one.
- Legacy-only monthly PDFs retain their original page count; recorded contribution ranges add a benefit summary page. Cost: one extra page for new monthly/multi-week slips.
- Verified deployment through the Linux Docker build after native Windows failures. Cost: Windows native builds remain environment-limited.

Full logs and task ledger remain in ignored `backups`. No independent-review minor findings were deferred.


## Review fixes (2026-11-08, not yet deployed)

- Stale-draft hash: contribution inputs now carry only what can change a week's allocation (the period's employees, the benefit months the week can touch, and prior approvals only for final settlements or later paydays). Locking an unrelated week no longer marks other drafts stale. The SQL validator still checks entitlement against every approval. Deploying this changes the hash shape once, so any open draft must be regenerated after the update.
- Migration 021: first-time contribution setup also skips a month that already has a submitted week.
- Contribution database errors now show plain-language messages.
- Pay history loads contributions in one query; the dashboard uses a single transaction; legacy/unconfigured printed slips omit the contributions block.
- Verification: typecheck, lint, 73 unit tests, 10 database tests on a disposable `motonorte_integrity_test` (including two new regression tests), production build.
