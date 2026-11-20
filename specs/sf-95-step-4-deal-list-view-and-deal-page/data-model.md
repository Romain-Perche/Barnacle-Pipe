# Data model: Deal list view and deal page

One migration, `migrations/0005_deal_page.sql`: only statements allowed in a transaction, `alter table … enable row
level security` (no policy) after every `create table`. Tables from SF-90/92/93 are only altered as below.

## Migration `0005_deal_page.sql`

```sql
-- Deal status (research.md §2)
alter table deals add column status text not null default 'open' check (status in ('open', 'won', 'lost'));
alter table deals add column closed_at timestamptz null;
alter table deals add column lost_reason text null
  check (lost_reason = btrim(lost_reason) and lost_reason <> '' and char_length(lost_reason) <= 500);
alter table deals add constraint deals_status_check
  check ((status = 'open') = (closed_at is null) and (status = 'lost') = (lost_reason is not null));

-- The board only reads open, non-archived deals (FR-006)
drop index deals_board_idx;
create index deals_board_idx on deals (stage_id, stage_entered_at desc) where archived_at is null and status = 'open';
create index deals_created_at_idx on deals (created_at desc, id desc);

-- Deal labels (research.md §6), separate from people labels
create table deal_labels (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 100),
  removed_at timestamptz null
);
alter table deal_labels enable row level security;
create unique index deal_labels_name_key on deal_labels (lower(name));

create table deal_label_links (
  deal_id bigint not null references deals (id) on delete cascade,
  label_id bigint not null references deal_labels (id),
  primary key (deal_id, label_id)
);
alter table deal_label_links enable row level security;
create index deal_label_links_label_idx on deal_label_links (label_id);

-- Other linked people (research.md §7)
create table deal_people (
  deal_id bigint not null references deals (id) on delete cascade,
  person_id bigint not null references persons (id) on delete cascade,
  linked_by bigint null references users (id),
  created_at timestamptz not null default now(),
  primary key (deal_id, person_id)
);
alter table deal_people enable row level security;
create index deal_people_person_idx on deal_people (person_id);

-- Followers (research.md §7)
create table deal_followers (
  deal_id bigint not null references deals (id) on delete cascade,
  user_id bigint not null references users (id),
  created_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);
alter table deal_followers enable row level security;
create index deal_followers_user_idx on deal_followers (user_id);

-- History: won, lost (with the reason as said then), reopened
alter table timeline_events add column reason text null check (char_length(reason) <= 500);
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened'));
alter table timeline_events add constraint timeline_events_reason_check check ((kind = 'lost') = (reason is not null));
```

Build confirms the constraint name `timeline_events_kind_check` against a migrated database before writing the
file (0004 re-created it with that name). Existing deals get `status = 'open'` from the default.

Also: `tests/support/reset.ts` and `.factory/run/reset-db.sh` truncate `deal_followers, deal_people,
deal_label_links, deal_labels` (no starting deal labels); `tests/integration/rls.test.ts` lists the 4 new tables.

## Entities

### Deal (changed)

| Field | Rule |
|---|---|
| `status` | `open` (default), `won`, `lost`. Only Won / Lost / Reopen change it. |
| `closed_at` | set when Won or Lost, cleared on Reopen. Shown as "Won · 19 Nov 2026". |
| `lost_reason` | required for Lost: trimmed, 1–500 characters; cleared on Reopen. Shown as plain text. |
| labels | `deal_label_links` → `deal_labels`. Removed labels stay on the deal: shown, filtered, kept on save; only new links need a non-removed label (as SF-90 people labels). |
| other people | `deal_people`; never the main person too. |
| followers | `deal_followers`; each user follows only themselves. |

`DealView` (`getDeal`) gains: `status`, `closedAt`, `lostReason`, `labels: Option[]` (every label the deal has, removed included, A–Z),
`otherPeople: { id, name, archived }[]` (visible only, A–Z), `followers: UserRef[]` (A–Z, deactivated marked),
`followedByViewer: boolean`.

### Stage bar (read model, pure)

`stageBar(stages: { id, name, seconds }[], currentStageId) → { id, name, state: "done" | "now" | "next", days: number | null }[]`
in `src/server/deals/rules.ts`: `days = Math.floor(seconds / 86400)` for `done` and `now`, `null` for `next`.
`seconds` comes from `getStageSeconds(dealId, pipelineId)`:

```sql
select s.id::int as id, s.name,
       coalesce(sum(extract(epoch from coalesce(p.left_at, now()) - p.entered_at)), 0)::float8 as seconds
from stages s
left join deal_stage_periods p on p.stage_id = s.id and p.deal_id = $deal
where s.pipeline_id = $pipeline
group by s.id, s.name, s.position
order by s.position, s.id
```

`formatDays(n)` in `src/server/format.ts`: "0 days", "1 day", "12 days".

### Deal history event (changed)

New kinds and their lines (in `src/app/(app)/records/Timeline.tsx`, `heading="HISTORY"`):

| kind | line |
|---|---|
| `won` | "Marked as won by <name>" |
| `lost` | "Marked as lost by <name>: <reason>" (reason as plain text from `timeline_events.reason`) |
| `reopened` | "Reopened by <name>" |
| `restored` (exists) | "Restored by <name>" |
| `person_linked` / `person_unlinked` on a deal | "Linked <person> by <name>" / "Unlinked <person> by <name>" (person links to `/people/<id>`); a deleted person keeps the SF-92 lines |
| `edited` with Labels | "Edited by <name>: Labels" |

Follow / unfollow: no event. `readTimeline({ dealId })` leaves out events whose `related_person_id` is a person the
viewer cannot see.

### Deal label

Like `labels` (SF-90): admins add (a removed entry with the same name comes back), rename, remove (`removed_at`).
Removed = no longer offered to deals that do not have it; deals that have it keep and show it, and the list's
label filter offers it while a deal the viewer can see has it.
`choices.ts` kind `deal_label` → table `deal_labels`, unique key `deal_labels_name_key`; a duplicate answers
`deal_label_exists` ("This name is already used.").

## State changes (all in one transaction each; the deal row loaded `for update` through `visibleDeal()`)

| Change | Allowed when | Writes | Event |
|---|---|---|---|
| Mark Won | visible, `status = open`, not archived, `version` matches | `status='won'`, `closed_at=now()`, `version+1`; open period `left_at=now()` | `won` |
| Mark Lost | as Won + reason valid | `status='lost'`, `closed_at`, `lost_reason`, `version+1`; close open period | `lost` (`reason`) |
| Reopen | visible, `status <> open`, not archived, `version` matches | `status='open'`, `closed_at=null`, `lost_reason=null`, `version+1`; insert open period in the current stage | `reopened` |
| Restore | visible, archived | `archived_at=null`, `version+1` (status, stage unchanged) | `restored` |
| Move (board, drawer, stage bar) | visible, open, not archived, version matches (SF-93) | as SF-93 | `moved` |
| `transferDeal` by a stage/pipeline delete | any status | as SF-93; when the deal is not open, the new period is inserted with `left_at = entered_at` | `moved` (cause) |
| Edit | visible, not archived (any status) | as SF-93 + labels rewritten (a requested id is kept when non-removed or already on the deal); a new main person removed from `deal_people` | `edited` (fields incl. Labels) |
| Link person | visible deal, open or closed, not archived; person visible, not archived, not main, not linked | insert `deal_people` | `person_linked` |
| Unlink person | visible deal, not archived; person linked and visible | delete row | `person_unlinked` |
| Follow / Unfollow | visible deal, not archived; actor active | insert `on conflict do nothing` / delete | none |

A wrong `version` or a status/archived state that no longer allows the change → `{ status: "conflict" }` (shown as
`deal_edit_conflict`); a deal that is missing or hidden → `{ status: "not_found" }`.

## Validation (pure, `src/server/deals/rules.ts`)

- `validateLostReason(raw)`: trim; empty → `lost_reason_required`; > 500 characters → `lost_reason_too_long`.
- `DealForm.labelIds: string[]` / `DealFields.labelIds: number[]` (sorted ids, `toId` each, at most 200);
  `DEAL_FIELDS` gets `["labelIds", "Labels"]` after Person.
- `parseDealsQuery` (research.md §5) in `src/server/records/list-query.ts`.

## Fake data (`src/seed/deals.ts`, FR-023)

Idempotent (re-running adds nothing): deal labels by `on conflict ((lower(name))) do nothing`; new deals skipped by
title as today; links, label links and followers `on conflict do nothing`.

- Deal labels: "Hot", "Warm", "Cold", "Big ticket", "Renewal" (5).
- New deals appended to `TITLES`, each with a multi-stage history spread over days (periods of e.g. 2, 3, 6, 11 days
  through the Sales stages, closed periods back to back, the last one open or closed at `closed_at`):
  - won: "Fakeco newsletter (won)", "Sample Gyms signage (won)", "Mock Labs retainer (won)";
  - lost: "Dummy Leisure app (lost)" — "Went with a fake competitor", "Lorem Logistics pilot (lost)" — "Fake budget
    cut", "Testfield Health kiosk (lost)" — "No fake decision maker";
  - archived and lost: "Old fake tender (lost)" — "Fake tender cancelled", archived a day ago.
  - each closed deal: `won`/`lost` event at `closed_at`, its last period closed then.
- Labels on at least eight deals (existing titles looked up by title), other linked people on at least five deals
  (people from `src/seed/people.ts`, never the deal's main person, never a private person the deal's viewers could not
  see), followers (the fake users) on at least five deals.
