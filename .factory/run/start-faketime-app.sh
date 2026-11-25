#!/usr/bin/env bash
# SF-123 (AI review): a second app on port ${PORT:-3001} whose JS clock is set by libfaketime from /tmp/ft-time
# (e.g. `echo "@2026-03-29 00:50:00" > /tmp/ft-time`; the clock runs on from there; rewrite the file to jump; Postgres
# now() stays real). Needs a build from start-app.sh (`.next`) and `sudo apt-get install -y faketime`.
set -e
cd "$(dirname "$0")/../.."
PORT=${PORT:-3001}
dpkg -s libfaketime >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq faketime >/dev/null
LIB=$(dpkg -L libfaketime | grep 'libfaketimeMT.so.1$')
[ -s /tmp/ft-time ] || echo "@$(date -u '+%Y-%m-%d %H:%M:%S')" > /tmp/ft-time
export APP_ENV=${APP_ENV-development} DATABASE_URL=${DATABASE_URL:-postgres://postgres@localhost:5432/crm_dev}
export FIRST_ADMIN_EMAIL=${FIRST_ADMIN_EMAIL-ada@barnacle.ai} APP_URL=http://localhost:$PORT
export PIPEDRIVE_TOKEN_KEY=$(cat /tmp/pipedrive-token-key) GMAIL_TOKEN_KEY=$(cat /tmp/gmail-token-key) CRON_SECRET=fake-cron-secret-0123456789
LD_PRELOAD=$LIB FAKETIME_TIMESTAMP_FILE=/tmp/ft-time FAKETIME_NO_CACHE=1 FAKETIME_DONT_FAKE_MONOTONIC=1 TZ=UTC \
  nohup npx next start -p "$PORT" >/tmp/app-$PORT.log 2>&1 &
for i in $(seq 60); do curl -fs -o /dev/null http://localhost:$PORT/sign-in && { echo "faketime app up on $PORT"; exit 0; }; sleep 1; done
echo "app did not start"; tail -20 /tmp/app-$PORT.log; exit 1
