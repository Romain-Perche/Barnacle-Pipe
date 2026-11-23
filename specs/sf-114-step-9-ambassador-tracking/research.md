# Research: Ambassador tracking (SF-114)

Every point the spec left open, resolved from the code as it is today (`src/server/records/*`, `src/server/deals/*`,
migrations 0001–0007). No NEEDS CLARIFICATION remains. Choices a person should confirm are in spec.md § Clarifications.

## 1. Dependencies

- **Decision**: nothing added. Postgres (postgres.js), Next.js server components and actions, and the existing client
  picker pattern (`PersonPicker.tsx`) cover everything.
- **Rationale**: the feature is two columns per table, a few queries and three screens. A combobox library would be a
  second way next to `PersonPicker` / `OrganisationPicker`.
- **Alternatives**: a headless combobox package (rejected: the repo already has two hand-built pickers).

## 2. How a person is an ambassador

- **Decision**: `persons.is_ambassador boolean not null default false`, set by an "Ambassador" tick on the person form
  (add and edit). Ticking and unticking write `ambassador_added` / `ambassador_removed` events ("Made an ambassador",
  "No longer an ambassador") on the person's timeline. Not part of `changedPersonFields` (its own lines).
- **Rationale**: spec Clarifications (tick on the form). A boolean on the row keeps every privacy, owner, archive and
  delete rule unchanged (FR-003): an ambassador is a person row like any other.
- **Alternatives**: a label or lead source "Ambassador" (rejected by the spec's Assumptions: admins can rename them);
  a separate `ambassadors` table (rejected: one more table, joins and RLS for one yes/no).

## 3. How a referral is stored

- **Decision**: `persons.referred_by_id` and `deals.referred_by_id`, `bigint null references persons (id) on delete set
  null`, plus `referred_at timestamptz null` (when the current referrer was set; drives "latest referral" on the
  Ambassadors page). `persons` gets `check (referred_by_id <> id)`. Partial indexes on `referred_by_id`.
- **Rationale**: at most one referrer per record (spec Assumptions) → a column, not a link table. `on delete set null`
  is the safety net; `deletePerson` clears the columns itself first so it can write the "cleared" events (§6).
- **Alternatives**: a `referrals` table (rejected: one per record, nothing else to hold); no `referred_at` and use the
  record's `created_at` (rejected: a referrer set on an old person would not show as a recent referral).

## 4. Which referrer a save accepts (FR-005, US2 scenarios 4, 5, 7, US4 scenario 3)

- **Decision**: one pure rule `decideReferrer(requested, current, selfId)` in `src/server/records/referral-rules.ts`
  plus one database check `isOfferedAmbassador(db, actorId, id)`:
  - the form posts `referredBy` = `""` (none), `"<id>"`, or `"keep"` (only rendered when the current referrer is hidden
    from the user: the page never holds the hidden person's id);
  - `"keep"`, or an id equal to the current referrer → keep the current referrer (even if no longer an ambassador,
    archived, or hidden);
  - an id equal to the person's own id → `referrer_self` "A person can't be their own referrer.";
  - any other id must be a person with `is_ambassador`, `archived_at is null`, visible to the actor
    (`visiblePerson`) → else `referrer_invalid` "Choose an ambassador from the list.";
  - an unparsable value → `referrer_invalid`. Nothing is saved on a refusal (the existing `Refused` path).
- **Rationale**: same shape as `allowedPerson` / `allowedLabels` (an unchanged current value is always kept), checked
  inside the save transaction.
- **Alternatives**: put the hidden referrer's id in a hidden input (rejected: leaks the id of a private person).

## 5. Timeline events for referrals

- **Decision**: three kinds on the referred person's or deal's own timeline, all with `actor_id`:
  `referrer_set` (`related_person_id` = new), `referrer_changed` (`from_person_id` = old, `related_person_id` = new),
  `referrer_cleared` (no person; `cause = 'person_deleted'` when written by a delete, §6). New column
  `timeline_events.from_person_id bigint null references persons (id) on delete set null`. Lines: "Referred by set to
  <name>", "Referred by changed from <old> to <new>", "Referred by cleared", "Referred by cleared (a deleted person)";
  a deleted person in set/changed reads "a deleted person". Written by `createPerson`, `updatePerson`, `createDeal`,
  `updateDeal` when the stored referrer differs before/after.
- **Privacy**: `readTimeline` already drops an event whose `related_person_id` is a person the viewer cannot see; it
  adds the same rule for `from_person_id`. So a referral event naming a private person is not shown to anyone that
  person is hidden from (factory choice, spec Clarifications).
- **Alternatives**: an `edited` event with field "Referred by" (rejected: the spec wants the names in the line); show
  "a private person" in the line (rejected: changes the SF-92 rule that events about a hidden person are left out).

## 6. Deleting an ambassador (FR-014, edge case)

- **Decision**: in `deletePerson`, before the `delete`, inside the same transaction:
  - person not private: for each person and deal with `referred_by_id = id`, write `referrer_cleared` with
    `cause = 'person_deleted'` and the admin as actor; then `update … set referred_by_id = null, referred_at = null`;
  - person private: no event; the existing `delete from timeline_events where related_person_id = $id` becomes
    `… where related_person_id = $id or from_person_id = $id`; then clear the columns.
- **Rationale**: follows SF-92: events about a deleted person stay without the name; about a deleted private person they
  go. The `cause` column already exists for moves; its check gains `'person_deleted'`.

## 7. The ambassador page: who has one (US3 scenario 7, US4 scenario 2)

- **Decision**: `/ambassadors/<personId>` shows when the person is visible to the viewer **and** (`is_ambassador` or
  they referred at least one person or deal the viewer can see). Otherwise `notFound()` →
  "This ambassador doesn't exist or you can't see them." (HTTP 404). A former ambassador shows a
  "No longer an ambassador" badge; an archived one "Archived".
- **Rationale**: the "has referrals" test uses only records the viewer may see, so the page never reveals that hidden
  records exist (factory choice, spec Clarifications).

## 8. Counts and totals (US3 scenario 1, US4, edge cases)

- **Decision**: computed on read, never stored, always through `visiblePerson` / `visibleDeal` for the viewer; archived
  referred records included (edge case). Deals: `count(*)`, open total `sum(value_pence) filter (where status='open')`,
  won total `… filter (where status='won')`, lost `count(*) filter (where status='lost')`; `null` value adds 0.
  People: `count(*)` of persons with `referred_by_id = $a` visible to the viewer. The Ambassadors page row uses the same
  SQL fragments (one shared function `summaryFragments`), so the two pages agree (SC-004).
- **Rationale**: ≤ a few thousand records; a stored counter could not respect per-viewer privacy.

## 9. Lists on the ambassador page (US3 scenarios 2–3, FR-010)

- **Decision**: people referred: newest first by `created_at desc, id desc` ("date added"). Deals referred: open first
  (`status <> 'open'`), then most recently changed = the newest timeline event of the deal
  (`(select max(created_at) from timeline_events where deal_id = d.id)`, falls back to `created_at`), then `id desc`.
  50 shown; `[ SHOW MORE ]` links to `?people=<n+50>` / `?deals=<n+50>` (parsed with `parseShown`, same as
  `?timeline=`): the page re-reads the first n rows of a total order, so nothing repeats or is skipped.
- **Alternatives**: keyset cursors (rejected: the repo's timeline uses "shown count" already).

## 10. Latest updates (US3 scenarios 4–6, FR-009)

- **Decision**: one query over `timeline_events e` where `e.person_id = $ambassador` or `e.person_id in (visible
  referred people)` or `e.deal_id in (visible referred deals)`, with the existing hidden-related-person filter, newest
  first (`created_at desc, id desc`), `limit n + 1`; n = `?updates=` parsed by `parseShownBy(value, 20)` (20, 40, … up
  to 5000). Each event has exactly one target, so no entry appears twice. Notes show their text and mentions (same as
  a deal's note on a person timeline) read-only. Tags: NOTE / CHANGE for the ambassador's own entries, PERSON (with
  the person's name linking to `/people/<id>`) and DEAL (title linking to `/deals/<id>`) for referred records, with
  "Archived" when archived.
- **Scope**: the ambassador's own entries are those on their person record only, not those of deals they are linked to
  as a contact (factory choice, spec Clarifications: "latest updates" is about the ambassador and what they referred).
- **Code**: `timeline.ts` gets an internal `selectEntries(viewerId, where, limit, own)` used by `readTimeline` and by the
  new `readAmbassadorUpdates`; `TimelineEntry` gains `person: { id, name, archived } | null`; `entryTag` returns
  `"PERSON"` when `person` is set. No change to what existing timelines show.

## 11. Pre-filling "Referred by" on the add deal form (FR-007, US2 scenario 6)

- **Decision**: `dealFormChoices` returns `ambassadors` (offered ambassadors, §4) and, on each `people` entry,
  `referredById` = that person's referrer only when that referrer is among the offered ambassadors (else `null`: nothing
  hidden or archived is pre-filled). `PersonPicker` gets an optional `onChange(personId | null)`; `DealForm` (already a
  client component) keeps the picked referrer in state and, on add only, sets it from the new main person's
  `referredById` when the main person changes; the user can then change or clear it. Edit never pre-fills.
- **Rationale**: no extra request; one small state lift in an existing client component.

## 12. The "Referred by" picker

- **Decision**: new client component `src/app/(app)/records/ReferrerPicker.tsx`, built like `PersonPicker` (type to
  filter, up to 8 matches, `[ CLEAR ]`), options `{ id, name, detail }` where `detail` = organisation and first email
  ("Sample Studios Fake · cara.ambassador@example.com") so two same-name ambassadors differ. Props: `options`,
  `current` (`{ id, name } | "hidden" | null`: the record's current referrer, shown even when not offered), `value` /
  `onChange` (controlled, for the deal form) or `initialId`. Posts hidden `referredBy`. On a person's form the person
  themselves is left out of the options.

## 13. Lists: "Referred by" filter (FR-011, US5)

- **Decision**: `?ref=<personId>` on `/people` and `/deals/list`, parsed in `parsePeopleQuery` / `parseDealsQuery`,
  kept by `withParams`, counted in `hasFilters` / `hasDealFilters`. Options (`referrerOptions(viewerId)`): visible
  persons with `is_ambassador` (archived ones too), plus any visible person who is the referrer of a person / deal the
  viewer can see. The deal list keeps only a known option (`knownDealsQuery` gains `referrers`); the people list
  follows its own filters (no known-check). Filter: `p.referred_by_id = $ref` / `d.referred_by_id = $ref`, so count and
  total follow it.

## 14. The Ambassadors page (FR-002)

- **Decision**: `/ambassadors`, a design C table (as the People list, without the filter row or drawer: each row links
  to `/ambassadors/<id>`): Name (+ "Archived"), Organisation, People, Deals, Open (£), Won (£), Latest referral
  (`formatDate` of the newest visible `referred_at`, "—" when none). Ordered by name A–Z, id. No paging: tens of
  ambassadors (scale). Sidebar: `{ href: "/ambassadors", label: "Ambassadors" }` after Organisations in `nav.ts`.
- **Alternatives**: paging and filters (rejected: YAGNI at this scale; add when the list grows).

## 15. Performance (SC-003)

- **Decision**: ambassador page = 1 person read + 1 summary query + 2 list queries (limit 51) + 1 updates query
  (limit 21) + 1 mentions query. Indexes: `persons_referred_by_idx`, `deals_referred_by_idx` (partial, not null), the
  existing `timeline_events_person_idx` / `timeline_events_deal_idx` (BitmapOr), new `timeline_events_from_person_idx`.
  An integration test with 200 referred records and 1,000 events checks < 2 s, like `timeline-performance.test.ts`.

## 16. Outside services

- **Decision**: none new. The code only reads and writes the app's own Postgres (Supabase in production); see plan.md
  § Outside services.
