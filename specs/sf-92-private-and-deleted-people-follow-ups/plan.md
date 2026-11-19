# Implementation Plan: Private and deleted people: follow-ups

**Branch**: `factory/sf-92-private-and-deleted-people-follow-ups` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-92-private-and-deleted-people-follow-ups/spec.md`

## Summary

Three changes to the SF-90 people rules, all on the existing Next.js + plain-SQL stack, no new dependency:

1. **Owner sees a private person.** The one visibility fragment `visiblePerson()` becomes
   `not private or created_by = viewer or owner_id = viewer`. Every people read already goes through it, so
   lists, search, counts, filters, organisation pages, drawers, timelines and duplicate messages follow. The
   creator *or* the owner may change "Private". A save that leaves the actor unable to see the person ends on
   the People list with "You can no longer see <name>: only their creator and owner can." (flash cookie).
2. **Deleting a person keeps organisation events, anonymously.** Migration `0003` changes
   `timeline_events.related_person_id` from `on delete cascade` to `on delete set null`. `deletePerson`
   first deletes organisation events about the person when the person is private (FR-007), then deletes the
   person; the database nulls the reference on the remaining events, which the timeline shows as
   "A deleted person was linked/unlinked by <user>" with no link.
3. **Hand over a deactivated user's private people.** The Users page shows "N private people" and
   `[ HAND OVER ]` on deactivated users' rows that own private people; `[ HAND OVER ]` opens a design-B panel
   above the table (`?handover=<userId>`) with a small client component for the user choice and the live
   question. A new domain function `handOverPrivatePeople` re-checks everything in one locked transaction,
   moves every private person the deactivated user owns to the chosen active user, bumps their `version`,
   and writes a `handed_over` event (new kind, new `related_user_id` column) on each.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3, `postgres` 4.1 — all already in the repo. Nothing added (`dependencies.json` is `[]`).

**Storage**: PostgreSQL. New migration `migrations/0003_private_owner_handover.sql` (data-model.md): FK on `timeline_events.related_person_id` → `on delete set null`; `timeline_events.kind` check gains `handed_over`; new column `timeline_events.related_user_id` (FK `users`, no cascade) with a check tying it to `handed_over`; partial index `persons (owner_id) where private`. No new table.

**Testing**: Vitest (unit: messages/templates, flash codes; integration against real Postgres: visibility by owner everywhere, delete keeps anonymous events, private-deleted events gone, handover rules/concurrency/refusals, seed idempotency), Playwright (US1–US3 through the fake Google login).

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-003 (handover < 30 s, one action). The visibility predicate gains one `or owner_id = $viewer`; the new partial index keeps it as cheap as the creator branch at ~2,000 people. The Users page count is one grouped query over private people.

**Constraints**: Private people visible to creator and owner only, admins included (FR-001); the admin never sees who is handed over (FR-009); handover all-or-nothing and re-checked on every request (FR-010, FR-012); nothing identifying a deleted person kept (FR-006); every text from `messages.ts` (FR-016).

**Scale/Scope**: ≤ 10 users, ~2,000 people. One new panel on an existing page, one changed form label, two new timeline lines, three new notices.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so no constitution gate can fail. The
binding rules are `AGENTS.md` and `docs/DECISIONS.md`; the plan is checked against them:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Users page, panel shell, timeline stay server components. One client component, `HandOverPanel`, only to update the question and explanation as the user choice changes; the form posts to a server action and works without JS (no live question) | ✅ |
| Every signed-in page calls `requireUser()`/`requireAdmin()`; every action checks first | Users page keeps `requireAdmin()`; new action `handOver` starts with `assertAdminForAction()`; `handOverPrivatePeople` re-checks active admin inside its transaction (FR-012, SC-005) | ✅ |
| Messages only from `messages.ts`; never text from the URL | New codes/templates in contracts/routes.md § Messages. Names in notices come from the database through the `crm_flash` cookie; `?handover=` takes a numeric id and `?error=` an allow-listed code | ✅ |
| Redirect targets through `isSafeNext` | All new redirects are fixed paths (`/people`, `/admin/users`, `/admin/users?handover=<id>&error=<code>`) | ✅ |
| Migrations: transaction-safe only, RLS after every `create table`, never at app start | `0003` is plain `alter table`/`create index` (no `concurrently`), no new table | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/people.ts` adds fake private people (owner ≠ creator; owned by Alan Fake) with `example.com` addresses, idempotent by email | ✅ |
| "A private contact … hides it … from everyone but its creator, admins included" (kickoff) | Widened to creator **and owner** by the spec; admins still excluded; the handover shows admins only a count. FR-014 adds the new rules to `docs/DECISIONS.md` | ✅ (spec-sanctioned change) |
| Only an admin deletes for good; users are deactivated, never deleted | Unchanged; `related_user_id` FK without cascade is safe because users are never deleted | ✅ |
| Every outside service has a fake | No new outside service | ✅ |

**Post-design re-check**: still passes; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-92-private-and-deleted-people-follow-ups/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: schema change, rules, handover state change
├── quickstart.md        # Phase 1: how to validate end-to-end
├── contracts/
│   └── routes.md        # Changed pages, the handover action, flash codes, messages
├── dependencies.json    # [] — nothing added
├── blueprints.json      # [] — no blueprint applies
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0003_private_owner_handover.sql      # NEW: FK set null, kind 'handed_over', related_user_id, owner index

src/server/
├── messages.ts                          # + codes and templates (contracts/routes.md § Messages)
└── records/
    ├── visibility.ts                    # creator OR owner
    ├── people.ts                        # updatePerson: creator or owner sets private; returns visible:false+name
    │                                    #   when the actor loses sight; deletePerson: drop org events if private
    ├── handover.ts                      # NEW: privatePeopleCounts(), handOverPrivatePeople()
    ├── timeline.ts                      # kind 'handed_over', relatedUser; relatedPerson null = deleted
    ├── common.ts                        # SaveResult "saved" gains optional { visible: false, name }
    └── flash.ts                         # + codes person_no_longer_visible, handed_over, handover_none (+ count)
src/app/(app)/
├── people/actions.ts                    # updatePerson: flash + redirect /people when no longer visible
├── people/[id]/edit/page.tsx            # canSetPrivate = creator || owner
├── people/page.tsx                      # reads flash person_no_longer_visible as well as person_deleted
├── records/PersonForm.tsx               # Private label from messages.ts
├── records/Timeline.tsx                 # "A deleted person was linked/unlinked by …", "Handed to X by Y"
└── admin/users/
    ├── page.tsx                         # count + [ HAND OVER ] on rows, ?handover= panel, flash notices
    ├── actions.ts                       # + handOver(formData)
    └── HandOverPanel.tsx                # NEW 'use client': select + live question/explanation
src/server/users.ts                      # listUsers: + privatePeople (deactivated users only)
src/seed/people.ts                       # + private people owned by others / by Alan Fake
src/app/globals.css                      # + .handover panel and .pp count (copy design-options.html B)
docs/DECISIONS.md                        # + three lines (FR-014)

tests/
├── unit/                                # messages/templates (plural forms), flash code allow-list
├── integration/                         # private.test.ts (owner), archive-delete.test.ts (anonymous events),
│                                        #   handover.test.ts (NEW), seed.test.ts, migrate/rls unchanged
└── e2e/                                 # private.spec.ts, archive-delete.spec.ts, handover.spec.ts (NEW)
```

**Structure Decision**: same single Next.js project. The handover touches people, so its domain code lives
in `src/server/records/handover.ts` (next to `visibility.ts` and `timeline.ts`), not in `src/server/users.ts`,
which stays about user accounts; the Users page only reads a count from it and calls it from its action.

## Build steps

1. **Migration** `migrations/0003_private_owner_handover.sql` exactly as data-model.md § Migration
   (constraint names `timeline_events_related_person_id_fkey` and `timeline_events_kind_check` are Postgres's
   defaults from `0002`; the migrate test applies it on a fresh database).
2. **Visibility** (`visibility.ts`): `(not p.private or p.created_by = $viewer or p.owner_id = $viewer)`;
   update its comment and `people.ts`'s header comment.
3. **Private flag** (`people.ts` `updatePerson`): `private: current.createdBy === actorId || current.owner.id === actorId ? value.private : current.private` (owner taken *before* the save). Edit page: `canSetPrivate={person.createdBy === user.id || person.owner.id === user.id}`.
4. **Losing sight** (FR-003): at the end of `updatePerson`'s transaction, re-select the person with
   `visiblePerson(db, actorId)`; if not visible return `{ status: "saved", id, visible: false, name }`.
   `people/actions.ts`: on that result `setFlash({ code: "person_no_longer_visible", name })`, revalidate,
   redirect `/people`. `people/page.tsx` reads either flash code.
5. **Delete** (`deletePerson`): inside the existing transaction, after the admin check, lock the person
   (`select private … for update` through `visiblePerson`); if private,
   `delete from timeline_events where related_person_id = $id`; then delete the person (the FK nulls the
   rest). Update the comment. No "unlinked" event is added.
6. **Timeline** (`timeline.ts` + `Timeline.tsx`): `EventKind` + `"handed_over"`; select
   `ru.name as ru_name` via `left join users ru on ru.id = e.related_user_id`; `TimelineEvent.relatedUserName`.
   `person_linked`/`person_unlinked` with `relatedPerson === null` render `messages.deleted_person_linked`
   / `deleted_person_unlinked` + `by(actor)` as plain text; `handed_over` renders
   `templates.handed_over_event(relatedUserName)` + `by(actor)`. The organisation branch of `readTimeline`
   stays `related_person_id is null or visible(rp)`.
7. **Handover domain** (`handover.ts`), see data-model.md § Handover:
   - `privatePeopleCounts(db = sql): Promise<Map<number, number>>` — `select p.owner_id, count(*) from persons p join users u on u.id = p.owner_id where p.private and u.status = 'deactivated' group by p.owner_id` (archived included).
   - `handOverPrivatePeople(actorId, fromUserId, toUserId)` → `{status: "handed", count, toName}` | `"forbidden"` | `"choose_user"` | `"not_deactivated"` | `{status: "none", fromName}`; one transaction, order in data-model.md.
8. **Users page**: `listUsers` gains `private_people` (0 for active users). Row: when deactivated and > 0,
   `<span class="pp">{templates.private_people(n)}</span>` after the Deactivated badge, and
   `<Link href="/admin/users?handover=<id>" class="btn link">[ HAND OVER ]</Link>` before `[ REACTIVATE ]`.
   `?handover=<id>` (`^[1-9][0-9]{0,15}$`) opens the panel above the add row only for a deactivated user
   with > 0; `?error=handover_choose_user` shows in the panel, `?error=handover_not_deactivated` above the
   table (add both to `PAGE_ERRORS`). Flash `handed_over` / `handover_none` shown above the table.
9. **`HandOverPanel.tsx`** (`'use client'`): props `fromUserId`, `fromName`, `count`, `users: Option[]`
   (active users except the from user, the admin included, sorted by name), `error?: string`. A form with
   `action={handOver}`, hidden `userId`, `<select name="toUserId">` starting on `messages.handover_choose`
   (value ""), `[ HAND OVER ]` (submit, `btn solid`), `[ CANCEL ]` (link `/admin/users`). The question
   line shows `templates.handover_question(fromName, count, chosen)` once a user is chosen; the explanation
   is `templates.handover_explain(chosen)` or `messages.handover_explain_unchosen`.
10. **Action** `handOver(formData)` in `admin/users/actions.ts`: `assertAdminForAction()`; read `userId`,
    `toUserId` (empty/invalid → `choose_user` without calling the domain); map results per
    contracts/routes.md; `revalidatePath("/admin/users")`, `revalidatePath("/people")`.
11. **Flash** (`flash.ts`): codes `person_deleted`, `organisation_deleted`, `person_no_longer_visible`,
    `handed_over`, `handover_none`; cookie value `{code, name, count?}`; `readFlash(allowed: FlashCode[])`
    renders through `templates` (count must be a positive integer ≤ 10,000 for `handed_over`).
12. **Messages** (`messages.ts`): every new text in contracts/routes.md § Messages; PersonForm's label from
    `messages.private_label`.
13. **Seed** (`src/seed/people.ts`): after the existing loop, an idempotent list (skip when the email is
    taken) of three fake private people: one created by Ada Fake owned by Linus Fake; two created by and
    owned by Alan Fake (one linked to "Fakeco Ltd"), each with an `added` event. Update `seed.test.ts`
    counts.
14. **CSS**: `.handover` panel styled like the delete confirmation (`DeleteConfirm`) and `.pp` as in
    `design-options.html` option B.
15. **Docs**: append to `docs/DECISIONS.md`:
    - `- A private person is visible to their creator and their current owner, nobody else, admins included; either of them can make the person private or shared (SF-92)`
    - `- When a person is deleted, events about them on other records are kept without their name ("A deleted person …"); events about a person who was private when deleted are removed (SF-92)`
    - `- An admin can hand all of a deactivated user's private people to one active user, who becomes their owner; the admin only sees how many there are (SF-92)`

    Also each factory choice from spec.md Clarifications that the Plan Review confirms. README: mention the
    handover on the Users page and the new fake people.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supabase and github.com/supabase/supavisor for SF-90; the app speaks the standard Postgres protocol, this change only alters the app's own tables, and tests use a real local Postgres rather than a fake)

No other outside service: the change makes no network call besides the app's own database.

## Complexity Tracking

No constitution violations to justify.
