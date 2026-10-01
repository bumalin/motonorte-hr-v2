#!/bin/sh
# Nightly backup (OPS-4): pg_dump → /backups/motonorte-YYYYMMDD.sql.gz (stays on this machine, owner-only),
# plus, when AGE_RECIPIENT is set, an age-encrypted copy → /offsite/motonorte-YYYYMMDD.sql.gz.age.
# Only /offsite may leave the machine (e.g. a OneDrive/Google Drive folder mounted there). The private key is kept
# offline by the Owner; this machine can't decrypt its own off-site copies. See docs/runbook*.md.
# Retention (both folders): 30 daily files + the 1st-of-month file for 12 months.
set -eu
set -o pipefail          # a failed pg_dump must fail the backup, not leave a truncated archive
umask 077                # dumps hold gov't IDs and bank accounts: owner-only files
day=$(date +%Y%m%d)
out="/backups/motonorte-$day.sql.gz"
tmp="$out.partial"
# Keep GRANTs (app_user access) and default privileges; --no-owner so the restoring superuser owns the objects
pg_dump --no-owner | gzip -9 > "$tmp"
gzip -t "$tmp"            # never keep a corrupt archive
mv "$tmp" "$out"
echo "$(date -Iseconds) backup ok: $out ($(wc -c < "$out") bytes)"

if [ -n "${AGE_RECIPIENT:-}" ]; then
  enc="/offsite/$(basename "$out").age"
  age -r "$AGE_RECIPIENT" -o "$enc.partial" "$out"
  mv "$enc.partial" "$enc"
  echo "$(date -Iseconds) encrypted copy ok: $enc"
else
  echo "$(date -Iseconds) WARNING: AGE_RECIPIENT not set - no encrypted off-machine copy made" >&2
fi

prune() {  # $1 = dir, $2 = suffix
  find "$1" -name '*.partial' -mmin +120 -delete
  find "$1" -name "motonorte-*$2" -mtime +30 ! -name "motonorte-??????01$2" -delete
  find "$1" -name "motonorte-??????01$2" -mtime +370 -delete
}
prune /backups .sql.gz
[ -d /offsite ] && prune /offsite .sql.gz.age
exit 0
