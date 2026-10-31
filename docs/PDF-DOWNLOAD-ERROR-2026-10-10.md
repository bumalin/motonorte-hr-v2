# Payslip PDF download error message

`app/(app)/my-payslips/[id]/download/route.ts` previously answered every failure with 409 "Approval unavailable, expired or already used". A PDF rendering failure rolls the transaction back, so the approval is still unused — the message sent employees to request a needless fresh approval.

Now only `DOWNLOAD_UNAVAILABLE` (missing, expired, used or not own approval) returns 409 with that message. Any other error is logged server-side and returns 500 "Couldn't generate the PDF. Your approval was not used; please try again." One-use consumption, same-origin POST and ownership checks are unchanged. No database or calculation changes.

## Deployment (office PC, live at http://localhost:3005)

The office PC remains the live system; the VPS move is not planned. The app had been stopped at 15:24 UTC for a VPS transfer dump; it was restarted on the new image.

- Backup: `backups/before-pdf-error-fix-20261010-194449/` — live database dump, source archive at HEAD plus uncommitted patch, SHA-256 sums. Previous app image tagged `motonorte-office-app:before-pdf-error-fix-20261010`.
- Restore test: dump restored into a disposable `restore_test` database; all 21 public table counts and content fingerprints matched live (`db/tests/verify.sql` needs seed data and does not apply to live data). Test database dropped.
- New image `motonorte-office-app:pdf-error-fix-20261010` (also the first run of the Next.js 16.3.8 security patch). Migrations up to date; app healthy; live table fingerprints identical before and after.
- Not exercised live: the 500 path needs an approved payslip and a forced render failure, which must not be done on live data.
- Office HTTPS (`https://192.168.50.241`) was unreachable because this PC was on another network (10.10.10.230); Caddy cannot bind until the PC is back on the office network. Pre-existing, unrelated to this change.

Rollback (keeps live data):
```bash
docker tag motonorte-office-app:before-pdf-error-fix-20261010 motonorte-office-app:latest
docker compose --profile prod up -d app
```

Hand-off:
- [x] Fix implemented; typecheck, lint, 62 unit tests, production build pass
- [x] Backup taken and restore-tested
- [x] Deployed to office PC; health and data checks pass
- [ ] Committed (held local at the Owner's request)
- [ ] Office network HTTPS rechecked once the PC is back on 192.168.50.241
