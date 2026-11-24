# Data model: Gmail connect and sync (SF-118)

One migration, `migrations/0013_gmail.sql` (`0012` is SF-117's `0012_pipedrive.sql`). It holds only statements allowed in a transaction, and every
`create table` is followed by `enable row level security` (no policies). `tests/support/reset.ts` empties the four new
tables, and `tests/integration/migrate.test.ts` applies the migration on a fresh database and checks the refusals
below.

## Migration

```sql
create table gmail_connections (
  id bigint generated always as identity primary key,
  user_id bigint not null unique references users (id),
  email text not null unique check (email = lower(btrim(email)) and email like '%@barnacle.ai'),
  state text not null check (state in ('working', 'needs_reconnect', 'disconnected')),
  token_cipher bytea null,
  scopes text not null default '',
  connected_at timestamptz not null,
  history_id numeric(20, 0) null check (history_id >= 0),
  last_synced_at timestamptz null,
  watch_renewed_at timestamptz null,
  watch_expires_at timestamptz null,
  sync_lease_until timestamptz null,
  sync_again boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((state = 'disconnected') = (token_cipher is null)),
  check (state <> 'disconnected' or (watch_renewed_at is null and watch_expires_at is null and sync_lease_until is null))
);
alter table gmail_connections enable row level security;

create table email_threads (
  id bigint generated always as identity primary key,
  connection_id bigint not null references gmail_connections (id) on delete cascade,
  gmail_thread_id text not null check (gmail_thread_id <> '' and char_length(gmail_thread_id) <= 64),
  subject text not null default '',
  created_at timestamptz not null default now(),
  unique (connection_id, gmail_thread_id)
);
alter table email_threads enable row level security;

create table email_messages (
  id bigint generated always as identity primary key,
  connection_id bigint not null references gmail_connections (id) on delete cascade,
  thread_id bigint not null references email_threads (id) on delete cascade,
  gmail_message_id text not null check (gmail_message_id <> '' and char_length(gmail_message_id) <= 64),
  rfc_message_id text null check (char_length(rfc_message_id) <= 998),
  direction text not null check (direction in ('sent', 'received')),
  from_address text null,
  from_name text null,
  to_list jsonb not null default '[]' check (jsonb_typeof(to_list) = 'array'),
  cc_list jsonb not null default '[]' check (jsonb_typeof(cc_list) = 'array'),
  bcc_list jsonb not null default '[]' check (jsonb_typeof(bcc_list) = 'array'),
  subject text not null default '',
  sent_at timestamptz null,
  received_at timestamptz not null,
  text_body text null,
  html_body text null,
  created_at timestamptz not null default now(),
  unique (connection_id, gmail_message_id)
);
alter table email_messages enable row level security;
create index email_messages_thread_idx on email_messages (thread_id, received_at);
create index email_messages_rfc_idx on email_messages (rfc_message_id) where rfc_message_id is not null;

create table email_attachments (
  id bigint generated always as identity primary key,
  message_id bigint not null references email_messages (id) on delete cascade,
  position int not null check (position >= 0),
  name text not null check (name <> '' and char_length(name) <= 255),
  content_type text not null default 'application/octet-stream' check (char_length(content_type) <= 255),
  size bigint not null check (size >= 0),
  unique (message_id, position)
);
alter table email_attachments enable row level security;
```

Notes:
- `users` is not deleted in this app (deactivated only), so there is no cascade from `users`. The connection row is
  kept after disconnect and deactivation, so its conversations stay (spec clarification).
- Address lists are `[{ "email": "<lower-cased>", "name": "<display name or null>" }]`. A later issue links
  conversations to people by these. No join table yet (YAGNI).
- `rfc_message_id` (index) lets later issues show one email once when two teammates' mailboxes both hold it (edge
  case "Same conversation in two mailboxes").
- `history_id` is Gmail's unsigned 64-bit id: `numeric(20,0)`, read and written as text in TypeScript.
- Names longer than 255 characters are cut to 255 by `rules.ts` before insert (never refused: Gmail decides names).

## Entities

### Gmail connection (`gmail_connections`)
| Field | Meaning |
|---|---|
| `user_id` | Owner. One connection per user, ever (re-used on reconnect). |
| `email` | The connected address. Always the user's own sign-in address (research.md §3). |
| `state` | `working` · `needs_reconnect` · `disconnected`. |
| `token_cipher` | AES-256-GCM refresh token (research.md §4). Null exactly when `disconnected`. Never selected by a read that serves a page. Only `src/server/gmail/connections.ts#loadKey` reads it. |
| `scopes` | Scopes Google granted (space-separated). |
| `connected_at` | Copying starts here (FR-009). Set on connect from `disconnected` or with no row. Kept on reconnect. |
| `history_id` | How far sync has got in Gmail's change history. |
| `last_synced_at` | The last successful sync ("Last sync"). |
| `watch_renewed_at`, `watch_expires_at` | The last `users.watch` and its expiry (FR-007). |
| `sync_lease_until`, `sync_again` | One sync at a time per connection without session locks (research.md §8). |

### Email conversation (`email_threads`), email message (`email_messages`), email attachment (`email_attachments`)
See the migration. "Conversations copied" = `count(*) from email_threads where connection_id = …`.

## State changes

```text
(no row) ──connect ok──▶ working
working ──key refused (sync / renewal / send)──▶ needs_reconnect
needs_reconnect ──reconnect ok (same account)──▶ working          (connected_at, history_id, last_synced_at kept)
working | needs_reconnect ──disconnect / user deactivated──▶ disconnected   (token_cipher, watch, lease → null)
disconnected ──connect ok──▶ working                                (connected_at = now, history_id from getProfile)
working ──connect ok again (second tab)──▶ working                  (token replaced, old one revoked after commit)
```

- Every change is one `sql.begin()` (or one update), with no network call inside. Google calls happen before (connect)
  or after commit (disconnect, deactivation, revoking a replaced token).
- `needs_reconnect` is set with `where state = 'working'`, so a disconnect in between is never undone.
- Nothing that was copied is ever deleted by these changes.

## Copy rules (FR-009 to FR-012)

A message `m` reported for connection `c` is stored when all of these hold:
1. `m.labelIds` has none of `DRAFT`, `SPAM`, `TRASH`;
2. `m.internalDate >= c.connected_at`;
3. it is not stored yet (`unique (connection_id, gmail_message_id)`);
4. either `email_threads(c, m.threadId)` exists, or some address in From / To / Cc / Bcc, after `normalizeEmail`, is in
   `person_emails.email`. Archived and private people count. Deleted people do not (their rows are gone).

## Fake data (`src/seed/gmail.ts`)

- Ada Fake (`ada@barnacle.ai`, the first fake user of `src/seed/users.ts`) gets a `working` connection made through
  the fake Google: a token made by the fake, encrypted with the fake-mode key.
- It gets three conversations, each with fake people from `src/seed/people.ts`:
  - "Fake proposal": received, then sent; `proposal-fake.pdf` (250,880 bytes);
  - "Fake intro call": received; `logo-fake.png` (18,432 bytes) and `notes-fake.txt` (1,024 bytes);
  - "Fake follow-up": sent.
- All are put into the fake mailbox after `connected_at` and copied through `syncConnection`.
- Running the seeder again finds the connection and the stored ids, and adds nothing.
