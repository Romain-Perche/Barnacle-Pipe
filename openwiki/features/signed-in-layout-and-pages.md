---
type: feature
title: Signed-in layout, pages and messages
description: The sidebar shell shared by every signed-in page, the nav registry, the home, forbidden and not-found pages, the sign-in page's states, and the single catalogue of user-facing messages.
tags: [ui, layout, navigation, messages, sign-in-page]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T17:53:35.777Z
sources:
  - id: openwiki-source-9c37e70856dfc7e98b60d790
    resource: repo://src/app/(app)/%5B...missing%5D/page.tsx
  - id: openwiki-source-55416ab6e4db28879c533a75
    resource: repo://src/app/(app)/layout.tsx
  - id: openwiki-source-ba467561895df40c1767967f
    resource: repo://src/app/(app)/nav.ts
  - id: openwiki-source-6e6147c60d91cff3c0050f23
    resource: repo://src/app/(app)/not-found.tsx
  - id: openwiki-source-069fcc27db1b076d635470f8
    resource: repo://src/app/(app)/notifications/actions.ts
  - id: openwiki-source-8407c3e3ac340b23e3472777
    resource: repo://src/app/(app)/RefreshOnHistory.tsx
  - id: openwiki-source-d4ce59a55777f00d30143744
    resource: repo://src/app/(app)/UnreadLink.tsx
  - id: openwiki-source-ed3f6cf4c5684edf2049ee88
    resource: repo://src/server/format.ts
  - id: openwiki-source-c952f67a81bc8f97643c325b
    resource: repo://src/server/messages.ts
  - id: openwiki-source-8bf427df8e393c62d99adf6b
    resource: repo://src/server/sign-in-page.ts
generated: { by: "claude-code", at: "2026-11-24T17:53:35.777Z" }
---

# Signed-in layout, pages and messages

## The `(app)` shell (design B)

Every signed-in page lives under `src/app/(app)/` and gets `layout.tsx`:

- a blue left sidebar with the Barnacle wordmark (`src/app/Wordmark.tsx`);
- the **Main** nav from `mainNav` in `nav.ts` (today `Home`, `Deals`, `People`, `Organisations`, `Ambassadors` (the [Ambassadors](people-and-organisations.md#ambassadors-and-referrals) page), `Activities` (the [Activities](activities.md) list), `Campaigns` (the [Campaigns](campaigns.md) page) and `Notifications`, which shows the user's unread mention count: `layout.tsx` gives the start value and `UnreadLink.tsx` keeps it current, see below);
- an `// ADMIN` group with `adminNav` (today `Users`, `Lead sources and labels`, `Pipelines` and `Custom fields` (see [Custom fields](custom-fields.md)), rendered only when the user's role is `admin`;
- the user's name and a `[ Sign out ]` button (the `signOut` server action, see
  [Sessions and access control](../auth/sessions-and-access-control.md)).

The layout calls `requireUser()` and sets `dynamic = "force-dynamic"`, so every signed-in page is
rendered per request, previews included. `SidebarLink.tsx` uses `usePathname()` to mark the current link
with `aria-current="page"`.

### Unread count on client navigation (SF-108)

The layout is not rendered again on client navigation, so the count would go stale. `UnreadLink.tsx`
(client) wraps `SidebarLink` for `/notifications`: after every navigation, or a click on a link to the page
already open, it calls the read-only `currentUnread` server action (`notifications/actions.ts`, behind
`requireUser()`) and drops replies older than the newest request. The layout gives the link a fresh `key` on each
render, so its own count always wins as the start value. `RefreshOnHistory.tsx` (client) calls
`router.refresh()` on back/forward. Opening a page never marks anything read. Data flow:
[DATAFLOW.md](../../dataflow/DATAFLOW.md).

The look follows `docs/DESIGN.md` (cream surface, electric blue, signal orange, monospace labels);
styles are in `src/app/globals.css` and fonts are Geist (`src/app/layout.tsx`).

## Pages

| Route | File | Notes |
|---|---|---|
| `/` | `(app)/page.tsx` | "Hello, <first name>" landing page until a later feature replaces it. |
| `/admin/users` | `(app)/admin/users/page.tsx` | See [User management](./user-management.md). |
| any other path | `(app)/[...missing]/page.tsx` | Calls `requireUser()` then `notFound()`, so unknown addresses show "Page not found." inside the shell (`(app)/not-found.tsx`) with `[ BACK TO HOME ]`, and only to signed-in users. |
| — | `(app)/Forbidden.tsx` | "You don't have access to this page." shown inside the shell when `requireAdmin()` says the user is not an admin. |
| `/sign-in` | `src/app/sign-in/page.tsx` | Outside the shell. |
| — | `src/app/not-found.tsx` | Not-found outside the shell (e.g. the fake login when disabled). |

The Notifications page (`src/app/(app)/notifications/`) lists the user's @mentions and the activities others assigned to them from `src/server/notifications.ts`;
opening one marks it read and goes to the record, and a button marks all read. Both actions call `requireUser()`.
Data movement is in [`dataflow/DATAFLOW.md`](../../dataflow/DATAFLOW.md).

## Sign-in page states

`signInPageState()` in `src/server/sign-in-page.ts` decides what `/sign-in` shows, in this order:

1. **Preview deployment** (`VERCEL_ENV=preview`): a notice that sign-in is off; no database access.
2. **Not set up**: no `FIRST_ADMIN_EMAIL` and an empty `users` table → "The CRM isn't set up yet."
3. **Form**: `Sign in with Google`, the `[ FAKE GOOGLE LOGIN ]` link when
   [the fake login](../auth/fake-google-login.md) is allowed, and an error message when `error` is one
   of `domain`, `not_allowed`, `removed`, `cancelled`.

Before that, a visitor whose session is still valid is redirected to their safe `next` path.

## Messages

`src/server/messages.ts` is the only source of user-facing text: a map from codes (`domain`,
`not_allowed`, `removed`, `cancelled`, `setup`, `preview`, `invalid_domain`, `duplicate`, `last_admin`,
`self_deactivate`, `forbidden`, `not_found`, `seed_refused`) to sentences. Pages receive only a code in
the URL (`?error=…`), check it against an allow-list, and look it up with `messageFor()`, which ignores
unknown codes and inherited object keys. Text from a URL is never displayed.

## Formatting

`src/server/format.ts` formats the Users page's "Last sign-in" in UK time (`19 Nov 2026, 09:12`, or
`Never`) and the header counts (`1 USER`, `2 ADMINS`).

`src/server/messages.ts` also holds `templates` (messages built from a name, such as the delete notices) and
`fieldMessage()` for form field errors; `src/server/format.ts` formats UK dates and times and header counts.
The People, Organisations and Lead sources pages are described in
[People and organisations](people-and-organisations.md); the Deals board and Pipelines admin pages in
[Pipelines, deals and the board](pipelines-and-deals.md).

New pages and nav links: see [Adding a feature](../workflows/adding-a-feature.md).
