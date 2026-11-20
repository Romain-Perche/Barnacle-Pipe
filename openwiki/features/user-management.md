---
type: feature
title: User management (Users page)
description: The admin-only Users page — list, add, make or remove admin, deactivate and reactivate — and the locked transaction that keeps at least one active admin, logs every change and revokes sessions of deactivated users.
tags: [users, admin, authorization, audit]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-20T11:20:44.617Z
sources:
  - id: openwiki-source-e78c5b056032c61cb809d6b1
    resource: repo://src/app/(app)/admin/users/actions.ts
  - id: openwiki-source-508d4e820419bd4df282b1ee
    resource: repo://src/app/(app)/admin/users/page.tsx
  - id: openwiki-source-16c334cbe6c5a2c7ad77a065
    resource: repo://src/server/records/handover.ts
  - id: openwiki-source-defe190e4c7d59423daec996
    resource: repo://src/server/users.ts
generated: { by: "claude-code", at: "2026-11-20T11:20:44.617Z" }
---

# User management (Users page)

Admins decide who can use the CRM on `/admin/users`. Only people listed there (plus the first admin
named in settings) can sign in; see [Google sign-in flow](../auth/google-sign-in.md).

## Page and actions

- **Page** `src/app/(app)/admin/users/page.tsx` (design A: a table with actions on each row, the add
  field above). It calls `requireAdmin()` and shows the [Forbidden](./signed-in-layout-and-pages.md)
  message to non-admins. Rows come from `listUsers()`: active users first, then by name. The header
  counts users and active admins.
- **Row actions** shown: `[ REMOVE ADMIN ]` or `[ MAKE ADMIN ]` for active users, `[ DEACTIVATE ]` for
  active users other than yourself, `[ REACTIVATE ]` for deactivated users. A deactivated user who still owns
  private people or private deals also shows their counts and `[ HAND OVER ]`, which opens `HandOverPanel.tsx` (`?handover=<id>`)
  to choose an active user; the panel shows only counts, never which people or deals.
- **Hand over** (`handOver` action): calls `handOverPrivateRecords()` in `src/server/records/handover.ts`, which
  re-checks every rule in a locked transaction. Results map to a flash notice (handed or nothing to hand over)
  or to `?error=handover_choose_user` / `handover_not_deactivated`.
- **Server actions** `src/app/(app)/admin/users/actions.ts` each call `assertAdminForAction()` first,
  parse `userId` as a positive safe integer, call the domain function in `src/server/users.ts`, then
  `revalidatePath("/", "layout")` (roles change the sidebar) and redirect. Errors come back as
  `?error=<code>`; a `forbidden` result redirects to the page without a code, which then shows the
  forbidden message. Removing your own admin rights sends you to `/`.

## The change transaction

Every change runs through `asAdmin(actorId, change)` in `src/server/users.ts`, one transaction that:

1. locks (`select … for update`, in id order) the actor and every active admin, so concurrent changes
   run one after another;
2. refuses with `forbidden` unless the actor is still an active admin (rights are re-checked here, not
   only in the action);
3. applies the change and writes a `user_changes` row (`actor_id` = the admin);
4. counts active admins and refuses with `last_admin` if none would remain, rolling everything back.

| Function | Change | Extra rules |
|---|---|---|
| `addUser` | inserts `email` (normalised) with name = the part before `@`, `added_by` = actor | `invalid_domain` if not `@barnacle.ai` (checked before the transaction); `duplicate` if the email exists. |
| `makeAdmin` / `removeAdmin` | sets `role` | `last_admin` when removing the last active admin. |
| `deactivate` | sets `status = 'deactivated'` and revokes all the user's sessions | `self_deactivate` for yourself. |
| `reactivate` | sets `status = 'active'` | — |

Updating a user id that does not exist is refused as `forbidden`. Users are never deleted.

A deactivated user's next request fails `requireUser()` (sessions revoked, status read fresh) and they
see "Your access has been removed." See [Sessions and access control](../auth/sessions-and-access-control.md).

## Tests

`tests/integration/users.test.ts` (rules and concurrency on a real database) and
`tests/e2e/users.spec.ts` (the page in a browser). Table definitions are on
[Database schema and access](../data/database-schema.md).
