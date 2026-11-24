---

description: "Task list for SF-119 Campaigns: writing the content"
---

# Tasks: Campaigns: writing the content

**Input**: Design documents from `/specs/sf-119-step-14-campaigns-writing-the-content/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/routes.md, quickstart.md

**Tests**: Requested by the repo (AGENTS.md § Tests) and the spec (SC-003 to SC-006): Vitest unit tests and Vitest integration tests against a real local Postgres (`crm_test`). No browser tests (docs/DECISIONS.md, 2026-11-23): never start the app in a browser. Each test file names what it covers (`// covers FR-007, US2 scenario 3`). Write each story's tests first and see them fail before the code.

**Organization**: Tasks are grouped by user story. Exact message texts are in contracts/routes.md § Messages: use them verbatim, from `src/server/messages.ts` only. The migration, entities, states and fake data are in data-model.md; pages, actions, domain functions and client components in contracts/routes.md; decisions in research.md (§n below). No new dependency (`dependencies.json` is `[]`): do not add any package — in particular no HTML sanitiser (DOMPurify, sanitize-html), no jsdom, no template engine. No blueprint applies (`blueprints.json` is `[]`, no blueprint index in this run), so there are no blueprint tasks and no `Departs from blueprint` line. The five factory choices in spec.md § Clarifications ("Plan 2026-11-24") are built as written there. The only outside service is Supabase Postgres (no public schema on GitHub): its task is T010, the recipe T060 (last task). Fake users: Ada Fake and Grace Fake (admins), Linus Fake and Margaret Fake (users), Alan Fake (deactivated). Tests create their own people (e.g. "Fakey McFake", no organisation).

Files in `src/server/campaigns/` named `merge.ts`, `content.ts` and `rules.ts` are pure and client-safe: they must not import `@/server/db`, `next/headers` or anything server-only (the client editor imports them).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)

---

## Phase 1: Setup

**Purpose**: The table, the request size and the texts every story uses.

- [X] T001 Write `migrations/0014_campaigns.sql` exactly as data-model.md § Migration (first check `0011_files.sql` is still the latest migration; renumber if not). Table `campaigns`:
  - `name text not null check (name = btrim(name) and char_length(name) between 1 and 100)`
  - `sender_name text not null default '' check (char_length(sender_name) <= 100)`
  - `reply_to text not null default '' check (char_length(reply_to) <= 254)`
  - `subject text not null default '' check (char_length(subject) <= 255)`
  - `preview_text text not null default '' check (char_length(preview_text) <= 255)`
  - `content_kind text null check (content_kind in ('blocks', 'html'))`
  - `blocks jsonb null check (blocks is null or (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) between 1 and 50))`
  - `html text null check (char_length(html) <= 500000)`
  - `merge_links jsonb not null default '[]' check (jsonb_typeof(merge_links) = 'array')` (no foreign key, with the comment of data-model.md)
  - `status text not null default 'draft' check (status in ('draft'))`
  - `created_by` / `updated_by bigint not null references users (id)`, `created_at` / `updated_at timestamptz not null default now()`, `version int not null default 1`
  - `constraint campaigns_content_check` (null kind ⇒ both null; `blocks` ⇒ blocks set and html null; `html` ⇒ html set and blocks null)
  - `alter table campaigns enable row level security;` right after the `create table`; `create index campaigns_updated_idx on campaigns (updated_at desc, id desc);`
- [X] T002 [P] Add `campaigns` to the `truncate` list of `tests/support/reset.ts` (and the same table to `.factory/run/reset-db.sh` if it lists tables).
- [X] T003 [P] Set `experimental: { serverActions: { bodySizeLimit: "4mb" } }` in `next.config.ts` (research.md §11) with a one-line comment: 500,000 characters of pasted HTML can be up to 2 MB as UTF-8.
- [X] T004 [P] Add every code of contracts/routes.md § Messages to `src/server/messages.ts`: the `messages` entries (`campaigns_empty` … `campaign_switch_to_layout`, labels, column headings, layout names "Blank", "Text", "Text with a button", "Newsletter", "Paste HTML", block names "Heading", "Text", "Button", "Image", "Divider") and the `templates` `campaign_deleted`, `campaign_delete_confirm`, `campaign_edit_conflict`, `campaign_block_too_long`, `campaign_button_url`, `campaign_image_url`, `campaign_copy_name`, with a `// SF-119` comment. Extend `tests/unit/messages.test.ts` so each new code exists and the templates give exactly the spec's texts (`Campaign "Exec dinner (fake)" deleted.`, `Ada Fake changed this campaign since you opened it. Reload to see their changes.`, `Button: enter a web address starting with https://.`).
- [X] T005 [P] Add flash codes `campaign_deleted` (template with the name) and `campaign_gone` (the fixed message, name ignored) to `CODES` and `render` in `src/server/records/flash.ts`; extend `tests/unit/flash.test.ts`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The sidebar entry and the pure modules every story builds on. ⚠️ No story starts before this phase is done.

- [X] T006 Add `{ href: "/campaigns", label: "Campaigns" }` to `mainNav` in `src/app/(app)/nav.ts`, right after Activities, with `// SF-119: campaign drafts.`; extend `tests/unit/nav.test.ts`: Campaigns comes right after Activities and before Notifications, for every user (not in `adminNav`).
- [X] T007 Create `src/server/campaigns/rules.ts` (pure): `codePoints(s) = Array.from(s).length`; `CAMPAIGN_LIMITS = { name: 100, senderName: 100, replyTo: 254, subject: 255, previewText: 255, fallback: 100, html: 500_000, blocks: 50, heading: 200, text: 10_000, buttonLabel: 60, alt: 200, url: 2_000 }`; `copyName(name)` = `templates.campaign_copy_name(name)` cut to 100 code points then trimmed. Validation and `stillEmpty` are added by US1.
- [X] T008 Create `src/server/campaigns/campaigns.ts` skeleton: the row type, `toView(row, customFields)` returning the editor view (contracts/routes.md § Domain functions), and the `lastEdited` line (`updated_by` name · `formatDateTime(updated_at)` from `src/server/format.ts`). Every change in one `sql.begin()`; no `set`, `listen` or session advisory lock.

**Checkpoint**: table, texts, sidebar and module skeletons in place.

---

## Phase 3: User Story 1 - Start and save a campaign draft (Priority: P1) 🎯 MVP

**Goal**: The Campaigns page lists drafts; `[ NEW CAMPAIGN ]` creates one; the edit page saves the details with every limit and conflict check.

**Independent Test**: Create "Exec dinner – March (fake)", fill sender name, reply-to, subject and preview text, save, reload: every value kept, and the draft is listed with who last edited it and when.

### Tests for User Story 1 ⚠️

- [X] T009 [P] [US1] `tests/unit/campaign-rules.test.ts` (covers FR-003, FR-004, US1 scenarios 3–5, SC-006): `validateDraft` refuses an empty name ("Give the campaign a name."), 101 code points ("A campaign name can be at most 100 characters."), sender name 101, reply-to `not-an-email` and `a@x.test, b@x.test` ("Reply-to: enter one valid email address."), subject 256 ("Subject: at most 255 characters."), preview text 256; accepts exactly 100 / 100 / 255 / 255, an empty reply-to, an emoji name of 100 code points (more than 100 UTF-16 units); trims outer spaces; keeps `<script>` in a name as typed; `stillEmpty` gives `["Sender name", "Subject", "Content"]` in that order for an empty draft and `[]` for a full one; `copyName` of a 100-character name stays 100.
- [X] T010 [US1] Supabase Postgres has no public schema on GitHub, so there is no fake to check against a schema: the tests use a real local PostgreSQL 17, and the new code follows Supabase's documentation https://supabase.com/docs/guides/database/connecting-to-postgres (transaction-mode pooler). It copies its limits: no prepared statements (`prepare: false`, unchanged in `src/server/db.ts`), no session state (no `set`, `listen` or session advisory lock), every multi-statement change in one `sql.begin()` transaction, at most 5 connections (`max: 5`). Extend `tests/integration/migrate.test.ts` so it scans `src/server/campaigns/*.ts` for `set `/`listen`/`pg_advisory_lock` and fails on any, checks `migrations/0014_campaigns.sql` has no `begin`/`commit`/`concurrently`/`vacuum`, applies it on a fresh database and checks Postgres's own refusals (23514): a name of 101 characters, a name `' x'` (not trimmed), a `status` `'sent'`, `content_kind 'blocks'` with `html` set, `content_kind 'html'` with no `html`, `blocks` `'[]'` and an array of 51, `html` of 500,001 characters, `merge_links` `'{}'`; and extend `tests/integration/rls.test.ts` if it lists tables by name, so `campaigns` must have RLS on.
- [X] T011 [P] [US1] `tests/integration/campaigns.test.ts` (covers FR-001–FR-004, US1 scenarios 1–5, SC-006, Edge Cases "two users", "deactivated user", "empty draft"): `createCampaign` sets sender name to the user's `users.name`, every other field empty, `version` 1, `updated_by` = creator; `listCampaigns` returns every draft, most recently edited first, with created-by and last-edited names (Alan Fake, deactivated, still named); a save with valid values keeps them and returns version 2 and "Draft saved."; each refusal of T009 leaves the row byte for byte unchanged (compare the row before and after); a save with an old version is refused with `Ada Fake changed this campaign since you opened it. …` and nothing written; a save of a deleted draft gives "This campaign no longer exists."; an empty draft (only a name) saves.
- [X] T012 [P] [US1] `tests/integration/campaign-actions.test.ts` (covers FR-018): with no session, or a deactivated user's session, every action of `src/app/(app)/campaigns/actions.ts` (`createCampaignAction`, `saveCampaignAction`, `duplicateCampaignAction`, `deleteCampaignAction`, `findPreviewPeople`, `previewPerson`) refuses before touching the database (no row created, changed or deleted; no person data returned). Follow the session helpers used by `tests/integration/files-actions.test.ts`.

### Implementation for User Story 1

- [X] T013 [US1] In `src/server/campaigns/rules.ts`: `validateDraft(form)` → `{ ok: true, value } | { ok: false, errors: Record<field, string> }` for `name`, `senderName`, `replyTo` (`isValidEmail(normaliseEmail(x))` from `src/server/records/rules.ts`, stored normalised), `subject`, `previewText`, all trimmed, limits from `CAMPAIGN_LIMITS` in code points, every error at once (research.md §10); `stillEmpty(draft)` using `isEmptyContent` (a local stub returning true for `null` until US3 adds `content.ts`).
- [X] T014 [US1] In `src/server/campaigns/campaigns.ts`: `listCampaigns()` (data-model.md § Lists and reads, `order by c.updated_at desc, c.id desc`), `getCampaignById(id)` (null when gone), `createCampaign(actorId, name)` (validated name; refusal returns the error), `saveCampaign(actorId, id, version, form)` (one `sql.begin()`: `select … for update`; gone → `campaign_gone`; `version` differs → `templates.campaign_edit_conflict(<updated_by user's name>)`; validate; update with `version = version + 1`, `updated_by`, `updated_at = now()`; return new version and last-edited line).
- [X] T015 [US1] `src/app/(app)/campaigns/actions.ts` (`"use server"`): `createCampaignAction` (refusal back to the box with the typed name via `useActionState`; ok → `redirect("/campaigns/<id>")`) and `saveCampaignAction(prev, fd)` (contracts/routes.md § Server actions; reads `id`, `version` with `toId`); each starts with `requireUser()`; `revalidatePath("/campaigns")` after a change.
- [X] T016 [US1] `src/app/(app)/campaigns/page.tsx` (server, `requireUser()`): design A table — Name (link to `/campaigns/<id>`), Subject (cut to 60 with "…", "—" when empty), Status `DRAFT` tag, Created by, Last edited (name · `24 Nov 14:05` style), `[ NEW CAMPAIGN ]` link to `/campaigns?new=1` in the page header; "No campaigns yet." when none; `readFlash(["campaign_deleted", "campaign_gone"])`. `?new=1` (exactly `1`) renders `NewCampaignBox.tsx` (server wrapper + the client form with `useActionState`): Name input (maxLength 100), `[ CREATE ]`, `[ CANCEL ]` link to `/campaigns`, in a box over the page like the activity box.
- [X] T017 [US1] `src/app/(app)/campaigns/[id]/page.tsx` (server, `requireUser()`; id through `toId`, else `notFound()`; gone → `notFound()`) and `[id]/not-found.tsx` ("This campaign no longer exists."). Header: `CAMPAIGN · DRAFT`, the name, "Last edited by <name> · <date time>", `[ SAVE ]` `[ DUPLICATE ]` `[ DELETE ]` (the last two wired in US6). Renders `CampaignEditor.tsx`.
- [X] T018 [US1] `src/app/(app)/campaigns/CampaignEditor.tsx` (client): form id `campaign-form`, controlled `// DETAILS` inputs Name (maxLength 100), Sender name (100), Reply-to (type email, 254), Subject (255), Preview text (255); hidden `id` and `version` (updated from each ok result); `useActionState(saveCampaignAction)`; the header `[ SAVE ]` posts through `form="campaign-form"`; field errors under each input; "Draft saved." after an ok save; "Still empty: " + `stillEmpty(...)` joined by ", " when not empty; typed values kept on refusal (state is never reset from the result). Right column `// PREVIEW FOR` placeholder (filled by US5).
- [X] T019 [US1] `src/app/globals.css`: the two-column edit page (two columns at ≥ 1200 px, one column below), the campaigns table, using existing tokens of `docs/DESIGN.md` only.

**Checkpoint**: drafts can be created, listed, saved and reloaded.

---

## Phase 4: User Story 2 - Personalise with merge tags (Priority: P1)

**Goal**: Tags in subject, preview text, content; "Insert merge tag"; unknown tags listed; custom field tags follow renames.

**Independent Test**: `{{First name | there}}` in the subject and `{{Diet}}` in content kept after save; `{{Favourite colour}}` saved and listed as unknown; rename Diet → its tags show the new name.

### Tests for User Story 2 ⚠️

- [X] T020 [P] [US2] `tests/unit/campaign-merge.test.ts` (covers FR-007–FR-009a, US2 scenarios 1–5, Edge Cases "tags"): `BUILT_IN_MERGE_FIELDS` names and order exactly First name, Last name, Full name, Email, Phone, Organisation, Role, Lead source, LinkedIn, Owner, Labels, with keys `first_name` … `labels`; `mergeFields` appends custom fields as `cf:<id>` in the given order; `parseTags`: `{{First name | there}}` → name "First name", fallback "there"; `{{ first NAME }}` matches First name; `{{ First name|  }}` has no fallback; `{{}}` is a tag with an empty name (unknown); `{{First name` is plain text; `a | b | c` splits on the first `|` only; `resolveTag` order link → built-in → custom → unknown, a dead link → unknown even when a current field has that name; `unknownTags` returns raw tags in first-seen order without repeats; `rewriteNames` turns `{{Diet | none given}}` into `{{Dietary needs | none given}}` and leaves every other character (spacing, `{{ diet|x }}` spacing, unrelated text, HTML) identical; `linksToStore` keeps a dead link while a tag uses its name and drops it when none does; `insertTag` gives `{{First name}}` and `{{First name | there}}`; `validateDraft` refuses a 101-character fallback on a known tag ("If empty, show: at most 100 characters.") and accepts it on an unknown tag.
- [X] T021 [P] [US2] `tests/integration/campaign-merge-links.test.ts` (covers FR-009, FR-009a, US2 scenarios 3–5): with a people custom field "Diet" (create it through `addField` of `src/server/custom-fields/fields.ts` as Ada Fake), save a draft using `{{Diet | none given}}` in the subject, a text block and the HTML (two drafts) → `merge_links` holds `{ field, name: "Diet" }`; rename the field to "Dietary needs" → `getCampaignById` shows `{{Dietary needs | none given}}` in all of them and `listCampaigns` shows it in Subject, while the stored text is unchanged; save again → `merge_links` name becomes "Dietary needs"; delete the field → the tag shows "Diet" and is unknown; a new field named "Diet" does not take the dead tag; changing the tag removes the dead link; a hand-typed `{{diet}}` links to the live field on save; `{{Favourite colour}}` saves and is unknown.

### Implementation for User Story 2

- [X] T022 [US2] Create `src/server/campaigns/merge.ts` (pure, client-safe; research.md §3, §4, §6; contracts/routes.md § Domain functions): `BUILT_IN_MERGE_FIELDS`, `mergeFields`, `parseTags` with regex `/\{\{([^{}]*)\}\}/g` and name offsets, `tagsIn`, `shownLinks`, `rewriteNames`, `resolveTag`, `unknownTags`, `linksToStore`, `insertTag`, `escapeHtml` (`& < > " '`), and `fillText` / `fillHtml` (used by US5). Matching key `trim().toLowerCase()`.
- [X] T023 [US2] In `src/server/campaigns/rules.ts`: the fallback check (≤ 100 code points, only for tags that resolve to a merge field) in `validateDraft`, which now takes the merge fields and shown links.
- [X] T024 [US2] In `src/server/campaigns/campaigns.ts`: `getCampaignById` and `listCampaigns` apply `rewriteNames` to subject, preview text, every text-bearing block field (heading text, text, button label, image alt) and the HTML, with `listFields("person")` from `src/server/custom-fields/fields.ts`, and return `shownLinks`; `saveCampaign` reads the stored links and `listFields("person", tx, …)` inside the transaction, resolves the submitted texts and writes `merge_links = linksToStore(...)` (never taken from the browser).
- [X] T025 [US2] `src/app/(app)/campaigns/MergeTagMenu.tsx` (client): `[ INSERT MERGE TAG ]` opens a list of `mergeFields` (built-ins then people custom fields by current name) and an "If empty, show" input (maxLength 100); inserts `insertTag(...)` at the cursor of the last focused field (subject, preview text, a heading/text/button label/alt input, or the HTML box) and restores focus. Wire it into `CampaignEditor.tsx`, which also shows "Unknown merge tags: " + the list from `unknownTags` (live, over every text) when there is any.

**Checkpoint**: tags save, rename-follow and unknown listing work.

---

## Phase 5: User Story 3 - Build the content from a simple layout (Priority: P1)

**Goal**: Layout chooser, editable blocks with add/remove/reorder, limits and safe addresses.

**Independent Test**: "Text with a button", heading, two paragraphs with a tag, button "Book a seat" → `https://example.test/dinner`, move the button up, save: preview shows that order.

### Tests for User Story 3 ⚠️

- [X] T026 [P] [US3] `tests/unit/campaign-content.test.ts` (covers FR-010, FR-011, US3 scenarios 1–5): `layoutBlocks` gives exactly Blank `[text]`, Text `[heading, text]`, Text with a button `[heading, text, button]`, Newsletter `[image, heading, text, button, divider, text]`; `validateContent` accepts heading 200 / text 10,000 / label 60 / alt 200 / url 2,000 and refuses one more each (`campaign_block_too_long` with the block name and limit), refuses 51 blocks ("A campaign can have at most 50 blocks."), unknown type or extra key (`campaign_content_invalid`), button url `javascript:alert(1)`, `ftp://x`, `example.test` ("Button: enter a web address starting with https://."), image src `http://x.test/a.png` ("Image: …"), accepts `mailto:a@x.test` for a button and an empty url in a draft, turns heading line breaks into spaces; `blocksToHtml` escapes `<b>Fake</b>` typed in heading, text and label (shows as text), keeps text line breaks as `<br>`, turns `https://example.test/x` in text into a link but not inside a heading, keeps `{{First name | there}}` as typed when filled with `keepTags`; `isEmptyContent` true for `null`, `[]`, `"   "`.
- [X] T027 [P] [US3] Extend `tests/integration/campaigns.test.ts` (covers US3 scenario 3, FR-010): blocks saved in a new order come back in that order; a refused block save leaves the stored content unchanged; a save with no blocks stores all three content columns as null.

### Implementation for User Story 3

- [X] T028 [US3] Create `src/server/campaigns/content.ts` (pure, client-safe; research.md §8): `Block` / `Content` types, `BLOCK_LABELS`, `LAYOUTS` (`blank`, `text`, `text_button`, `newsletter`), `newBlock`, `layoutBlocks`, `validateContent(kind, blocksJson, html)` (JSON parse, known types and keys only, limits, `new URL()` schemes `https:` / `http:` / `mailto:`, image `src` `https:` only, empty addresses allowed), `isEmptyContent`, `linkify`, `blocksToHtml(blocks, fill)` (600 px centred column, Arial/Helvetica/sans-serif, inline styles only). Replace the `isEmptyContent` stub of T013.
- [X] T029 [US3] In `saveCampaign` and `saveCampaignAction`: read `contentKind` (`none` / `blocks` / `html`), `blocks` (JSON) and `html`; validate with `validateContent`; normalise empty content to null columns; include block texts in tag resolution (T024).
- [X] T030 [US3] `src/app/(app)/campaigns/BlockList.tsx` (client) and the `// CONTENT · LAYOUT / PASTE HTML` part of `CampaignEditor.tsx`: with empty content, a chooser Blank / Text / Text with a button / Newsletter / Paste HTML; blocks shown in order as cards with the block name, ↑ ↓ `[ REMOVE ]`, inputs with the limits as `maxLength`; `[ + ADD BLOCK ]` with the five types, disabled at 50; the blocks posted as one hidden JSON field `blocks`; block errors shown on the block.
- [X] T031 [US3] `src/app/globals.css`: block cards and the chooser, existing tokens only.

**Checkpoint**: a draft can be written from a layout without HTML.

---

## Phase 6: User Story 4 - Paste HTML content, shown safely (Priority: P1)

**Goal**: Paste HTML, kept as pasted, shown only in the sandboxed frame; switching between layout and HTML.

**Independent Test**: paste HTML with a script, a form, an `onerror` image and a link; save, reload: the box shows it as pasted; the preview runs nothing, sends nothing, links open a new tab.

### Tests for User Story 4 ⚠️

- [X] T032 [P] [US4] Extend `tests/unit/campaign-content.test.ts` (covers FR-012, FR-017, US4 scenarios 2–3, SC-004): `validateContent("html", …)` accepts 500,000 code points and refuses 500,001 ("The HTML can be at most 500,000 characters."); `frameDocument(html, unsubscribe)` starts with exactly `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:"><base target="_blank">` before the content, and the unsubscribe line comes after the content.
- [X] T033 [P] [US4] `tests/unit/campaign-preview-frame.test.ts` (covers FR-017, SC-004): render `CampaignPreview` with `react-dom/server` `renderToStaticMarkup` and HTML containing `<script>document.title='x'</script>`, `<img onerror="alert(1)">`, `<form action="/campaigns"><button>Go</button></form>` and `<a href="https://example.test/">`: the markup has exactly one `<iframe>` whose `sandbox` is exactly `allow-popups allow-popups-to-escape-sandbox` (no `allow-scripts`, `allow-same-origin`, `allow-forms`, `allow-top-navigation`), `referrerpolicy="no-referrer"`, the pasted HTML only inside `srcdoc` (escaped), and nothing of the pasted HTML outside the frame. Also grep-check in the test that no file under `src/app/(app)/campaigns/` uses `dangerouslySetInnerHTML`.
- [X] T034 [P] [US4] Extend `tests/integration/campaigns.test.ts` (covers FR-012, US4 scenario 1, Edge Case "not valid HTML"): HTML with unclosed tags, `\r\n`, leading spaces and `{{Unknown}}` comes back byte for byte after save and `getCampaignById`.

### Implementation for User Story 4

- [X] T035 [US4] In `src/server/campaigns/content.ts`: `frameDocument(contentHtml, unsubscribeHtml)` exactly as research.md §5 and §9 (the unsubscribe line: `<p …>` + `messages.campaign_unsubscribe_line` + ` <a>` + `messages.campaign_unsubscribe` + `</a></p>`, an `<a>` without `href`).
- [X] T036 [US4] `src/app/(app)/campaigns/CampaignPreview.tsx` (client): `<iframe title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc}>`; `doc` updated at most every 300 ms (debounce); before it is set, `openLinksInNewTab(html)` (browser only, `typeof DOMParser !== "undefined"`): `DOMParser` `text/html`, every `a[href]` and `area[href]` gets `target="_blank"` and `rel="noopener noreferrer"`, serialise `documentElement.outerHTML`. Never `dangerouslySetInnerHTML`.
- [X] T037 [US4] In `CampaignEditor.tsx`: the "Paste HTML" mode — a `<textarea>` named `html` (value only, monospace) with the merge tag menu; switching layout → HTML opens an in-page confirmation box (`campaign_switch_to_html`, `[ SWITCH ]` / `[ CANCEL ]`, no `window.confirm`) and starts the box with `blocksToHtml(blocks, keepTags)`; HTML → layout opens a box (`campaign_switch_to_layout`) then shows the layout chooser whose choice replaces the HTML; nothing is stored until `[ SAVE ]`.

**Checkpoint**: pasted HTML is kept and shown safely.

---

## Phase 7: User Story 5 - Preview the email for a person (Priority: P1)

**Goal**: Choose a visible person; the preview fills tags with their values live.

**Independent Test**: Fakey McFake (no organisation), subject `{{First name}}, news for {{Organisation | your team}}` → "Fakey, news for your team"; another person with an organisation shows its name.

### Tests for User Story 5 ⚠️

- [X] T038 [P] [US5] Extend `tests/unit/campaign-merge.test.ts` (covers FR-014, FR-016, US5 scenarios 1, 4, 6, SC-002, SC-003, Edge Cases "no first name", "multiple choice"): with no person every known tag shows `[First name]` (current field name), unknown tags as typed; with values a tag shows the value, an empty one the fallback, else nothing (never `[First name]` or `undefined`); `fillHtml` escapes a value `<b>Fake</b>` and `"` inside an attribute; a fallback is wrapped in the orange tint span in the frame only; filling 500,000 characters with 1,000 tags takes under 200 ms.
- [X] T039 [P] [US5] `tests/integration/campaign-preview.test.ts` (covers FR-015, US5 scenarios 3, 4, 7, SC-003, SC-005, Edge Case "can no longer see"): `previewValues` gives every built-in key for a full person (Full name = first and last; Email and Phone the first by position; Labels joined ", " in person-page order; Owner, Lead source, Organisation names) and every custom type formatted as `formatValue` ("Vegan, Halal", "24 Nov 2026", "£1,200", "No" for Yes/No false), and `null` for empty fields; returns `null` for Linus Fake's private person asked by Margaret Fake (admins included: Grace Fake too) and for an archived person; `searchPreviewPeople` matches part of a name or an email, case-insensitive, `%` and `_` typed literally, never a hidden or archived person, at most 20 of 25 matches; a blank or 101-character query gives `[]`; no column of `campaigns` stores a person.

### Implementation for User Story 5

- [X] T040 [US5] Create `src/server/campaigns/preview.ts` (research.md §6, §7): `searchPreviewPeople(viewerId, query)` (one query, `visiblePerson(sql, viewerId)`, `archived_at is null`, name or any `person_emails.email` `ilike` with `escapeLike`, ordered by name then id, `limit 20`, `{ id, name, detail }` with detail = organisation name · first email) and `previewValues(viewerId, personId)` (`getPerson` from `src/server/records/people.ts`, `null` when not found or archived; the key map; custom values through `formatValue` only when a value exists; empty strings → `null`).
- [X] T041 [US5] In `actions.ts`: `findPreviewPeople(query)` and `previewPerson(personId)` (each `requireUser()` first); `saveCampaignAction` also returns `preview` for the posted `previewPersonId` (or `null`).
- [X] T042 [US5] `src/app/(app)/campaigns/PreviewPersonPicker.tsx` (client): text box under `// PREVIEW FOR`, calls `findPreviewPeople` 250 ms after typing stops, lists name and detail, choosing calls `previewPerson`; the chosen person lives only in client state (not posted except as `previewPersonId` for the refresh, never stored).
- [X] T043 [US5] In `CampaignPreview.tsx` / `CampaignEditor.tsx`: above the frame "From: <sender name>", "Reply-to: <address>" (only when set), the subject and the preview text as React text nodes through `fillText`; the content through `blocksToHtml(blocks, fill)` or `fillHtml(html, …)`, then `frameDocument`; "Unknown merge tags: …" under the preview too; when `previewPerson` (or a save's `preview`) returns `null`, drop the values and show "Choose a person to preview."; with no person chosen, `[Field name]` placeholders.
- [X] T044 [US5] `src/app/globals.css`: the preview pane (white email area, the From / Reply-to lines, the tint), existing tokens only.

**Checkpoint**: the preview shows the email for a chosen, visible person.

---

## Phase 8: User Story 6 - Duplicate and delete drafts (Priority: P2)

**Goal**: `[ DUPLICATE ]` and `[ DELETE ]` from the Campaigns page and the edit page.

**Independent Test**: duplicate "Exec dinner – March (fake)" → "Copy of …" opens with the same fields; delete the copy after the confirmation; it is gone.

### Tests for User Story 6 ⚠️

- [X] T045 [P] [US6] Extend `tests/integration/campaigns.test.ts` (covers FR-005, FR-006, US6 scenarios 1–3, Edge Case "100 characters"): Margaret Fake duplicates Ada Fake's draft → "Copy of <name>" (cut to 100) with the same sender name, reply-to, subject, preview text, content and `merge_links`, `created_by` and `updated_by` Margaret, version 1, original unchanged (and unsaved changes are not copied: only the stored row); any user deletes any draft; duplicate, delete and save of a deleted draft give `campaign_gone` and change nothing.

### Implementation for User Story 6

- [X] T046 [US6] In `campaigns.ts`: `duplicateCampaign(actorId, id)` (one `insert … select` from the stored row, `name = copyName(name)`) and `deleteCampaign(actorId, id)` → `{ ok: true, name } | { ok: false, code: "campaign_gone" }`.
- [X] T047 [US6] In `actions.ts`: `duplicateCampaignAction` (ok → `redirect("/campaigns/<new id>")`; gone → flash `campaign_gone`, `redirect("/campaigns")`) and `deleteCampaignAction` (flash `campaign_deleted` with the name from the database, or `campaign_gone`; `redirect("/campaigns")`), each `requireUser()` first.
- [X] T048 [US6] `src/app/(app)/campaigns/CampaignDeleteConfirm.tsx` (server, like `records/DeleteConfirm.tsx`): a box over the page with `templates.campaign_delete_confirm(name)`, `[ DELETE FOR GOOD ]`, `[ CANCEL ]`. Shown on `/campaigns?delete=<id>` (id through `toId`, unknown id → no box) and `/campaigns/<id>?delete=1`; row buttons `[ DUPLICATE ]` (form) and `[ DELETE ]` (link) on the Campaigns table; header `[ DUPLICATE ]` (form posting only the id) and `[ DELETE ]` (link to `?delete=1`) on the edit page.

**Checkpoint**: all six stories work.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T049 [P] Fake data `src/seed/campaigns.ts` (research.md §13, data-model.md § Fake data), registered last in `src/seed/index.ts` with a `// SF-119` comment: "Exec dinner – March (fake)" (Text with a button, `{{First name | there}}`, `{{Organisation | your team}}`, button `https://example.test/dinner`), "Welcome note (fake)" (Blank), "Event recap (fake)" (Text, `{{Diet (fake) | not given}}` with its `merge_links` entry looked up by name; skipped when the field is missing), "Newsletter – winter (fake)" (Newsletter, image `https://example.test/winter.png`), "Pasted HTML sample (fake)" (HTML with `<script>document.title='Changed (fake)'</script>`, `<img src="x" onerror="alert('fake')">`, a form and a link to `https://example.test/`); created by the seeded fake users; each inserted only when no campaign has that name.
- [X] T050 [P] Extend `tests/integration/seed.test.ts` (covers FR-021): seeding twice adds the five drafts once; one per layout, one with HTML containing `<script>`, one with a `merge_links` entry for "Diet (fake)".
- [X] T051 [P] Append to `docs/DECISIONS.md` the three choices people made (spec.md § Clarifications, Session 2026-11-24), one line each, exactly as plan.md Build step 13 words them, ending `(SF-119)`; do not add the factory's "Plan 2026-11-24" choices.
- [X] T052 [P] Add a `docs/DECISIONS.md (SF-119)` block to `tests/unit/decisions.test.ts` checking those three lines (design A, shared drafts, tags follow renames).
- [X] T053 [P] Update `AGENTS.md` § Layout: `src/server/campaigns/` (`merge.ts`, `content.ts`, `rules.ts` pure and client-safe; `campaigns.ts`; `preview.ts`) and `src/app/(app)/campaigns/` (pages, actions, `CampaignEditor.tsx`, `BlockList.tsx`, `MergeTagMenu.tsx`, `PreviewPersonPicker.tsx`, `CampaignPreview.tsx`: the sandboxed frame), one entry each in the style of the others; mention `next.config.ts` `bodySizeLimit` in the README if it lists settings.
- [X] T054 [P] Check `src/app/(app)/campaigns/` against `docs/DESIGN.md` and design A of `design-options.html`: `// ` section labels, `[ … ]` buttons, the DRAFT tag, header buttons, two columns.
- [ ] T055 Run `npm test && npm run typecheck` with `APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test`; fix every failure; keep the complete failure output in the report when something cannot be fixed.
- [X] T056 Confirm nothing outside the plan changed: `git diff --stat main` shows no `package.json` / `package-lock.json` change (dependencies.json is `[]`).
- [X] T057 Confirm `grep -rn "dangerouslySetInnerHTML\|allow-scripts\|allow-same-origin\|allow-forms\|allow-top-navigation" src/app/\(app\)/campaigns` finds nothing.
- [X] T058 Confirm no text from a URL is shown: `new` and `delete` parameters read only as `1` / an id in `src/app/(app)/campaigns/page.tsx` and `[id]/page.tsx`.
- [X] T059 Run the quickstart.md § Automated checks list and tick each file as present with its `// covers` line.
- [X] T060 Write the test recipe `.factory/test-env.md`: a `## Services` line for each outside service (its fake, its schema) — keep Google Sign-In and Supabase Storage as they are and extend the Supabase Postgres line: no fake, a real local PostgreSQL 17, no public schema on GitHub, follows https://supabase.com/docs/guides/database/connecting-to-postgres, and the SF-119 code (`src/server/campaigns/`) keeps to the same pooler limits (no `set`/`listen`/session advisory lock, one `sql.begin()` per change) with its table from `migrations/0014_campaigns.sql`, applied on a fresh database by `tests/integration/migrate.test.ts` — and `## Schemas` (each schema's GitHub URL at its commit: the existing entries unchanged, nothing added); also describe the five fake campaign drafts in the seed line, and note for the AI review how to check the sandbox in a browser (quickstart.md § By hand, step 4).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none; T001 first, T002–T005 in parallel after it.
- **Foundational (Phase 2)**: after Setup; blocks every story.
- **US1 (Phase 3)**: after Foundational — the MVP.
- **US2 (Phase 4)**: after US1 (editor and save exist).
- **US3 (Phase 5)**: after US1; T029 after T024 (US2) because block texts join tag resolution.
- **US4 (Phase 6)**: after US3 (content kinds, `blocksToHtml`).
- **US5 (Phase 7)**: after US2 (`fillText` / `fillHtml`) and US4 (`CampaignPreview`, `frameDocument`).
- **US6 (Phase 8)**: after US1 only; can run beside US2–US5.
- **Polish (Phase 9)**: after every story; T060 is the last task.

### Within Each User Story

Tests first (they fail), then pure modules, then database code, then actions, then pages and client components.

### Parallel Opportunities

- T002–T005 (different files).
- In each story the `[P]` test tasks.
- US6 beside US2–US5 once US1 is done.
- T049–T054 in Polish.

## Parallel Example: User Story 1

```text
Task: "T009 tests/unit/campaign-rules.test.ts"
Task: "T011 tests/integration/campaigns.test.ts"
Task: "T012 tests/integration/campaign-actions.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

Phases 1–3: drafts can be created, listed, saved with every check. Stop and validate with T009–T012.

### Incremental Delivery

US1 → US2 (tags) → US3 (layouts) → US4 (pasted HTML, safe frame) → US5 (preview for a person) → US6 (duplicate, delete) → Polish. Each story adds to the same edit page without breaking the previous one.

## Notes

- Choices made here without asking: US5 (P1) comes after US4 because its preview frame is built in US4 and its fill
  functions in US2; US6 (P2) is last but only needs US1; the Supabase Postgres task (T010) sits in US1, the first story
  whose code writes the new table; the seed is in Polish because it needs every story's code; the test recipe T060 is
  the last task.
- The sandbox itself (scripts not running, forms not sending) can only be seen in a browser: the repo tests check the
  frame's attributes and document; the AI review checks the behaviour (DECISIONS 2026-11-23).

## Fix round 1 (AI review 2026-11-24)

- [ ] T061 [P] Write the failing tests first. (a) `tests/integration/campaign-merge-links.test.ts`, new case `// covers
  FR-009a, US2 scenario 5, Edge case "renamed and then deleted"`: save a draft with `{{Diet | none given}}` in the
  subject, a text block and pasted HTML; `updateField` renames it "Dietary needs"; `deleteField` deletes it with no save
  in between; `getCampaignById` shows `{{Dietary needs | none given}}` in all three, `unknownTags` lists it, the stored
  texts are unchanged and the row's `version` is unchanged; a save after that stores `name` "Dietary needs" and the tag
  still reads as unknown; a draft that never used the field keeps its `merge_links` as they were. It fails now (it shows
  "Diet"). (b) `tests/unit/campaign-merge.test.ts`: `shownLinks` uses the live name, else `last`, else `name`;
  `rewriteNames` with `{ field, name: "Diet", last: "Dietary needs" }` and no live field turns `{{diet|x}}` into
  `{{Dietary needs|x}}`. (c) new `tests/unit/campaign-editor-form.test.ts` `// covers US1 scenario 4, FR-019, Edge
  case "Reply-to that is not an email address"`: render `CampaignEditor` with `renderToStaticMarkup` (as
  `campaign-preview-frame.test.ts` renders the preview) and check the `<form id="campaign-form"` tag has `novalidate`;
  render the Campaigns page row (or read `page.tsx` markup) and check the Status cell text is "Draft". Each fails now.
- [ ] T062 Add `noValidate` to `#campaign-form` in `src/app/(app)/campaigns/CampaignEditor.tsx` (plan.md § Fix round 1,
  item 1).
- [ ] T063 Keep a deleted field's last name: `StoredLink` gains `last?: string` and `shownLinks` uses live name → `last`
  → `name` in `src/server/campaigns/merge.ts`; in `deleteField` (`src/server/custom-fields/fields.ts`), for a `person`
  field, in the same transaction, add `"last"` with the field's name to each `campaigns.merge_links` entry of that field,
  without changing `version`, `updated_by` or `updated_at`; update `data-model.md` § Link (plan.md § Fix round 1,
  item 2).
- [ ] T064 Show `messages.campaign_status_draft` in the Campaigns page Status column and the edit page header; remove
  the unused `messages.campaign_draft` (plan.md § Fix round 1, item 3).
- [ ] T065 Run `npm test && npm run typecheck`; T061's tests pass and nothing else breaks.
