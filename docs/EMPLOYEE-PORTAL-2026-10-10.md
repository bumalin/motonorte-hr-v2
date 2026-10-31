# Employee portal release — 10 October 2026
Project: C:\Users\kcmat\MotonortePayroll; local app http://localhost:3005; Compose motonorte-office.
Installed migration 017_employee_portal.sql and image motonorte-office-app:mypay-candidate-20261010 (also tagged latest).
Image digest: sha256:bb03526156c98b272dcbefd14cb83ff1b13121f58bfd1d1064f04c0837ae9f2e.

## Using it
1. Sign in as administrator. Open Team members, then Employee login — no invitations.
2. Choose an existing employee, enter their email, select My Profile/My Pay/Payslip requests as desired, and create the account.
3. Copy the one-time activation code shown immediately. Share it privately with that employee; no email is sent. Codes expire after 7 days.
4. Employee opens the app's /activate page, enters email/code and chooses a password of at least 12 characters. Normal sign-ins then use email/password.
5. Admin can edit email/tabs, disable access, or generate a replacement activation code on the member card. Employee ownership is fixed; existing attendance and payroll records are retained.
6. My Pay shows own approved earnings and breakdowns, plus a draft estimate when available and not stale. Profile corrections and attendance edits remain admin work.
7. For a printable document, employee chooses a month or custom payday range. Only complete approved weeks with scheduled paydays in that range are included. A September 28–October 4 week belongs to October.
8. Admin sees Employee requests and a pending badge. Header notifications refresh every 30 seconds while the page is visible. Admin reviews the included weeks and approves one download or rejects with a reason.
9. PDF approvals expire after 7 days. Employee downloads once; another request needs another approval. A saved PDF can be copied or printed outside the system; physical print counts are not enforceable.
10. Admin records actual payments under Employee requests → Payment tracking. Approval alone is not marked Paid. Existing historical runs have no payment records until verified payments are entered.

## Data and security
Crew access_kind is separate from office staff. Crew app_role() is NULL, blocking legacy office mutations; own-row policies and manually selected personal tabs control access.
Passwords use existing scrypt/session protections. Activation codes are hashed, consumed atomically and excluded from audit data.
PDF requests are approved against stored amounts and payroll lock markers, then frozen. A POST download consumes approval atomically; GET/HEAD cannot consume it. A failed generation rolls back consumption; a network failure after commitment needs a new request.
Reopening payroll revokes unused approvals. Issued snapshots are retained when employee names or payroll change.
Payment entries are retained and owner-only, limited to unpaid approved net. There is no payment reversal UI in this release; verify entries before recording.
No calculation rules, payroll periods or recorded paydays were changed.
Migration runs now serialize and verify checksums. Existing migration files get a one-time baseline checksum, which cannot detect pre-baseline edits.

## Backup and rollback
Private backup: backups/before-mypay-20261010-143852.
Includes original source, .env, roles, full database, exact previous image and HTTPS configuration. Two fresh pre-017 dumps were also saved and restored separately.
Upgrade was rehearsed against a restored database; live financial, employee and attendance snapshots compared unchanged. Environment file and motonorte-office_pgdata preserved.
scripts/rollback-mypay.ps1 -ValidateOnly passed. Running the script without ValidateOnly restores the pre-portal app image and keeps the current database/credentials. Portal screens become unavailable until the new image is restored; never overwrite new live transactions with an old dump as an app rollback.

## Validation
61/61 tests passed, none skipped, with synthetic data in a clean PostgreSQL 17 database. Existing SQL verification: ALL CHECKS PASSED. ESLint, type generation, TypeScript and production build passed.
After the last PDF spacing change, targeted PDF/range/tab regression passed again and final production image rebuilt successfully.
Browser checks against the candidate image: admin-created linked login, first-login activation, normal employee login, own profile/pay, office payroll denial, date-range request, September month selection, reload persistence, admin notification/approval, synthetic payment recording and a real one-use PDF download changing request to Used.
Phone 390x844: document width 375, no horizontal overflow; desktop layout reviewed at 1366x900.
PDF rendering reviewed with Poppler on all three pages of a two-period September specimen. Weekly amounts, summary, approver and document ID preserved, with no clipping/overlap in reviewed specimen. Standard PDF fonts support Latin-script names; unsupported glyphs use a fallback.
Live installed login/activation pages verified. Live authenticated admin check awaits user sign-in (session expired); no live credentials were reset.
No real employee login accounts, payments or requests were created by QA: live users remain 2 office accounts; new payment/request tables are empty.
Full automated browser E2E suite was not rerun; targeted browser workflows above were performed with synthetic data.
Leave management, employee change requests, payment reversals and external hosting are separate future work.
