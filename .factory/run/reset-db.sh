#!/usr/bin/env bash
# Empties every app table of a database (default crm_dev) and, unless NO_SEED=1, loads fake data again.
set -e; cd "$(dirname "$0")/../.."
DB=${1:-crm_dev}
/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d "$DB" -qc "truncate users, sessions, user_changes restart identity cascade"
[ -n "$NO_SEED" ] || APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/$DB npm run -s db:seed 2>/dev/null
