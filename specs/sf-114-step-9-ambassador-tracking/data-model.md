# Data model: Ambassador tracking (SF-114)

No new table. One migration, `migrations/0008_ambassadors.sql` (only statements allowed in a transaction; no
`create table`, so no new RLS line). Existing tables `persons`, `deals`, `timeline_events` change.

## Migration `0008_ambassadors.sql`

```sql
-- SF-114: ambassadors and who referred each person or deal (specs/sf-114-step-9-ambassador-tracking/data-model.md).
alter table persons add column is_ambassador boolean not null default false;
alter table persons add column referred_by_id bigint null references persons (id) on delete set null;
alter table persons add column referred_at timestamptz null;
alter table persons add constraint persons_referrer_not_self check (referred_by_id <> id);
create index persons_referred_by_idx on persons (referred_by_id) where referred_by_id is not null;
create index persons_ambassador_idx on persons (id) where is_ambassador;

alter table deals add column referred_by_id bigint null references persons (id) on delete set null;
alter table deals add column referred_at timestamptz null;
create index deals_referred_by_idx on deals (referred_by_id) where referred_by_id is not null;

-- Referral events: the previous referrer of a change; gone with the person (SF-92 rule, research.md §5–6).
alter table timeline_events add column from_person_id bigint null references persons (id) on delete set null;
create index timeline_events_from_person_idx on timeline_events (from_person_id) where from_person_id is not null;
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared'));
alter table timeline_events add constraint timeline_events_from_person_check
  check (from_person_id is null or kind = 'referrer_changed');
alter table timeline_events drop constraint timeline_events_cause_check;
alter table timeline_events add constraint timeline_events_cause_check
  check (cause in ('stage_deleted', 'pipeline_deleted', 'person_deleted'));
```

Build: confirm the names `timeline_events_kind_check` and `timeline_events_cause_check` on a migrated database
(`\d timeline_events`) before relying on them; the kind list must keep every kind of 0007 (including `'imported'`).
No check ties `referred_at` to `referred_by_id`: `on delete set null` only clears `referred_by_id`, and
`deletePerson` clears both itself (§ State changes).

## Entities

### Person (`persons`, changed)

| Field | Type | Rule |
|---|---|---|
| `is_ambassador` | boolean, default false | Set by the "Ambassador" tick (add / edit). Anyone who can edit the person. |
| `referred_by_id` | person id or null | At most one referrer; never the person themselves (check). |
| `referred_at` | timestamptz or null | `now()` whenever `referred_by_id` changes to a non-null value; null when cleared. |

`PersonView` gains `ambassador: boolean` and `referredBy: Referrer`, where
`type Referrer = { id: number; name: string; ambassadorPage: boolean } | "hidden" | null` (`"hidden"`: the referrer
exists but the viewer cannot see them → "Referred by a private person", no link). `PersonForm` gains
`ambassador: boolean` and `referredBy: string` (`""`, `"<id>"` or `"keep"`); `PersonFields` gains `ambassador` and
`referredById` (not in `PERSON_FIELDS`: they have their own events).

### Deal (`deals`, changed)

| Field | Type | Rule |
|---|---|---|
| `referred_by_id` | person id or null | At most one referrer. |
| `referred_at` | timestamptz or null | As for people. |

`DealView` gains `referredBy: Referrer`; `DealForm` gains `referredBy: string`; `DealFields` gains `referredById`
(not in `DEAL_FIELDS`).

### Timeline event (`timeline_events`, changed)

| Kind | Target | Columns | Line |
|---|---|---|---|
| `ambassador_added` | person | actor | "Made an ambassador by <user>" |
| `ambassador_removed` | person | actor | "No longer an ambassador by <user>" |
| `referrer_set` | person or deal | actor, `related_person_id` = new | "Referred by set to <name> by <user>" |
| `referrer_changed` | person or deal | actor, `from_person_id` = old, `related_person_id` = new | "Referred by changed from <old> to <new> by <user>" |
| `referrer_cleared` | person or deal | actor; `cause = 'person_deleted'` when written by a delete | "Referred by cleared by <user>" / "Referred by cleared (a deleted person) by <user>" |

A person removed later (`related_person_id` / `from_person_id` set null by the delete) reads "a deleted person". Names
link to the ambassador page when that person has one for the viewer, else to `/people/<id>`. An event whose
`related_person_id` or `from_person_id` is a person the viewer cannot see is not shown (`readTimeline`).

### Ambassador (derived, not stored)

A person with `is_ambassador`. Has a page when visible and (`is_ambassador` or referred at least one record the viewer
can see). "Offered" (pickers, accepted as a new referrer): `is_ambassador and archived_at is null and visiblePerson`.

### Ambassador summary (derived per viewer)

| Box | SQL over referred records the viewer can see (archived included) |
|---|---|
| People referred | `count(*)` from `persons r where r.referred_by_id = $a and visiblePerson(r)` |
| Deals referred | `count(*)` from `deals d where d.referred_by_id = $a and visibleDeal(d)` |
| Open | `coalesce(sum(d.value_pence) filter (where d.status = 'open'), 0)` |
| Won | `coalesce(sum(d.value_pence) filter (where d.status = 'won'), 0)` |
| Lost | `count(*) filter (where d.status = 'lost')` |
| Latest referral (Ambassadors page) | `greatest(max(r.referred_at), max(d.referred_at))` |

## State changes (all in one `sql.begin`, record locked through its visibility rule, as today)

- **createPerson / updatePerson**: after the existing checks, `ambassador = value.ambassador`; referrer via
  `decideReferrer` + `isOfferedAmbassador` (research.md §4) → `Refused({ referredBy: { code } })` on refusal. Update sets
  `is_ambassador`, `referred_by_id`, and `referred_at = case when <changed> then now()/null else referred_at end`.
  Events: `ambassador_added` / `ambassador_removed` when the flag changes (on add: `ambassador_added` when ticked);
  `referrer_set` / `referrer_changed` / `referrer_cleared` when the referrer changes (on add: `referrer_set` when set).
  Archived people are not editable (existing rule), so neither field changes on them.
- **createDeal / updateDeal**: same referrer rule without the self check; same events on the deal.
- **deletePerson** (admin): before deleting, if the person is not private: insert `referrer_cleared` with
  `cause = 'person_deleted'`, `actor_id = admin` on every person and deal with `referred_by_id = $id`; if private: no
  event, and `delete from timeline_events where related_person_id = $id or from_person_id = $id`. Then
  `update persons set referred_by_id = null, referred_at = null where referred_by_id = $id` (same for `deals`), then the
  existing delete.
- **Hand-over (SF-92/SF-97)**: unchanged; ambassadors and referred records follow their owner like any record.
- **CSV import**: unchanged; new columns take their defaults (spec Assumptions).

## Validation (pure, `src/server/records/referral-rules.ts`)

- `parseReferredBy(raw: string): { keep: true } | { id: number | null } | { invalid: true }` — `""` → `{ id: null }`,
  `"keep"` → keep, a positive id (`toId`) → `{ id }`, anything else → invalid.
- `decideReferrer(requested, currentId, selfId)` → `{ kind: "keep" } | { kind: "none" } | { kind: "check", id } |
  { kind: "refuse", code: "referrer_self" | "referrer_invalid" }` (keep when `keep` or `id === currentId`; refuse self
  when `id === selfId`; `check` → the transaction runs `isOfferedAmbassador`, refusing `referrer_invalid` if false).
- `referralEvent(beforeId, afterId)` → `null | { kind: "referrer_set", to } | { kind: "referrer_changed", from, to } |
  { kind: "referrer_cleared" }`.
- `parseShownBy(value, step)` (in `notes-rules.ts`, beside `parseShown`): multiples of `step` from `step` to 5000, else
  `step`; `parseShown(v)` becomes `parseShownBy(v, 50)`.

## Fake data (`src/seed/ambassadors.ts`, registered after `notes`)

Idempotent (people found by email, deals by title, notes by record and body; flags and referrers set with `update`,
events written only when the row was created). All names clearly fake, owners the fake users:

| Who | Details |
|---|---|
| Cara Example (`cara.ambassador@example.com`) | Ambassador, shared, owner Ada Fake, organisation Sample Studios Fake, role "Partnerships lead". |
| Dora Privatefake (`dora.ambassador@example.com`) | Ambassador, private, creator and owner Linus Fake. |
| Ezra Formerfake (`ezra.formerambassador@example.com`) | Former ambassador (not ticked) with two referred people. |
| Ben / Dee / Eli Referredfake (`…referredfake@example.com`) | Referred by Cara (Dee also has a note). |
| Fay / Gus Referredfake | Referred by Ezra. |
| Hal Referredfake | Referred by Dora (shared person). |
| Deals "Fake referral · website" (open, £4,500), "Fake referral · pilot" (won, £4,000), "Fake referral · app" (lost, £1,500, reason "Fake: chose another supplier"), "Fake referral · audit" (open, £2,000, private, creator and owner Linus Fake) | Referred by Cara; created like `src/seed/deals.ts` (deal row + open `deal_stage_periods` row, Sales pipeline). |
| Notes | One on "Fake referral · website" and one on Dee Referredfake, by Ada Fake, clearly fake text. |

`seed.test.ts` checks a second run adds nothing.
