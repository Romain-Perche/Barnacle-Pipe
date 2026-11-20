# Data model: Hand-over of private deals

No new table, column or constraint. Existing entities and how this feature uses them.

## Deal (`deals`, SF-93)

| Field | Use in this feature |
|-------|---------------------|
| `owner_id` | set to the chosen active user by the hand-over when `private` and `owner_id` = the deactivated user |
| `private` | unchanged; only private deals are handed over |
| `created_by` | unchanged (an active creator keeps sight) |
| `stage_id`, `stage_entered_at`, `archived_at`, `value_pence`, `organisation_id`, `person_id`, `expected_close_on` | unchanged (FR-004) |
| `version` | `+ 1`, so a form opened before the hand-over gets the existing stale answer |

**Selection rule** ("a deactivated user's private deals", FR-001): `private and owner_id = :from`, archived included.

**Visibility after** (unchanged rule `visibleDeal`): `not private or created_by = viewer or owner_id = viewer`.
So the new owner sees it; the creator still sees it; the deactivated former owner loses it unless creator.

## Timeline event (`timeline_events`)

One row per handed-over deal: `deal_id = <deal>`, `kind = 'handed_over'`, `actor_id = <admin>`,
`related_user_id = <new owner>`, other columns null. Allowed by migration 0004 (`kind` check includes
`handed_over`, `num_nonnulls(person_id, organisation_id, deal_id) = 1`). Shown in "// HISTORY" as
"Handed to <new owner> by <admin>" with date and time. No `moved` event and no `deal_stage_periods` row.

## User (`users`, SF-80) — derived counts

`listUsers()` returns, for deactivated users only (0 otherwise):

- `private_people`: `count(*) from persons where private and owner_id = users.id` (SF-92)
- `private_deals`: `count(*) from deals where private and owner_id = users.id` (new)

## Hand-over result (domain type)

```ts
type HandOverResult =
  | { status: "handed"; people: number; deals: number; toName: string }
  | { status: "none"; fromName: string }
  | { status: "forbidden" } | { status: "not_deactivated" } | { status: "choose_user" };
```

## State transitions (per private deal of the deactivated user)

`owner = deactivated user` → (admin confirms hand-over to active user U) → `owner = U`, private, same creator,
same stage and position, one `handed_over` event. Any refusal or empty selection: no change.
