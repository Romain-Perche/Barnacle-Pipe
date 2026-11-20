#!/usr/bin/env bash
# Empties every app table (lead sources back to the six starting ones) of a database (default crm_dev) and, unless NO_SEED=1, loads fake data again.
set -e; cd "$(dirname "$0")/../.."
DB=${1:-crm_dev}
/usr/lib/postgresql/17/bin/psql -h localhost -U postgres -d "$DB" -qc "truncate deal_followers, deal_people, deal_label_links, deal_labels, deal_stage_periods, deals, stages, pipelines, timeline_events, person_labels, person_emails, person_phones, persons, organisations, labels, lead_sources, csv_imports, users, sessions, user_changes restart identity cascade" \
  -qc "insert into lead_sources (name) values ('Duncan''s LinkedIn'), ('Referral'), ('Exec dinner'), ('Inbound'), ('Event'), ('Ambassador')"
[ -n "$NO_SEED" ] || APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/$DB npm run -s db:seed 2>/dev/null
