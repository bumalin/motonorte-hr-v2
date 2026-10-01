# Review: TASK-021 (production compose: app image, Caddy, backups)

```json
{"task":"TASK-021","verdict":"APPROVE","iteration":3,
 "findings":[
  {"severity":"minor","file":"docs/runbook.md","line":100,
   "issue":"The safety copy runs `backup.sh`, which writes today's `motonorte-YYYYMMDD.sql.gz`. If the damage happened after tonight's 23:00 run, and the operator restores before midnight, the backup they want is today's file. The safety copy overwrites it with the damaged state before `f` is read. The window is about 1 h a day. The swap already keeps the old DB (`<db>_before_restore_<ts>`), so the safety copy adds little.",
   "fix_hint":"Delete the line, since the renamed old DB is the safety copy. Or dump to a distinct name, e.g. `pre-restore-$(date +%Y%m%d_%H%M).sql.gz`."},
  {"severity":"minor","file":"docs/runbook.md","line":99,
   "issue":"If the block is pasted into an interactive SSH shell, `set -eo pipefail` makes any failure close the session. That fails safe, since production is untouched until step 2, but the operator gets disconnected mid-disaster.",
   "fix_hint":"Wrap the block in `( ... )` or `bash -c '...'`, or say 'paste into `bash` first'."},
  {"severity":"minor","file":"docs/runbook.md","line":72,
   "issue":"Lines 70–71 say to copy as root, but the scp example still reads `user@server:~/motonorte-payroll/backups/`. As a non-root user that fails on the 0600 files.",
   "fix_hint":"Use `root@server:/path/to/motonorte-payroll/backups/` in the example."}
 ]}
```

## Round-2 findings: status

| Round-2 finding | Status |
|---|---|
| major, §6 restore reads 0600 files without sudo, so a failed gunzip gives an empty production DB | Fixed, and made fail-safe. It restores into `restore_new`; `pipefail` catches gunzip/psql failures; verify.sql must pass (a FAIL makes psql exit non-zero, and `set -e` stops the block). Production is only swapped out by rename afterwards, and the old DB is kept. Every step either stops with production untouched, or stops with the app down and the old DB still present under its original or timestamped name. Production is never dropped or left empty. The revoke on `restore_new` is a database ACL, so it survives the rename. |
| minor, chown advice for off-server copies | Fixed (the example on line 72 still needs updating, see above) |

## Summary

TASK-021 now meets its acceptance criteria. `docker compose up` serves the app on `127.0.0.1:${APP_PORT:-3000}`. A backup produced by the service restores into a scratch DB, and `verify.sql` passes against it (developer run: 67 PASS, ALL CHECKS PASSED). OPS-1..7 are covered, and the task's rules hold:
- **Secrets:** they come only from env. The owner URL stays in the one-shot `migrate` service, and nothing is baked into the image.
- **Container and proxy:** the image runs as non-root. The app waits for migrations, and a failed migration leaves the old app on the old schema. Caddy replaces client-sent X-Forwarded-For. There is no public DB port; the loopback-only binding was accepted by ruling in round 1.
- **Backups:** owner-only, verified with `gzip -t`, and a failed `pg_dump` fails the backup (pipefail).

The §6 disaster restore is now fail-safe: it restores into a new database, verifies it, then swaps by rename. The three remaining findings are runbook polish, and none blocks: the safety copy can overwrite a same-evening backup, `set -e` closes an interactive session, and the scp example still uses a non-root user. The developer can fix them in passing or leave them for the release-engineer's launch checklist.

## Suggested new tasks

- IP-level login rate limit before going online.
- Backup freshness alert: warn if no dump newer than about 26 h exists, because crond failures are silent.
- Encrypt off-server backup copies.

## Hand-off checklist

- [x] Acceptance criteria met (local full app; a service backup restores and db:verify passes)
- [x] Security: secrets from env only, owner URL isolated, non-root, no public DB port, trusted client IP
- [x] Money: not applicable
- [x] Tests: the restore plus verify.sql procedure is documented and was run
- [x] Simplicity: no needless abstraction or new dependencies
- [x] APPROVE
