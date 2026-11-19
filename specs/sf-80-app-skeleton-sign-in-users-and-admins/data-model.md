# Data model: App skeleton — sign-in, users and admins

One migration, `migrations/0001_users_sessions.sql`. Postgres. All times are `timestamptz` (UTC).

## users

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity` | primary key |
| `email` | `text not null unique` | stored trimmed + lowercase; `check (email = lower(email))`; `check (email like '%@barnacle.ai')` |
| `name` | `text not null` | from Google at each sign-in; email local part when added and never signed in |
| `role` | `text not null default 'user'` | `check (role in ('admin','user'))` |
| `status` | `text not null default 'active'` | `check (status in ('active','deactivated'))` |
| `added_by` | `bigint null references users(id)` | null for the first admin and for seeded users |
| `created_at` | `timestamptz not null default now()` | |
| `last_sign_in_at` | `timestamptz null` | null → "Never" |

- Never deleted (FR-015): later features reference `users.id` as author.
- Role is kept on deactivation; reactivation restores status only, so the old role returns (US2-7).

### State transitions (all by an active admin, in one locked transaction)

```text
            add (role=user)
   (none) ───────────────▶ active/user ◀──remove admin── active/admin
                              │  ▲     ──make admin──▶      │  ▲
                   deactivate │  │ reactivate    deactivate │  │ reactivate
                              ▼  │                          ▼  │
                       deactivated/user          deactivated/admin
first sign-in of FIRST_ADMIN_EMAIL with no row ──▶ active/admin
```

Guards:

- Actor must be an active admin at the time of the change (re-read inside the transaction).
- After the change, `count(*) where role='admin' and status='active'` must be ≥ 1, otherwise refuse with
  `last_admin`.
- Actor cannot deactivate themselves (`self_deactivate`).
- Make admin applies to any user; on a deactivated user it only changes the role (the button is shown
  only on active rows in design A, so this is only reachable directly and is harmless).

## sessions

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity` | primary key |
| `token_hash` | `bytea not null unique` | SHA-256 of the cookie token; the token itself is never stored |
| `user_id` | `bigint not null references users(id)` | index |
| `created_at` | `timestamptz not null default now()` | |
| `last_seen_at` | `timestamptz not null default now()` | refreshed at most hourly |
| `expires_at` | `timestamptz not null` | `last_seen_at + 30 days` |
| `revoked_at` | `timestamptz null` | set for all of a user's sessions on deactivation |

Valid session = row exists, `revoked_at is null`, `expires_at > now()`, user `status='active'`.
Sign-out deletes the row. Expired and revoked rows are deleted when next looked up (and by sign-in of the
same user); no scheduled job.

## user_changes

| Column | Type | Rules |
|---|---|---|
| `id` | `bigint generated always as identity` | primary key |
| `user_id` | `bigint not null references users(id)` | the user changed |
| `actor_id` | `bigint null references users(id)` | admin who did it; null for first-admin creation and fake data |
| `action` | `text not null` | `check (action in ('added','made_admin','admin_removed','deactivated','reactivated'))` |
| `created_at` | `timestamptz not null default now()` | |

Append-only (FR-018). Not shown in the UI in this feature.

## schema_migrations

Created by `scripts/migrate.ts`: `name text primary key`, `applied_at timestamptz not null default now()`.

## Validation summary

| Input | Rule | Result code |
|---|---|---|
| Email to add | trim, lowercase, `^[a-z0-9._%+-]+@barnacle\.ai$` | `invalid_domain` |
| Email to add | not already in `users` | `duplicate` |
| Any role/status change | ≥ 1 active admin remains | `last_admin` |
| Deactivate | target ≠ actor | `self_deactivate` |
| Any admin action | actor active admin | redirect → forbidden page |
| Sign-in email | verified, `@barnacle.ai`, `hd` = barnacle.ai (real Google) | `domain` |

Result codes map to text in `contracts/routes.md`.

## Fake data (`src/seed/users.ts`)

Idempotent (`insert … on conflict (email) do nothing`), prints each user as created or already there:

| Email | Name | Role | Status |
|---|---|---|---|
| `ada@barnacle.ai` | Ada Fake | admin | active |
| `grace@barnacle.ai` | Grace Fake | admin | active |
| `linus@barnacle.ai` | Linus Fake | user | active |
| `margaret@barnacle.ai` | Margaret Fake | user | active |
| `alan@barnacle.ai` | Alan Fake | user | deactivated |

`src/seed/index.ts` holds the ordered list of seeders; later features append theirs (pipelines, deals…).
