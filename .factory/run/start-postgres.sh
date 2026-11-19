#!/usr/bin/env bash
# Starts a local PostgreSQL 17 on localhost:5432 (trust auth) with databases crm_dev and crm_test.
set -e
export PATH=/usr/lib/postgresql/17/bin:$PATH
[ -x /usr/lib/postgresql/17/bin/initdb ] || { sudo apt-get update -qq; sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/tmp/apt.log 2>&1 || true; }
export PATH=/usr/lib/postgresql/17/bin:$PATH
PGDATA=${PGDATA:-/tmp/pgdata}
[ -d "$PGDATA" ] || initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_isready -h localhost -p 5432 >/dev/null 2>&1 || pg_ctl -D "$PGDATA" -o "-k /tmp -c listen_addresses=localhost" -l /tmp/pg.log start >/dev/null
for i in $(seq 30); do pg_isready -h localhost -p 5432 >/dev/null && break; sleep 1; done
for db in crm_dev crm_test; do
  psql -h localhost -U postgres -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 || psql -h localhost -U postgres -qc "create database $db"
done
echo "postgres ready"
