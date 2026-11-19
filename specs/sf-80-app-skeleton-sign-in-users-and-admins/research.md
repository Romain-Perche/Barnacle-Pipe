# Research: App skeleton — sign-in, users and admins

All Technical Context items are resolved; nothing is left as NEEDS CLARIFICATION. The factory ran this
without a person: choices that only a person can confirm are recorded in `spec.md` under
`## Clarifications` with "(decided by the factory, to confirm)".

## 1. Framework and runtime

- **Decision**: Next.js 16.4 (App Router), React 19.3, TypeScript 6.0, Node.js 24.
- **Rationale**: Next.js App Router is fixed by DECISIONS (SF-80). 16.4 is the current stable release.
  TypeScript 6.0 is the last JavaScript-based compiler; 7.0 (native) is new, and Next's build-time type
  check relies on the JS compiler API, so 6.0 is the safe pick.
- **Alternatives**: TypeScript 7.0 (rejected: tooling compatibility risk for no benefit here).

## 2. Google sign-in without an auth library

- **Decision**: hand-written OAuth 2.0 authorization code flow with PKCE (S256) and a `state` value:
  1. `GET /auth/google/start?next=…` stores `{state, codeVerifier, next}` in a short-lived (10 min),
     httpOnly, SameSite=Lax cookie and redirects to `https://accounts.google.com/o/oauth2/v2/auth` with
     `client_id`, `redirect_uri=${APP_URL}/auth/google/callback`, `response_type=code`,
     `scope=openid email profile`, `state`, `code_challenge`, `code_challenge_method=S256`,
     `hd=barnacle.ai`, `prompt=select_account`.
  2. `GET /auth/google/callback` checks `state` against the cookie; `error` param or any failure →
     "cancelled" message. It POSTs the code to `https://oauth2.googleapis.com/token`, then calls
     `GET https://www.googleapis.com/oauth2/v2/userinfo` with the access token.
  3. The userinfo fields (`email`, `verified_email`, `hd`, `name`, `given_name`) — all in the schema file
     listed under plan.md "Outside services" — go into the same `completeSignIn()` as the fake login.
- **Rationale**: two `fetch` calls and ~60 lines; no ID-token signature checking is needed because
  identity comes from Google's userinfo endpoint over TLS with a fresh access token. Using userinfo
  (instead of decoding the ID token) also means every field we read is covered by a public schema.
  `hd=barnacle.ai` is only a hint to Google's chooser; the server re-checks domain on the returned email
  and `hd`.
- **Alternatives**: Auth.js / next-auth (rejected: DECISIONS wants our own DB sessions; Auth.js adapters
  and callbacks add more surface than the flow itself), `arctic` + `jose` (rejected: two dependencies to
  replace a few lines), Supabase Auth (rejected by DECISIONS).
- **Testing**: unit/integration tests stub `fetch` for the token and userinfo calls with responses shaped
  by the schema; browser tests use the fake Google login (§6).

## 3. Sign-in rules (one pure function)

`decideSignIn({ email, emailVerified, hd }, existingUser | null, firstAdminEmail | null, userCount)`
returns one of `ok`, `create_first_admin`, `domain`, `removed`, `not_allowed`, `setup`. Order:

1. Email normalised (trim, lowercase). Not verified, or domain ≠ `barnacle.ai`, or (real Google) `hd` ≠
   `barnacle.ai` → `domain` ("Only barnacle.ai Google accounts can sign in.").
2. User exists: deactivated → `removed`; active → `ok` (name and `last_sign_in_at` updated).
3. No user, email = `FIRST_ADMIN_EMAIL` (normalised) → `create_first_admin` (insert … ON CONFLICT DO
   NOTHING, then re-read: safe if two first sign-ins race).
4. Otherwise → `not_allowed` ("This account doesn't have access yet. Ask an admin to add you.").

The sign-in page itself shows `setup` ("The CRM isn't set up yet. No first admin has been named.", no
button) when `FIRST_ADMIN_EMAIL` is empty and the users table is empty. The display name is Google's
`name`, falling back to the email's local part. "Hello, <first name>" uses the first word of the stored
name (not Google's `given_name`), so it works the same for the fake login and for users who have never
signed in.

## 4. Sessions

- **Decision**: database sessions. Cookie `crm_session` = 32 random bytes (base64url); the table stores
  only its SHA-256 hash. Cookie: httpOnly, SameSite=Lax, Path=/, Secure when served over https, max-age
  30 days. Server-side `expires_at = last_seen_at + 30 days`; `last_seen_at` is refreshed at most once
  an hour to avoid a write on every request. `proxy.ts` re-sends the cookie with a fresh max-age so the
  browser keeps it while it is used (FR-006).
- **Ending**: sign-out deletes this browser's session row and cookie. Deactivation sets `revoked_at` on
  all of the user's sessions (FR-007) instead of deleting them, so the next request can show "Your access
  has been removed…" (spec US2-6) rather than a bare sign-in page; reactivation does not revive them.
- **Lookup** (`requireUser()`), every request: hash cookie → join user. Missing/expired → `/auth/end`
  (clears cookie) → `/sign-in?next=…`. Revoked or user deactivated → `/auth/end?reason=removed`. Role and
  status are always read fresh, so changes apply on the next request (FR-017).
- **Why a route handler `/auth/end`**: server components cannot change cookies; clearing the stale cookie
  there prevents redirect loops between `proxy.ts` (which only sees cookie presence) and the page.
- **No session secret is needed**: tokens are random and stored hashed; nothing is signed. The OAuth
  `state` cookie is compared, not trusted.
- **Alternatives**: signed JWT cookies (rejected: cannot be ended immediately on deactivation).

## 5. Access checks that later features reuse

- `proxy.ts` (Next 16's renamed middleware, Node runtime): for every path except `/sign-in`, `/auth/*`,
  `/dev/fake-google`, `/_next/*` and static files, no cookie → redirect to `/sign-in?next=<path+query>`.
  It also forwards the path as an `x-pathname` request header so server components can build `next`.
- Every signed-in page calls `requireUser()` (or `requireAdmin()`) itself, and every server action calls
  it again before doing anything. Layouts are not re-rendered on client navigation in the App Router, so
  the layout check alone is not enough (FR-011).
- `requireAdmin()` on a page renders "You don't have access to this page." (HTTP 403) inside the shell;
  in an action it redirects to `/admin/users`, which then renders that message for a non-admin (edge
  case: admin B demoted while the page is open).
- `isSafeNext(next)`: must start with `/`, not `//` or `/\`, and must not point at `/auth/*` → otherwise
  `/` (FR-009, no open redirect).

## 6. Fake Google login and environment gating

- `isFakeAllowed()` = `process.env.APP_ENV === "development" || process.env.APP_ENV === "test"`, exact
  string compare, nothing else (FR-026). Used by the fake login page (`notFound()` → "Page not found."),
  its server actions, the sign-in page link, and `scripts/seed.ts`.
- `/dev/fake-google` mimics Google's chooser: one button per user in the database (name + email), a form
  for any email and name, and `[ CANCEL ]` → `/sign-in?error=cancelled`. It calls the same
  `completeSignIn()` as the real callback, with `emailVerified: true` and no `hd`, so all rules apply.
- On the sign-in page in development/test: the real "Sign in with Google" button plus a
  `[ FAKE GOOGLE LOGIN ]` link.
- This in-app fake is enough for the browser tests and the AI review; no fake HTTP Google server is
  needed.

## 7. Preview deployments

- `isPreview()` = `process.env.VERCEL_ENV === "preview"`. It is checked first, before any database
  access: the sign-in page shows "Sign-in is turned off on preview deployments." with no button;
  `/auth/google/*`, `/dev/fake-google`, `requireUser()` all refuse. All app pages are dynamic
  (`cookies()`), so `next build` never queries the database.

## 8. Database access and migrations

- **Decision**: `postgres` (postgres.js) 4.1 with tagged-template SQL; one module-level client,
  `prepare: false` (required by Supabase's transaction-mode pooler), `max: 5`, `idle_timeout: 20`.
- **Migrations**: numbered plain SQL files in `migrations/`; `scripts/migrate.ts` takes
  `pg_advisory_lock`, creates `schema_migrations(name, applied_at)` if missing, applies each new file in
  its own transaction, prints what it applied. `npm run db:migrate`. Never called by the app.
- **Vercel**: `"vercel-build"` script runs `db:migrate` only when `VERCEL_ENV=production`, then
  `next build`. Previews skip it and have no `DATABASE_URL`.
- **Scripts runner**: `tsx` runs `scripts/*.ts` so they can import `src/server/*` with the `@/` alias.
- **Alternatives**: Drizzle/Prisma/Kysely (rejected: three tables, a query builder and a migration tool
  cost more than they save now; can be adopted later), `pg` (equivalent; postgres.js has simpler
  transactions and pooler support), Node's built-in type stripping instead of `tsx` (rejected: does not
  resolve the `@/` path alias or extensionless imports used by the Next.js code).

## 9. User management rules (data-model.md has the details)

- One transaction per action. It locks the acting user's row and all active admin rows
  (`SELECT … FOR UPDATE`), re-checks that the actor is an active admin, applies the change, and refuses
  with "The CRM must always have at least one active admin." if no active admin would remain (FR-016,
  SC-008). Locking makes two simultaneous demotions safe.
- Add: trim + lowercase, must match `^[a-z0-9._%+-]+@barnacle\.ai$` → else "Only barnacle.ai addresses
  can be added."; unique index on `email` → "This person is already a user.".
- Deactivate self → "You can't deactivate yourself." (FR-015); the button is hidden on one's own row.
- Every change writes a `user_changes` row (FR-018).
- Feedback: actions redirect to `/admin/users?error=<code>`; the page maps codes to fixed messages from
  `messages.ts` (never reflects text from the URL). Works without client JavaScript.

## 10. Look and feel

- Plain CSS (`globals.css` with the `docs/DESIGN.md` tokens, CSS modules per component); fonts from the
  `geist` package (DESIGN.md requires the npm package for the `ss08` stylistic set). The sidebar follows
  design B, the Users page design A (`design-options.html`), including the "N USERS · M ADMINS" count,
  greyed deactivated rows and the orange-bordered error box.
- Last sign-in shown in UK time (`Europe/London`) as `19 Nov 2026, 09:12`, "Never" when null. Rows: active
  first, then by name.
- **Alternatives**: Tailwind (rejected: a build dependency for a handful of screens).

## 11. Tests

- `npm test` → Vitest: unit tests for `rules.ts`, `env.ts`, email normalisation, `isSafeNext`; integration
  tests for `completeSignIn`, sessions and `users.ts` against `DATABASE_URL` of a local test database
  (global setup runs migrations, each test truncates tables).
- `npm run test:e2e` → Playwright (Chromium): `webServer` starts the app with `APP_ENV=test`; global setup
  migrates and seeds; tests sign in through `/dev/fake-google`. Covers sign-in, sign-out, Users page
  actions, deactivation, gating, layout and not-found.
- The exact database and browser setup in the factory VM is Build's test recipe, not this plan.
