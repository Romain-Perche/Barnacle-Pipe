# Implementation Plan: Notification count updates while navigating

**Branch**: `factory/sf-108-notification-count-updates-while-navigat` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-108-notification-count-updates-while-navigat/spec.md`

## Summary

The sidebar's "Notifications (n)" is worked out in `src/app/(app)/layout.tsx`. In Next.js 16 a shared layout is not
re-rendered on client navigation (partial rendering: only the segments that change are fetched), and back/forward
restores pages from the client cache without asking the server (research.md §1). So the count only changes on a full
load or after an action that revalidates the layout.

Fix, with no new dependency and no database change:

1. The Notifications link moves out of the layout into a **parallel route slot `@unread`** of the `(app)` layout whose
   pages are a catch-all. A slot's leaf page is rendered by the server on every navigation, including a click on the
   link of the page already open, a link inside a page and the redirect after a form (research.md §2). The slot page
   calls `requireUser()` and `unreadCount()` and renders the same `SidebarLink` as today.
2. A tiny client component **`RefreshOnHistory`** in the layout calls `router.refresh()` on the browser's `popstate`
   (back and forward), so the restored page and its sidebar are brought up to date from the server (research.md §3).

Everything else in the sidebar (highlight, admin links, name, `[ Sign out ]`) stays in the layout, unchanged.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24 LTS (unchanged)

**Primary Dependencies**: Next.js 16.4.6 (App Router parallel routes, `useRouter().refresh()`), React 19.3 — already in
the repo. Nothing added or upgraded (`dependencies.json` is `[]`).

**Storage**: PostgreSQL, unchanged. No migration. The existing `unreadCount(userId)` query (one indexed query,
`note_mentions_unread_idx`) now runs once per navigation instead of once per full load.

**Testing**: Playwright (FR-007: two browser contexts, Ada mentions Bob while Bob has a page open; Bob's count after a
sidebar link, a link inside a page, the same-page sidebar link, a note save, back and forward, with no full reload).
Vitest: no new pure logic; existing `unreadCount` integration tests stay as they are.

**Target Platform**: Vercel serverless functions (Node runtime); desktop browsers.

**Project Type**: Web application (single Next.js project, server-rendered).

**Performance Goals**: FR-006 — navigation stays a client-side transition; the extra cost is one `unreadCount` query
inside the request Next already makes for the new page (no extra round trip). Back/forward costs one `router.refresh()`
request (accepted, research.md §3).

**Constraints**: AGENTS.md rules: server components by default (the slot pages are server components; only
`RefreshOnHistory` is a client component, it needs `window`); every signed-in page calls `requireUser()` (the slot
pages do too); user-facing text from `src/server/messages.ts` (`templates.notifications_label`, unchanged).

**Scale/Scope**: 3 new files under `src/app/(app)/@unread/`, 1 new client component, `layout.tsx` edited; 1 new e2e spec.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: no ratified principles to gate on. The gates applied
are the repo's own rules (AGENTS.md, docs/PRODUCT.md, docs/DECISIONS.md):

| Gate | Status |
|------|--------|
| Server components by default; client only where the browser is needed | PASS — only `RefreshOnHistory` (listens to `popstate`) |
| Every signed-in page calls `requireUser()` | PASS — the `@unread` pages call it before reading the count |
| User-facing text from `messages.ts`, nothing taken from a URL | PASS — the catch-all `path` param is never read or shown |
| Migrations rules | N/A — no migration |
| No secrets, settings listed | N/A — no new setting |
| Tests name what they cover | Planned — `// covers SF-108 FR-001, FR-007, US1 scenarios 1–3, …` |

Post-design re-check: PASS (no change).

## Project Structure

### Documentation (this feature)

```text
specs/sf-108-notification-count-updates-while-navigat/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1 (no data change)
├── quickstart.md        # Phase 1
├── contracts/sidebar.md # Phase 1: the sidebar's count contract
├── dependencies.json    # []
└── blueprints.json      # [] (from Specify; no blueprint index in this run)
```

### Source Code (repository root)

```text
src/app/(app)/
├── layout.tsx                 # EDIT: takes the `unread` slot; drops unreadCount(); renders <RefreshOnHistory />
├── RefreshOnHistory.tsx       # NEW client component: popstate → router.refresh()
├── UnreadLink.tsx             # NEW server component: requireUser() + unreadCount() → <SidebarLink …/>
├── @unread/
│   ├── page.tsx               # NEW: matches "/"           → <UnreadLink />
│   ├── [...path]/page.tsx     # NEW: matches every other URL → <UnreadLink />
│   └── default.tsx            # NEW: fallback on a full load → <UnreadLink />
├── nav.ts                     # EDIT: comment only (the Notifications item is rendered by the @unread slot)
└── SidebarLink.tsx            # unchanged
tests/e2e/
└── notification-count.spec.ts # NEW (FR-007)
```

**Structure Decision**: single Next.js project, as before. The change stays inside the `(app)` route group.

## Implementation steps (for Build)

1. **`src/app/(app)/UnreadLink.tsx`** (server component, no `"use client"`):
   `export async function UnreadLink() { const user = await requireUser(); const n = await unreadCount(user.id);
   return <SidebarLink href="/notifications" label="Notifications" count={n} />; }`. Take `href`/`label` from the
   `mainNav` entry whose `href === "/notifications"` so the registry stays the one source of the label.
   `requireUser()` is wrapped in React `cache` per request, so calling it in the slot and in the page costs one session
   lookup.
2. **`src/app/(app)/@unread/page.tsx`**, **`@unread/[...path]/page.tsx`**, **`@unread/default.tsx`**: each
   `export default function X() { return <UnreadLink />; }` (the catch-all ignores its `params`; never read it).
   Together they match every URL under `(app)`, including `/[...missing]` and pages that call `notFound()`.
3. **`src/app/(app)/layout.tsx`**: signature `AppLayout({ children, unread }: { children: React.ReactNode; unread:
   React.ReactNode })`. Remove the `unreadCount` import and call. In the `mainNav.map`, render `unread` in place of the
   item whose `href === "/notifications"` (wrap in a keyed `<Fragment>`), and plain `<SidebarLink {...item} />` for the
   others. Keep the order of the links, `export const dynamic = "force-dynamic"`, the admin group and the `.me` block
   exactly as they are. Add `<RefreshOnHistory />` once inside `.shell`.
4. **`src/app/(app)/RefreshOnHistory.tsx`** (`"use client"`): `useEffect` adds a `popstate` listener that calls
   `router.refresh()` (from `useRouter()` of `next/navigation`) and removes it on unmount; renders `null`.
5. **`src/app/(app)/nav.ts`**: update the SF-102 comment: the Notifications link and its count are rendered by the
   `@unread` slot (`UnreadLink.tsx`) so the count is fresh on every navigation (SF-108).
6. Keep `revalidatePath("/", "layout")` in `notifications/actions.ts` and `records/note-actions.ts` (harmless, and it
   still clears the client cache after Bob's own actions).
7. **`tests/e2e/notification-count.spec.ts`**: reuse `resetAndSeed`, `signInAs`, `sidebar`, `insertDeal`, `addNote`
   (or insert the mention via `db()` for speed where the UI path is already covered by `mentions.spec.ts`). Prove "no
   full reload" by setting a marker on `window` (`await page.evaluate(() => (window as any).__noReload = 1)`) before
   navigating and checking it is still there after. Scenarios: sidebar link; same-page sidebar link; link inside a page
   (people list → person); note save by Bob (US2-3); count going down after the note is deleted (US1-4) and the record
   made private (US1-5: no badge, name "Notifications"); `[ MARK ALL AS READ ]` (no badge); back and forward (US3);
   deleted deal's not-found page shows the current count; 13 unread shows "13".
8. **`AGENTS.md` Layout section**: one phrase that the sidebar count lives in the `@unread` slot (`UnreadLink.tsx`)
   and `RefreshOnHistory.tsx` refreshes on back/forward (SF-108).

No blueprint exception, so no `docs/DECISIONS.md` line is required.

## Outside services

- Supabase Postgres (through the Supavisor connection pooler): no public schema found on GitHub (looked in github.com/supabase/supavisor at commit e59909dc629230a4c07af3df16957ef22a184774, which only has an OpenAPI test for its own management API, and github.com/supabase/supabase, during SF-90 and SF-93; the app speaks the standard Postgres protocol, this change only reads the existing `note_mentions` count from the app's own database, and tests use a real local Postgres rather than a fake)

No other outside service: the change is routing and rendering inside the app.

## Complexity Tracking

No violation to justify.

## Fix round 1

**Problem** (AI review): the design changed during Build, but the feature documents still describe the first design.
`research.md` §2 records the change. `plan.md` (Summary, Performance Goals, Constraints, Scale, Gates, Source Code,
Implementation steps 1–3, 5, 8), `contracts/sidebar.md` (table rows "at that navigation's request", "Routing pieces")
and `data-model.md` ("by the `@unread` slot") still describe the `@unread` parallel-route slot. `tasks.md` marks T002,
T003, T015 (and the slot parts of T008, T016, T021) as done although they were not built as written.

**Cause**: Build found that the slot does not work in Next.js 16.4.6 (the client router kept an old slot subpage, so
the count was stale; research.md §2 "Changed during Build"). Build then built the rejected alternative, a client
`UnreadLink.tsx` with the read-only server action `currentUnread()`, and updated only `research.md`.

**Fix**: documents only, no app code and no test change. The documents follow what was built:

- The layout still computes `unreadCount()` and gives it to the client `UnreadLink` as `initial`, with a new `key` on
  each layout render (full load, `router.refresh()`, `revalidatePath` always win).
- `UnreadLink` (client) calls `currentUnread()` (`src/app/(app)/notifications/actions.ts`: `requireUser()` first,
  read only, FR-004) when the path or query changes, and on a click on a link to the page already open (an in-page
  `#` link also asks again: harmless, one extra read). A reply older than the latest request is dropped.
- Cost (FR-006 still met, no reload): one small POST per navigation, sent after the new page shows. For that moment
  the old count can show. The plan's "no extra round trip" claim no longer holds.
- `RefreshOnHistory` (back/forward) is unchanged.

Files to change (all under this feature folder): `plan.md` (the sections above; keep a one-line note that the slot
was planned and dropped, pointing to research.md §2), `contracts/sidebar.md`, `data-model.md`, `tasks.md` (reword
T002, T003, T008, T015, T016, T021 to what was built, each with "(changed during Build: see research.md §2)"),
`quickstart.md` (note in step 2 that the count can change a moment after the page shows). `spec.md` stays as it is:
what the user gets does not change. `dependencies.json` stays `[]`.
