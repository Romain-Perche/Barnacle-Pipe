# Implementation Plan: Campaigns: writing the content

**Branch**: `factory/sf-119-step-14-campaigns-writing-the-content` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-119-step-14-campaigns-writing-the-content/spec.md`

## Summary

A new "Campaigns" page (after Activities in the sidebar) lists the team's campaign drafts; each draft opens on one edit
page (design A): `// DETAILS` and `// CONTENT` on the left, a live `// PREVIEW FOR` a chosen person on the right. A
draft is one row of a new `campaigns` table (migration `0015_campaigns.sql`) with a version for conflicting saves.
Content is either layout blocks (JSON, five block types, four layouts) or pasted HTML kept as pasted. Merge tags
`{{<field> | <if empty>}}` are parsed by one pure module shared by the server (save checks, unknown tags, links) and the
client (live preview); custom field tags are linked by id in `merge_links` and their names rewritten on open, so they
follow renames. Person values come only from a server action that applies the private rule. Email content is shown only
in an `<iframe srcdoc>` sandboxed without scripts, same origin, forms or top navigation, with a CSP meta tag and
`<base target="_blank">`: pasted HTML cannot run, send or reach the app. No new dependency, no new outside service.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js ≥ 22.12 (unchanged)

**Primary Dependencies**: Next.js 16.4 (App Router, server actions), React 19.3, `postgres` 4.1 — already in the repo.
Nothing added (research.md §1).

**Storage**: PostgreSQL (local for dev/tests, Supabase through its pooler in production). Migration
`migrations/0015_campaigns.sql`: table `campaigns` (data-model.md). No change to existing tables.

**Testing**: Vitest — unit (merge grammar, content, rules, frame document, messages, nav) and integration on the real
local Postgres (drafts, conflicts, links after rename/delete, preview privacy, picker, actions without session, RLS,
seed). No browser tests (DECISIONS 2026-11-23). quickstart.md lists them.

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered, client islands).

**Performance Goals**: SC-002 — preview < 2 s for 50 blocks or 500,000 characters of HTML: filling is pure string work
in the browser (no server trip after the person is chosen), frame updates debounced to 300 ms; a unit test fills
500,000 characters with 1,000 tags in under 200 ms.

**Constraints**: pasted HTML never runs, sends or navigates in the app (FR-017); person values only for visible,
non-archived people, HTML-escaped (FR-015, FR-016); every limit and stale save refused with nothing written (SC-006);
messages only from `messages.ts`; server action bodies up to 4 MB (research.md §11).

**Scale/Scope**: ≤ 10 users, tens of drafts, thousands of people. 2 new pages, 4 boxes/confirmations, 5 client
components, 1 table, 5 server modules, 1 seeder, the sidebar.

No NEEDS CLARIFICATION left: research.md decides each open point; the choices only a person can make are in spec.md
§ Clarifications ("Plan 2026-11-24", decided by the factory, to confirm).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles, no gate can fail. The binding
rules are `docs/DECISIONS.md` and `AGENTS.md`:

| Rule | Plan | Status |
|---|---|---|
| Server components by default, client only where needed | List page, boxes, confirmations, not-found: server. Client only for the editor (typing, blocks, live preview), the merge tag menu, the picker, the preview frame | ✅ |
| Every signed-in page `requireUser()`; every action `requireUser()` first | Both pages and all six actions (contracts/routes.md); drafts are shared, so no admin check (spec Clarification) | ✅ |
| Messages from `messages.ts`; never text from the URL; redirects safe | contracts § Messages; `new`/`delete` read as `1` or an id; names from the database through templates/flash; redirects to fixed paths | ✅ |
| Migrations transaction-safe, RLS after every `create table`, never at app start | `0012` only `create table` / `alter table` / `create index`; RLS on `campaigns` | ✅ |
| Fake data only when `isFakeAllowed()`, clearly fake names | `src/seed/campaigns.ts` in the gated registry, "(fake)" names, `example.test` addresses | ✅ |
| Private person hidden from everyone but creator / owner, admins included | Picker and values through `visiblePerson` via `getPerson` / one query; nothing about the person stored on the draft | ✅ |
| Every outside service reached through settings with a fake | No new outside service (§ Outside services) | ✅ |
| Campaigns sent through Gmail, unsubscribe served by the CRM (2026-11-24) | Not in this issue; the preview's unsubscribe line is a stand-in; nothing here blocks it | ✅ |
| Email templates and segments shared by the team (2026-11-24) | Drafts shared the same way | ✅ |
| Design B sidebar layout, `// ` labels, `[ … ]` buttons, confirmations in a box over the page | FR-020, design A of `design-options.html` | ✅ |

**Post-design re-check**: still passes; no violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/sf-119-step-14-campaigns-writing-the-content/
├── plan.md              # This file
├── research.md          # Phase 0: decisions and rationale
├── data-model.md        # Phase 1: migration, entities, states, fake data
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   └── routes.md        # Pages, actions, domain functions, client components, messages
├── dependencies.json    # [] (nothing added)
├── blueprints.json      # [] (from Specify; no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
migrations/
└── 0015_campaigns.sql                       # data-model.md § Migration

next.config.ts                               # experimental.serverActions.bodySizeLimit "4mb"

src/
├── server/
│   ├── campaigns/                           # new
│   │   ├── merge.ts                         # pure, client-safe: tags, fields, links, rename, fill
│   │   ├── content.ts                       # pure, client-safe: blocks, layouts, HTML, frame document
│   │   ├── rules.ts                         # pure: draft limits, Still empty, copy name
│   │   ├── campaigns.ts                     # list / open / create / save / duplicate / delete
│   │   └── preview.ts                       # picker search, a person's merge values
│   ├── records/flash.ts                     # + campaign_deleted, campaign_gone
│   └── messages.ts                          # contracts § Messages
├── app/(app)/
│   ├── nav.ts                               # + Campaigns after Activities
│   └── campaigns/                           # new
│       ├── page.tsx, actions.ts
│       ├── NewCampaignBox.tsx, CampaignDeleteConfirm.tsx       # server
│       ├── CampaignEditor.tsx, BlockList.tsx, MergeTagMenu.tsx # client
│       ├── PreviewPersonPicker.tsx, CampaignPreview.tsx        # client
│       └── [id]/page.tsx, [id]/not-found.tsx
├── seed/campaigns.ts, seed/index.ts
└── app/globals.css                          # two-column edit page, block cards, preview pane (existing tokens only)

tests/support/reset.ts                       # truncate campaigns
tests/unit/, tests/integration/              # quickstart.md § Automated checks
```

**Structure Decision**: same single Next.js project. Campaigns get their own domain folder `src/server/campaigns/`
(a draft is not a CRM record); the later sending issue adds to it. Pure files there must not import `@/server/db` or
anything server-only, because the client editor imports them.

## Build steps (in order)

1. **Migration** `migrations/0015_campaigns.sql` exactly as data-model.md. `tests/support/reset.ts` truncates
   `campaigns`. (Check `0011` is still the latest; renumber if another step merged first.)
2. **Pure merge module** `src/server/campaigns/merge.ts` (research.md §3, §4, §6; contracts § Domain functions):
   regex `/\{\{([^{}]*)\}\}/g`, name/fallback split on the first `|`, trim, `toLowerCase()` matching, segments with
   name offsets, `rewriteNames`, `resolveTag` (link → built-in → custom → unknown), `unknownTags`, `linksToStore`,
   `fillText`, `fillHtml` (HTML-escape `& < > " '`), `[<name>]` with no person.
3. **Pure content module** `content.ts` (research.md §8, §5, §9): block types and limits, `LAYOUTS`, `validateContent`
   (JSON parse, known types and keys only, ≤ 50, schemes via `new URL()`), `blocksToHtml`, `linkify`, `frameDocument`
   with exactly the CSP meta and `<base target="_blank">` of research.md §5 before the content.
4. **Pure rules** `rules.ts`: limits counted in code points, trimming, `isValidEmail(normaliseEmail(…))` from
   `records/rules.ts`, fallback ≤ 100 for known tags, `stillEmpty`, `copyName`.
5. **Messages and flash**: the codes and templates of contracts § Messages; flash codes `campaign_deleted`,
   `campaign_gone`.
6. **Database** `campaigns.ts` (research.md §10): list with creator / last editor names; open with `rewriteNames` and
   `shownLinks` from `listFields("person")`; create (sender = the user's `users.name`); save in a transaction (`for
   update`, gone, version, validate, `merge_links = linksToStore(...)`, `version + 1`); duplicate (copy row, `Copy of`);
   delete. `preview.ts` (research.md §6, §7): `searchPreviewPeople` (one query, `visiblePerson`, not archived, name or
   email `ilike` with `escapeLike`, limit 20) and `previewValues` (`getPerson`, not archived, the key map, custom values
   through `formatValue` only when set).
7. **Config**: `next.config.ts` → `experimental: { serverActions: { bodySizeLimit: "4mb" } }`.
8. **Pages and actions** (contracts § Pages, § Server actions): `nav.ts` entry; `/campaigns` table with `?new=1` box and
   `?delete=<id>` confirmation; `/campaigns/[id]` with `?delete=1`; `not-found.tsx`; six actions each starting with
   `requireUser()`; `revalidatePath("/campaigns")` after changes.
9. **Client editor** (design A): `CampaignEditor.tsx` (state, `useActionState`, header `[ SAVE ]` via `form=` id, field
   errors, "Draft saved.", "Still empty: …", "Unknown merge tags: …", layout chooser when content is empty, switch
   boxes with `campaign_switch_to_html` / `campaign_switch_to_layout`), `BlockList.tsx`, `MergeTagMenu.tsx` (inserts at
   the cursor of the last focused field), `PreviewPersonPicker.tsx` (250 ms debounce), `CampaignPreview.tsx`
   (`<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc=…>`, 300 ms
   debounce, `openLinksInNewTab` with `DOMParser`). Never `dangerouslySetInnerHTML`; never `allow-scripts`,
   `allow-same-origin`, `allow-forms` or `allow-top-navigation*`.
10. **Styles** in `globals.css` with existing tokens only (`docs/DESIGN.md`): two columns ≥ 1200 px wide, one column
    below; block cards; preview pane with a white email area.
11. **Fake data** `src/seed/campaigns.ts` (research.md §13), registered last in `src/seed/index.ts`.
12. **Tests** as quickstart.md § Automated checks, each with its `// covers …` line.
13. **Docs**: append to `docs/DECISIONS.md` the choices people made in spec.md § Clarifications (Session 2026-11-24),
    one line each, and a `tests/unit/decisions.test.ts` block for SF-119:
    "Campaigns use design A: the Campaigns page is a table; a draft's edit page has the draft (// DETAILS, // CONTENT) on
    the left and a live preview for a chosen person on the right (SF-119)",
    "Campaign drafts are shared by the whole team: everyone can edit, duplicate and delete every draft (SF-119)",
    "Merge tags of a people custom field follow the field's renames, in the subject, preview text, layout blocks and
    pasted HTML; a tag typed by hand is matched to its field when the draft is saved (SF-119)".
    The factory's choices ("Plan 2026-11-24") are added only once a person confirms them. No blueprint exception, so no
    "Departs from blueprint" line. Update `AGENTS.md` § Layout with `src/server/campaigns/` and
    `src/app/(app)/campaigns/` (one entry each, in the style of the others), and the README if it lists pages.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor and github.com/supabase/supabase during SF-90, SF-93 and SF-102: only an OpenAPI file for Supavisor's own management API; the app speaks the standard Postgres protocol, this change only adds a table to the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: drafts, merge tags and the preview run in the app, its database and the user's browser. Images
or stylesheets named in pasted HTML are fetched by the user's browser inside the sandboxed preview, not by the app's
code (spec.md § Clarifications, Plan 2026-11-24).

## Fix round 1

AI review (2026-11-24): 40 of 41 checks passed. Three problems.

1. **Reply-to message never shown (US1 scenario 4, FR-019).** Cause: `#campaign-form` in
   `src/app/(app)/campaigns/CampaignEditor.tsx` has no `noValidate`, and Reply-to is `type="email"`, so the browser
   blocks the save with its own message. The person, organisation and deal forms all set `noValidate`. Fix: add
   `noValidate` to `#campaign-form`. The server checks stay the only checks.
2. **Rename then delete shows the name before the rename (FR-009a).** Cause: `merge_links` entries keep the name of the
   draft's last save (`{ field, name }`); `shownLinks` in `src/server/campaigns/merge.ts` uses the live field's name,
   else that stored name. When the field is renamed and then deleted with no save in between, the stored name is the
   old one. Fix: keep the field's last name when it is deleted. In `deleteField`
   (`src/server/custom-fields/fields.ts`), for a `person` field, in the same transaction, add `"last": <field name>` to
   every `campaigns.merge_links` entry whose `field` is that id (one `update campaigns ... where merge_links @>
   jsonb_build_array(jsonb_build_object('field', <id>))`; `version`, `updated_by` and `updated_at` do not change: it
   is not an edit of the draft). `StoredLink` becomes `{ field, name, last? }`. `shownLinks` shows the live field's
   name, else `last`, else `name`. `rewriteNames` still finds tags by `name` (the text as stored), so the stored texts
   are not touched. `linksToStore` keeps writing `{ field, name }` with the shown name, so the next save stores the
   last name as `name`. Rejected: rewriting every draft's texts on each rename (changes drafts nobody edited and
   makes open edit pages fail with a conflict); keeping deleted fields as hidden rows (changes the whole custom fields
   feature). Also update the comment in `data-model.md` § Link (`{ field, name, last? }`).
3. **Status column reads the badge message (minor).** Cause: the Campaigns page and the edit page header show
   `messages.campaign_draft` ("DRAFT"); `messages.campaign_status_draft` ("Draft", spec US1 scenario 1) is unused. Fix:
   use `campaign_status_draft` in both places and remove `campaign_draft`. The `.status` style still shows it in
   capitals, as `docs/DESIGN.md` asks for status text.

Not a problem: a person made private after being chosen keeps their values on screen until the next save or a new
choice; the edge case in spec.md passes (the AI review saw it pass).

Files to change: `src/app/(app)/campaigns/CampaignEditor.tsx`, `src/app/(app)/campaigns/page.tsx`,
`src/server/messages.ts`, `src/server/campaigns/merge.ts`, `src/server/custom-fields/fields.ts`, `data-model.md`,
`tests/integration/campaign-merge-links.test.ts`, `tests/unit/campaign-merge.test.ts`, a new
`tests/unit/campaign-editor-form.test.ts`. No migration (the `merge_links` column is already `jsonb`), no new
dependency, no new outside service.

## Fix round 2

AI review (2026-11-24): one problem, in the docs only. The code passed (migration 0015 after 0014_segments, nav order
Activities → Campaigns → Segments, the seeder before segments, `requireUser()` first in actions, preview values through
`visiblePerson`).

1. **`AGENTS.md` § Layout, the `src/seed/` entry, has its second line twice.** Cause: the merge of `main` (SF-120)
   kept both versions of the line: one ends "campaigns: `campaigns.ts`).", the other "segments: `segments.ts`).". Each
   copy leaves out the other seeder. Fix: keep one line, "files, custom fields: `custom-fields.ts`, campaigns:
   `campaigns.ts`, segments: `segments.ts`). The fake Pipedrive needs no seeding." Rejected: removing the seeder list
   and pointing to `src/seed/index.ts` (every other Layout entry names its files; the review asks for the one line).

Files to change: `AGENTS.md` only. No code, no test file, no migration, no dependency, no outside service, no spec
change (nothing the user sees changes).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
