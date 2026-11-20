# Data model: Private and deleted people: follow-ups

Builds on `specs/sf-90-people-and-organisations/data-model.md`. No new table.

## Migration `migrations/0003_private_owner_handover.sql`

Only statements allowed in a transaction (applied by `scripts/migrate.ts`):

```sql
-- Events about a deleted person stay on other records, without the person (FR-005).
alter table timeline_events drop constraint timeline_events_related_person_id_fkey;
alter table timeline_events add constraint timeline_events_related_person_id_fkey
  foreign key (related_person_id) references persons (id) on delete set null;

-- Hand-over event on a person (FR-011).
alter table timeline_events drop constraint timeline_events_kind_check;
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over'));
alter table timeline_events add column related_user_id bigint null references users (id);
alter table timeline_events add constraint timeline_events_related_user_check
  check ((kind = 'handed_over') = (related_user_id is not null));

-- The owner branch of the visibility rule (FR-001).
create index persons_private_owner_idx on persons (owner_id) where private;
```

## Entities (changes only)

### Person (`persons`)

Fields unchanged. Rules:

- **Visible to viewer V** ⇔ `not private or created_by = V or owner_id = V` (`visiblePerson()`), for every
  user, admins included.
- **May change `private`**: `created_by = actor or owner_id = actor` (owner as it was before the save).
  Anyone else's `private` value in the form is ignored.
- **Owner on save**: unchanged SF-90 rule (`resolveOwner`: an active user, or the current owner kept).
- **After a save** the actor may no longer see the person (private, actor neither creator nor new owner) →
  result `saved`, `visible: false`, `name`.

### Timeline event (`timeline_events`)

| Column | Change |
|---|---|
| `related_person_id` | FK now `on delete set null`. For `person_linked` / `person_unlinked`, `null` = "a deleted person". |
| `kind` | + `handed_over` (on a person: `person_id` set). |
| `related_user_id` | NEW, `bigint null references users (id)`, set iff `kind = 'handed_over'` (the new owner). |

Reading (`readTimeline`):

- On a person: unchanged (only when the person is visible); `handed_over` rows join `users ru` for the name.
- On an organisation: `related_person_id is null or visiblePerson(rp)`; a null related person on a
  linked/unlinked event is shown as "A deleted person was linked/unlinked by <actor>", plain text.

### User (`users`)

No column change. Derived on the Users page: `private_people` = number of private persons with
`owner_id = user` (archived included), computed only for `status = 'deactivated'` (0 for active users).

## Deleting a person (state change)

One transaction (`deletePerson`), admin re-checked:

1. `select p.private from persons p where p.id = $id and visiblePerson(p, actor) for update` → none: `not_found`.
2. If private: `delete from timeline_events where related_person_id = $id` (FR-007).
3. `delete from persons … returning name`: emails, phones, labels and the person's own events cascade;
   remaining events about them get `related_person_id = null`. No "unlinked" event is written.

## Handover (state change)

`handOverPrivatePeople(actorId, fromUserId, toUserId)`, one transaction:

1. `select id, role, status, name from users where id in ($actor, $from, $to) order by id for update`.
2. Actor not an active admin → `forbidden`.
3. From missing or not `deactivated` → `not_deactivated`.
4. To missing, not `active`, or `= from` → `choose_user`.
5. `update persons set owner_id = $to, version = version + 1 where private and owner_id = $from returning id`.
6. 0 rows → `{ status: "none", fromName }`.
7. For each id: `insert into timeline_events (person_id, kind, actor_id, related_user_id) values (id, 'handed_over', $actor, $to)`.
8. → `{ status: "handed", count, toName }`.

People stay private, keep `created_by`, `archived_at`, emails and everything else. A private person created
by the deactivated user but owned by someone else is not touched; one created by an active user and owned by
the deactivated user is handed over (its creator still sees it).

## Fake data (`src/seed/people.ts`)

Added once (skipped when the email address is already taken), all `private = true`:

| Name | Email | Creator | Owner | Organisation |
|---|---|---|---|---|
| Pat Privatefake | pat.privatefake@example.com | Ada Fake | Linus Fake | — |
| Robin Leftfake | robin.leftfake@example.com | Alan Fake | Alan Fake | Fakeco Ltd |
| Sam Leftfake | sam.leftfake@example.net | Alan Fake | Alan Fake | — |

Each gets an `added` event (actor null, like the other seeded people); the one linked to Fakeco Ltd also
gets a `person_linked` event on Fakeco Ltd.
