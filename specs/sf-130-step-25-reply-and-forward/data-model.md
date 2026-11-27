# Data model: Reply and forward (SF-130)

No new table. One column on SF-129's ledger. Everything else reuses SF-118 / SF-127 / SF-129 tables unchanged.

## Migration `migrations/0022_email_reply.sql`

```sql
-- SF-130: a reply or forward names the email it answers, so the sent email joins that email's conversation even when
-- it starts a new Gmail thread in the sender's mailbox (research.md §1). No hand link is made for it: the record
-- columns stay null.
alter table email_sends add column reply_message_id bigint null references email_messages (id) on delete set null;
```

- Allowed in a transaction; no `create table`, so no RLS line. `tests/support/reset.ts` already empties
  `email_sends`.
- Ledger rows of a reply: `deal_id`, `person_id`, `organisation_id` all null (`num_nonnulls(...) <= 1` already allows
  it); `reply_message_id` = the answered `email_messages.id` (the shown copy); `upload_ids` as SF-129.

## Entities used

| entity | table / source | read for |
|---|---|---|
| Email answered | `email_messages` (+ `email_threads.conversation_id`, `email_attachments`) | prefill, quote, headers, forwarded files |
| Conversation | `email_conversations` through `visibleConversation(db, viewerId, "c")` | buttons, box, send-time check |
| User's Gmail thread | `email_threads` of the user's connection in that conversation | `threadId` (research §3) |
| Send | `email_sends` (SF-129) + `reply_message_id` | double press, joining the conversation, catch-up by the sync |
| Forwarded attachment (transient) | `email_attachments` row → bytes from Gmail (SF-127 `fetchAttachment`) | sending only, never stored |
| Gmail connection | `gmail_connections` (state, email) | buttons / link, own address, From |

## Prefill (pure, `src/server/emails/reply-rules.ts`)

Input: the answered email `{ from: EmailAddress | null; to; cc; subject; receivedAt; text: string | null }`, mode,
own address (or null).

| mode | To | Cc | Bcc | Subject | Attachments | Quote |
|---|---|---|---|---|---|---|
| reply | own sender → its To; else `[from]` (none when no sender) | — | — | `replySubject` | none | reply quote |
| reply_all | reply's To + email's To, minus own, once each | email's Cc minus own, minus To's | — | `replySubject` | none | reply quote |
| forward | — | — | — | `forwardSubject` | every attachment of the email | forward block |

Addresses are taken as stored (`email`), compared lower-cased, and kept in first-seen order. Names for the chips come
from the sender's visible CRM people (SF-129 `nameRecipients`, exported as `namesFor(actorId, addresses)`), never from
the email.

Quote (reply):
```
On 27 Nov 2026 at 14:05, Ana Fake <ana@example.test> wrote:
> line 1
>
> line 3
```
Quote (forward):
```
---------- Forwarded message ---------
From: Ana Fake <ana@example.test>
Date: 27 Nov 2026 at 14:05
Subject: Pricing
To: Ada Fake <ada@barnacle.ai>, ben@example.test

<text unchanged>
```
Body sent = `text + "\n\n" + quote`.

## Headers (research §2)

- `In-Reply-To`: answered `rfc_message_id` (when it matches `^<[^<>\s]{1,996}>$`).
- `References`: the conversation's shown emails' `rfc_message_id`s, oldest first (`received_at, id`), up to and
  including the answered one, deduplicated, folded at spaces.
- `threadId`: research §3.

## Validation and refusals (send time)

SF-129's codes are unchanged (`compose_*`). New:

| code | when | text (`messages.ts`) |
|---|---|---|
| `email_not_found` (existing SF-127) | conversation hidden / missing, or the answered email no longer in it | "This conversation doesn't exist or you can't see it." |
| `reply_forward_unavailable` | a forwarded attachment cannot be fetched from any working mailbox | "One of the forwarded attachments can't be fetched from Gmail right now. Remove it or try again later." |

`compose_attachment_gone` also covers a forwarded id not among the answered email's attachments.

## New fixed texts (`messages.ts`)

| key | text |
|---|---|
| `reply_button` | `[ REPLY ]` |
| `reply_all_button` | `[ REPLY ALL ]` |
| `forward_button` | `[ FORWARD ]` |
| `reply_connect_gmail` | `[ CONNECT GMAIL TO REPLY ]` |
| `reply_reconnect_gmail` | `[ RECONNECT GMAIL TO REPLY ]` |
| `reply_heading` / `reply_all_heading` / `forward_heading` | `// REPLY` / `// REPLY ALL` / `// FORWARD` |
| `reply_footer` | `Sent from your Gmail, in this conversation.` |
| `reply_quote_label` | `Quoted below your text` |
| `reply_forward_unavailable` | see above |
| `reply_forwarded_label` | `Forwarded` |

The box heading is `<heading> · <subjectOrDefault(answered subject)>` (subject as text, not upper-cased).

## State changes

1. Press `[ SEND ]` → ledger row `sending` (with `reply_message_id`) → Gmail → `storeMessage`:
   `placePendingReply` (thread → conversation) → `processMessage` (addresses, auto links, Last contacted) →
   `completePendingSend` (no hand link; ledger `sent`).
2. Failure before Gmail accepted → ledger row deleted, nothing else changed.
3. Stored later by the sync → same `storeMessage` path; `decideCopy` copies it because a ledger row is pending.
