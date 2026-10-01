> **Update 2026-09-27 — Owner decision: Stage 1 runs on the office PC (office network only); the VPS comes later.**
> Server items below apply to the VPS stage. For the office PC, use `docs/runbook-office.md`; its launch items are:
> PC prep (BitLocker, auto-start, no sleep, DHCP reservation, Private network) · separate install folder + own `.env`
> (`COMPOSE_PROJECT_NAME=motonorte-office`, `CADDYFILE=Caddyfile.office`, `DOMAIN=<PC IP>`, `TRUST_PROXY=0`, `HTTP(S)_BIND=<PC IP>:80/443`,
> `BACKUP_SCHEDULE="45 17 * * *"`, installed under `C:\Users\kcmat\`) · key ceremony (`AGE_RECIPIENT`) · firewall rule (Private, 80/443) · root certificate
> installed on each staff PC · encrypted copies land in a OneDrive/Google Drive folder · restore test (`ALL CHECKS PASSED`)
> · Owner account via create-user, no test accounts. Verified on a throwaway copy of this setup: fresh DB migrated
> 001–007, HTTPS 200 with security headers, certificate chain verifies against Caddy's root, backup + encrypted copy
> decrypts to a valid dump. Everything else in this checklist (parallel first week, print check, RCBC decision, M-2) is unchanged.

# Launch Checklist — Motonorte HR & Payroll (Phase 4)

Owner agent: release-engineer · Date: 2026-09-27
Inputs: `docs/07-test-report.md` (incl. re-run), `docs/08-security-report.md`, `docs/reviews/*` (esp. `TASK-024-027.md`, `TASK-021.md`), `docs/06-task-queue.md`, `docs/03-architecture.md` §9–§10, `docs/runbook.md`, the codebase, and measurements taken for this checklist.
**The Owner decides go/no-go.** This document only recommends.

Status key: **PASS** verified with evidence · **FAIL** verified not met · **PENDING** can't be verified yet, with the reason given.

## Summary

| # | Item | Status |
|---|---|---|
| 1 | QA report green | **PASS** |
| 2 | Security: no open Critical/High | **PASS** (M-2 needs a decision, see 17) |
| 3 | Lighthouse ≥ 90 perf + a11y on key screens | **PENDING** (tool not installed). Proxy measurements: performance OK, 2 small a11y defects |
| 4 | Payroll run for 200 employees < 10 s | **PASS**: 0.24 s |
| 5 | Hot queries indexed (EXPLAIN ANALYZE) | **PASS for launch**. One query degrades with audit-log growth (recommended TASK-028) |
| 6 | Production env vars set | **PASS** locally (`.env.example` complete) · **PENDING** on the server |
| 7 | Migrations applied | **PASS** locally (001–007) · **PENDING** on the server |
| 8 | OPS-1..8 verified | **PENDING**: verify on the server |
| 9 | Nightly backups, off the machine, restore tested | **PASS** for the procedure (restore 79/79 from an encrypted backup) · **PENDING** on the server |
| 10 | Error monitoring wired | **FAIL**: none exists. The minimum setup is below |
| 11 | Rollback plan written | **PASS**: §11 below (images are not yet tagged per release) |
| 12 | First live payroll run in parallel with the old process | **PENDING**: Owner, after install |
| 13 | TASK-016 payslip print-preview check | **PENDING**: Owner |
| 14 | TASK-017 RCBC bank file, or launch without it | **PENDING**: Owner decision |
| 15 | Encryption key ceremony (age key offline) | **PENDING**: Owner |
| 16 | First Owner account via create-user; no dev test accounts carried over | **PENDING**: server install |
| 17 | Security M-2 decision (DB owner role is a superuser) | **PENDING**: Owner decision |
| 18 | Before-online backlog (scrypt cap, must_change_password, offsite freshness alert) | **PENDING**: Owner decision to do now or accept |

---

## 1. QA report green: PASS

- Re-run after fixes (`07-test-report.md`, final section; reviewer re-run in `reviews/TASK-024-027.md`):
  - `npm test` **49/49**. This includes all 24 Owner-approved fixtures, to the centavo.
  - `test:e2e` **24/24** on a fresh production build, with the TASK-026 workaround removed.
  - `db:verify` all checks pass: **81/81** in the latest orchestrator run, 79/79 at the review.
  - typecheck and lint are clean.
- The critical bug TASK-026 (Owner can't lock) and the minor bug TASK-027 are `done`. **16/16 testable Must stories pass.**
- Two stories are not covered by this item: US-035 (bank file) is blocked, see 14, and the print layout is pending, see 13.
- Known gap, not a blocker: the CI workflow has never run because there is no GitHub remote. All suites run locally.

## 2. Security report: PASS (no open Critical/High)

- `08-security-report.md` found 0 Critical and 2 High.
  - **H-1** is fixed by TASK-024 (per-IP limit, lockout-proof throttle, purge).
  - **H-2** is fixed by TASK-025 (age-encrypted off-server copies).
  - Both are `done`, and the review verdict is **APPROVE** (iteration 2, `reviews/TASK-024-027.md`). That review also covers the M-1, M-3, M-4 (part 1), L-5 and L-7 fixes.
- **Paperwork gap:** the verdict table in `08-security-report.md` still says "FAIL". No re-audit section has been added. The evidence for closure is the review. Recommend the security-auditor add a one-paragraph re-audit note, or the Owner accepts the review as closure.
- **Human confirmation still open** (review checklist): the Owner confirms the amended TASK-025 acceptance. Plaintext dumps stay on the server, and only `offsite/*.age` leaves it.
- **Still open, Medium/Low:** M-2 (decision, item 17), M-4 part 2 (item 18), and L-1, L-2, L-3, L-4, L-6 (freshness alert), L-8 and L-9. None blocks launch. They are accepted risks unless the Owner says otherwise.
- **Local-PC note (M-1):** `package.json` now binds dev to 127.0.0.1. The dev process that is running now was started earlier and still listens on `0.0.0.0:3000` (netstat, 2026-09-27). Restart it when convenient, and remove the blanket node.exe firewall rule before entering any real data on the office PC.

## 3. Lighthouse: PENDING (tool not installed)

Lighthouse isn't installed: not in `node_modules`, not global, and there's no `lhci`. I didn't download it.

**Substitute I ran:**
- Setup: the current production build (`.next`, newer than every source file) served by `next start` on a temporary port, against the 200-employee scratch DB (item 4), using the installed Edge through Playwright.
- Each page loaded with a cold cache, signed in as a throwaway owner in the scratch DB.
- Accessibility checked with **axe-core 4.13.0**, already installed as a dependency of eslint-plugin-jsx-a11y. Tags: WCAG 2.0/2.1 A+AA and best-practice.

| Screen (volume) | Unthrottled FCP/LCP · load | Mobile-like¹ FCP/LCP · load | TBT² | CLS | Transfer | axe |
|---|---|---|---|---|---|---|
| Login | 28 ms · 52 ms | 532 ms · 1.22 s | ~51 ms | 0 | 168 KB | 0 violations |
| Dashboard (53 locked weeks) | 292 ms · 311 ms | 680 ms · 1.34 s | ~50 ms | 0 | 197 KB | 0 |
| Week (200 employees) | 288 ms · 321 ms | 1.42 s · 1.63 s | ~56 ms | 0 | 243 KB | 1: color-contrast |
| Run review (200 lines, 1,808 items) | 304 ms · 343 ms | 800 ms · 1.59 s | ~75 ms | 0 | 268 KB | 1: color-contrast |
| Payroll list (53 runs) | 268 ms · 289 ms | 632 ms · 1.31 s | ~53 ms | 0 | 201 KB | 1: color-contrast ×53 |
| Payslips (200) | 388 ms · 425 ms | 1.25 s · 1.71 s | ~82 ms | 0 | 276 KB | 1: heading-order |
| Audit (88.6k audit rows) | **3.88 s** · 3.90 s | **4.91 s** · 5.56 s | ~55 ms | 0 | 202 KB | 0 |

¹ 150 ms RTT, 1.6 Mbps down, 4× CPU slowdown, similar to Lighthouse mobile.
² Long-task sum, an approximation.

**Reading:**
- Every key screen reaches LCP in under 1.5 s even with mobile-like throttling. There are no layout shifts, blocking time is small, and the JS payload is about 200 KB. That is consistent with a Lighthouse performance score of 90+, but it is not a Lighthouse score.
- The exception is `/audit`, which is slow because of one query at large volume (item 5).

**Accessibility defects found (small, recommend fixing before launch):**
1. **color-contrast (serious):** the "locked" status chip (`components/ui.tsx`, `bg-success/10 text-success`) measures **4.38:1**; WCAG AA needs 4.5:1 for 12 px text. It appears on the week, run review and payroll list pages. Fix: darken the text, e.g. a darker `--color-success` on the chip only.
2. **heading-order (moderate):** the payslips page jumps to `<h3>` ("Base pay") without an `<h2>`.

**To close this item:** run Lighthouse from any PC that has Chrome, against the server once it's live (Chrome DevTools → Lighthouse, desktop and mobile) on login, dashboard, week and run review. Record the scores here.

## 4. Payroll run for 200 employees under 10 s: PASS (0.24 s)

**Setup:**
- A scratch DB `motonorte_perf` (migrations 001–007 + seed, `revoke temporary` applied), created in `motonorte-payroll-db-1` and **dropped afterwards**.
- 200 synthetic employees: 120 mechanics, 20 technicians, 60 staff. Rest days vary, and all have approved pay terms.
- 20 catalog jobs.
- **52 locked history weeks**, built through the real `loadPeriodInput → computeWeek → save_draft → submit_run → lock_run` path. Each week has:
  - full attendance: 90 % F, 5 % H, 5 % A, with OT on about 10 % of F days;
  - 240 job-log rows;
  - 15 adjustments, some large enough to create carry-over;
  - 2 holidays in the year.
- The timed week (2028-01-03) had the same kind of data.
- **Final volume:** 74,242 attendance rows, 12,722 job-log rows, 10,400 payroll lines, 93,886 payroll items and 88,595 audit rows.

**Timed:** exactly the `generateDraft` path: `loadPeriodInput` + `computeWeek` + `inputHash` + `save_draft`. It connected **as `app_user` with RLS on** and a staff identity, and each run committed. It ran 5 times; each regeneration replaces the draft.

| Run | load | compute | hash | save_draft | **total incl. commit** |
|---|---|---|---|---|---|
| 1 (cold) | 61 ms | 3 ms | 1 ms | 140 ms | **237 ms** |
| 2 | 46 | 2 | 2 | 180 | **236 ms** |
| 3 | 42 | 2 | 1 | 172 | **222 ms** |
| 4 | 44 | 2 | 1 | 177 | **230 ms** |
| 5 | 42 | 2 | 1 | 163 | **236 ms** |

- Output per run: 200 lines and 1,808 items.
- Owner approve & lock (re-load + re-hash + `lock_run`, as `lockRun` does): **52 ms**.
- The budget is 10 s, so there is about 40× headroom. Motonorte has about 20 employees.

## 5. Hot queries indexed: PASS for launch, one growth issue

All queries were run with EXPLAIN (ANALYZE, BUFFERS) on the item-4 volume, as `app_user` with the owner identity, after `ANALYZE`. The query text was copied from the app.

| Query (source) | Time | Plan / seq scans |
|---|---|---|
| Loader: `carried_in_for` | 5.9 ms | index |
| Loader: adjustments by period | 0.2 ms | `adjustments_period_idx` |
| Loader: attendance ids / attendance for week (also week page) | 11–13 ms | `attendance_pkey` range on `date`, 2,000 buffers. No `date`-leading index; acceptable. |
| Loader/week: job_log for week | 11.6 ms | `job_log_date_idx` |
| Loader/week: employees + pay terms | 5.1 ms | seq scan on `employees` (206 rows, whole table needed; fine) |
| Week: adjustments tab | 1.1 ms | index |
| Run page: lines | 7.5 ms | PK on `payroll_lines`; seq on `employees` (206 rows, fine) |
| Run page: items | 13.4 ms | `payroll_items_run_emp_idx` |
| Payroll runs list | **142 ms** | seq on `payroll_runs` (53 rows, fine). The cost is RLS evaluating `app_role()` once per `payroll_lines` row in the per-run subqueries. |
| Dashboard: 12-week totals | 70 ms | same per-row `app_role()` cost on 10.6k lines |
| Dashboard: KPI / mechanics / top jobs | 15 / 8 / 41 ms | index; small seq scans on `employees`/`catalog_jobs` only |
| Audit: page 1, default 7-day range | **159 ms** | `audit_log_pkey` backward; the "record" subquery seq-scans `employees` 100× because it compares `id::text`, which can't use the PK |
| Audit: filtered by table | 11.8 ms | seq on `audit_log` (small result) |
| **Audit: "who" filter list** (`select distinct actor, user_name(actor) … from audit_log`) | **3,475 ms** | **seq scan of all 88.5k audit rows**, calling `user_name()` and the RLS `app_role()` per row, plus an external sort. Runs on **every** audit page load. |

**The sequential scan that matters is the audit "who" list.** It grows linearly with the audit log: about 38 µs per row.
- At Motonorte's real size (~20 employees, roughly 9–10k audit rows a year) it adds about **0.35 s after year one**, and more every year after.
- It is not a launch blocker.
- In a rolled-back probe on the scratch DB, two changes brought it from **3,475 ms to 19 ms**:
  1. RLS policies written as `using ((select app_role()) in ('staff','owner'))`, so `app_role()` is evaluated once per query instead of once per row;
  2. the query rewritten to `select distinct actor` first and `user_name()` afterwards.
- The same policy change took the **payroll runs list from 142 ms to 4 ms**.

**Recommended new task (TASK-028, for the task-planner/Owner):**
- A migration that rewrites the `app_role()` RLS policies with `(select app_role())`.
- A distinct-first query for the audit "who" list.
- In the audit "record" subquery, compare `id = (… ->> 'employee_id')::uuid`, not `id::text = …`.
- Verify: `db:verify` stays green, and re-run these EXPLAINs.

## 6. Production environment variables: PASS locally · PENDING on the server

**`.env.example` is complete** for everything compose and the app read:
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_OWNER`, `DOMAIN`, `TRUST_PROXY`, `OPENAI_API_KEY`, `OPENAI_MODEL`.
- `APP_PORT` is optional (default 3000) and is documented in the compose header.
- `DEV_OWNER_PASSWORD`/`DEV_STAFF_PASSWORD` are dev/e2e-only, correctly absent from the example, and **must not** be on the server.

**`docker compose config`** validates for both profiles:
- Default profile: `db`, `migrate`, `app`.
- `--profile prod`: adds `caddy` and `backup`.
- Published ports: Caddy `80`/`443` (public); app `127.0.0.1:3000`; db `127.0.0.1:5434` (host-only).
- `restart: unless-stopped` on db, app, caddy and backup; `migrate` is `"no"` (one-shot).
- Healthchecks on db (`pg_isready`) and app (`/login`).

**Server (runbook §2):**
- `.env` created from the example with `chmod 600`.
- Every `change-me-*` replaced with `openssl rand -hex 24`, using **different passwords from the office PC**.
- `DOMAIN=<real domain>` and `TRUST_PROXY=1`.
- `OPENAI_*` left empty (US-051 was skipped).
- Verify with `docker compose --profile prod config --quiet` (prints nothing on success) and `stat -c %a .env` → `600`.

## 7. Migrations applied: PASS locally · PENDING on the server

- Dev DB `schema_migrations` (read-only query) has `001_init` … `007_throttle_trusted_ips`: **7 of 7 applied**, the last on 2026-09-27 03:37 +08.
- `motonorte_e2e` also has 7 of 7.
- On the server, `migrate` runs before `app` starts (`service_completed_successfully`).
- Verify there:
  - `docker compose ps` shows `migrate` as `Exited (0)`;
  - `docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from schema_migrations"` returns `7`, or more if newer migrations ship.
- Migrations are forward-only (no down scripts). See §11.

## 8. OPS-1..8 on the web server: PENDING (verify on server)

The server's OS and domain aren't known yet. Each item below must be verified there and ticked, with the evidence written in.

| OPS | Requirement | How to verify on the server | Runbook | Status |
|---|---|---|---|---|
| OPS-1 | HTTPS with a real certificate | `curl -sI https://$DOMAIN/login` → 200 and HSTS header; a browser shows a valid Let's Encrypt certificate | §1 (DNS A record), §2 (Caddy) | PENDING |
| OPS-2 | Only 22/80/443 open; SSH key-only | `sudo ufw status` (or the provider firewall) lists only 22, 80, 443; `nmap -Pn <ip>` from outside shows no 5432/3000; `sshd -T \| grep passwordauthentication` → `no` | §1 | PENDING |
| OPS-3 | Auto-restart | `systemctl is-enabled docker` → enabled; reboot the server, then `docker compose ps` shows everything Up without manual action | §2 (compose `restart: unless-stopped`) | PENDING |
| OPS-4 | Nightly backups, off the server (encrypted) | Next morning: `backups/backup.log` shows a success and `backups/motonorte-YYYYMMDD.sql.gz` exists; after 23:30, `offsite/*.age` exists; the off-server destination has the `.age` file and **no plaintext `.sql.gz`** | §4 | PENDING |
| OPS-5 | Restore tested | Run §5 on the server with a real nightly file, **and** once from an `.age` copy decrypted on the Owner's PC → `ALL CHECKS PASSED` | §4 step 4, §5 | PENDING (procedure proven locally, item 9) |
| OPS-6 | Secrets | `.env` is `600` and not in git (`git status` clean); passwords differ from the office PC | §2, §8 | PENDING |
| OPS-7 | Updates | `unattended-upgrades` enabled; monthly `docker compose pull` noted in the Owner's calendar | §7 | PENDING |
| OPS-8 | Access hardening (optional) | Owner decides: restrict to the office IP/VPN or not. Doing it removes most login-attack exposure (security H-1 note) | §1 | PENDING: Owner decision |

## 9. Backups, off-machine copies, restore test: PASS for the procedure · PENDING on the server

- The `backup` service runs `pg_dump` at 23:00 PHT. Retention is 30 daily plus 12 monthly, files are owner-only (`umask 077`), with `pipefail` and `gzip -t`. Reviewed in `reviews/TASK-021.md` and security controls #22.
- Off-server copies are **age-encrypted by the backup container itself** (`db/backup.sh` + `AGE_RECIPIENT`; the earlier host script `encrypt-offsite.sh` was folded in on 2027-09-27 for the office-PC deployment). Only `offsite/*.age` may leave the server. This was an Owner decision on 2026-09-27, recorded under TASK-025.
- **Restore tested:** fresh backup → encrypt (Ubuntu 22.04 dash) → decrypt → restore into a scratch DB → `verify.sql` **79/79 PASS** (TASK-025 in `06-task-queue.md`; reviewer confirmed in `reviews/TASK-024-027.md`). The earlier plain restore gave 67/67 (`reviews/TASK-021.md`).
- A dump exists locally: `backups/motonorte-20260927.sql.gz`.
- **On the server:** OPS-4 and OPS-5 above, run with the real key after item 15.

## 10. Error monitoring: FAIL (not wired). Minimum recommended, no code needed

Nothing alerts anyone today. The healthchecks exist, but nobody is told when they fail. Minimum setup, all at server level with no app changes:

1. **Uptime ping:** a free external monitor (e.g. UptimeRobot or Healthchecks.io) checks `https://$DOMAIN/login` every 5 min and emails the Owner on failure. This also catches expired certificates and a server that is down.
2. **Backup freshness via a dead-man ping:** have the host (VPS: root cron; office PC: Windows Task Scheduler) check that today's `offsite/*.age` exists after the backup time and then call `curl -fsS -m 10 https://hc-ping.com/<uuid>`. A Healthchecks.io check expecting a ping every 24 h (grace 2 h) then emails if either the backup or the encryption stops. This also covers the backlog item "alert when `offsite/` has no new file for 26 h".
3. **Logs:**
   - Set Docker log rotation in `/etc/docker/daemon.json`: `{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}`. Without it, logs grow until the disk is full.
   - On any incident run `docker compose logs --since 24h app | grep -iE "error|fail"`.
   - Once a week, check `docker compose ps` (all healthy) and `tail backups/backup.log`.

Add error tracking (Sentry etc.) only if these three prove insufficient. Before adding it, security L-9 must be fixed first so no row data reaches a third party.

## 11. Rollback plan: PASS (written here)

**Constraints:**
- Migrations only go forward (there are no down scripts).
- There is one image tag, `motonorte-payroll:latest`, which `build` overwrites.
- So a rollback = **the previous image + the pre-update backup** (if a migration ran).

**Before every update (add to runbook §7):**
```bash
cd ~/motonorte-payroll && set -a; . ./.env; set +a
git rev-parse --short HEAD > ../last-good-commit                  # the code you can go back to
docker tag motonorte-payroll:latest motonorte-payroll:prev          # keep the running image
docker compose exec -T db pg_dump -U "$POSTGRES_USER" --no-owner "$POSTGRES_DB" | gzip \
  | sudo tee "backups/pre-update-$(date +%Y%m%d_%H%M).sql.gz" >/dev/null   # distinct name: never overwrites a nightly file
ls db/migrations > ../migrations-before
```
Then update per runbook §7. Afterwards, `diff <(ls db/migrations) ../migrations-before` tells you whether this update added a migration.

**If the update is bad:**
- **A. No new migration in the update:**
  ```bash
  git checkout "$(cat ../last-good-commit)"
  docker tag motonorte-payroll:prev motonorte-payroll:latest
  docker compose --profile prod up -d        # no --build; migrate finds nothing to apply
  ```
  No data is lost.
- **B. The update applied a migration:**
  1. Do step A's `git checkout` and `docker tag`.
  2. Restore the `pre-update-*.sql.gz` with **runbook §6**: restore into `restore_new`, run `verify.sql` from the *checked-out old* commit, and swap by rename. The damaged DB is kept as `<db>_before_restore_<ts>`.
  3. `docker compose --profile prod up -d`.
  4. Anything entered between the update and the rollback must be re-entered. Keep a paper note of the changes made in that window.
- **Never** roll back while a payroll week is half-approved. Finish or send back the run first.

**Gap (recommended):** tag images per release, e.g. `motonorte-payroll:<git-sha>` in compose via `image: motonorte-payroll:${APP_TAG:-latest}`. Then the previous version is a named tag rather than a manual `:prev`. Until then, the `docker tag … :prev` step above is **mandatory**.

## 12. First live payroll week in parallel: PENDING (Owner)

- There is no real past payroll, so no historical comparison was possible (`07-test-report.md` §4). The substitute passes: 24 Owner-approved fixtures, run end to end.
- **Required before relying on the app alone:**
  1. For the first live week, HR runs the **current manual process** and the **app** on the same attendance and jobs.
  2. Compare **net pay per employee to the centavo**, plus base, OT, incentive and adjustments.
  3. Every non-zero difference is either explained (a manual-process error, or a rule the Owner confirms) or filed as a bug. Switch-over happens only after a week with zero unexplained differences.
  4. Keep paying from the manual figures for that week.
- Record the result here: date, headcount, total net manual vs app, and the differences with their explanations.

## 13. TASK-016 payslip print preview: PENDING (Owner)

The Owner opens a locked run → Payslips → Print in Edge/Chrome. Confirm that:
- there is one A4 page per employee;
- nothing is cut off;
- incentives are itemized per day;
- the result is readable as a PDF.

Tick TASK-016 in the queue. Consider fixing the heading-order finding (item 3) at the same time.

## 14. TASK-017 RCBC bank file: PENDING (Owner decision)

The task is blocked on the blank RCBC bulk-credit template (OQ-18a). The Owner chooses one:
- **(a)** supply the template and wait for TASK-017 before launch; or
- **(b)** **launch without the bank file**: the Owner keys or uploads payments in RCBC manually from the locked run's net column (or the monthly CSV), and TASK-017 follows later.

Option (b) doesn't block the app's correctness.

## 15. Encryption key ceremony: PENDING (Owner)

Runbook §4 step 1:
1. On the Owner's own PC (not the server), run `age-keygen -o motonorte-backup.key`.
2. Store the private key **offline**: printed, and/or on a USB stick in the safe, with ideally two copies in two places.
3. Put only the `age1…` public key on the server at `/root/motonorte-backup.pub` (`chmod 600`).
4. Test-decrypt one `offsite/*.age` file on the Owner's PC, then run OPS-5.
5. **If the key is lost, no off-server backup can ever be read.** Record where the copies are kept, but not the key itself.

## 16. First Owner account; no dev test accounts: PENDING (server install)

- **Fresh install (recommended):** create the Owner with `create-user` via the `migrate` service, with the password read from an environment variable (runbook §2). The Owner then adds staff in Settings → Users.
  - **Do not** load `db/seed.sql`: it is fake data and says "Never load into production".
  - **Do not** set `DEV_OWNER_PASSWORD`/`DEV_STAFF_PASSWORD` on the server.
- **If trial data is carried over (runbook §3):** the dump brings the office-PC accounts with it, including `owner@motonorte.test` and `staff@motonorte.test`. Deactivate those in Settings → Users, or delete them in SQL before the first live week, and reset passwords for any real account.
- **Verify:** Settings → Users lists only the real people, and there is no `@motonorte.test` address.

## 17. Security M-2 decision: PENDING (Owner)

- **The finding:** `app_owner` is the image's PostgreSQL **superuser**. It owns every table and all SECURITY DEFINER functions, and `migrate` and `backup` hold its password. A leaked migrate/backup credential, or a future definer bug, would give full DB and container compromise.
- **Recommendation:** decide **before** the server install, because the fix is cheapest on a fresh volume. Keep `postgres` as the bootstrap superuser, create a `NOSUPERUSER NOBYPASSRLS` `app_owner` in `db/init` that owns the schema, and give `backup` a read-only role (`pg_read_all_data`). This needs a small task (developer + review + re-verify).
- **Alternative:** accept the risk. The app never holds these credentials (security control #10), and the functions are tight today. Record the acceptance here.

## 18. Before-online backlog: PENDING (Owner: do now or accept)

From `06-task-queue.md` Backlog and `reviews/TASK-024-027.md`:

| Item | Risk if deferred | Suggestion |
|---|---|---|
| Global cap on concurrent scrypt work during login | Many-IP spray saturates the 4-thread pool, so logins slow down (availability only) | Acceptable to defer if OPS-8 (office IP/VPN) is on; otherwise do it |
| `must_change_password` for owner-set passwords (M-4 part 2) | Owner knows staff's initial passwords; weakens audit non-repudiation | Users can already change their own password (M-4 part 1 done). Ask staff to change it at first login until the flag exists |
| Alert when `offsite/` has no new file for 26 h | Silent backup failure | Covered without code by item 10.2 (dead-man ping) |

---

## Measurement hygiene

- The scratch DB `motonorte_perf` was created, used and **dropped**.
- The temporary `next start` server on :3200 was stopped, and the throwaway login password file was deleted. No secrets were printed.
- The dev DB `motonorte` was only read (`schema_migrations`).
- `motonorte_e2e` was not written. It is unchanged: 7 migrations, 7 employees, 2 runs, 2 users, the same before and after.
- The dev server (:3000) and the containers were not touched. No app code, migrations or `.env` were modified.

## Hand-off checklist

- [x] QA and security reports read; evidence cited per item
- [x] Performance measured locally on a scratch DB (200 employees: 0.24 s)
- [x] EXPLAIN ANALYZE on hot queries; the one growing seq scan reported with a measured fix (TASK-028 suggested)
- [ ] Lighthouse scores: tool not installed; proxy measurements + axe recorded, and Lighthouse to be run against the live server
- [x] Compose config, `.env.example`, migrations checked locally
- [x] Rollback plan written (§11)
- [ ] Error monitoring: not wired; minimum recommended (§10)
- [ ] OPS-1..8 verified on the server
- [ ] Owner items: parallel run, TASK-016, TASK-017 decision, key ceremony, M-2 decision, backlog decision, first Owner account
- [ ] Owner go/no-go

**Recommendation: NO-GO for going live today.** No code defects block launch, and the app is ready to install on the server. It is blocked only by open items: server OPS-1..8 unverified, error monitoring not wired, the Owner's decisions (M-2, TASK-017/manual bank upload, backlog) and actions (age key ceremony, TASK-016 print check, first Owner account), and the first live week, which must run in parallel with manual payroll and match to the centavo before the app is used alone.
