# Task Queue — Motonorte HR & Payroll

Status: **v1 — APPROVED by Owner 2026-09-26 (Phase 3 in progress)**
Owner agent: task-planner · Date: 2026-09-26
Inputs: `01-prd.md`, `02-payroll-rules.md`, `03-architecture.md` (incl. Data Model), `04-ux-spec.md`, `db/migrations/001_init.sql`

**Every task's Definition of Done includes:** typecheck + lint + all tests green (incl. every payroll fixture and `db/tests/verify.sql` once they exist), code-reviewer APPROVE, and no new dependency without a stated reason. Each task should fit one PR (under ~400 changed lines). Split it if it grows.

**Every page and Server Action calls `requireUser()` / `requireOwner()` itself.** The `(app)` layout check is not enough: layouts don't re-run on client navigation and don't guard Server Actions (review TASK-005..006, finding 6).

Legend: status `todo` · `doing` · `done` · `blocked`

## Milestone A: Foundations

### TASK-001 · Project scaffold & tooling · `done` · deps: —
- **Scope:** `git init`; Next.js (App Router, TS strict) + Tailwind v4 + ESLint + Vitest; `package.json` scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`); `.gitignore` (incl. `.env*`, `backups/`); `.env.example`; tokens from UX §6 in `app/globals.css`.
- **Acceptance:** `npm run build`, `lint`, `typecheck`, `test` pass on an empty app; home page renders using the brand tokens.
- **Reviewer focus:** no extra deps; TS strict on.

### TASK-002 · Local database + migrations + CI · `done` (CI workflow unverified until a GitHub remote exists) · deps: 001
- **Scope:** `docker-compose.yml` (`db` service: postgres:17-alpine, `127.0.0.1:5434`, volume, `db/init` mounted, env from `.env`); `db/migrate.ts` (applies `db/migrations/*.sql` in order, records in `schema_migrations`; ADR-012); scripts `db:migrate`, `db:seed`, `db:verify`, `db:reset`; GitHub Actions CI with a Postgres service: migrate → seed → verify.sql → typecheck/lint/test.
- **Acceptance:** fresh `docker compose up db && npm run db:reset` then `db:verify` prints `ALL CHECKS PASSED`; migrate is idempotent (second run applies nothing); CI green.
- **Rules/Stories:** ADR-010, ADR-012. **Reviewer focus:** DB port bound to 127.0.0.1; no secrets committed.

### TASK-003 · Pay engine: base pay, OT, adjustments, validation · `done` · deps: 001
- **Scope:** `lib/payroll/types.ts`, `engine.ts` (no I/O), `engine.test.ts` that loads `fixtures/payroll/weekly.json` (expands the compact attendance format) and runs **all** cases, with pool cases marked `todo` until TASK-004.
- **Acceptance:** F01–F05, F14–F17, F19–F23 pass to the centavo; integer-only math (multipliers as hundredths); errors `MISSING_ATTENDANCE`, `INVALID_OT` with emp + date; output includes provenance items with rule IDs.
- **Rules:** PR-001–003, 010, 020–023, 030–032, 040–041, 060–061, 070. **Reviewer focus:** no floats, no `Date.now()`, rounding exactly per PR-002.

### TASK-004 · Pay engine: incentive pool + 13th month · `done` · deps: 003
- **Scope:** daily pool, eligibility, split with remainder (PR-053), `NO_ELIGIBLE_MECHANIC`; `thirteenth.ts`; un-`todo` all fixture cases.
- **Acceptance:** **all 23 weekly cases + T01 pass**; incentive items carry `source: { pool, eligible[], jobs[] }`.
- **Rules:** PR-050–054, PR-080, PR-011. **Reviewer focus:** remainder ordering by employee code; mechanics identified by position *on that day*.

### TASK-005 · DB client + authentication · `done` · deps: 002
- **Scope:** `lib/db/client.ts` (`postgres` driver; `withUser(userId, fn)` sets `app.user_id` in a transaction; the only exported query path); `lib/auth/password.ts` (scrypt), `session.ts` (token, cookie `HttpOnly; Secure; SameSite=Lax`, 12 h sliding), `requireRole.ts`; `/login` page + Server Action (S-01), logout; route protection (redirect to `/login`); `scripts/create-user.ts` (uses owner connection, ADR-009 / Data Model note 5).
- **Acceptance:** US-061 criteria; wrong password gives the generic error; the 6th failure within 15 min is throttled; logout invalidates the session; unit tests for hash/verify and token hashing; `create-user` creates an owner who can sign in.
- **Reviewer focus:** constant-time compare, no password/hash in logs, no query outside `withUser()`, app connects as `app_user`.

### TASK-006 · App shell & formatting helpers · `done` · deps: 005
- **Scope:** layout (sidebar nav, top bar with user + role badge, sign out), role-aware nav, `lib/format.ts` (money `₱12,345.67` from centavos, dates in Asia/Manila, week labels) with tests; shared components: `Money`, `StatusChip`, `ConfirmDialog` (native `<dialog>`), empty/error states.
- **Acceptance:** UX §1 global layout, §5 formatting, §7 focus styles; format tests cover negatives and rounding display.

## Milestone B: Master data

### TASK-007 · Employees list + profile + government/bank · `done` · deps: 006
- **Scope:** S-03, S-04 Profile and Government & bank tabs; masked fields with Show that calls `log_reveal`; deactivate with end date; zod validation.
- **Acceptance:** US-001, US-003 criteria; code uniqueness error shown per field; reveal writes an audit row.
- **Reviewer focus:** private fields never in client bundles until revealed; no delete path.

### TASK-008 · Pay terms (effective-dated rate/position) + approvals · `done` · deps: 007
- **Scope:** S-04 Pay terms tab; staff propose / owner approve-reject; approvals panel component (reused on S-02 in TASK-019).
- **Acceptance:** US-002 criteria; `PERIOD_LOCKED` error shown in plain language; F17-style mid-week change visible in history.

### TASK-009 · Incentive catalog · `done` · deps: 006
- **Scope:** S-05; add job, change amount (effective date), activate/deactivate; pesos → centavos server-side.
- **Acceptance:** US-010 criteria; staff read-only; amount history expands per row.

### TASK-010 · Settings: multipliers, holidays, users · `done` · deps: 006
- **Scope:** S-11; settings as effective-dated hundredths (UI shows 1.25); holidays per year; user admin (add with temp password, reset password, deactivate). Owner edits, staff views.
- **Acceptance:** PR-030 values editable only by owner; legal note shown; new users can sign in; password reset, role change and deactivation delete that user's sessions (review TASK-005..006).

## Milestone C: Weekly workflow

### TASK-011 · Week workspace: attendance grid · `done` · deps: 007, 008
- **Scope:** `/week/[start]` header (prev/next, payday, status chip), Tab 1 grid per UX S-06: status select, OT hours → minutes, rest-day shading, holiday badges, "Fill empty cells", keyboard nav, per-cell save, locked read-only banner.
- **Acceptance:** US-021, US-023; `NOT_EMPLOYED` / `PERIOD_LOCKED` shown per cell; no silent defaults. Rows = employees employed on any day of the week by **hire/end dates**, not the `active` flag (deactivation with a future end date must still show their last days).

### TASK-012 · Week workspace: incentive job log · `done` · deps: 009, 011
- **Scope:** Tab 2: day chips with pool totals, add/remove job rows, day summary "Pool ÷ n full-day mechanics = share" computed **server-side with the engine's pool function**, red warning when n = 0.
- **Acceptance:** US-020 criteria (pool split, half-day excluded, no-mechanic warning).

### TASK-013 · Week workspace: adjustments · `done` · deps: 011
- **Scope:** Tab 3 per UX; carried-in shown from `carried_in_for()`.
- **Acceptance:** US-033 criteria; reason required; clawback type available.

### TASK-014 · Generate payroll draft · `done` · deps: 004, 012, 013, 010
- **Scope:** `lib/db/loadPeriodInput.ts` (builds normalized `PeriodInput` incl. settings, holidays, pay terms, catalog amounts, carried_in); stable `inputHash()`; Server Action: load → `computeWeek` → `save_draft`; error list view (S-08 error state) with links to the exact cell.
- **Acceptance:** US-030; **integration test:** seeded dev week produces F07 figures from the DB; missing attendance produces a `MISSING_ATTENDANCE` link; regenerate replaces the draft; same data gives the same hash.
- **Also (review TASK-001..004):** merge per-key `settings` rows into effective-dated `Settings` bundles (one bundle per distinct `effective_from`, carrying forward the other keys); include in `employees` anyone with an adjustment or a `carried_in_for()` balance even if not employed that week (engine throws otherwise).
- **Reviewer focus:** hash covers every input that affects pay; engine stays pure.

### TASK-015 · Run review, drill-down, submit/approve/lock · `done` · deps: 014
- **Scope:** S-07 runs list; S-08 summary strip, lines table with totals, drill-down `<dialog>` from `payroll_items`, stale banner (recompute hash on view), actions per status/role with confirm dialogs (lock dialog restates headcount + net), calls `submit_run` / `send_back_run` / `lock_run(expected_hash)`.
- **Acceptance:** US-031, US-032; staff never sees Approve; locking a stale draft is refused with a clear message; weeks must be locked in order.

### TASK-016 · Payslips print view · `done — pending Owner print-preview check` · deps: 015
- **Scope:** S-09 print CSS, one A4 page per employee, incentives itemized per day with the pool's jobs.
- **Acceptance:** US-034; only for locked runs; prints cleanly to PDF in Chrome/Edge.

### TASK-017 · RCBC bank transfer file · `blocked` · deps: 015
- **Blocked on:** OQ-18a (blank RCBC Corporate bulk-credit template from the Owner).
- **Scope:** Route Handler producing the RCBC file from a locked run; download logged to `audit_log`.
- **Acceptance:** US-035; file matches the template byte-for-byte on a sample; only locked runs.

## Milestone D: Reporting & audit

### TASK-018 · Reports: monthly summary + 13th month · `done` · deps: 015
- **Scope:** S-10 using `v_monthly_summary`, `v_thirteenth_month`; CSV export Route Handlers.
- **Acceptance:** US-040, US-041; attribution by payday month/year; 13th month matches `thirteenth.ts` for the same data.

### TASK-019 · Dashboard · `done` · deps: 015, 008
- **Scope:** S-02 KPI tiles, 12-week SVG stacked bars (no chart lib unless justified), incentives-per-mechanic and top-jobs tables, owner approvals panel.
- **Acceptance:** US-050; empty state before the first locked run.

### TASK-020 · Audit log viewer · `done` · deps: 006
- **Scope:** S-12 filters + before/after diff (masked values stay masked).
- **Acceptance:** US-060 visible to both roles; no write path.

## Milestone E: Deployment readiness

### TASK-021 · Production compose: app image, Caddy, backups · `done` · deps: 015
- **Scope:** `Dockerfile` (multi-stage, `next start`, non-root), compose `app` service, `prod` profile with `caddy` (auto-HTTPS for `$DOMAIN`) and `backup` (nightly `pg_dump`, 30 daily + 12 monthly retention), migrations on app start, `docs/runbook.md` (install, restore, rotate secrets).
- **Acceptance:** `docker compose up` runs the full app locally at `http://localhost:3000`; a backup produced by the service restores into a scratch DB and `db:verify` passes against it.
- **Rules:** architecture §9 OPS-1..7. Caddy must overwrite `X-Forwarded-For` with the real client IP (audit data, `clientIp()`); consider an IP-level login rate limit before going online. **Reviewer focus:** no DB port in prod profile; secrets only from env.

## Security blockers (Phase 4, from docs/08-security-report.md)

Both must be done and re-audited before going online (Stage 2). Neither affects the localhost-only Stage 1.

### TASK-024 · IP-level login rate limit + lockout-proof throttle · `done` · **blocker (security H-1)** · deps: 021
- **Scope:** per-IP limit on `POST /login` (Caddy rate_limit, or an app-level window keyed on the Caddy-set client IP, see security L-5); replace the hard per-email lockout so a third party can't keep the Owner locked out (e.g. backoff delay, or IP-scoped counting); purge `login_attempts` older than 30 days and expired `sessions`.
- **Acceptance:** from one IP, more than N attempts/min across many emails are refused before scrypt runs; 5 wrong attempts from IP A don't stop the correct password from IP B; old attempts/sessions are purged; verify.sql or tests cover it. Supersedes the backlog item "IP-level login rate limit".
- **Reviewer focus:** client IP can't be spoofed by headers when behind Caddy; no scrypt before the IP check.

### TASK-025 · Encrypt backups before they leave the server · `done` · **blocker (security H-2)** · deps: 021
- **Scope:** `db/backup.sh` encrypts to the Owner's public key (age or gpg), private key kept offline; optional `--exclude-table-data=sessions --exclude-table-data=login_attempts`; update `docs/runbook.md` §4–§6 (decrypt on restore; remove the plaintext "rclone to Google Drive/OneDrive" advice).
- **Acceptance (amended by Owner 2026-09-27):** no plaintext `.sql.gz` **leaves the server**; off-server copies are only the age-encrypted files in `offsite/`; an encrypted backup decrypts, restores into a scratch DB and `verify.sql` passes.
- **Reviewer focus:** off-server copies can't be decrypted without the offline key; the key-loss procedure is documented.
- **Owner decision (2026-09-27):** plaintext nightly dumps **stay on the server** for fast restores (the live DB on the same server holds the same data); only the age-encrypted copies in `offsite/` may leave it. Acceptance amended accordingly: "no plaintext .sql.gz leaves the server". Verified: fresh backup → encrypt (Ubuntu 22.04 dash) → decrypt → restore → verify.sql 79/79 PASS.

## QA bugs (Phase 4, from `docs/07-test-report.md`)

### TASK-026 · BUG (Critical): Owner cannot Approve & lock any payroll run · `done` · deps: 015 · US-032
- **Found by:** E2E-RUN-06 (`tests/e2e/payroll-cycle.spec.ts`), fails on every run.
- **Repro:** 1) Staff generates a draft and submits it. 2) Owner opens `/payroll/<id>` → **Approve & lock** → confirms. 3) The dialog shows "You don't have permission to do that." and the run stays `submitted`.
- **Cause:** `lockRun` in `app/(app)/payroll/actions.ts:96` runs `select … from payroll_runs … for update` as `app_user`. `FOR UPDATE` needs UPDATE privilege, but `app_user` has only SELECT on `payroll_runs` (001_init.sql:648), so Postgres raises "permission denied for table payroll_runs". Confirmed directly on `motonorte_e2e`: the same query without `for update` succeeds.
- **Fix hint:** drop `for update` (`lock_run()` already takes the row lock as SECURITY DEFINER, and 004 freezes the week's attendance, jobs and adjustments while it is submitted). Add a regression test that runs the action's query path as `app_user`, not as the owner connection. verify.sql calls `lock_run` directly, which is why it didn't catch this.
- **Acceptance:** E2E-RUN-06 passes with no workaround annotation; `npm test`, `db:verify` stay green.

### TASK-027 · BUG (Minor): Run review "Days" reads "5 + 1½" for 5 full days + 1 half day · `done` · deps: 015 · US-030
- **Found by:** manual review of the E2E-RUN-06 screenshot (M003: 5 F + 1 H).
- **Repro:** mark one weekday H for an employee, generate the draft, and look at the Days column on `/payroll/<id>`. It shows `5 + 1½`, which reads as 6.5 days, not 5.5 days worked.
- **Cause:** `app/(app)/payroll/[runId]/page.tsx` `days()` renders `${f} + ${h}½`.
- **Fix hint:** show `5 F + 1 H`, as in UX S-08 "Days (F/H)", or `5½`.
- **Acceptance:** the Days cell is unambiguous for 0, 1 and 2 half days.

## Launch follow-ups (Phase 4, from `docs/09-launch-checklist.md`)

### TASK-028 · Audit page + runs list query speed · `todo` · deps: 020
- **Why:** at ~88k audit rows `/audit` takes ~3.9 s (the "who" filter scans the whole log; RLS check runs per row). Not a launch blocker at Motonorte's size (~0.35 s after year one) but grows.
- **Scope:** evaluate the role check once per query in the policy (e.g. `(select app_role())`), de-duplicate actors before `user_name()`; same pattern for the payroll runs list.
- **Acceptance:** release engineer's measured 3.5 s → ~19 ms reproduced; `db:verify` and e2e still pass.
- Also: "locked" status chip contrast (4.38:1 → ≥ 4.5:1) and payslip heading order (axe).

### TASK-029 · Office-PC deployment mode (Stage 1) · `done` · deps: 021, 025
- **Why:** Owner decision 2026-09-27 — run real payroll on the office PC (office network only), VPS later.
- **Scope:** `Caddyfile.office` (`tls internal`); compose variables `CADDYFILE`, `HTTP_BIND`/`HTTPS_BIND`, `DB_PORT`,
  `BACKUP_DIR`, `OFFSITE_DIR`, `BACKUP_SCHEDULE`, `AGE_RECIPIENT`; age encryption moved into the backup container
  (`db/Dockerfile.backup`, `db/backup.sh`; host script `encrypt-offsite.sh` removed); `docs/runbook-office.md`; runbook §4 updated.
- **Acceptance:** throwaway office-mode stack: fresh DB migrates, HTTPS 200 + headers, cert verifies against Caddy root,
  backup writes an encrypted copy that decrypts to a valid dump; schedule variable reaches crontab; compose valid for base + prod.

## Should (after Must milestones)

### TASK-022 · Attendance CSV import · `todo` · deps: 011 · US-022
### TASK-023 · AI "Explain this payslip" · `todo` · deps: 015 · US-051
- OpenAI server-side; sends only the line's items + rule text + employee code/first name; peso-figure guard falls back to itemized text; 10 s timeout; rate limit.

## Backlog (Could, not scheduled)
- **Backups in Settings (pinned 2026-10-04)** — Owner-only list of backups (date, size, encrypted copy, warning if newest > 26 h), "Back up now" (request picked up by the backup service), download of the encrypted .age copy only. Restore stays out of the web app (the app login deliberately cannot drop/replace data); instead a one-command restore script with confirmation + safety backup first.
- **Phone/tablet layout** — Owner decision 2026-09-28: desktop only for now. When needed: collapsible menu, tables scroll sideways inside their box, forms stack, attendance grid with fixed name column (layout-only, ~20 files, no logic or DB change). A per-employee attendance view for phones would be a separate, larger task.
Catch-up backup when the backup container starts (office PC may be off at backup time) · Global cap on concurrent scrypt work during login · `must_change_password` flag for owner-set passwords (M-4 part 2) · alert when `offsite/` has no new file for 26 h · Before going online (review TASK-021): IP-level login rate limit · alert when no backup newer than ~26 h · encrypt off-server backup copies · Attendance-rate definition: should an unworked holiday count as an absence? (Owner to confirm; review TASK-016..020) · Keyboard/touch chart tooltips if the table view isn't enough · US-052 report Q&A · US-053 anomaly flags · US-043 BIR 2316 export. · Adjustments for recently separated employees (loader already supports them; UI lists only employees employed that week — review TASK-011..015).

## Coverage check

| Story | Task(s) |
|---|---|
| US-001, 003 | 007 |
| US-002 | 008 |
| US-010 | 009 |
| US-020 | 012 |
| US-021, 023 | 011 |
| US-030 | 003, 004, 014 |
| US-031, 032 | 015 |
| US-033 | 013, 003 |
| US-034 | 016 |
| US-035 | 017 (blocked) |
| US-040 | 018 |
| US-050 | 019 |
| US-060 | 020 (+ triggers in 001_init) |
| US-061 | 005, 010 |

## Hand-off checklist

- [x] Every Must story covered (table above)
- [x] No circular dependencies
- [x] Pay engine (003, 004) precedes every payroll UI task (014+)
- [x] Human approval → Phase 3 (Owner, 2026-09-26)
