# Quickstart: validate Private and deleted people: follow-ups

## Prerequisites

Local Postgres with `crm_dev` and `crm_test` (README).

```bash
export APP_ENV=development DATABASE_URL=postgres://postgres@localhost:5432/crm_dev FIRST_ADMIN_EMAIL=ada@barnacle.ai
npm run db:migrate          # applies 0003_private_owner_handover.sql
npm run db:seed             # adds the private fake people (data-model.md § Fake data); run twice: no duplicates
npm run build && npm start  # http://localhost:3000, [ FAKE GOOGLE LOGIN ]
```

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run test:e2e && npm run typecheck
```

Must cover: SC-001 (a private person reaches creator and owner through every read function and page, and
no other user or admin), SC-002 (organisation events about deleted non-private people kept in order with user
and time, no name or link; none for a person private when deleted), SC-004 (after a handover the new owner
finds every person and the duplicate message names them), SC-005 (handover refused for non-admins, inactive
recipients, active "from" users, from = to, including direct action calls), the all-or-nothing handover and
its races (recipient deactivated meanwhile; two admins at once), and seed idempotency.

## Manual scenarios

1. **US1 owner** — as Linus Fake: "Pat Privatefake" (seeded, created by Ada, owned by Linus) is in People,
   search, and its page shows "Private"; the edit form offers the Private box. As Grace Fake (neither
   creator nor owner) it is absent from every list, search and count, and its address shows "Page not found.".
2. **US1 give away** — as Linus, change Pat's owner to Margaret Fake and save → People list with "You can no
   longer see Pat Privatefake: only their creator and owner can."; Pat gone for Linus, visible to Ada and
   Margaret.
3. **US2** — as Ada (admin): link a non-private person to "Fakeco Ltd" then delete them → Fakeco Ltd's
   timeline shows "A deleted person was linked by Ada Fake" at the original time, no link, no name anywhere.
   Delete a private person who was linked → no event about them on the organisation.
4. **US3** — as Ada: Users page → Alan Fake's row shows "2 private people" and `[ HAND OVER ]` → panel; press
   `[ HAND OVER ]` with no choice → "Choose an active user."; choose Margaret Fake → "Hand Alan Fake's 2
   private people to Margaret Fake?" → confirm → "2 private people handed to Margaret Fake.", row has no count.
   As Margaret: Robin and Sam Leftfake listed (filter owner Margaret Fake), "Private", timeline "Handed to
   Margaret Fake by Ada Fake"; adding a person with `robin.leftfake@example.com` → "Robin Leftfake already
   has this email address." with a link.
5. **Refusal** — as Linus, post the `handOver` action directly → "You don't have access to this page.",
   nothing changes.
