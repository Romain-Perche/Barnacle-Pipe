# Implementation Plan: Campaigns — segments

**Branch**: `factory/sf-120-step-15-campaigns-segments` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-120-step-15-campaigns-segments/spec.md`

## Summary

A new "Segments" page (sidebar, after Activities) lists saved segments shared by the whole team; each segment has its
own page and an add / edit form on its own page (design C). A segment stores a choice of recipients — everyone, the
people on the deals of a pipeline or of one stage (Open / Won / Lost / All deals, archived deals never) — plus any
number of AND-ed conditions on person fields (lead source, label, organisation, owner, role, people custom fields),
never a list of people. The count "Reaches <n> people now" and the people left out (archived → unsubscribed → no email
address) are worked out at each page load by one SQL query per segment built on `visiblePerson` / `visibleDeal`, so
private people and deals never count or show. One table `segments` (conditions as a checked jsonb list, no foreign keys
to things that can be deleted, so a deleted pipeline, stage, organisation or field shows "(deleted)" and matches
nobody), optimistic `version` for concurrent edits. One migration (`0012_segments.sql`), a new domain folder
`src/server/segments/`, no new dependency, no new outside service.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3, `postgres` (postgres.js) — all
already in the repo. Nothing added (research.md §1, `dependencies.json` = `[]`).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). Migration
`migrations/0012_segments.sql`: table `segments`, index `segments_name_key`, partial index `deals_stage_live_idx`
(data-model.md).

**Testing**: Vitest only — unit (pure rules, messages, nav) and integration on the real local Postgres (CRUD,
concurrency, reach and privacy, People list parity, performance, migrate, RLS, seed). No browser tests (DECISIONS
2026-11-23). quickstart.md lists the files.

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: SC-004 — Segments page with 50 segments over 10,000 people and 5,000 deals < 2 s: one `count(*)
filter` query per segment on indexed probes (research.md §9).

**Constraints**: private people and deals never counted, named or hinted at (FR-010, SC-003); every page and action
`requireUser()` first; all text from `messages.ts`, names as text nodes; nothing from the address shown back.

**Scale/Scope**: ≤ 10 users, ≤ 10,000 people, tens of segments. 4 new pages (list, new, segment, edit) + not-found, 1
client form with a multi-picker, the sidebar, the seeder; one small refactor in `custom-fields/values.ts`.

No NEEDS CLARIFICATION left: research.md settles each technical point; the factory's product choices (limits,
archived organisations offered, "Empty" with choices, no timeline entries, delete for everyone) are in spec.md
§ Clarifications "decided by the factory, to confirm".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | Pages, table, segment page, delete confirmation: server. Client: `SegmentForm.tsx` (rows added / removed, inputs by field type, stages by pipeline, `useActionState`) and `MultiPicker.tsx` (filtering multi-select) | ✅ |
| Every signed-in page `requireUser()`; every action `requireUser()` first; never rely on hidden links | 4 pages + 2 actions call `requireUser()`; no admin rights needed (segments are shared, DECISIONS 2026-11-24) | ✅ |
| Messages from `messages.ts`; never text from the URL; redirects via `isSafeNext` | contracts/routes.md § Messages; `[id]` via `parseId`, only `confirm=delete` read; deleted name from the database via the flash cookie; redirects are fixed paths (no `next`) | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0012` only `create table` / `create index`; RLS on `segments` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/segments.ts` in the gated registry, names start "Fake —" | ✅ |
| Private contact or deal hidden from everyone but creator / owner, admins included | `visiblePerson` + `visibleDeal` inside the one reach query; left-out numbers counted among visible people only | ✅ |
| Saved segments shared by the whole team; recipients worked out at send time, the segment says so (DECISIONS 2026-11-24) | No owner on a segment; `segment_count_note` on the form, the segment page and beside every count | ✅ |
| A person's unsubscribed status is respected (kickoff, PRODUCT §4) | Unsubscribed people are left out and counted as such; consent unchanged | ✅ |
| Removed label / lead source / choice stays on records and in filters, not offered (SF-90, SF-95, SF-115) | Removed ones keep matching and stay in a segment that has them, never offered to a new condition | ✅ |
| Every outside service has a fake | No new outside service (§ Outside services) | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-120-step-15-campaigns-segments/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, validation, state changes, fake data
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   └── routes.md        # Pages, form fields, actions, domain functions, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0012_segments.sql                           # data-model.md § Migration

src/
├── server/
│   ├── segments/                               # new
│   │   ├── rules.ts                            # pure: types, form reading + validation, readConditions, describeSegment
│   │   ├── reach.ts                            # reachWhere, countReach, reachedPeople
│   │   └── segments.ts                         # list, get, form options, create / update / delete, countDefinition
│   ├── custom-fields/values.ts                 # customProbe extracted from customListParts (behaviour unchanged)
│   ├── records/flash.ts                        # segment_deleted, segment_not_found
│   └── messages.ts                             # contracts/routes.md § Messages
├── app/(app)/
│   ├── nav.ts                                  # + Segments after Activities
│   └── segments/                               # new
│       ├── page.tsx                            # the Segments table
│       ├── actions.ts                          # saveSegmentAction, deleteSegmentAction
│       ├── SegmentForm.tsx                     # client: the form, conditions, count block
│       ├── MultiPicker.tsx                     # client: filtering multi-select with chips
│       ├── ReachBlock.tsx                      # server-safe: "Reaches n people now", left out, note
│       ├── SegmentDeleteConfirm.tsx            # server: ?confirm=delete
│       ├── new/page.tsx
│       └── [id]/page.tsx, [id]/edit/page.tsx, [id]/not-found.tsx
├── seed/segments.ts, seed/index.ts
└── app/globals.css                             # count strip, condition rows, chips (existing tokens only, docs/DESIGN.md)

tests/support/reset.ts, .factory/run/reset-db.sh   # truncate segments
tests/unit/, tests/integration/                    # quickstart.md § Automated checks
```

**Structure Decision**: same single Next.js project. Segments get their own domain folder `src/server/segments/` (like
`deals/`, `activities/`, `custom-fields/`) and their own app folder; the later Campaigns issue will sit beside them and
reuse `reachedPeople`. Privacy stays in `records/visibility.ts`, used by `reach.ts`.

## Build steps (in order)

1. **Migration** `migrations/0012_segments.sql` exactly as data-model.md § Migration (check the number against
   `migrations/` first; take the next free one). Add `segments` to the truncate list of `tests/support/reset.ts` and
   `.factory/run/reset-db.sh`.
2. **Messages** in `src/server/messages.ts` (contracts/routes.md § Messages), flash codes `segment_deleted` (template
   with the name) and `segment_not_found` in `src/server/records/flash.ts`.
3. **Pure rules** `src/server/segments/rules.ts`: types (data-model.md § Condition), `readSegmentForm`,
   `validateSegmentForm` (data-model.md § Validation; reuse `parseNumber`, `parseMoney`, `parseDate`, `canonicalNumber`
   from SF-115 / records rules; ids kept only when in the form options), `readConditions`, `describeSegment`
   (summaries exactly as contracts/routes.md; "(deleted)"; `broken`), `formToValues`. Format "Last changed" with the
   existing UK date helpers.
4. **Custom probe**: in `src/server/custom-fields/values.ts` extract the `exists (select 1 from custom_values cv …)`
   probe into exported `customProbe(db, field, alias, test)`; `customListParts` uses it. Existing list tests must stay
   green unchanged.
5. **Reach** `src/server/segments/reach.ts` (research.md §3, §4): `reachWhere` = `visiblePerson(sql, viewer, "p")` and
   the "Who" `exists` on `deals d join stages s` with `d.archived_at is null`, `visibleDeal(sql, viewer, "d")`, status
   unless `all`, main contact or `deal_people`; each condition as research.md §4 (a condition on a missing / non-person
   / other-type field → `false`); `countReach` one query with four `count(*) filter (…)` in the order archived →
   unsubscribed → no email → reaches; `reachedPeople` (person id + first email by `position`).
6. **Domain** `src/server/segments/segments.ts` (contracts/routes.md § Domain functions; research.md §5, §6, §8):
   option lists, name check (`lower(name)` excluding the segment itself; catch `23505`), `update … where id and version`
   with the `segment_changed` / `segment_not_found` split, delete `returning name`, `listSegments` ordered
   `lower(name), id` with one `countReach` per segment in sequence, names for `describeSegment` loaded in a few
   `= any($ids)` queries for all segments of the page at once.
7. **Pages and actions** under `src/app/(app)/segments/` (design C of `design-options.html`, `docs/DESIGN.md`):
   table page, segment page (count strip, // WHO, // CONDITIONS, `[ EDIT ]`, `[ DELETE ]` → `?confirm=delete` →
   `SegmentDeleteConfirm`), new / edit pages with `SegmentForm` + `MultiPicker`, `not-found.tsx`, `actions.ts` (both
   start with `requireUser()`; `intent=count` never writes). `nav.ts`: `{ href: "/segments", label: "Segments" }`
   after Activities, with a `// SF-120` comment. CSS in `globals.css` with existing tokens only.
8. **Fake data** `src/seed/segments.ts` (data-model.md § Fake data), registered last in `src/seed/index.ts`.
9. **Tests** as quickstart.md § Automated checks (Build writes them; each names what it covers).
10. **Docs**: append to `docs/DECISIONS.md`, one line each, the choices of this spec:
    "Segments use design C: a Segments table and one page per segment with a count strip, // WHO and // CONDITIONS; the
    add and edit form on its own page (SF-120)",
    "A pipeline or stage segment counts the people on its Open, Won, Lost or All deals, Open first; archived deals never
    count (SF-120)",
    "A segment counts each person once, at their first email address, leaving out archived, then unsubscribed, then
    address-less people (SF-120)",
    "A segment that refers to a deleted pipeline, stage, organisation or custom field shows it as (deleted), matches
    nobody through it and asks to be edited (SF-120)",
    and the factory's choices from spec.md § Clarifications, each with "(SF-120, decided by the factory, to confirm)"
    until a person confirms them: at most 20 conditions and 100 values per condition; the Organisation condition offers
    archived organisations; "Empty" can be picked with choices; segments make no timeline entries; anyone can delete
    any segment. No blueprint exception (no blueprint index in this run), so no "Departs from blueprint" line.
    Update `AGENTS.md` § Layout with `src/server/segments/` (`rules.ts`, `reach.ts`, `segments.ts`), `customProbe`, and
    `src/app/(app)/segments/`; add `src/seed/segments.ts` to the seeder list sentence.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; the app speaks the standard Postgres protocol, this change only adds one table and one index to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: segments and their counts run in the app and its database; sending (Gmail API) is the later
campaign issue.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
