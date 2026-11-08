# Runbook — Push changes to GitHub, update the VPS, back up and restore

How a change travels: **office PC** (edit, test, commit) → **GitHub** `bumalin/motonorte-hr-v2` → **VPS** (pull, rebuild, restart).
The VPS never edits code; it only pulls. Server install itself: `docs/runbook.md` §1–§2.

Commands marked **(Office PC)** run in Git Bash or PowerShell in `C:\Users\kcmat\MotonortePayroll`.
Commands marked **(VPS)** run over SSH inside the project folder on the server (e.g. `cd ~/motonorte-payroll`).

> **Never, anywhere:** `docker compose down -v`, `docker volume prune`, `docker system prune --volumes`,
> `npm run db:reset` on a real database. Each deletes the payroll database. Never commit `.env`, `backups/` or `offsite/`.

---

## 1. One-time setup

### Office PC — push as `bumalin`
This PC has two GitHub logins in `gh`: **reyaldesign** (default — gets *403 Permission denied* on this repo) and
**bumalin** (has write access). Check with `gh auth status`. Push with the bumalin login without changing the default
(§2 step 4). If bumalin is not listed: `gh auth login` and sign in as bumalin.

### VPS — clone
The repository is **public**, so the VPS needs no GitHub login to pull:
```bash
git clone https://github.com/bumalin/motonorte-hr-v2.git ~/motonorte-payroll
cd ~/motonorte-payroll
git checkout codex/employee-portal-monthly-payslips-20261010   # or main, once changes are merged there
```
Then `.env` and first start: `docs/runbook.md` §2.

**Nginx or Caddy?** If the VPS already runs **Nginx** on ports 80/443, do **not** use `--profile prod` (it starts Caddy,
which fights Nginx for those ports). This runbook only restarts `app` (and `backup`), so it works either way.

---

## 2. Release a change (Office PC)

1. **Check** (never run `npm test` — it includes database tests that would use the live `.env` database):
   ```bash
   npm run typecheck
   npm run lint
   node --test lib/payroll/*.test.ts lib/portal/range.test.ts lib/portal/summary.test.ts lib/format.test.ts lib/auth/auth.test.ts lib/db/reports.test.ts
   npm run build
   ```
2. **Review** what will be committed — only intended source and docs, no `.env`, no backups:
   ```bash
   git status --short
   git diff
   ```
3. **Commit** (name the files; avoid `git add -A` unless `git status` is clean of surprises):
   ```bash
   git add "app/(app)/my-pay/page.tsx" docs/some-note.md
   git commit -m "Short summary of the change"
   ```
4. **Push as bumalin** (one line; uses bumalin's login for this push only):
   ```bash
   GH_TOKEN="$(gh auth token --user bumalin)" git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin HEAD
   ```
   Expected: `… -> codex/employee-portal-monthly-payslips-20261010` (or your branch).
5. *(Optional, recommended)* Merge into `main` so the VPS can simply follow `main`:
   ```bash
   GH_TOKEN="$(gh auth token --user bumalin)" gh pr create --repo bumalin/motonorte-hr-v2 --base main --fill
   ```
   Review and merge the pull request on GitHub.

The office PC's own live app is updated separately (backup → restore test → `docker compose build migrate` →
`docker compose --profile prod up -d app`), see `docs/runbook-office.md` §8.

---

## 3. Update the VPS (pull the changes)

```bash
# (VPS) 0. Where am I?  Expect origin = bumalin/motonorte-hr-v2 and the branch you deploy from
git remote -v && git branch --show-current && docker compose ps

# 1. Backup first (§4.2) and remember the current app image for rollback
mkdir -p ~/motonorte-backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > ~/motonorte-backups/before-update-$(date +%Y%m%d-%H%M).sql.gz
APP_IMAGE=$(docker compose config --images | grep -- '-app:' | head -1)
docker tag "$APP_IMAGE" "${APP_IMAGE%:*}:before-update-$(date +%Y%m%d)"

# 2. Get the new code (fast-forward only; refuses if someone edited files on the server)
git fetch origin
git pull --ff-only

# 3. Rebuild and restart the app (migrations run automatically before it starts)
docker compose build --pull migrate
docker compose up -d app

# 4. Check
docker compose ps                     # app: Up (healthy); migrate: Exited (0)
docker compose logs --tail 5 migrate  # "up to date" or "N migration(s) applied"
```
Open the site and reload with **Ctrl+F5**.

**Rollback** (keeps all data; use the date from step 1):
```bash
APP_IMAGE=$(docker compose config --images | grep -- '-app:' | head -1)
docker tag "${APP_IMAGE%:*}:before-update-YYYYMMDD" "$APP_IMAGE"
docker compose up -d --no-deps app
```
If the update **added a migration**, rolling back the app does not undo it — ask before rolling back, or restore (§6).

---

## 4. Backups on the VPS

### 4.1 Nightly (automatic)
The `backup` service writes `backups/motonorte-YYYYMMDD.sql.gz` every night (23:00 Manila; `BACKUP_SCHEDULE` in `.env`),
keeps 30 daily + 12 monthly, and — if `AGE_RECIPIENT` is set — an encrypted copy in `offsite/`. Details: `docs/runbook.md` §4.
```bash
docker compose ps backup                 # must be Up. Start it (no Caddy): docker compose --profile prod up -d backup
sudo tail -3 backups/backup.log          # expect "backup ok" (and "encrypted copy ok")
sudo ls -lh backups/ | tail -5
```

### 4.2 On demand (before every update or risky change)
```bash
docker compose exec backup /bin/sh /backup.sh       # same as the nightly job (needs the backup service)
# or, without the backup service:
mkdir -p ~/motonorte-backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > ~/motonorte-backups/manual-$(date +%Y%m%d-%H%M).sql.gz
chmod 600 ~/motonorte-backups/*.sql.gz              # gov't IDs and bank accounts: owner-only
gzip -t ~/motonorte-backups/manual-*.sql.gz && echo archive ok
```

### 4.3 Copy off the server
Copy **only encrypted** files (`offsite/*.age`) off the VPS, e.g. to the office PC:
```bash
# (Office PC, Git Bash)
scp 'user@your-vps:~/motonorte-payroll/offsite/motonorte-*.sql.gz.age' "C:/Users/kcmat/OneDrive/MotonorteBackups/"
```
Never upload the plain `.sql.gz` files. Decrypting needs the offline key: `docs/runbook.md` §4 step 4.

---

## 5. Restore test (safe — production is not touched)

Do this after setting up backups, then monthly. It restores a backup into a scratch database and proves every table
matches. Use a backup taken **just now** (§4.2), so the live database has not changed since:
```bash
f=$(ls -1t ~/motonorte-backups/*.sql.gz | head -1)        # or: f=$(sudo ls -1 backups/motonorte-*.sql.gz | tail -1)
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists restore_test" -c "create database restore_test" -c "revoke temporary on database restore_test from public"'
sudo gunzip -c "$f" | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_test -v ON_ERROR_STOP=1 -q' && echo RESTORE_OK
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAq' < db/tests/fingerprints.sql > /tmp/fp-live.txt
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_test -tAq'   < db/tests/fingerprints.sql > /tmp/fp-restore.txt
diff /tmp/fp-live.txt /tmp/fp-restore.txt && echo "PASS: all $(wc -l < /tmp/fp-live.txt) tables match"
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -q -c "drop database restore_test"'
```
Expected: `RESTORE_OK` and `PASS: all 21 tables match` (table count grows with new migrations). Any diff line names
the table that differs — if only `sessions`, `login_attempts`, `users` or `audit_log` differ, someone signed in after
the backup; take a fresh backup and repeat.

(`db/tests/verify.sql` from `docs/runbook.md` §5 needs the synthetic seed data and fails on real payroll data; use it only on test databases.)

---

## 6. Real restore (disaster) — go back to a backup

Restores into a **new** database, checks it, then swaps by renaming. The current database is **kept** (renamed), never dropped.
Anything entered after the chosen backup must be re-entered.
```bash
( set -eo pipefail
f=~/motonorte-backups/manual-YYYYMMDD-HHMM.sql.gz           # or backups/motonorte-YYYYMMDD.sql.gz (use sudo below)
sudo test -s "$f" && sudo gzip -t "$f"

# 0. Safety copy of the current state under its own name
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > ~/motonorte-backups/pre-restore-$(date +%Y%m%d-%H%M).sql.gz

# 1. Restore into a new database
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists restore_new" -c "create database restore_new" -c "revoke temporary on database restore_new from public"'
sudo gunzip -c "$f" | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_new -v ON_ERROR_STOP=1 -q'

# 2. Sanity check: row counts per table (employees, payroll_runs, users should look right)
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_new -tAq' < db/tests/fingerprints.sql | cut -d'|' -f1,2
)
```
**Stop here and look at the counts.** If they look wrong, nothing has changed yet — drop `restore_new` and pick another backup.
If they look right, swap:
```bash
( set -eo pipefail
docker compose stop app backup
old="before_restore_$(date +%Y%m%d_%H%M)"
docker compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -v ON_ERROR_STOP=1 -c \"alter database \\\"\$POSTGRES_DB\\\" rename to $old\" -c \"alter database restore_new rename to \\\"\$POSTGRES_DB\\\"\""
docker compose up -d app
docker compose --profile prod up -d backup     # only if you use the backup service
docker compose ps
)
```
The previous database remains as `before_restore_<timestamp>`. Drop it only when sure:
`docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "drop database before_restore_YYYYMMDD_HHMM"'`.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Office PC push: `Permission … denied to reyaldesign` / 403 | Use the bumalin push command (§2 step 4). |
| VPS `git pull --ff-only`: *Not possible to fast-forward* / *local changes would be overwritten* | Someone edited files on the server. `git status`; save anything needed, then `git stash` and pull again. Never commit on the VPS. |
| `migrate` exited with an error | `docker compose logs migrate`. The old app keeps running only if it was not yet recreated; if the site is down, roll back the image (§3) and report the error. Applied migrations must never be edited — fixes go in a new numbered migration. |
| App not healthy after update | `docker compose logs --tail 50 app`; roll back (§3). |
| Page looks unchanged | Reload with Ctrl+F5; confirm `git log -1` on the VPS shows the expected commit. |

---

Hand-off:
- [x] Push, VPS update, backup, restore test, disaster restore and rollback documented
- [x] Restore check uses `db/tests/fingerprints.sql` (works on real data)
- [ ] VPS install itself not verified from here (folder, branch, Nginx vs Caddy are the Owner's)
- [x] `docs/runbook.md` points here and warns that `verify.sql` needs seed data
