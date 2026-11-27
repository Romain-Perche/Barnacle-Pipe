#!/usr/bin/env bash
# SF-130 AI review: fresh data (seed + sf129-setup.sql) for scenarios-sf130-a.js then -b.js. App on :3000 already running.
set -e
cd "$(dirname "$0")/../.."
rm -rf .fake-gmail .fake-storage /tmp/sf130-a.json /tmp/sf130-b.json
bash .factory/run/reset-db.sh >/dev/null 2>&1
/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d crm_dev -qf .factory/run/sf129-setup.sql
echo fresh
