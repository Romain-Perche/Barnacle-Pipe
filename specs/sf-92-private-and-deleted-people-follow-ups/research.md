# Research: Private and deleted people: follow-ups

No NEEDS CLARIFICATION remained in Technical Context. The questions below are the design choices.

## 1. Visibility: one predicate, widened

- **Decision**: change `visiblePerson()` to `not private or created_by = viewer or owner_id = viewer`; add
  `create index persons_private_owner_idx on persons (owner_id) where private`.
- **Rationale**: SF-90 routes every `persons` read (lists, search, counts, filters, organisation people and
  counts, drawer, record page, timelines, duplicate messages, every change's lock) through this fragment, so
  one edit covers FR-001/FR-004 and cannot miss a place. The partial index mirrors the creator one.
- **Alternatives**: a `person_viewers` table (rejected: two fixed columns already say who sees); checking
  ownership in each caller (rejected: the reason the single fragment exists).

## 2. Who changes "Private"; losing sight after a save

- **Decision**: creator or current owner (before the save) may change it. After the update, the same
  transaction re-reads the person through `visiblePerson`; if gone, `updatePerson` returns
  `saved` with `visible: false` and the name, and the action shows the flash
  "You can no longer see <name>: only their creator and owner can." on `/people`.
- **Rationale**: FR-002/FR-003. Redirecting to `/people/<id>` would show "Page not found.", which looks like
  an error. The name comes from the database via the existing `crm_flash` cookie (never the URL).
- **Alternatives**: forbid an owner from giving a private person away (rejected: the spec allows it, scenario 6).

## 3. Keeping events about a deleted person

- **Decision**: `timeline_events.related_person_id` → `on delete set null`. A `person_linked` /
  `person_unlinked` event with a null `related_person_id` means "a deleted person". When the person is
  private at deletion, `deletePerson` deletes those events first, in the same transaction, after locking the
  person row.
- **Rationale**: The database does the anonymising atomically; nothing about the person (id, name) remains
  on the kept row (FR-006). These two kinds are always written with a person, so null is unambiguous. A
  private person's events are removed rather than hidden, because DECISIONS says a private contact is hidden
  from everyone and keeping invisible rows adds a rule every reader must remember (FR-007).
- **Alternatives**: a `deleted_person` flag column or a tombstone row in `persons` (rejected: more state,
  and a tombstone keeps an id that ties events together, which FR-006 and the "not told apart" edge case
  avoid); copying the name into the event (rejected: FR-006).

## 4. The hand-over event and its new owner

- **Decision**: new kind `handed_over` on the person; `actor_id` = admin; new column `related_user_id`
  (FK `users`, no cascade) = new owner, with a check that it is set exactly for `handed_over`.
- **Rationale**: the timeline line "Handed to <new owner> by <admin>" needs two users; users are never
  deleted, so a plain FK is safe and the name stays current. Storing the name in `fields` would freeze it
  and mix text into a list of field names.
- **Alternatives**: reuse `edited` with `fields = ['Owner']` (rejected: the spec asks for its own line).

## 5. Handover transaction and races

- **Decision**: in one transaction: lock the actor and the two users in id order (`for update`), check
  actor = active admin, from = deactivated, to = active and ≠ from; then
  `update persons set owner_id = $to, version = version + 1 where private and owner_id = $from returning id`;
  insert one `handed_over` event per id; 0 rows → `none`.
- **Rationale**: all-or-nothing (FR-010). Locking user rows serialises with deactivate/reactivate (whose
  `update users` takes the same row lock), so a recipient deactivated meanwhile is refused with
  "Choose an active user." and a second admin's handover finds 0 people. Bumping `version` makes an edit form
  opened before the handover answer "Someone else changed this person …" instead of silently moving the owner
  back. The admin is never given ids or names, only the count.
- **Alternatives**: put it in `src/server/users.ts`'s `asAdmin` (rejected: that helper locks every active
  admin and writes `user_changes`, whose action check would need a migration for no reader).

## 6. The panel: server page + small client component

- **Decision**: `[ HAND OVER ]` on the row is a link to `/admin/users?handover=<id>`; the page renders the
  panel (design B) above the add row. `HandOverPanel` (`'use client'`) only keeps the question and
  explanation in step with the select. `[ CANCEL ]` links back to `/admin/users`.
- **Rationale**: the spec's question names the chosen user before confirming, which needs the browser; the
  rest stays server-rendered, and the form works without JS (the question just stays empty). Same pattern as
  `?confirm=delete` on record pages.
- **Alternatives**: two-step server flow with a `[ NEXT ]` button (rejected: not in design B); a modal dialog
  (rejected: design B is a panel).

## 7. Counting private people on the Users page

- **Decision**: one grouped query joined to deactivated users; archived private people included; active
  users' rows show nothing (spec Clarifications, decided by the factory).
- **Rationale**: archived people still hold email addresses (FR-013); counts for active users would tell
  admins about others' private contacts for no use.

## 8. Notices

- **Decision**: extend `crm_flash` with `person_no_longer_visible`, `handed_over` (name + count) and
  `handover_none`. Refusals without a name use allow-listed `?error=` codes.
- **Rationale**: names come from the database, never the URL (AGENTS.md); `src/proxy.ts` already deletes the
  cookie after one page load.

## 9. Outside services and dependencies

- No new outside service; no new package (`dependencies.json` `[]`). No blueprint in the factory index
  applies (the only one is about map cursors), so `blueprints.json` stays `[]`.
