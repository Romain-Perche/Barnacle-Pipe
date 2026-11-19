# Quickstart: validate People and organisations

## Prerequisites

Local Postgres with `crm_dev` and `crm_test` (README; or `bash .factory/run/start-postgres.sh`).

```bash
export APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate          # applies 0002_people_organisations.sql
npm run db:seed             # users, then ≥ 30 fake people and ≥ 8 fake organisations; run twice: no duplicates
npm run build && npm start  # http://localhost:3000, [ FAKE GOOGLE LOGIN ]
```

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run test:e2e && npm run typecheck
```

Must cover: SC-004 (duplicate email in every case/spacing/archived/private variant), SC-005 (a private
person never reaches another user or an admin through any read function or page), SC-006 (delete and
lead-source/label actions refused for non-admins, including direct action calls), SC-007 (every filter
and sort option returns ≥ 1 row after seeding), and the RLS test over all tables.

## Manual scenarios (signed in as Ada Fake, admin, unless noted)

1. **US1** — People → `[ ADD PERSON ]`: Ada Example, `ada@example.com` + `ada.home@example.net`, phone
   `+44 20 7946 0000`, role COO, lead source Referral → person page shows all values, owner Ada Fake,
   "Subscribed", today's date, "Last contacted: Never". Search the list for `ada.home@` → found.
2. **Duplicate** — add another person with ` ADA@example.com ` → "Ada Example already has this email
   address." linking to her; nothing saved.
3. **Validation** — `javascript:alert(1)` as LinkedIn → "Enter a LinkedIn profile link (linkedin.com/…)."; typed values kept.
4. **US2** — add organisation "Fakeco Ltd" (website `fakeco.example`) → link `https://fakeco.example`,
   "No people yet."; add " fakeco ltd " → "Fakeco Ltd already exists."; add a person typing "New Org" →
   "Add organisation 'New Org'" → person linked to the new organisation.
5. **US3** — People list: filter lead source "Exec dinner" + owner, sort by date added; copy the address
   to a new tab → same view; select a row → drawer; `[ CLOSE ]` → same filters; `?page=999` → last page.
6. **US4** — as Linus Fake (user): archive a person → gone from the list, page shows "Archived" and
   `[ RESTORE ]`, timeline "Archived by Linus Fake"; no `[ DELETE ]`. As Ada: delete → "<name> was
   deleted."; old address → "Page not found.".
7. **US5** — as Linus: add a private person `secret@example.com`. As Ada (admin): not in list/search/organisation
   page/count, address → "Page not found.", adding `secret@example.com` → "Another person already has this
   email address.".
8. **Concurrency** — open the same person's edit form in two tabs, save both → second shows "Someone else
   changed this person while you were editing. Reload to see their changes.".
9. **US6** — Admin → "Lead sources and labels": rename Event → Events, add label Hot, remove Inbound →
   people show "Events", "Hot" offered, "Inbound" not offered but still shown and still a filter option.
   As Linus: the page shows "You don't have access to this page." and the sidebar has no link.

Contracts: [routes.md](./contracts/routes.md), [list-query.md](./contracts/list-query.md); tables and
rules: [data-model.md](./data-model.md).
