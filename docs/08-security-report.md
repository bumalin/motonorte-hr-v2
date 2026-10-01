# Security Report — Motonorte HR & Payroll

Owner agent: security-auditor · Date: 2026-09-26 · Standard: OWASP ASVS 4.0 Level 2 (as a checklist, not a certification)
Inputs: `docs/03-architecture.md` (§3, §9, Data Model deviations), `docs/runbook.md`, `docs/reviews/*`, `db/migrations/001–005`, `db/tests/verify.sql`, all of `app/`, `lib/`, `scripts/`, `proxy.ts`, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.github/workflows/ci.yml`. Also the running systems: the prod build at http://localhost:3001 (container `motonorte-payroll-app-1`), the dev server at http://localhost:3000, and the DB container `motonorte-payroll-db-1`.

## Verdict

**Overall: FAIL.** There are 2 open High findings and 0 Critical. Both are about **going online (Stage 2)**: login rate limiting, and encryption of off-server backups. Neither one can be exploited in the Stage 1 setup, which is localhost only. Each has a blocker task in `docs/06-task-queue.md`: TASK-024 and TASK-025.

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 2 | H-1, H-2 |
| Medium | 4 | M-1 … M-4 |
| Low | 9 | L-1 … L-9 |
| Info | 5 | I-1 … I-5 |

The core design holds up under attack.
- **RLS:** policies are correct for every role, and every SECURITY DEFINER function checks the caller's role.
- **Payroll immutability:** locked and submitted weeks cannot be changed.
- **Gov't IDs and bank accounts:** masked everywhere, and every reveal is logged.
- **Server Actions:** each one authenticates and validates its own input.
- **CSRF:** cross-origin requests are rejected.
- **Secrets:** none in the repo, the image, or the client bundles.
- **Dependencies:** zero known CVEs.

All three earlier review fixes still hold: the pg_temp shadowing fix, the throttle race fix, and session revocation.

## How this was tested

- **DB probes** ran in transactions that were rolled back. Each probe ran as `app_user` (`set role app_user` from the owner session), with `app.user_id` set to empty (anonymous), the real dev staff and owner accounts, an inactive user, and a garbage value. Scratch SQL is in the session scratchpad, outside the project.
  - Role escape tests used a **direct** `app_user` login, because a superuser session can `SET ROLE` back to itself. That makes `SET ROLE` tests from an owner session meaningless.
  - `db/tests/verify.sql` was re-run against the dev DB (it rolls itself back): **68 PASS, ALL CHECKS PASSED**.
- **HTTP probes** used Node `fetch`/curl against :3001 (prod build) and :3000 (dev).
  - Signed in as `staff@motonorte.test`, with the password read from `.env` and never printed. Signed out again afterwards.
  - Owner-only Server Actions were called directly by action ID. All targets were random UUIDs, so nothing could change even if a check was bypassed.
  - The throttle was tested with made-up `@example.invalid` emails. The owner account was never used for failed logins.
- **Nothing in app code, `.env` or config was modified.** The only data written to the dev DB comes from normal app use: two staff logins and logouts (sessions, login_attempts, `last_login_at` and its audit rows) and the throttle probe's rows for the made-up emails.

---

## Controls: pass/fail

| # | Control | Result | Evidence / finding |
|---|---|---|---|
| 1 | Every table has RLS | **PASS** | All 17 app tables `relrowsecurity = t`. `sessions`/`login_attempts` have no policies and no grants (functions only). `schema_migrations` has no RLS but also no grant to `app_user`, so it is unreachable (I-4). Views are `security_invoker`. |
| 2 | Cross-role reads/writes denied | **PASS** | See the RLS probe table below. |
| 3 | SECURITY DEFINER functions | **PASS** (see M-2) | All 18 pin `search_path=public, pg_temp`. None is executable by PUBLIC. `app_user` has no TEMP, no CREATE on `public`, cannot `SET ROLE app_owner`, and cannot set `session_replication_role`. Role checks are present in save_draft, submit_run, send_back_run, lock_run, carried_in_for, user_name and log_reveal. The `auth_*` functions have no role check by design (pre-login, I-1). |
| 4 | No trust in client role claims | **PASS** | Role comes only from `users.role` via `app_role()`. `app.user_id` is set only from the DB-validated session (`withUser(user.id)`). No action accepts a user ID or role from the client. `lib/db/runs.ts#currentRunHash(userId, …)` is **not** a Server Action: it is absent from the production `server-reference-manifest.json`, which lists exactly 28 actions, all accounted for. |
| 5 | Auth: hashing, tokens, cookies, throttle, logout, expiry | **PASS with findings** (H-1, M-4, L-2, L-3) | scrypt with per-user 16-byte salt, NFKC normalization and `timingSafeEqual`. Unknown users get a dummy verify, so timing is equal: unknown email took 111 ms vs a similar path for real accounts per code. Token: 32 bytes `randomBytes` (43 chars base64url), only its SHA-256 is stored. Cookie observed: `mn_session=…; Path=/; Secure; HttpOnly; SameSite=lax`. New token at every login. Logout deletes the row; the old token redirects to /login (verified). Password reset, role change and deactivation delete sessions (002/003 trigger, verify.sql). |
| 6 | Login throttle race (review TASK-005..006) | **PASS** (fix holds) | 12 concurrent wrong logins for one email gave exactly **5** generic replies and 7 "Too many attempts". The 13th was throttled. |
| 7 | CSRF / open redirects | **PASS** | A cross-origin Server Action (`Origin: http://evil.example`) with a valid session was rejected (`Invalid Server Actions request`, E80). Cross-origin login was also rejected. The only Route Handler is GET and read-only. Every `redirect()` target is a fixed path or a server-generated UUID/date. |
| 8 | Server Actions: authz + input validation on every one | **PASS** (L-8) | All 28 call `requireUser()`/`requireOwner()` first and validate with zod (`z.guid()`, enums, regex dates, caps). postgres.js tagged templates are used everywhere, with no `unsafe` in app code. Dynamic identifiers are enum-restricted (`revealField`) or come from zod-stripped objects. As staff: setUserActive, removeHoliday, decideTerms and setJobActive returned FORBIDDEN, and lockRun returned "Only the Owner…". A malformed saveCell returned "Invalid entry.". Anonymous or forged-cookie calls stop at `requireUser`. |
| 9 | Route Handler `reports/export` | **PASS** | Anonymous request gets 307 to /login. Bad month/year/kind get 400. Staff gets CSV with `no-store`. The CSV neutralises formula injection and contains no IDs or bank data. |
| 10 | DB owner credentials never used by the app | **PASS** | App container env holds only `DATABASE_URL` (app_user) and the OPENAI vars. The owner URL exists only in `migrate` (one-shot) and `backup`. `create-user` runs via `migrate`. |
| 11 | No secrets in `NEXT_PUBLIC_*` / bundles | **PASS** | No `NEXT_PUBLIC_` anywhere. `/app/.next/static` contains no `postgres://`, `scrypt$`, `DATABASE_URL`, `app_owner` or dev password names. No source maps are shipped. |
| 12 | Secrets only in env, nothing committed | **PASS** | The repo has no commits yet. `.env*` is gitignored (except `.env.example`, which holds placeholders) and dockerignored. The image has no `.env` (checked with `find /`). CI uses throwaway passwords on an ephemeral service DB. `OPENAI_API_KEY` is empty. |
| 13 | DB port not reachable from the LAN | **PASS** for this project's DB | Only `127.0.0.1:5434` is published. The prod profile publishes only Caddy 80/443. **However, the dev app server is reachable on the LAN (M-1).** |
| 14 | Bank/tax IDs masked, reveals logged | **PASS** | The profile page masks in SQL (`••••` + last 4). The full value comes only from `revealField`, which writes `log_reveal` in the same transaction. The audit trigger masks `employee_private` (0 unmasked values in 199+ audit rows; sample `••••-000`). Payslips, CSV, reports and the dashboard don't select `employee_private`. |
| 15 | IDs never logged | **PASS** (latent risk L-9) | The only server log sink is `dbErrorMessage → console.error(e)`. No current code path can log an `employee_private` row. |
| 16 | IDs never sent to OpenAI | **PASS** (not wired) | No `lib/ai`, no `openai` dependency, no outbound HTTP code. US-051/TASK-023 is still `todo`. Compose passes `OPENAI_*` through, but nothing reads them (I-3). |
| 17 | Audit log immutability | **PASS** for the app (L-4) | `app_user` gets permission denied on INSERT/UPDATE/DELETE/TRUNCATE of `audit_log` as staff and owner, and cannot `disable trigger`. |
| 18 | Locked & submitted payroll immutable | **PASS** | Attendance, adjustments and holidays in locked **and** submitted weeks give PERIOD_LOCKED for staff and owner. save_draft on a locked period gives PERIOD_BEFORE_LOCKED; on a submitted one, RUN_NOT_DRAFT. Settings and pay terms in locked history give PERIOD_LOCKED. lock_run/send_back on a locked run are refused. A stale hash gives RUN_STALE. `payroll_*` has no write grants. lockRun computes the hash in the same transaction as `lock_run` (`for update`). |
| 19 | Money caps / int overflow | **PASS** | zod caps are matched by DB CHECKs (adjustments ₱1M, catalog and daily rate ₱100k). Negative amounts are rejected. `PG_TYPES` int8 parser throws above 2^53. `parsePesos` is integer-only, with at most 9 digits. |
| 20 | `npm audit` | **PASS** | `npm audit --omit=dev`: **0 vulnerabilities**. Full `npm audit`: **0 vulnerabilities** (next 16.3.6, postgres 3.4.x, react 19.2.8, zod 4.x). |
| 21 | Rate limiting on auth (and AI) endpoints | **FAIL** | **H-1.** The AI endpoint doesn't exist yet. TASK-023 already requires a rate limit. |
| 22 | Backups + restore documented and tested | **FAIL** | **H-2** (off-site copies are plaintext). Everything else passes: `umask 077`, `pipefail`, `gzip -t`, retention, §5 restore test and §6 fail-safe restore. The developer ran a restore plus verify.sql (TASK-021 review: 67 PASS). I verified the current dump is valid gzip, carries 46 `GRANT … TO app_user`, and that verify.sql passes on the live schema. I did not restore into a scratch DB in the dev cluster (dev DB is off-limits). See also L-6. |
| 23 | HTTP security headers | **PARTIAL** | **M-3.** Caddy sets HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy and strips `Server`. No CSP anywhere. Next sends none of these itself and advertises `X-Powered-By: Next.js`. |
| 24 | Production error pages | **PASS** | On :3001, 404 and 500 bodies carry only a `digest`, with no stack and no `node_modules`/`.ts:` paths. Thrown messages (e.g. `FORBIDDEN: owner only`) stay in the server log. The dev server shows full errors, which is expected but matters because of M-1. |

### RLS probe results (as `app_user`, rolled back)

| Actor | Attempt | Result |
|---|---|---|
| anonymous (`app.user_id=''`) | select employees / employee_private / payroll_lines / audit_log / users / views | 0 rows each |
| anonymous | insert employee · save_draft · select sessions / login_attempts | RLS violation · FORBIDDEN · permission denied |
| anonymous | user_name(owner) · carried_in_for | null · 0 rows |
| garbage `app.user_id` | app_role() | error (uuid cast), fails closed |
| inactive user | app_role() · select employees | null · 0 rows |
| staff | select users · password_hash | 1 row (self) · permission denied |
| staff | promote self to owner · reset owner password | 0 rows (RLS) |
| staff | insert user · approved pay terms · settings · holiday · catalog amount | RLS violation |
| staff | approve proposal · change approved rate · update settings / catalog / delete holidays | 0 rows |
| staff | insert/update/delete/truncate audit_log · delete employees/employee_private · write payroll_* | permission denied |
| staff | lock_run · send_back_run | FORBIDDEN |
| staff | read `users` rows via `audit_log` | **14 rows: emails, roles, last_login_at of all users** (L-1) |
| owner | update/delete audit_log · delete employees | permission denied |
| owner | demote the only owner | LAST_OWNER |
| app_user direct | `SET ROLE app_owner` · `session_replication_role` · temp table · CREATE in public · `pg_read_file` · `COPY … PROGRAM` · `lo_import` · `ALTER TABLE audit_log DISABLE TRIGGER` | all denied |

---

## Findings

### H-1 · High · No IP-level rate limiting on login. Anyone can lock the Owner out, burn CPU and fill the disk
- **Where:** `app/login/actions.ts` (throttle is per email only), `db/migrations/001_init.sql` (`auth_recent_failures`, `login_attempts` never purged), `Caddyfile` (no limits).
- **Evidence:**
  - 5 failures per email per 15 min locks that email. The check runs **before** the password is verified, so the real Owner with the right password also gets "Too many attempts" (verified with a made-up email: the 13th attempt was throttled).
  - An internet attacker who guesses `owner@<company-domain>` needs only 5 requests every 15 minutes to keep the only Owner out indefinitely. The Owner is the only one who can lock payroll before payday.
  - There is no per-IP or global cap. Each unauthenticated attempt costs a 64 MiB scrypt (N=2^16, r=8) on the 4-thread libuv pool and inserts a permanent `login_attempts` row. Many emails from one IP means unbounded CPU queueing and table growth. Expired `sessions` rows are also removed only when someone logs out.
- **Scope:** Stage 2 (online) only. In Stage 1 the app is on 127.0.0.1, apart from the dev server (M-1).
- **Fix hint:**
  - Add a per-IP limit in front of login, e.g. Caddy `rate_limit` (caddy-ratelimit plugin) on `POST /login`, or a small per-IP window in `login_attempts` that uses the Caddy-set client IP.
  - Change the per-email lock from a hard lockout to a delay/backoff, or exempt the correct password from the email lock only after an IP check passes, so a third party can't lock the Owner out.
  - Purge `login_attempts` older than 30 days and expired `sessions` (e.g. inside `auth_record_attempt`).
  - Consider OPS-8 (restrict to office IP/VPN), which removes most of this exposure.
- **Blocker task:** TASK-024.

### H-2 · High · Off-server backup copies are plaintext and the runbook sends them to consumer cloud storage
- **Where:** `db/backup.sh`, `docs/runbook.md` §4.
- **Evidence:**
  - Each dump is `pg_dump | gzip` with no encryption. The current file contains `COPY public.employee_private (… tin, sss_no, philhealth_no, pagibig_no, … bank_account_no)`, plus `users` (password hashes), `sessions` (token hashes) and `login_attempts` (emails, IPs).
  - Runbook §4 tells the operator to copy backups off-server with scp to the office PC, or "rclone to Google Drive/OneDrive". That puts every employee's gov't IDs and bank account numbers, unencrypted, in a third-party account and on a PC outside the server's controls.
  - This breaks the "bank/tax IDs encrypted or restricted" rule. It is also a Data Privacy Act (RA 10173) exposure if that account or PC is compromised.
- **Fix hint:**
  - Encrypt before the file leaves the server: `pg_dump … | gzip | age -r <owner-public-key> > …sql.gz.age`, or `gpg --encrypt`. Keep the private key offline with the Owner. The server only needs the public key, so a stolen server can't decrypt old backups.
  - Update runbook §4/§5/§6 to decrypt on restore, and test a restore from an encrypted file.
  - Optionally add `--exclude-table-data=sessions --exclude-table-data=login_attempts` (see L-6).
- **Blocker task:** TASK-025.

### M-1 · Medium · The dev server listens on all interfaces and the firewall lets the LAN reach it
- **Evidence:**
  - `netstat`: `0.0.0.0:3000` and `[::]:3000` are held by `node.exe … next\dist\server\lib\start-server.js` (`npm run dev`).
  - Windows Firewall has an enabled inbound **Allow** rule for `C:\program files\nodejs\node.exe`, TCP any port, Private + Public profiles.
  - `curl http://192.168.50.241:3000/login` returned 200.
  - Architecture §1/§9 says Stage 1 is "localhost only, with no office-network access".
  - The dev server shows full stack traces, runs against the dev DB, and has no IP rate limit (H-1). Any device on the same network, including public Wi-Fi, can try passwords.
  - Today the DB holds seed data. **This becomes High as soon as real employee data is entered for the local trial**, which §9 allows.
- **Fix hint:**
  - Bind dev to loopback: `"dev": "next dev -H 127.0.0.1"`, and do the same in `scripts/dev.cjs` (`process.argv.push("dev", "-H", "127.0.0.1")`).
  - Remove or scope the blanket node.exe firewall rule (Private only, or delete it).

### M-2 · Medium · Tables and SECURITY DEFINER functions are owned by a PostgreSQL superuser
- **Evidence:**
  - `app_owner` has `rolsuper = t` and `rolbypassrls = t`, because it is the `POSTGRES_USER` of the official image.
  - It owns every table, and all 18 SECURITY DEFINER functions run as it. `migrate` and `backup` also hold it.
  - Today the functions are tight: pinned search_path, no dynamic SQL, parameters used only as values.
  - But any future definer bug, or leak of the migrate/backup credentials, is a full superuser compromise. That means `COPY … TO PROGRAM` code execution in the DB container and bypass of all RLS and triggers. This conflicts with the architecture's intent that the table owner is used for migrations only.
- **Fix hint:**
  - Keep the image superuser (e.g. `postgres`) for bootstrap only.
  - Create a `NOSUPERUSER NOBYPASSRLS NOCREATEROLE` role `app_owner` in `db/init`, and run migrations and object ownership as that role.
  - Give `backup` a dedicated read-only role (`pg_read_all_data` on PG14+) instead of the owner password.
  - On existing DBs, transfer ownership with `REASSIGN OWNED`.

### M-3 · Medium · No Content-Security-Policy; Next sends no security headers of its own
- **Evidence:**
  - :3001 and :3000 responses carry only `Cache-Control` and `X-Powered-By: Next.js`.
  - The Caddyfile adds HSTS (1 year), nosniff, `X-Frame-Options: DENY` and Referrer-Policy, but no CSP and no Permissions-Policy.
  - The XSS risk is low today: React escaping, no `dangerouslySetInnerHTML`. But ASVS 14.4.3 expects a CSP for an app that reveals gov't IDs.
  - The headers exist only when traffic goes through Caddy.
- **Fix hint:**
  - Set headers in `next.config.ts` (`headers()`) so they apply behind any proxy.
  - Start with `default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. Next needs `script-src 'self' 'unsafe-inline'` or a nonce set up via `proxy.ts`; see `node_modules/next/dist/docs` on CSP.
  - Add `Permissions-Policy`.
  - Set `poweredByHeader: false`.

### M-4 · Medium · Users can't change their own password, and the Owner keeps knowing staff passwords
- **Where:** `app/(app)/settings/actions.ts` (`addUser`/`updateUser` are owner-only). No self-service change exists, and no change is forced at first login.
- **Evidence:**
  - The Owner sets a staff member's "temporary password" and it stays valid indefinitely.
  - Every audited staff action (pay-term proposals, attendance, submits) could therefore have been done by the Owner. That weakens non-repudiation of `audit_log` and the maker/checker split (staff propose/submit, Owner approves/locks).
  - ASVS 2.1.6 (users can change their password) and 2.3.1 (initial secrets must be changed on first use) are not met.
- **Fix hint:**
  - Add a "Change my password" action. It should re-verify the current password, go through a SECURITY DEFINER `auth_change_password(current_user_id, new_hash)` that checks `app_current_user_id()`, and sign out other sessions.
  - Add a `must_change_password` flag set by `addUser`/reset and enforced in `requireUser`.

### L-1 · Low · Staff can read every user's email, role and login times through the audit log
- **Evidence:**
  - As staff, `/audit?table=users` shows `owner@motonorte.test` and `last_login_at`. The DB probe returned 14 `users` audit rows with the keys `email, role, active, full_name, created_at, id, last_login_at`.
  - Every login updates `last_login_at`, which fires the audit trigger. The audit log is therefore a login timeline for all users, although the `users` policy lets staff see only themselves.
- **Fix hint:**
  - In `audit_row()`, skip UPDATEs where only `last_login_at` changed, or drop that key.
  - Restrict `users` audit rows to the Owner: `audit_select using (app_role() = 'owner' or table_name <> 'users')`.

### L-2 · Low · Session lifetime and cookie hardening
- **Where:** `lib/auth/session.ts`, `lib/auth/token.ts`, `auth_get_session`.
- **Issue:**
  - The 12 h expiry slides with no absolute cap, so a session used at least every 12 h lives forever.
  - The cookie has no `__Host-` prefix.
  - Logging in again doesn't revoke the session already in that browser.
  - There is no "sign out everywhere" for your own account.
- **Fix hint:**
  - Add an absolute limit: `created_at > now() - interval '7 days'` in `auth_get_session`.
  - Rename the cookie to `__Host-mn_session`.
  - In `login`, delete the previous token's row if a cookie is present.

### L-3 · Low · scrypt cost is slightly below current OWASP minimums, with no rehash path
- **Where:** `lib/auth/password.ts`.
- **Issue:**
  - N=2^16, r=8, p=1. OWASP currently lists N=2^17/r=8/p=1, or N=2^16/r=8/p=2.
  - Parameters are stored per hash, but nothing upgrades old hashes.
  - There is no breached/common-password check (ASVS 2.1.7). Only the 12-character minimum applies.
- **Fix hint:**
  - Move to N=2^17 (`maxmem` 256 MiB already allows it).
  - On a successful login, rehash if the stored parameters are below current.
  - Optionally reject passwords from a small common-password list.

### L-4 · Low · Audit log is immutable only against `app_user`
- **Issue:**
  - UPDATE/DELETE are refused through grants.
  - The superuser credentials held by `migrate`, `backup` and the operator can still rewrite or delete history, and nothing would show it. There is no hash chain or external copy apart from backups.
- **Fix hint:**
  - Accept the risk for 3 users, or add a `BEFORE UPDATE OR DELETE` trigger on `audit_log` that always raises. This stops accidents by non-superusers once M-2 is done.
  - Optionally add a `prev_hash` chain column.

### L-5 · Low · Client IP comes from a spoofable header when the app is reached directly
- **Where:** `lib/auth/session.ts#clientIp`.
- **Issue:**
  - It trusts the left-most `X-Forwarded-For`. Behind Caddy this is safe: Caddy replaces client-sent XFF.
  - On :3001 and :3000 anyone can forge the IP stored in `sessions` and `login_attempts`. Today the IP is used for audit only. It becomes a security input if H-1 is fixed with an app-level per-IP limit.
- **Fix hint:** Trust XFF only when the connection comes from the Caddy container (or use `x-real-ip` set by Caddy), and document this.

### L-6 · Low · Backup contents and local copies
- **Issues:**
  - Dumps include `sessions` and `login_attempts`, so restoring an older dump brings back sessions revoked since that dump.
  - On the office PC, `umask 077` means nothing: `backups/motonorte-20260927.sql.gz` inherits user-profile ACLs (Administrators, SYSTEM, the user, and a `CodexSandboxUsers` read ACE).
  - Nothing alerts on a missed backup. crond failures are silent (already in the backlog).
- **Fix hint:**
  - Add `--exclude-table-data=sessions --exclude-table-data=login_attempts`.
  - Keep office-PC copies on a BitLocker volume, encrypted per H-2.
  - Add a freshness check (no dump newer than 26 h → alert).

### L-7 · Low · The audit page returns a 500 for a malformed `who` filter
- **Where:** `app/(app)/audit/page.tsx`.
- **Evidence:** `/audit?who=------------------------------------` returned 500. The regex `^[0-9a-f-]{36}$` accepts a string that isn't a UUID, and `::uuid` then throws. Only a digest is shown, so nothing leaks.
- **Fix hint:** Validate with `z.guid().safeParse(sp.who)`.

### L-8 · Low · Supply-chain pinning
- **Issue:** `node:24-alpine`, `postgres:17-alpine` and `caddy:2-alpine` are not pinned by digest. `actions/checkout@v4` and `actions/setup-node@v4` are not pinned by SHA.
- **Fix hint:**
  - Pin digests and SHAs, and let Dependabot/Renovate bump them. This fits OPS-7's monthly update.
  - Keep `npm ci` and the lockfile (already done).

### L-9 · Low · Latent risk of gov't IDs in server logs
- **Where:** `lib/db/errors.ts`.
- **Issue:**
  - `console.error(e)` prints the PostgresError `detail`. For CHECK and NOT NULL violations, `detail` contains "Failing row contains (…)", which is the whole row.
  - `employee_private` has no CHECK constraints today and `bank_name` always gets a value, so no path triggers it now.
  - Adding a constraint to that table later would write full TIN/SSS/bank numbers to `docker logs`.
- **Fix hint:** Log `code`, `constraint` and `message` only, never `detail`/`where`. Alternatively, keep constraints off `employee_private` and validate in zod.

### Info
- **I-1. The RLS model protects against app bugs, not against a compromised app process.** `app_user` can set any `app.user_id` and can call `auth_login_lookup` (returns hashes) and `auth_create_session` for any user without a context (verified). This is inherent in ADR-010 plus the pre-login auth functions. Protect the app container and `APP_DB_PASSWORD` accordingly.
- **I-2. Masking shows the last 4 characters.** A value of 4 characters or fewer is shown in full. That's fine for real TIN/SSS/bank formats.
- **I-3. OpenAI is not wired.** Nothing is sent. When TASK-023 is built, re-audit that only codes, first names, items and rule text are sent. It already requires a rate limit and a timeout.
- **I-4. `schema_migrations` has no RLS.** It has no grants to `app_user` either, so it can't be reached. The DB traffic between app and db has `ssl=off`, but it stays on the internal Docker network. Inside the container, `pg_hba` trusts 127.0.0.1, which is the image default and not reachable from the host (the host goes through Docker NAT, so scram-sha-256 applies).
- **I-5. Out of scope, same PC:** container `web-postgres-1` (another project) publishes `0.0.0.0:5432` to the LAN. Tell the owner of that project.

---

## Fixes from earlier reviews: re-verified

| Review item | Status |
|---|---|
| pg_temp shadowing of tables inside SECURITY DEFINER functions (TASK-001..004 blocker) | Holds. No TEMP privilege (direct `app_user`: "permission denied to create temporary tables"). All functions pin `public, pg_temp`. No CREATE on `public`. |
| Login throttle check-then-act race (TASK-005..006) | Holds. Advisory lock plus pre-recorded failure: 12 concurrent requests, exactly 5 got past. |
| Session revocation on password/role/active change (TASK-005..006 → 002/003) | Holds. verify.sql checks pass. `create-user` also deletes sessions. |
| X-Forwarded-For overwritten by Caddy (TASK-021) | Holds for prod. Direct access remains spoofable (L-5). |
| Owner URL only in `migrate` (TASK-021) | Holds. App container env verified. |

## Blocker tasks added to `docs/06-task-queue.md`

- **TASK-024**: H-1, IP-level login rate limit and non-lockout throttle before going online.
- **TASK-025**: H-2, encrypt backups before they leave the server; update the runbook and test a restore.

## Hand-off checklist

- [x] Read CLAUDE.md, architecture (§3, §9, Data Model deviations), runbook, all reviews
- [x] Every table checked for RLS; cross-role reads/writes attempted as `app_user` in rolled-back transactions (anon / inactive / staff / owner / direct app_user)
- [x] Every SECURITY DEFINER function checked (search_path, role checks, exposure, EXECUTE grants)
- [x] All 28 Server Actions enumerated from the production manifest and checked for authz and validation; Route Handler checked
- [x] Auth reviewed and exercised (scrypt, timing, throttle and its race, token entropy, cookie flags, logout, revocation, CSRF, redirects)
- [x] Secrets/config: repo, image, env, bundles, compose ports, `NEXT_PUBLIC_*`
- [x] PII: masking in UI, audit, CSV, payslips, logs; reveal logging; OpenAI not wired
- [x] Integrity: audit immutability, locked/submitted freeze, caps, int8 parsing; verify.sql 68 PASS
- [x] `npm audit --omit=dev` and full `npm audit`: 0 / 0
- [x] HTTP headers and error pages on :3001 and :3000; dev server LAN exposure verified
- [x] Backups and restore procedure reviewed; dump integrity checked (no scratch restore in the dev cluster)
- [x] Blocker tasks written for every open High (TASK-024, TASK-025)
- [ ] Overall PASS: **no, FAIL** until TASK-024 and TASK-025 are done and re-audited
