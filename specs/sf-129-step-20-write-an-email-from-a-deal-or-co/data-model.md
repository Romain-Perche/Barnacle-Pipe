# Data model: Write an email from a deal or contact (SF-129)

One migration, `migrations/0021_email_send.sql` (statements allowed in a transaction only; `enable row level security`
after every `create table`, no policies; main already holds two `0020_*` files). SF-118's `email_threads`,
`email_messages` and `email_attachments` and SF-127's `email_conversations`, `email_conversation_addresses` and
`email_links` are reused unchanged: a sent email is an `email_messages` row with `direction = 'sent'`, processed by
SF-127's `processMessage` like any copied email.

## New tables

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
| `created_at` | timestamptz not null default now() | |

- Index `(connection_id, gmail_message_id) where state = 'sending'` for the sync's fallback lookup.
- State: inserted `sending` before any download or Google call → (Gmail refused or not reached, an attachment gone)
  row **deleted** → or (Gmail accepted) `gmail_*` set → `storeMessage` → `completePendingSend` adds the hand link and
  sets `sent` + `message_id` (from the send path, or later from the sync when the send path's store failed). A
  `sending` row is never sent again.

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

- `email_messages` (SF-118, SF-127 columns): a sent email: `connection_id`, `thread_id`, `gmail_message_id`,
  `rfc_message_id` (the CRM's Message-ID, so SF-127's `dedupe_key`), `direction 'sent'`, `from_address` (the
  connection's address), `from_name` (the user's name), `to_list` / `cc_list` / `bcc_list` (jsonb arrays of
  `{ email, name: null }`), `subject`, `sent_at` = `received_at` = the send time, `text_body` = the text, `html_body`
  null; `linked_at` set by `processMessage`.
- `email_attachments` (SF-118): `position`, `name`, `content_type`, `size` of each attachment, in the box's order.
- `email_threads` (SF-118): one per Gmail conversation; the email starts a new one (subject = the subject); its
  `conversation_id` (SF-127) set by `processMessage`.
- `email_links` (SF-127): one more row, by hand, for the record written from: `conversation_id`, one of `deal_id` /
  `person_id` / `organisation_id`, `how = 'manual'`, `removed = false`, `changed_by` = the sender, `changed_at = now()`;
  inserted `on conflict do nothing` (its partial unique indexes). The automatic rows (people, organisation, one open
  deal) are SF-127's.
- `persons.last_contacted_at`: raised by SF-127's `processMessage` (every address in the email), never lowered.
- `files` (SF-116): record files offered and attached (read with `visibleFile()`, `files.<record>_id` = the record).
- `file_cleanup` (SF-116): removal of `email_uploads` contents.
- `gmail_connections` (SF-118): `state = 'working'` to send; `markNeedsReconnect` on a refused key.

## Validation (pure, `src/server/emails/compose-rules.ts`)

| rule | message (`messages.ts`) |
|---|---|
| an address fails `isValidEmail` or the header-safe check | `compose_address_invalid(address)`: "<address> is not a valid email address." |
| To empty after parsing | `compose_to_required`: "Add at least one address in To." |
| subject empty after trim | `compose_subject_required`: "Add a subject." |
| more than 100 distinct addresses | `compose_too_many_addresses`: "An email can go to 100 addresses at most." |
| subject > 250 code points | `compose_subject_too_long`: "The subject can be 250 characters at most." |
| text > 100,000 code points | `compose_text_too_long`: "The text can be 100,000 characters at most." |
| attachments > 26,214,400 bytes in total (also a single computer file at pick time) | `compose_attachments_too_large`: "Attachments can be 25 MB in total at most." |
| an attached record file / upload no longer there, not visible, or of another record / user | `compose_attachment_gone`: "One of the attached files is no longer on the record. Remove it and send again." |
| record archived | `compose_record_archived`: "This record is archived: restore it to send email from it." |
| record gone or not visible | `compose_record_not_found`: "This record doesn't exist or you can't see it." |
| no connection / disconnected | `compose_connect_gmail`: "Connect your Gmail in Settings to send email from the CRM." |
| needs reconnecting (or the key refused at send) | `compose_reconnect_gmail`: "Reconnect your Gmail in Settings to send email from the CRM." |
| Gmail off for the app | `compose_gmail_off`: "Email can't be sent from the CRM right now." |
| Gmail unavailable / Storage unreachable / BadHeader | `compose_send_failed`: "The email could not be sent. Try again in a minute." |
| success (flash `email_sent`) | `templates.email_sent(addresses, count)`: "Email sent to a@…, b@…." — the first 5 addresses (To, Cc, Bcc order; fewer when they do not fit the flash's 300 characters) then "and <n> more" |

Duplicates (case-insensitive, whitespace trimmed) are removed silently, the first one kept (To before Cc before Bcc).
