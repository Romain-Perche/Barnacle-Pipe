# Quickstart: validating Campaigns: writing the content (SF-119)

## Prerequisites

Local Postgres as in `README.md`; `npm install` done.

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm run db:migrate          # applies 0014_campaigns.sql
npm test && npm run typecheck
```

## Automated checks (Build writes these; each names what it covers)

Unit (`tests/unit/`, pure, no database):
- `campaign-merge.test.ts` — grammar and edge cases (`{{}}`, unclosed, empty fallback, case and spaces), built-in order,
  `resolveTag` with live/dead links, `rewriteNames` changes only name characters, `unknownTags`, `fillText` / `fillHtml`
  for no person / value / fallback / nothing, markup in values escaped, 500,000 characters with 1,000 tags filled in
  under 200 ms (US2, US5, FR-007–FR-009a, FR-016, SC-002, SC-003).
- `campaign-content.test.ts` — layouts, block limits, 50 blocks, address schemes, markup in blocks escaped, linkify,
  `blocksToHtml` keeping tags, `frameDocument` (CSP meta and `<base target="_blank">` first), empty content (US3, US4).
- `campaign-rules.test.ts` — every field limit and message, code-point counting, `stillEmpty`, `copyName` at 100 (US1,
  US6, SC-006).
- `nav.test.ts` (existing) — Campaigns after Activities. `messages` tests — new codes exist.

Integration (`tests/integration/`, real Postgres):
- `campaigns.test.ts` — create (sender = user's name), list order and columns with a deactivated creator, save and
  reload, every refusal leaves the row unchanged, version conflict names the first editor, gone draft, duplicate,
  delete (US1, US6, FR-001–FR-006, SC-006).
- `campaign-merge-links.test.ts` — rename "Diet" → "Dietary needs" rewrites subject, block and HTML tags on open and
  the list's Subject; deleting the field keeps the last name and makes it unknown until changed; a hand-typed tag links
  on save (US2 scenarios 3–5).
- `campaign-preview.test.ts` — `searchPreviewPeople` (visible, not archived, name or email, ≤ 20) and `previewValues`
  (every built-in and custom type formatted as on the person page; empty → null; private person of another user and
  archived person → null) (US5, FR-015, SC-003, SC-005).
- `campaign-actions.test.ts` — every action refuses without a session (FR-018).
- `migrate.test.ts` / RLS test (existing) — `campaigns` has RLS on. `seed.test.ts` (existing) — seeding twice adds the
  five drafts once (FR-021).

The sandbox behaviour (FR-017) is proved by unit tests of the frame document and a test that `CampaignPreview.tsx`
renders an `<iframe>` whose `sandbox` is exactly `allow-popups allow-popups-to-escape-sandbox` (render to string with
`react-dom/server`), plus the AI review in a browser (DECISIONS 2026-11-23: no browser tests in the repo).

## By hand (AI review)

```bash
export APP_ENV=development
npm run db:seed && npm run dev   # sign in through the fake Google login
```

1. Sidebar → Campaigns: the seeded drafts, newest edit first. `[ NEW CAMPAIGN ]` → name "Exec dinner – April (fake)" →
   the edit page with your name as sender.
2. Choose "Text with a button", subject `{{First name}}, news for {{Organisation | your team}}`, a button
   `javascript:alert(1)` → refused with "Button: enter a web address starting with https://.".
3. `// PREVIEW FOR` → type "Fakey" → choose Fakey McFake: subject reads "Fakey, news for your team"; type in the text
   block and watch the preview follow.
4. Open "Pasted HTML sample (fake)": no alert, the tab title stays, the form's button does nothing, the link opens a new
   tab, the sidebar keeps its colours.
5. As an admin rename the custom field "Diet (fake)"; reopen "Event recap (fake)": the tag shows the new name.
6. Open the same draft in two tabs, save in both: the second is refused naming you. Duplicate, then delete the copy.
