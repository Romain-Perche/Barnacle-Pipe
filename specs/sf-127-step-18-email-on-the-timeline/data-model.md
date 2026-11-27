# Data model: Email on the timeline (SF-127)

Existing tables from SF-118 (`migrations/0016_gmail.sql`): `gmail_connections`, `email_threads` (one per mailbox and
Gmail thread), `email_messages` (one per mailbox and Gmail message; `direction`, `from_*`, `to_list` / `cc_list` /
`bcc_list` jsonb `[{email, name}]`, `subject`, `received_at` = Gmail's time, `text_body`, `html_body`),
`email_attachments` (`message_id`, `position`, `name`, `content_type`, `size`).

## Entities

### Conversation — `email_conversations` (new)

| Column | Type | Rule |
|---|---|---|
| id | bigint identity PK | |
| created_at | timestamptz default now() | |

Its subject is read, not stored: the subject of its oldest shown email (empty → "(no subject)"). Threads point at it.

### Thread — `email_threads` (changed)

| New column | Type | Rule |
|---|---|---|
| conversation_id | bigint null → `email_conversations(id)` | set by processing; null only for threads copied before SF-127 and not processed yet. Index. |

### Email — `email_messages` (changed)

| New column | Type | Rule |
|---|---|---|
| linked_at | timestamptz null | null until processed (§ Processing); partial index `where linked_at is null` |
| dedupe_key | text generated always as `coalesce(rfc_message_id, 'g:' \|\| connection_id \|\| ':' \|\| gmail_message_id)` stored | the same email in several mailboxes shares it; index `(thread_id, dedupe_key)` not needed — index `(dedupe_key)` |

**Shown copy** of an email in a conversation: `distinct on (t.conversation_id, m.dedupe_key)` ordered by
`(m.direction = 'sent') desc, m.id` — the sender's copy, else the first stored.

### Conversation address — `email_conversation_addresses` (new)

| Column | Type | Rule |
|---|---|---|
| conversation_id | bigint → `email_conversations(id)` on delete cascade | |
| email | text, `= lower(btrim(email))`, ≤ 254 | every From / To / Cc / Bcc address of every copy |
| PK (conversation_id, email) | | index on `email` (person added later → their conversations) |

Used for automatic linking and for the privacy rule ("a person in its emails").

### Conversation link — `email_links` (new)

| Column | Type | Rule |
|---|---|---|
| id | bigint identity PK | |
| conversation_id | bigint → `email_conversations(id)` on delete cascade | |
| person_id | bigint null → `persons(id)` on delete cascade | exactly one of the three is set (check) |
| organisation_id | bigint null → `organisations(id)` on delete cascade | |
| deal_id | bigint null → `deals(id)` on delete cascade | |
| how | text check in ('auto', 'manual') | who made the link (last) |
| removed | boolean default false | true: unlinked by hand, remembered so automatic linking never adds it again |
| changed_by | bigint null → `users(id)` | null for automatic |
| changed_at | timestamptz default now() | |

Unique: `(conversation_id, person_id) where person_id is not null`, same for organisation and deal (partial unique
indexes, so `on conflict do nothing` without a target covers them). Indexes on `person_id`, `organisation_id`,
`deal_id` (timeline reads).

**State changes**

| From | Event | To |
|---|---|---|
| (none) | automatic linking | `how=auto, removed=false` |
| (none) | linked by hand | `how=manual, removed=false, changed_by=user` |
| any, not removed | unlinked by hand | `removed=true, changed_by=user, changed_at=now()` (how kept) |
| removed | linked by hand | `how=manual, removed=false, changed_by, changed_at` |
| removed | automatic linking | unchanged (FR-011) |
| any | record deleted | row deleted (cascade) |

**Merge** (two conversations become one): for a target in both, keep per `mergeLinkChoice`: a hand choice (`how =
manual` or `removed`) beats a plain automatic link; two hand choices → the later `changed_at`.

### Attachment — `email_attachments` (unchanged)

`position` is the index in `attachmentParts(payload)` — the one walk shared by `readMessage` and the download.

### Person (existing) — `persons.last_contacted_at`

Raised, never lowered: `greatest(coalesce(last_contacted_at, '-infinity'), received_at)` for every person with an
address among the email's From / To / Cc / Bcc, private and archived people included (FR-014). No timeline event
(as for done activities).

## Processing an email

`processMessage(db, messageId)`, inside the caller's transaction:

1. `lock table email_conversations in share row exclusive mode`.
2. Conversation of the message's thread (research §1): own → match by `rfc_message_id` in another thread → new; set
   `email_threads.conversation_id`. Two conversations → merge into the smaller id (threads, addresses `on conflict do
   nothing`, links by `mergeLinkChoice`, delete the other).
3. Insert its addresses into `email_conversation_addresses` (`on conflict do nothing`).
4. `autoLink(db, [conversationId])` (research §5).
5. Raise Last contacted of the people with those addresses.
6. `update email_messages set linked_at = now() where id = messageId`.

`catchUpEmails(now)`: up to 500 messages `where linked_at is null order by id`, one `sql.begin()` each.
`linkForPeople(db, personIds)`: conversations with an address of those people → `autoLink`. Neither raises Last
contacted (only emails do, at processing).

## Visibility

`visibleConversation(db, viewer, alias = "c")` in `src/server/records/visibility.ts`:

```text
not exists (address of c joined to person_emails → persons vcp where not visiblePerson(vcp))
and not exists (email_links of c, removed = false, person not visiblePerson)
and not exists (email_links of c, removed = false, deal not visibleDeal)
```

Every read of `email_conversations`, `email_threads`, `email_messages`, `email_attachments`, `email_links` for a viewer
goes through it.

## Migration

`migrations/0020_email_timeline.sql` (statements allowed in a transaction only):

1. `create table email_conversations (…)`; `alter table email_conversations enable row level security;`
2. `alter table email_threads add column conversation_id bigint null references email_conversations (id);`
   `create index email_threads_conversation_idx on email_threads (conversation_id);`
3. `alter table email_messages add column linked_at timestamptz null, add column dedupe_key text generated always as
   (coalesce(rfc_message_id, 'g:' || connection_id::text || ':' || gmail_message_id)) stored;`
   `create index email_messages_unlinked_idx on email_messages (id) where linked_at is null;`
   `create index email_messages_dedupe_idx on email_messages (dedupe_key);`
4. `create table email_conversation_addresses (…)` + RLS + `create index … on email_conversation_addresses (email);`
5. `create table email_links (…)` with the check "exactly one target", the three partial unique indexes, the three
   target indexes, + RLS.

Nothing is backfilled in SQL: existing messages keep `linked_at` null and are processed by the next Gmail check.

`tests/support/reset.ts` empties the three new tables too.
