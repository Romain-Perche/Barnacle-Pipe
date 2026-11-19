---
type: feature
title: Signed-in layout, pages and messages
description: The sidebar shell shared by every signed-in page, the nav registry, the home, forbidden and not-found pages, the sign-in page's states, and the single catalogue of user-facing messages.
tags: [ui, layout, navigation, messages, sign-in-page]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-19T12:52:49.147Z
sources:
  - id: openwiki-source-9c37e70856dfc7e98b60d790
    resource: repo://src/app/(app)/%5B...missing%5D/page.tsx
  - id: openwiki-source-55416ab6e4db28879c533a75
    resource: repo://src/app/(app)/layout.tsx
  - id: openwiki-source-ba467561895df40c1767967f
    resource: repo://src/app/(app)/nav.ts
  - id: openwiki-source-6e6147c60d91cff3c0050f23
    resource: repo://src/app/(app)/not-found.tsx
  - id: openwiki-source-ed3f6cf4c5684edf2049ee88
    resource: repo://src/server/format.ts
  - id: openwiki-source-c952f67a81bc8f97643c325b
    resource: repo://src/server/messages.ts
  - id: openwiki-source-8bf427df8e393c62d99adf6b
    resource: repo://src/server/sign-in-page.ts
generated: { by: "claude-code", at: "2026-11-19T12:52:49.147Z" }
---

# Signed-in layout, pages and messages

## The `(app)` shell (design B)

Every signed-in page lives under `src/app/(app)/` and gets `layout.tsx`:

- a blue left sidebar with the Barnacle wordmark (`src/app/Wordmark.tsx`);
- the **Main** nav from `mainNav` in `nav.ts` (today only `Home`);
- an `// ADMIN` group with `adminNav` (today `Users`), rendered only when the user's role is `admin`;
- the user's name and a `[ Sign out ]` button (the `signOut` server action, see
  [Sessions and access control](../auth/sessions-and-access-control.md)).

The layout calls `requireUser()` and sets `dynamic = "force-dynamic"`, so every signed-in page is
rendered per request, previews included. `SidebarLink.tsx` is the only client component: it uses
`usePathname()` to mark the current link with `aria-current="page"`.

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

New pages and nav links: see [Adding a feature](../workflows/adding-a-feature.md).
