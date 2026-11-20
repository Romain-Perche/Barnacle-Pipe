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
  - id: openwiki-source-16c334cbe6c5a2c7ad77a065
    resource: repo://src/server/records/handover.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T18:23:26.676Z
generated: { by: "claude-code", at: "2026-11-19T18:23:26.676Z" }
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
- **Hand-over**: when a user is deactivated, an admin can hand their private people to an active user
  (`handover.ts`). One transaction locks the users, re-checks the rules, moves `owner_id`, bumps `version` and
  writes a `handed_over` event per person; it returns only a count and the new owner's name, never a person.
  See [User management](user-management.md).
- **Delete notice**: after a delete the action sets a 60-second `crm_flash` cookie holding a code and the
  deleted name; the next page shows it once (`flash.ts`) and `src/proxy.ts` clears the cookie on the next GET.
  The same cookie carries the hand-over notices (`handed_over` with a count, and a "nothing to hand over" code).
  Only the known codes are shown, and the text comes from `src/server/messages.ts`.

## Fake data

`src/seed/people.ts` seeds fake organisations, people, labels and timeline rows; see
[Migrations and fake data](../operations/migrations-and-seeding.md).
