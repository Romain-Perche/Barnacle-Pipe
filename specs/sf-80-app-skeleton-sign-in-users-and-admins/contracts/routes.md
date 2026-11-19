# Contract: routes, actions and messages

The app's interface is its pages, route handlers and server actions. "Signed in" means `requireUser()`
passes; "admin" means `requireAdmin()` passes (research.md §4–5).

## Public (no session needed)

| Path | Method | Behaviour |
|---|---|---|
| `/sign-in` | GET | Query: `next` (optional, safe path), `error` (optional code). Valid session → redirect to `next` or `/`. Preview → `preview` notice, no button. Setup state → `setup` notice, no button. Otherwise "Sign in with Google" (→ `/auth/google/start?next=…`), the `error` message if any, and in development/test a `[ FAKE GOOGLE LOGIN ]` link (→ `/dev/fake-google?next=…`). |
| `/auth/google/start` | GET | Preview → `/sign-in`. Sets `oauth` cookie (state, PKCE verifier, next; 10 min) and redirects to Google (research.md §2). |
| `/auth/google/callback` | GET | Query `code`, `state` or `error`. Bad/missing state, `error`, or failed token/userinfo call → `/sign-in?error=cancelled`. Else `completeSignIn()`; success → sets `crm_session`, redirects to `next` or `/`; refusal → `/sign-in?error=<code>`. Always clears the `oauth` cookie. |
| `/auth/end` | GET | Query `reason` (`removed` optional), `next`. Deletes the session row (if any) and the cookie, then → `/sign-in?error=removed` or `/sign-in?next=…`. |
| `/dev/fake-google` | GET | Not development/test → 404 "Page not found.". Else the fake chooser: one button per user (name, email), a form with Email + Name, `[ CANCEL ]`. |

### Fake login server actions (`src/app/dev/fake-google/actions.ts`)

| Action | Input | Result |
|---|---|---|
| `fakeSignIn` | `email`, `name` (optional), `next` | Refused (404-equivalent, no change) unless development/test. Else `completeSignIn({email, name, emailVerified: true, hd: null})`, same outcomes as the callback. |
| `fakeCancel` | `next` | → `/sign-in?error=cancelled` |

## Signed in (inside the design B shell)

| Path | Access | Behaviour |
|---|---|---|
| `/` | signed in | "Hello, <first name>"; Home link highlighted. |
| `/admin/users` | admin; non-admin sees `forbidden` (HTTP 403) in the shell | Design A table; query `error` (optional code) shown above the table. |
| any other path | signed in | "Page not found." + link to Home, inside the shell (HTTP 404). |

No session cookie on any non-public path → `proxy.ts` redirects to `/sign-in?next=<path>`.

### Sign-out server action (in the shell)

`signOut()` — POST form `[ Sign out ]`: deletes the current session row and cookie → `/sign-in`.

### Users page server actions (`src/app/(app)/admin/users/actions.ts`)

Each one: `requireAdmin()` first (not an admin → redirect `/admin/users`, which shows `forbidden`;
signed out/removed → sign-in), then one locked transaction (data-model.md), then redirect to
`/admin/users` or `/admin/users?error=<code>`.

| Action | Input | Success | Refusal codes |
|---|---|---|---|
| `addUser` | `email` | row added: name = local part, User, Active, "Never" | `invalid_domain`, `duplicate` |
| `makeAdmin` | `userId` | role Admin | — |
| `removeAdmin` | `userId` (may be self) | role User | `last_admin` |
| `deactivate` | `userId` | status Deactivated; all their sessions revoked | `self_deactivate`, `last_admin` |
| `reactivate` | `userId` | status Active, previous role | — |

Row buttons (design A): `[ MAKE ADMIN ]` on active users, `[ REMOVE ADMIN ]` on active admins,
`[ DEACTIVATE ]` on active rows except one's own, `[ REACTIVATE ]` on deactivated rows. Header shows
`// ADMIN`, "Users", and `N USERS · M ADMINS`.

## Messages (`src/server/messages.ts`, exact text)

| Code | Where | Text |
|---|---|---|
| `domain` | sign-in | Only barnacle.ai Google accounts can sign in. |
| `not_allowed` | sign-in | This account doesn't have access yet. Ask an admin to add you. |
| `removed` | sign-in | Your access has been removed. Ask an admin if this is a mistake. |
| `cancelled` | sign-in | Sign-in was cancelled or failed. Please try again. |
| `setup` | sign-in (notice, no button) | The CRM isn't set up yet. No first admin has been named. |
| `preview` | sign-in (notice, no button) | Sign-in is turned off on preview deployments. |
| `invalid_domain` | Users page | Only barnacle.ai addresses can be added. |
| `duplicate` | Users page | This person is already a user. |
| `last_admin` | Users page | The CRM must always have at least one active admin. |
| `self_deactivate` | Users page | You can't deactivate yourself. |
| `forbidden` | any admin page | You don't have access to this page. |
| `not_found` | 404 pages | Page not found. |
| `seed_refused` | fake data command (stdout, exit 1) | Fake data can only be loaded when APP_ENV is development or test. |

An unknown `error` code in a URL shows nothing. Text from the URL is never displayed.

## Extension points for later features

- Add a page under `src/app/(app)/…`; call `requireUser()` or `requireAdmin()` at the top of the page and
  of each server action.
- Add one entry to `mainNav` or `adminNav` in `src/app/(app)/nav.ts` (`{ href, label }`).
- Add a seeder to the list in `src/seed/index.ts`.
- Add a numbered SQL file to `migrations/`: only statements allowed inside a transaction, and
  `alter table … enable row level security` after every `create table` (a test fails otherwise).
