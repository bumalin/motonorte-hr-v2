# Runbook — Motonorte Payroll (VPS / web server)

**Current plan:** Stage 1 on the office PC → `docs/runbook-office.md`. This file is Stage 2 (your VPS).

Operations guide for the VPS / web server (Stage 2). Architecture: `docs/03-architecture.md` §1, §9, §10.

## 1. Server requirements

- Linux VPS or dedicated server with Docker Engine + Docker Compose v2 (1 vCPU, 1–2 GB RAM, 20 GB disk).
- A domain or subdomain (e.g. `payroll.yourdomain.com`) with an **A record** pointing at the server's IP.
- Firewall: allow **22** (SSH, key-only), **80**, **443**. Nothing else. Postgres and the app are never exposed publicly.
- Shared hosting that only runs PHP/cPanel **cannot** run this app.

## 2. First install

```bash
git clone <repo-url> motonorte-payroll && cd motonorte-payroll
cp .env.example .env && chmod 600 .env
```

Edit `.env`:
- Replace every `change-me-*` with `openssl rand -hex 24` output. **Letters and digits only**: passwords are placed inside connection URLs, and characters like `/` break them. **Use different passwords from the office PC.**
- Set `DOMAIN=payroll.yourdomain.com`, `CADDYFILE=Caddyfile`, `AGE_RECIPIENT=<public key>` and `TRUST_PROXY=1` (the app sits behind Caddy, which sets the real client IP used by the login throttle).
- Leave `DATABASE_URL*` lines as they are (they're only used by `npm` scripts on a dev machine; containers build their own URLs).

Load the values into your shell for the commands below: `set -a; . ./.env; set +a`.

**Moving trial data from the office PC?** Do section 3 now *instead of* the start command below, then come back for the Owner account.

Start everything:

```bash
docker compose --profile prod up -d --build
docker compose ps          # db, app, caddy, backup "Up"; migrate "Exited (0)"
```

Caddy gets the HTTPS certificate automatically on first request to `https://$DOMAIN` (DNS must already point at the server).

Create the Owner account (password read from an environment variable, never typed on screen):

```bash
read -s OWNER_PW && export OWNER_PW
docker compose run --rm -e OWNER_PW migrate node scripts/create-user.ts --email you@example.com --name "Your Name" --role owner --password-env OWNER_PW
unset OWNER_PW
```

(The `migrate` service already has the owner database connection; only the password variable is passed in.)

The Owner then adds staff accounts in **Settings → Users**.

## 3. Moving trial data from the office PC (optional — on a fresh install only)

On the office PC, **in Git Bash** (PowerShell has no `gzip` and can corrupt binary pipes):
```bash
docker compose exec -T db pg_dump -U app_owner --no-owner motonorte | gzip > trial.sql.gz
```
Copy `trial.sql.gz` to the server. There, with a **brand-new** database volume (before `up -d --build` has ever run):
```bash
docker compose --profile prod up -d db                      # creates the empty database + app_user
gunzip -c trial.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "revoke temporary on database $POSTGRES_DB from public"
docker compose --profile prod up -d --build                 # migrate sees the trial's migrations and applies only newer ones
```
The `revoke temporary` line matters: the dump says migration 001 already ran, so its database-level hardening
(no temp tables for the app) must be applied by hand. Accounts come along with the dump; reset passwords in
Settings → Users if you want fresh ones. If the server already ran section 2, use the section 6 pattern instead.

## 4. Backups (OPS-4)

- The `backup` service runs **every night at 23:00 (Manila)**: `backups/motonorte-YYYYMMDD.sql.gz`, log in `backups/backup.log`.
- Keeps 30 daily files plus the 1st-of-month file for 12 months.
- Files are **owner-only** (`umask 077`, created by root inside the container): they contain gov't IDs and bank accounts.
  Copy them **as root** (key-only SSH for root, or a root cron job on the server that pushes them off-site).
- **Off-server copies are encrypted by the backup job itself** (they contain everyone's gov't IDs, bank accounts and password hashes):
  1. Once, on your own PC: create the key pair as in `docs/runbook-office.md` §3 (`age-keygen`). Keep the private key
     **offline** (printed and/or on a USB stick in the safe). Without it no off-site copy can be read — by anyone.
  2. Put the public key (`age1…`) in `.env` as `AGE_RECIPIENT`. Each nightly run then also writes
     `offsite/motonorte-YYYYMMDD.sql.gz.age`. `backup.log` warns if `AGE_RECIPIENT` is missing.
  3. Copy **only `offsite/`** off the server (as root, e.g. `rclone copy offsite/ gdrive:motonorte-backups`, or scp to the office PC).
     Never upload the plain `backups/*.sql.gz` files.
  4. To use an encrypted copy: `age -d -i motonorte-backup.key motonorte-YYYYMMDD.sql.gz.age > motonorte-YYYYMMDD.sql.gz`, then §5/§6.
- Run one on demand: `docker compose exec backup /bin/sh /backup.sh`.

## 5. Restore test (OPS-5) — before go-live, then monthly

Restores the latest backup into a **scratch database** (production is untouched) and runs the full database
check suite (`db/tests/verify.sql`: roles, locks, audit, carry-over — everything rolls back) against it:

```bash
f=$(sudo ls -1 backups/motonorte-*.sql.gz | tail -1)
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "drop database if exists restore_test" \
  -c "create database restore_test" -c "revoke temporary on database restore_test from public"
sudo gunzip -c "$f" | docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_test -v ON_ERROR_STOP=1 -q
docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_test -v ON_ERROR_STOP=1 -q < db/tests/verify.sql 2>&1 | grep -E "FAIL|ALL CHECKS"
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "drop database restore_test"
```
Expected last line of the check: `NOTICE:  ALL CHECKS PASSED`. Backup files are owner-only (they contain gov't IDs
and bank accounts), hence `sudo`.

## 6. Real restore (disaster)

Fail-safe: the backup is restored into a **new** database and checked *before* anything touches production; the
live database is then swapped out by renaming (kept, not dropped). At no point is production left empty.

```bash
( # subshell: a failed step stops the block without closing your SSH session
set -a; . ./.env; set +a
set -eo pipefail                                        # any failed step stops here (e.g. unreadable backup)
# Safety copy of the current (damaged) state under its OWN name, so it can't overwrite today's good backup
docker compose exec -T db pg_dump -U "$POSTGRES_USER" --no-owner "$POSTGRES_DB" | gzip | sudo tee "backups/pre-restore-$(date +%Y%m%d_%H%M).sql.gz" >/dev/null
f=backups/motonorte-YYYYMMDD.sql.gz                     # the backup you want to go back to
sudo test -s "$f"                                       # exists and is non-empty

# 1. Restore into a new database and prove it's good
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists restore_new" -c "create database restore_new" \
  -c "revoke temporary on database restore_new from public"        # database-level hardening isn't in the dump
sudo gunzip -c "$f" | docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_new -v ON_ERROR_STOP=1 -q
docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_new -v ON_ERROR_STOP=1 -q < db/tests/verify.sql 2>&1 | grep -E "FAIL|ALL CHECKS"
# → must print "ALL CHECKS PASSED". If not, stop: production is still untouched.

# 2. Swap (only the app and backup hold connections; stop them first)
docker compose --profile prod stop app caddy backup
old="${POSTGRES_DB}_before_restore_$(date +%Y%m%d_%H%M)"
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "alter database $POSTGRES_DB rename to $old" -c "alter database restore_new rename to $POSTGRES_DB"
docker compose --profile prod up -d
)
```
The previous database stays as `<POSTGRES_DB>_before_restore_<timestamp>` for inspection; drop it when sure:
`docker compose exec db psql -U "$POSTGRES_USER" -d postgres -c "drop database <name>"`.
The app role (`app_user`) lives outside the dump and backups keep GRANTs, so `app_user` regains exactly its
original access. Anything entered after the chosen backup must be re-entered.

## 7. Updates (OPS-7)

```bash
git pull
docker compose --profile prod build --pull && docker compose --profile prod up -d   # migrations run before the app starts
docker compose --profile prod pull caddy db && docker compose --profile prod up -d   # base images, monthly (backup + app are rebuilt by build --pull)
```
Keep OS security updates on (`unattended-upgrades` on Ubuntu/Debian).

## 8. Rotating secrets

Use psql's `\password` so new passwords never land in shell history or the process list (letters and digits only):
- **App DB password:** `docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`, then `\password app_user`.
  Set `APP_DB_PASSWORD` in `.env`, then `docker compose --profile prod up -d app` (`up -d`, not `restart`, re-reads `.env`).
- **Owner DB password:** same, `\password <POSTGRES_USER>`; update `POSTGRES_PASSWORD`; `docker compose --profile prod up -d`.
- **User passwords:** Settings → Users (signs that user out everywhere).

## 9. Development/test copy on the office PC

```bash
docker compose up -d db && npm run dev        # development
docker compose up -d                          # full app at http://localhost:3000 (APP_PORT=3001 if 3000 is busy)
```
If real employee data is entered locally, turn on BitLocker and use a password-protected Windows account.
