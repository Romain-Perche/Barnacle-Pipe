# AGENTS.md

How to work on this repo. Setup, commands and settings are in `README.md`. Product rules are in
`docs/PRODUCT.md`, the look in `docs/DESIGN.md`, team choices in `docs/DECISIONS.md`: follow them.

## Stack

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript, Postgres through `postgres` (postgres.js,
plain SQL, no ORM), plain CSS (`src/app/globals.css`), fonts from `geist`. No auth library: own Google
OAuth code flow and database sessions.

## Layout

- `src/app/(app)/` — every signed-in page (design B sidebar layout). `nav.ts` is the sidebar registry.
- `src/app/sign-in`, `src/app/auth/*`, `src/app/dev/fake-google` — public sign-in pages and routes.
- `src/server/` — domain code, tested without the UI: `auth/rules.ts` (pure rules), `auth/session.ts`
  (`requireUser`, `requireAdmin`, `assertAdminForAction`), `auth/sign-in.ts`, `auth/google.ts`,
  `users.ts`, `env.ts` (`isFakeAllowed`, `isPreview`), `messages.ts` (every user-facing message; `templates` for
  messages built from a database name). `records/`: people, organisations, lead sources and labels —
  `rules.ts` and `list-query.ts` (pure), `visibility.ts` (the one private rule — creator or owner: every `persons` read uses
  `visiblePerson()`; `visibleDeal()` beside it: every `deals` read uses it), `handover.ts` (hand a deactivated user's private people and private deals, archived included, to an active user), `people.ts`, `organisations.ts`, `choices.ts`, `timeline.ts`, `flash.ts` (one-shot notice after a delete, a hand-over or losing sight of a person or deal; `src/proxy.ts` drops its cookie on the next page load), `form-data.ts`.
  `deals/`: pipelines, stages and deals — `rules.ts` (pure: money in pence, validation, board address, stage bar, lost
  reason, `back`), `deals.ts` (board of open deals, deal, add/edit/move/archive/restore/delete, Won/Lost/Reopen, stage
  seconds; `transferDeal` records every stage move), `list.ts` (the deal list: rows, count and total, filter options),
  `links.ts` (other linked people, followers), `pipelines.ts` (admin changes).
- `src/app/(app)/records/` — UI shared by people, organisations and deals (forms, pickers, drawer, timeline, filter row).
  `records/import/`: the CSV import screens shared by `/people/import` and `/organisations/import` (`ImportPages.tsx`:
  the four steps; `FileStep.tsx`: the only client part, sends the file in 512 KiB parts; `actions.ts`; `example.ts`).
- `src/app/(app)/deals/` — the board (`Board.tsx`: native drag and drop), deal drawer and forms, `list/` (the deal
  list), `[id]/` (the deal page: `StageBar.tsx`, `LostBox.tsx`, `not-found.tsx`), `ViewSwitch.tsx` (Board / List);
  `src/app/(app)/admin/pipelines/` — the Pipelines admin pages.
- `src/server/imports/` — CSV import (SF-103): `csv.ts` (reading the file), `columns.ts` (fields, suggestions, mapping
  checks, example files), `rows.ts` (a row through `validatePerson`/`validateOrganisation`), `plan.ts` (what an import
  will do: duplicates, organisations, lists, owners, consent), `text.ts` (reasons and warnings) are pure; `imports.ts`
  (table `csv_imports`: upload in parts, columns, preview, `runImport` in one transaction locking `organisations` and
  `person_emails`, bulk inserts).
- `src/seed/` — fake data; `index.ts` is the seeder registry (users, people, deals).
- `migrations/` — numbered SQL files, applied by `scripts/migrate.ts`.
- `scripts/fetch-schemas.mjs` (`npm run test:schemas`, before `npm test`: pinned Google schema) and
  `scripts/start-isolated.mjs` (browser tests start the app without the developer's `.env*` files).
- `tests/unit`, `tests/integration` (Vitest, real Postgres), `tests/e2e` (Playwright), `tests/fakes` (outside services only), `tests/fixtures/csv` (fake CSV files),
  `tests/support/reset.ts` (empties every app table; lead sources back to the six starting ones).

## Rules

- Server components by default; a client component only where the browser is needed.
- Every signed-in page calls `requireUser()`/`requireAdmin()`; every server action calls `requireUser()` or
  `assertAdminForAction()` first. Never rely on hidden links alone.
- User-facing text comes from `src/server/messages.ts`; never show text taken from a URL. Redirect
  targets go through `isSafeNext(next, appBaseUrl())`.
- Migrations: only statements allowed in a transaction; `alter table … enable row level security` after
  every `create table` (no policies). Never run migrations at app start.
- The fake Google login and fake data only work when `isFakeAllowed()` is true. Fake data uses
  clearly fake names, never the real team.
- No secrets in the repo; every setting is listed in `.env.example` and the README.

## Tests

```bash
export APP_ENV=test DATABASE_URL=postgres://postgres@localhost:5432/crm_test
npm test && npm run test:e2e && npm run typecheck
```

Each test names what it covers (`// covers FR-003, US1 scenario 2`). Fakes only for outside services
(Google Sign-In: `tests/fakes/google.ts`, checked against its schema; see `.factory/test-env.md`).

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

Use the repository's documented maintenance process to refresh generated pages after source changes. Check its configuration and completed runs before relying on automatic updates. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
