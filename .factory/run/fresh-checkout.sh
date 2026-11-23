#!/usr/bin/env bash
# US4 scenario 3: follow the README on a fresh clone of the branch (no Google/Vercel/Supabase), log /tmp/fresh.log.
set -x
R=$(cd "$(dirname "$0")/../.." && pwd); F=/tmp/fresh; rm -rf $F; git clone -q "$R" $F && cd $F
P=/usr/lib/postgresql/17/bin; for d in crm_dev crm_test; do $P/psql -h localhost -U postgres -qc "drop database if exists $d" -c "create database $d"; done
npm install --no-audit --no-fund >/dev/null 2>&1; echo "install=$?"
cp .env.example .env.local
npm run db:migrate; npm run db:seed
(env -u APP_ENV -u DATABASE_URL npx next dev -p 3009 >/tmp/fresh-dev.log 2>&1 &) ; for i in $(seq 90); do curl -fs -o /dev/null localhost:3009/sign-in && break; sleep 1; done
curl -s localhost:3009/sign-in | grep -o "FAKE GOOGLE LOGIN" | head -1
pkill -f "next dev -p 3009"; sleep 1
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test 2>&1 | tail -8; echo "npm test exit=${PIPESTATUS[0]}"
npm run typecheck 2>&1 | tail -3; echo "typecheck exit=${PIPESTATUS[0]}"
