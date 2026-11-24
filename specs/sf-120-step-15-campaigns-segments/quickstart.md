# Quickstart: validating Campaigns — segments (SF-120)

Setup, commands and settings: `README.md`. Database: local Postgres.

## Automated checks

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run test:schemas && npm test && npm run typecheck
```

Files Build adds (each test names what it covers, e.g. `// covers FR-009, US1 scenario 7`):

| File | Covers |
|---|---|
| `tests/unit/segment-rules.test.ts` | `validateSegmentForm` (names, who, status default, each condition type, limits, made-up ids dropped), `readConditions`, `describeSegment` (summaries, "(deleted)", broken), messages (US1-5/6, US2-3, Edge "Removed things") |
| `tests/unit/nav.test.ts` (existing) | Segments after Activities in `mainNav` |
| `tests/integration/segments.test.ts` | create / edit / rename / delete by two users, name uniqueness ignoring case and outer spaces, `segment_changed`, `segment_not_found`, deleted pipeline / stage / organisation / custom field (US1, US3, FR-012, FR-013) |
| `tests/integration/segments-reach.test.ts` | US1 scenario 2 numbers (open vs all, archived deal), reasons and their order, a person on 2 deals or with 2 addresses counted once, conditions of every kind incl. removed label / lead source / choice and deactivated owner, archived organisation, stage move, nobody → 0, privacy with Ada and Grace (private person, private deal) (FR-002…FR-011, SC-002, SC-003) |
| `tests/integration/segments-people-list.test.ts` | US2 independent test: segment count = `listPeople` total with the same filters minus left-out people; People list custom filters unchanged after the `customProbe` extraction |
| `tests/integration/segments-perf.test.ts` | SC-004: 50 segments, 10,000 people, 5,000 deals → `listSegments` < 2 s |
| `tests/integration/migrate.test.ts`, `tests/integration/rls.test.ts` (existing) | `0012` applies in a transaction; RLS on `segments` |
| `tests/integration/seed.test.ts`, `tests/unit/messages.test.ts` (existing) | the four fake segments, re-runnable; every new message present and templates rendering |

## By hand (dev server, fake login)

1. `npm run db:migrate && npm run db:seed && npm run dev`; sign in as Ada Fake.
2. Sidebar → **Segments**: four "Fake — …" segments, each with a count and "Ada Fake · <date>".
3. `[ NEW SEGMENT ]` → "Sales — Proposal test", People on the deals of a stage, Sales · Proposal, Open deals →
   `[ COUNT AGAIN ]` shows "Reaches <n> people now", the left-out line and the note. Change to All deals → the number
   is the same or higher.
4. `[ ADD CONDITION ]` Lead source → Inbound; `[ SAVE ]` → segment page: count strip, // WHO "Open deals",
   "Sales · Proposal", // CONDITIONS "Lead source Inbound".
5. Save with an empty name → "Give the segment a name.", choices kept. Name "fake — EVERYONE " → "There is already a
   segment called …".
6. Open the edit page in two tabs; save in one, then the other → "Someone else changed this segment. Open it again
   to see their changes."
7. As admin, delete the Exec Dinner pipeline's deals and the pipeline (or a seeded custom field) → the segment that
   uses it shows "(deleted)", 0 and "This segment refers to something that was deleted. Edit it before using it."
8. `[ DELETE ]` → confirmation names the segment → confirm → "Segment … deleted." on the Segments page.
9. `/segments/999999` → "This segment no longer exists."; a segment named `<b>Test</b>` shows the tags as text.
10. Sign in as Grace Fake: a private person she created makes her "Fake — everyone" count one higher than Ada's.
