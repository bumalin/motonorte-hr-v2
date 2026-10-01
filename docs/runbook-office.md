# Runbook — Office PC (Stage 1: real payroll on this PC, office network only)

Owner decision (2026-09-27): run real payroll on this Windows 11 PC for staff on the office network, **not on the
internet**; move to the Owner's VPS later (`docs/runbook.md`). Same Docker setup in both places — only `.env` differs.

Commands marked **(Git Bash)** run in Git Bash; **(PowerShell, admin)** in PowerShell started with "Run as administrator".

## 1. Prepare this PC (once)

| # | What | How |
|---|---|---|
| 1 | Password-protected Windows account | Settings → Accounts → Sign-in options |
| 2 | Disk encryption (the database holds gov't IDs and bank accounts) | Settings → Privacy & security → Device encryption / BitLocker → On. **Save the recovery key** somewhere other than this PC. |
| 3 | Docker starts by itself | Docker Desktop → Settings → General → ✅ *Start Docker Desktop when you sign in* |
| 4 | PC stays awake during office hours | Settings → System → Power → Screen and sleep → *When plugged in, put my device to sleep after*: **Never** |
| 5 | Fixed address on the network | In your router's admin page, add a **DHCP reservation** for this PC (current address `192.168.50.241`). Staff will always use this address. |
| 6 | Office network is "Private" (**currently Public**) | Settings → Network & internet → (your connection) → Network profile type: **Private** |
| 7 | UPS (recommended) | Protects against power cuts mid-payroll |

## 2. Install the real system in its own folder

The real system goes in **your user folder** (`C:\Users\kcmat\MotonortePayroll`): other Windows accounts on this PC
can't read it (a folder directly under `C:\` would be readable by every local user). The project folder on your Desktop is the **development/test copy** (test data, `@motonorte.test` accounts). The real
system lives in a separate folder with its own database, passwords and backups.

**(PowerShell)** — copy the program files only:
```powershell
robocopy "C:\Users\kcmat\Desktop\Claude - Motonorte HR 2" "C:\Users\kcmat\MotonortePayroll" /E /XD node_modules .next backups offsite test-results playwright-report .git /XF .env
cd C:\Users\kcmat\MotonortePayroll
copy .env.example .env
notepad .env
```

Fill in `.env` (**letters and digits only** for passwords — get each with `openssl rand -hex 24` in Git Bash):

```ini
COMPOSE_PROJECT_NAME=motonorte-office      # keeps it separate from the test copy
POSTGRES_PASSWORD=<new random>
APP_DB_PASSWORD=<new random>
DB_PORT=5435                               # test copy uses 5434
DATABASE_URL_OWNER=postgres://app_owner:<POSTGRES_PASSWORD>@127.0.0.1:5435/motonorte
DATABASE_URL=postgres://app_user:<APP_DB_PASSWORD>@127.0.0.1:5435/motonorte
DOMAIN=192.168.50.241                      # this PC's reserved address
CADDYFILE=Caddyfile.office
TRUST_PROXY=0                              # office: Docker hides staff PCs' real addresses; per-account limits apply
HTTP_BIND=192.168.50.241:80                # listen on the office network address only
HTTPS_BIND=192.168.50.241:443
APP_PORT=3005                              # localhost only; staff use https://192.168.50.241
BACKUP_SCHEDULE="45 17 * * *"              # 5:45 PM — this PC must be on
AGE_RECIPIENT=<public key from §3>
OFFSITE_DIR=C:/Users/kcmat/OneDrive/MotonorteBackups   # or your Google Drive folder
```
Delete the `DEV_OWNER_PASSWORD` / `DEV_STAFF_PASSWORD` lines if present — test accounts never go into the real system.

**Check before the first start (PowerShell):** `docker compose config | Select-String "^name:"` must print
`name: motonorte-office`. If it prints `motonorte-payroll`, **stop** — `COMPOSE_PROJECT_NAME` is missing and the office
system would share the test copy's database.

## 3. Backup encryption key (once — the "key ceremony")

**(Git Bash)**, in `C:\Users\kcmat\MotonortePayroll`:
Plug in the USB stick and look up **its** drive letter in File Explorer (on this PC, `E:` is an internal disk — don't
guess). Below, replace `F:` with the stick's letter. Then **(Git Bash)**:
```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "F:/:/k" alpine:3 sh -c "apk add --no-cache age >/dev/null && age-keygen -o /k/motonorte-backup.key"
```
Before going on, open the USB stick in File Explorer and confirm `motonorte-backup.key` is **there** (not on this PC).
The command printed `Public key: age1…` → paste that into `.env` as `AGE_RECIPIENT`. Print the key file too (one short line) and keep the USB stick and printout in the office safe. **Without this key, off-site backup copies can't be read by
anyone — including you.** The PC keeps its own unencrypted copies for quick restores.

## 4. Start it and create your account

**(PowerShell)**, in `C:\Users\kcmat\MotonortePayroll`:
```powershell
mkdir C:\Users\kcmat\OneDrive\MotonorteBackups -Force
docker compose --profile prod up -d --build
docker compose ps        # db, app, caddy, backup "Up"; migrate "Exited (0)"
```

Create the Owner account **(Git Bash)**, in `C:\Users\kcmat\MotonortePayroll`:
```bash
read -s OWNER_PW && export OWNER_PW
docker compose run --rm -e OWNER_PW migrate node scripts/create-user.ts --email you@yourdomain.com --name "Your Name" --role owner --password-env OWNER_PW
unset OWNER_PW
```
Open https://192.168.50.241, sign in, and add staff under **Settings → Users** (each changes their password under
**Your account** afterwards). Add incentive jobs, employees and settings for real.

## 5. Let staff PCs in

**Firewall (PowerShell, admin).** Docker Desktop installs its own rules that allow any port on *Private and Public*
networks; restrict them to Private (office) networks, and allow only the web ports:
```powershell
Get-NetFirewallApplicationFilter -Program "*com.docker.backend.exe" | Get-NetFirewallRule | Set-NetFirewallRule -Profile Private
New-NetFirewallRule -DisplayName "Motonorte Payroll (office)" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Profile Private -Action Allow
```
With `HTTP_BIND`/`HTTPS_BIND` set to the office address, the app isn't offered on any other network (hotspots, VPNs).
**After every Docker Desktop update**, run the `Set-NetFirewallRule -Profile Private` line again — updates can re-create Docker's rules for all networks.

**Trust the certificate on each staff PC** (once per PC). On this PC, export it:
```powershell
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt C:\Users\kcmat\MotonortePayroll\motonorte-root.crt
```
Copy `motonorte-root.crt` to each staff PC (USB or shared folder) and run there **(PowerShell, admin)**:
```powershell
Import-Certificate -FilePath .\motonorte-root.crt -CertStoreLocation Cert:\LocalMachine\Root
```
Then open **https://192.168.50.241** and bookmark it. No security warning should appear.
If the page doesn't load (from any PC): on this PC run `ipconfig` and check the IPv4 address is still `192.168.50.241`
(the router reservation, §1 row 5); then `docker compose --profile prod up -d` and `docker compose ps` (caddy must be *Up*).
Caddy can only listen on that address while this PC actually has it.

Note: a trusted root certificate can vouch for *any* site name on the staff PC, and its private key lives in this PC's
Caddy data (a Docker volume). Keep this PC protected (BitLocker, password, few accounts) and remove the certificate from
staff PCs when you move to the VPS (§10).

## 6. Backups

- Every day at 5:45 PM: `C:\Users\kcmat\MotonortePayroll\backups\motonorte-YYYYMMDD.sql.gz` (stays on this PC) and an **encrypted**
  copy in your OneDrive/Google Drive folder (`…sql.gz.age`) which syncs off the PC. 30 daily + 12 monthly kept.
- Check it works: the next morning, look for today's `.age` file in the cloud folder; `backups\backup.log` shows `backup ok`.
- Make one now **(PowerShell)**: `docker compose exec backup /bin/sh /backup.sh`
- **After every "Approve & lock", run that command once** — a locked week is then backed up even if the PC is off at 5:45 PM.
- After a power cut or restart, the system comes back only once someone signs in to Windows (Docker Desktop starts at sign-in).

**Never** use Docker Desktop's *Clean / Purge data* or *Reset to factory defaults*, uninstall Docker Desktop, or run
`docker volume prune` / `docker system prune --volumes` on this PC: they **delete the live payroll database**. If Docker
must be reinstalled, take a backup first and restore it afterwards (§7).

## 7. Restore test — before first live payroll, then monthly **(Git Bash)**

```bash
set -a; . ./.env; set +a
f=$(ls -1 backups/motonorte-*.sql.gz | tail -1)
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "drop database if exists restore_test" -c "create database restore_test" -c "revoke temporary on database restore_test from public"
gunzip -c "$f" | docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_test -v ON_ERROR_STOP=1 -q
docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_test -v ON_ERROR_STOP=1 -q < db/tests/verify.sql 2>&1 | grep -E "FAIL|ALL CHECKS"
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "drop database restore_test"
```
Expected: `ALL CHECKS PASSED`. Once a quarter, also test an **encrypted** copy: decrypt it with the offline key
(`age -d -i motonorte-backup.key file.sql.gz.age > file.sql.gz`, in the same alpine container as §3) and run the steps above on it.

Disaster restore: same fail-safe procedure as `docs/runbook.md` §6 (restore into a new database, check, then swap).

## 8. Updates

Stop nothing by hand. Copy the new version over the program files (never `.env`, `backups`), then rebuild:
```powershell
# (PowerShell)
docker compose exec backup /bin/sh /backup.sh                 # safety copy first
robocopy "<new version folder>" "C:\Users\kcmat\MotonortePayroll" /E /XD node_modules .next backups offsite test-results playwright-report .git /XF .env
docker compose --profile prod build --pull; docker compose --profile prod up -d   # migrations run before the app starts
```
If an update changes what goes into a payroll draft (e.g. migration 008, daily allowance), any week that is in draft or submitted shows as stale afterwards: send it back if submitted, then regenerate it. Locked weeks are never affected.

## 9. The development/test copy

Only run it when developing: `docker compose down` in the Desktop project folder when done. It uses different ports
(3000/3001/5434) and its own database, and listens on this PC only.

## 10. Later: moving to your VPS

1. On the VPS, follow `docs/runbook.md` §1–§2, with `DOMAIN=payroll.yourdomain.com`, `CADDYFILE=Caddyfile`,
   `BACKUP_SCHEDULE="0 23 * * *"`, the **same** `AGE_RECIPIENT`.
2. Move the data with `docs/runbook.md` §3 using a fresh backup from `C:\Users\kcmat\MotonortePayroll\backups`.
3. Staff switch their bookmark to `https://payroll.yourdomain.com` (a public certificate — no cert install needed).
4. Stop the office stack: `docker compose --profile prod down` in `C:\Users\kcmat\MotonortePayroll` (keep the folder until the VPS has run a full week).
5. On each staff PC **(PowerShell, admin)**, remove the office certificate:
   `Get-ChildItem Cert:\LocalMachine\Root | Where-Object Subject -like "*Caddy Local Authority*" | Remove-Item`
