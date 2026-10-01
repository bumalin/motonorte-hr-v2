# Review — TASK-029 · Office-PC deployment mode (Stage 1)

```json
{"task":"TASK-029","verdict":"APPROVE","iteration":2,
 "findings":[
  {"severity":"minor","file":"docs/runbook-office.md","line":62,
   "issue":"The example 'say it is drive E:' is wrong for this PC: E: is a fixed internal disk here (Get-Volume); the removable slots are F: and H:. Following the example literally writes the private key to the PC's own disk, which is what §3 forbids. Lines 61-62 also repeat the '(Git Bash)' label.",
   "fix_hint":"Say: 'use the USB stick's letter from File Explorer (not C:, D: or E:)'. After running the command, check in File Explorer that <USB>:\\motonorte-backup.key exists before pasting the public key into .env. Remove the duplicate label."},
  {"severity":"minor","file":"docs/runbook-office.md","line":93,
   "issue":"Docker Desktop can re-create its com.docker.backend.exe firewall rules (Private + Public) when it updates or reinstalls, which silently undoes the restriction.",
   "fix_hint":"Add one line: after each Docker Desktop update, run the `Get-NetFirewallApplicationFilter ... | Set-NetFirewallRule -Profile Private` line again."},
  {"severity":"minor","file":"docs/runbook-office.md","line":46,
   "issue":"Binding to 192.168.50.241 was not exercised: the retest used 127.0.0.1:8443, as the review rules required. If the address isn't there when Docker starts (DHCP reservation not yet made, or the network comes up late), Caddy's ports don't publish. It fails loudly, but the runbook doesn't say what to do.",
   "fix_hint":"Add a troubleshooting line to §6 for when staff can't connect after a restart: check `ipconfig` shows 192.168.50.241, then run `docker compose --profile prod up -d`. The first staff-PC check in §5 is the acceptance test for the bind."},
  {"severity":"minor","file":"docs/runbook-office.md","line":158,
   "issue":"§10 step 1 still shows `BACKUP_SCHEDULE=0 23 * * *` unquoted. The same bash-sourcing problem as round 1 comes back on the VPS.",
   "fix_hint":"Write it as `BACKUP_SCHEDULE=\"0 23 * * *\"`."},
  {"severity":"minor","file":"docs/03-architecture.md","line":50,
   "issue":"Round-1 minor, partly fixed. 03-architecture.md line 50 still says 'localhost only, no office-network access ... needs no certificates'. docs/runbook.md line 5 still says 'for the web server and the office PC', and runbook.md §9 is still titled 'Office PC (local trial)'.",
   "fix_hint":"Point these at runbook-office.md, or say 'dev/test copy'."}
 ]}
```

**Summary.** All 2 blockers and 6 majors from iteration 1 are fixed, and I re-checked each one.
- **SNI:** `Caddyfile.office` sets `default_sni {$DOMAIN}`. In round 1 I proved this fixes the handshake without SNI, and the developer confirmed it on an IP-addressed stack with `-verify_ip`.
- **Images:** they are now per project. `docker compose config` gives `motonorte-payroll-app/-backup` for dev, `motonorte-office-app/-backup` for the office `.env`, and `mn-x-app` with only `-p mn-x`. The running dev app still uses its own image (ce22d87786c9).
- **Project name:** `.env.example` no longer sets it, and §2 requires the `name:` check before the first start.
- **Binds and firewall:** the office binds resolve to `host_ip: 192.168.50.241` for 80/443 and `127.0.0.1` for the DB and app. The firewall wildcard matches both Docker rules (count 2).
- **TRUST_PROXY:** it is 0 in the runbook and in the checklist.
- **Install folder:** `C:\Users\kcmat` grants access only to SYSTEM, Administrators and kcmat.
- **VPS runbook:** the §7 pull no longer names built images.
- **Certificate:** the root-certificate text is now accurate, and §10 removes the root from staff PCs.
- **BACKUP_SCHEDULE:** the quoted value parses in both compose and bash.

The remaining findings are wording and operations notes, so this is APPROVE. Housekeeping: the old-name tags `motonorte-payroll:latest` (db6dbc937131) and `motonorte-backup:latest` (90fa44c6ed98) from the round-1 test are still present. Nothing references them any more, so `docker rmi` is safe.

## Suggested new tasks
- Catch-up backup at container start (run `backup.sh` if today's file is missing, then start crond). Carried over from iteration 1.
- Owner decision, outside this project: `web-postgres-1` publishes 0.0.0.0:5432. Docker's rules now allow it on the office (Private) network, so bind it to 127.0.0.1 or stop it before staff use this PC's address.

## Hand-off checklist
- [x] Each iteration-1 blocker and major re-verified (compose config with dev, office and `-p` variants; firewall filter; ACL; bash sourcing)
- [x] No new scope added; ideas under Suggested new tasks
- [x] No running motonorte-payroll-* container touched; .env not read; no containers or volumes left behind (only read-only `--rm` checks)
- [x] Verdict: APPROVE (minors don't block)
