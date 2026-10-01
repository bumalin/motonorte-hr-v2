#!/bin/sh
# Runs once when the Postgres container's data volume is first created (docker-entrypoint-initdb.d).
# Creates the non-owner login role the app uses, so RLS applies to it.
set -e
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v pw="$APP_DB_PASSWORD" <<'EOSQL'
create role app_user login password :'pw';
EOSQL
