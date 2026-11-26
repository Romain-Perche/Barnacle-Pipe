# Data model: Write an email from a deal or contact (SF-129)

One migration, `migrations/0020_sent_email.sql` (statements allowed in a transaction only; `enable row level security`
after every `create table`, no policies). SF-118's `email_threads`, `email_messages` and `email_attachments` are reused
unchanged: a sent email is an `email_messages` row with `direction = 'sent'`.

## New tables

### `email_links` — which records an email belongs to

| column | type | rule |
|---|---|---|
| `id` | bigint identity PK | |
| `message_id` | bigint not null → `email_messages(id)` on delete cascade | |
| `deal_id` | bigint null → `deals(id)` on delete cascade | |
| `person_id` | bigint null → `persons(id)` on delete cascade | |
| `organisation_id` | bigint null → `organisations(id)` on delete cascade | |
| `how` | text not null | `check (how in ('written_from', 'recipient'))` |
| `created_at` | timestamptz not null default now() | |

- `check (num_nonnulls(deal_id, person_id, organisation_id) = 1)`; `check (how = 'written_from' or person_id is not null)`
  (a recipient is always a person).
- Unique: `(message_id, deal_id) where deal_id is not null`, `(message_id, person_id) where person_id is not null`,
  `(message_id, organisation_id) where organisation_id is not null` (one row per message and record; a person written
  from and written to keeps the `written_from` row — insert the source first, recipients `on conflict do nothing`).
- Indexes: `(deal_id)`, `(person_id)`, `(organisation_id)` partial on not null (timeline reads).
- Later issues (automatic and manual thread linking) add `how` values; this issue writes only these two.

### `email_sends` — one row per press of `[ SEND ]` (the ledger)

| column | type | rule |
|---|---|---|
| `id` | bigint identity PK | |
| `user_id` | bigint not null → `users(id)` | |
| `send_key` | uuid not null | made by the box when it opens; `unique (user_id, send_key)` |
| `connection_id` | bigint not null → `gmail_connections(id)` on delete cascade | |
| `deal_id` / `person_id` / `organisation_id` | bigint null, on delete set null | the record written from (`num_nonnulls(…) <= 1`: 1 at insert, 0 once the record is deleted) |
| `rfc_message_id` | text not null unique | `<crm-<24 hex>@barnacle.ai>`, the `Message-ID` header sent |
| `gmail_message_id` | text null | set as soon as Gmail answered |
| `gmail_thread_id` | text null | |
| `state` | text not null | `check (state in ('sending', 'sent'))` |
| `message_id` | bigint null → `email_messages(id)` on delete set null | set when recorded |
| `upload_ids` | bigint[] not null default '{}' | the `email_uploads` sent with it (their cleanup) |
| `created_at` | timestamptz not null default now() | the send time used for Last contacted by the fallback |

- Index `(connection_id, gmail_message_id) where state = 'sending'` for the sync's fallback lookup.
- State: inserted `sending` before any download or Google call → (Gmail refused or not reached, an attachment gone)
  row **deleted** → or (Gmail accepted) `gmail_*` set → `recordSent` sets `sent` + `message_id`; when `recordSent`
  failed, the sync's `completePendingSend` sets them later. A `sending` row is never sent again.

### `email_uploads` — a file chosen from the computer, waiting to be sent

| column | type | rule |
|---|---|---|
| `id` | bigint identity PK | |
| `user_id` | bigint not null → `users(id)` | only its owner can attach it |
| `storage_path` | text not null unique | `newStoragePath()` (SF-116) |
| `name` | text not null | `char_length(name) between 1 and 255` |
| `size` | bigint not null | `check (size between 1 and 26214400)` |
| `content_type` | text not null | `char_length <= 255` |
| `created_at` | timestamptz not null default now() | |

- At creation the path is also queued in `file_cleanup` with `due_at = now() + interval '24 hours'`; after a send the
  sent uploads' `file_cleanup.due_at` is set to now and their rows deleted. `sweepFileCleanup` also deletes
  `email_uploads` rows older than 24 hours (their content is then gone).
- Never shown in `// FILES`, never in `files` (clarified 2026-11-26).

## Existing tables used

- `email_messages` (SF-118): a sent email: `connection_id`, `thread_id`, `gmail_message_id`, `rfc_message_id` (the CRM's
  Message-ID), `direction 'sent'`, `from_address` (the connection's address), `from_name` (the user's name), `to_list` /
  `cc_list` / `bcc_list` (jsonb arrays of `{ email, name: null }`, the `Address` shape of `gmail/rules.ts`), `subject`,
  `sent_at` = `received_at` = the send time, `text_body` = the text, `html_body` null.
- `email_attachments` (SF-118): `position`, `name`, `content_type`, `size` of each attachment, in the box's order.
- `email_threads` (SF-118): one per Gmail conversation; the email starts a new one (subject = the subject).
- `persons.last_contacted_at`: raised to the send time for recipients, never lowered (SF-109 statement).
- `files` (SF-116): record files offered and attached (read with `visibleFile()`, `files.<record>_id` = the record).
- `file_cleanup` (SF-116): removal of `email_uploads` contents.
- `gmail_connections` (SF-118): `state = 'working'` to send; `markNeedsReconnect` on a refused key.

## Validation (pure, `src/server/email/rules.ts`)

| rule | message (`messages.ts`) |
|---|---|
| an address fails `isValidEmail` or the header-safe check | `email_address_invalid(address)`: "<address> is not a valid email address." |
| To empty after parsing | `email_to_required`: "Add at least one address in To." |
| subject empty after trim | `email_subject_required`: "Add a subject." |
| more than 100 distinct addresses | `email_too_many_addresses`: "An email can go to 100 addresses at most." |
| subject > 250 code points | `email_subject_too_long`: "The subject can be 250 characters at most." |
| text > 100,000 code points | `email_text_too_long`: "The text can be 100,000 characters at most." |
| attachments > 26,214,400 bytes in total (also a single computer file at pick time) | `email_attachments_too_large`: "Attachments can be 25 MB in total at most." |
| an attached record file / upload no longer there, not visible, or of another record / user | `email_attachment_gone`: "One of the attached files is no longer on the record. Remove it and send again." |
| record archived | `email_record_archived`: "This record is archived: restore it to send email from it." |
| record gone or not visible | `email_record_not_found`: "This record doesn't exist or you can't see it." |
| no connection / disconnected | `email_connect_gmail`: "Connect your Gmail in Settings to send email from the CRM." |
| needs reconnecting (or the key refused at send) | `email_reconnect_gmail`: "Reconnect your Gmail in Settings to send email from the CRM." |
| Gmail off for the app | `email_gmail_off`: "Email can't be sent from the CRM right now." |
| Gmail unavailable / Storage unreachable / BadHeader | `email_send_failed`: "The email could not be sent. Try again in a minute." |
| success (flash `email_sent`) | `email_sent(addresses)`: "Email sent to a@…, b@…." — the first 5 addresses (To, Cc, Bcc order) then "and <n> more" |

Duplicates (case-insensitive, whitespace trimmed) are removed silently, the first one kept (To before Cc before Bcc).
