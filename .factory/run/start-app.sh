#!/usr/bin/env bash
# Builds and starts the app on port ${PORT:-3000} in the background (log /tmp/app-$PORT.log).
# Env overrides: APP_ENV (default development), DATABASE_URL (default crm_dev), FIRST_ADMIN_EMAIL
# (default ada@barnacle.ai; set to "" to leave unset), VERCEL_ENV, SKIP_BUILD=1, SKIP_SEED=1, PIPEDRIVE_TOKEN_KEY
# (SF-117; default: a key made once into /tmp/pipedrive-token-key, never in the repo; set to "" for "not set up"),
# PIPEDRIVE_URL (default empty: the fake Pipedrive), GMAIL_TOKEN_KEY (SF-118; default: a key made once into
# /tmp/gmail-token-key; set to "" for "Gmail can't be connected right now."), GMAIL_PUBSUB_TOPIC (default empty: the
# fake Gmail, /dev/fake-gmail), CRON_SECRET (default fake-cron-secret-0123456789, for curl on /cron/gmail),
# CALENDAR_SYNC (SF-124; default on: Google Calendar sync on the fake Google, /dev/fake-calendar; "" for off).
set -e
cd "$(dirname "$0")/../.."
bash .factory/run/start-postgres.sh
export PATH=/usr/lib/postgresql/17/bin:$PATH
PORT=${PORT:-3000}
export APP_ENV=${APP_ENV-development}
export DATABASE_URL=${DATABASE_URL:-postgres://postgres@localhost:5432/crm_dev}
export FIRST_ADMIN_EMAIL=${FIRST_ADMIN_EMAIL-ada@barnacle.ai}
export APP_URL=http://localhost:$PORT
[ -s /tmp/pipedrive-token-key ] || openssl rand -base64 32 > /tmp/pipedrive-token-key
export PIPEDRIVE_TOKEN_KEY=${PIPEDRIVE_TOKEN_KEY-$(cat /tmp/pipedrive-token-key)}
[ -s /tmp/gmail-token-key ] || openssl rand -base64 32 > /tmp/gmail-token-key
export GMAIL_TOKEN_KEY=${GMAIL_TOKEN_KEY-$(cat /tmp/gmail-token-key)}
export CRON_SECRET=${CRON_SECRET-fake-cron-secret-0123456789}
export CALENDAR_SYNC=${CALENDAR_SYNC-on}
[ -d node_modules ] || npm ci >/dev/null
npm run -s db:migrate
[ -n "$SKIP_SEED" ] || npm run -s db:seed || true
[ -n "$SKIP_BUILD" ] || npm run -s build >/tmp/build.log 2>&1
nohup npx next start -p "$PORT" >/tmp/app-$PORT.log 2>&1 &
for i in $(seq 60); do curl -fs -o /dev/null http://localhost:$PORT/sign-in && { echo "app up on $PORT"; exit 0; }; sleep 1; done
echo "app did not start"; tail -20 /tmp/app-$PORT.log; exit 1
