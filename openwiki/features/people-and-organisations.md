---
type: feature
title: People and organisations
description: The signed-in People, Organisations and Lead sources and labels pages — lists with search and filters, forms, the private-person rule, archive and delete, timelines, optimistic versions and the one-shot delete notice.
tags: [people, organisations, records, lead-sources, labels, timeline]
sources:
  - id: sf90-src-people
    resource: repo://src/server/records/people.ts
  - id: sf90-src-organisations
    resource: repo://src/server/records/organisations.ts
  - id: sf90-src-visibility
    resource: repo://src/server/records/visibility.ts
  - id: sf90-src-flash
    resource: repo://src/server/records/flash.ts
  - id: sf90-src-nav
    resource: repo://src/app/(app)/nav.ts
  - id: openwiki-source-f34ac1e549d94dc3ac475ae4
    resource: repo://src/proxy.ts
  - id: openwiki-source-7a68905e9fd3093f14ae72f5
    resource: repo://src/server/imports/imports.ts
  - id: openwiki-source-9ebb64fab176b6e210f7c3a3
    resource: repo://src/server/notifications.ts
  - id: openwiki-source-ef4a42d348ae43b9d1f60b79
    resource: repo://src/server/records/ambassadors.ts
  - id: openwiki-source-16c334cbe6c5a2c7ad77a065
    resource: repo://src/server/records/handover.ts
  - id: openwiki-source-615b00ed02d4d38087bb7a47
    resource: repo://src/server/records/notes.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-23T18:05:22.701Z
generated: { by: "claude-code", at: "2026-11-23T18:05:22.701Z" }
---

# People and organisations

Staff keep contact records here. The tables are described in
[Database schema](../data/database-schema.md); how data moves between the pages, the tables and the
browser is drawn in [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md) (group "People and organisations").

## Pages

The sidebar registry `src/app/(app)/nav.ts` lists **People** and **Organisations** for everyone and
**Lead sources and labels** in the admin group. Pages live under `src/app/(app)/people`,
`src/app/(app)/organisations` and `src/app/(app)/admin/lead-sources-and-labels`; UI shared by people and
organisations (forms, organisation picker, drawer, timeline, pager, filter row) is in
`src/app/(app)/records/`. Every page calls `requireUser()` or `requireAdmin()`, and every server action checks
the user first (see [Sessions and access control](../auth/sessions-and-access-control.md)).

## Server code (`src/server/records/`)

- `rules.ts` — pure validation and normalisation (emails, phones, websites, LinkedIn URLs, sizes, consent) and
  the list of fields compared to record "edited" events.
- `list-query.ts` — turns URL parameters into a typed query: sorts, filters, page size 50. Unknown values are
  ignored, never shown.
- `people.ts`, `organisations.ts` — reads and writes in plain SQL. Edits lock the row and compare a `version`
  number, so a stale form is refused with an edit-conflict error.
- `choices.ts` — lead sources and labels, soft-removed rather than deleted.
- `timeline.ts` — writes and reads `timeline_events`.
- `form-data.ts` — reads submitted forms.

## Rules worth knowing

- **Private people**: a private person is visible only to their creator and their current owner, admins
  included. Every read of `persons` goes through `visiblePerson()` in `visibility.ts`.
- **Duplicate emails** are refused; names of organisations are unique ignoring case. Typing a new organisation
  name in a person form creates or matches it.
- **Archive and restore** are available to staff; **delete is admin only** and is re-checked inside the
  transaction. Deleting a person removes their emails, phones, labels and own timeline rows; events about them
  on other records stay, without the person (`related_person_id` is set to null). Deleting an
  organisation leaves its people with no organisation.
- **Hand-over**: when a user is deactivated, an admin can hand their private people and private deals (archived
  included) to an active user (`handOverPrivateRecords()` in `handover.ts`). One transaction locks the users,
  re-checks the rules, moves `owner_id`, bumps `version` and writes a `handed_over` event per person and per
  deal; a deal keeps its creator, stage and stage history (no "moved" event). It returns only the two counts and
  the new owner's name, never a person or deal.
  See [User management](user-management.md).
- **Delete notice**: after a delete the action sets a 60-second `crm_flash` cookie holding a code and the
  deleted name; the next page shows it once (`flash.ts`) and `src/proxy.ts` clears the cookie on the next GET.
  The same cookie carries the hand-over notices (`handed_over` with a people count and a deals count, and a "nothing to hand over" code).
  The note codes (`note_deleted`, `note_not_found`) and the "no longer visible" codes use it too.
  Only the known codes are shown, and the text comes from `src/server/messages.ts`.
- **Notes and @mentions**: a note is a `timeline_events` row of kind `note`, added, edited (with an optimistic
  version) and deleted by `src/server/records/notes.ts` through `src/app/(app)/records/note-actions.ts`. Text
  rules and `@[user:<id>]` mention tokens are in `notes-rules.ts`; mentions are `note_mentions` rows and a
  user's mentions appear on the Notifications page (`src/server/notifications.ts`) only while the record is
  visible to them. `RecordTimeline.tsx` draws the timeline of every record page. See
  [Database schema](../data/database-schema.md) and [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md).

## Ambassadors and referrals

A person with `is_ambassador` is an ambassador. The **Ambassadors** page (`/ambassadors`) lists them and the
ambassador page (`/ambassadors/[id]`) shows the people and deals they referred and their latest updates. Person
and deal forms have a "Referred by" picker (`ReferrerPicker.tsx`), and record pages and the deal drawer show it
(`ReferredBy.tsx`). Reads and counts are in `src/server/records/ambassadors.ts`, the pure rules in
`referral-rules.ts`. Every read goes through `visiblePerson()` and `visibleDeal()`, so a private ambassador or
referred record is never listed, counted or offered to someone who cannot see it. Referral changes are written as
timeline events (`ambassador_added`, `referrer_set` and so on).

## CSV import

`/people/import` and `/organisations/import` share the screens in `src/app/(app)/records/import/`
(`ImportPages.tsx`: file, columns, preview and report; `FileStep.tsx` sends the file in 512 KiB parts;
`actions.ts`). Each import is a `csv_imports` row that only its starter can read (`src/server/imports/imports.ts`);
unfinished imports and any import older than 24 hours are purged. The pure code in `src/server/imports/`
reads the file (`csv.ts`), suggests and checks the column mapping (`columns.ts`), validates rows with the normal
person and organisation rules (`rows.ts`) and plans the result: duplicates, organisations, lists, owners and
consent (`plan.ts`, texts in `text.ts`). `runImport` does the whole import in one transaction and writes an
`imported` timeline event. Example files come from `example/route.ts` on each import route. See
[Database schema](../data/database-schema.md) and [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md).

## Fake data

`src/seed/people.ts` seeds fake organisations, people, labels and timeline rows; see
[Migrations and fake data](../operations/migrations-and-seeding.md).
