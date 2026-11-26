# Data model: Fetch past emails (SF-128)

## Migration `migrations/0020_past_email_fetches.sql`

Only statements allowed in a transaction; RLS enabled, no policies (AGENTS.md).

```sql
-- SF-128: one past-email fetch per Gmail connection (so per user): running, then ended (kept to show its end
-- message until the next press). Deleted by a disconnect or a deactivation (forgetGmailInTx); what it copied stays.
create table past_email_fetches (
  id bigint generated always as identity primary key,
  connection_id bigint not null unique references gmail_connections (id) on delete cascade,
  state text not null check (state in ('running', 'ended')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  slice_end timestamptz not null,
  page_token text null check (char_length(page_token) <= 1024),
  page_offset int not null default 0 check (page_offset >= 0),
  copied int not null default 0 check (copied >= 0),
  problem text null check (problem in ('unavailable')),
  wait_until timestamptz null,
  lease_until timestamptz null,
  started_at timestamptz not null,
  ended_at timestamptz null,
  updated_at timestamptz not null default now(),
  check (window_start < window_end),
  check ((state = 'ended') = (ended_at is not null)),
  check (state = 'running' or (lease_until is null and wait_until is null and problem is null))
);
alter table past_email_fetches enable row level security;
```

`tests/support/reset.ts` adds `past_email_fetches` to its `truncate` list.

## Entity: past email fetch (`past_email_fetches`)

| Field | Meaning |
|---|---|
| `connection_id` | the user's Gmail connection (unique: one fetch per user at a time, and the last ended one) |
| `state` | `running` (parts still to do; shown paused while the connection is `needs_reconnect`) or `ended` |
| `window_start`, `window_end` | fixed at the press: `window_end` = the press, `window_start` = 12 calendar months earlier (UTC) |
| `slice_end` | exclusive upper bound of the 7-day slice being listed; starts at `window_end + 1 day` |
| `page_token`, `page_offset` | Gmail's page of the current slice (null = first page) and how many of its threads are done |
| `copied` | conversations this fetch created for the account (+1 in the transaction that created the thread) |
| `problem` | `unavailable` after a part could not reach Gmail; cleared by the next handled thread |
| `wait_until` | Gmail asked to slow down: no part before this time |
| `lease_until` | a part is running until at most this time (90 s lease) |
| `started_at`, `ended_at` | the press; the end |

Slice of a cursor: `[max(slice_end − 7 days, window_start − 1 day), slice_end)`, listed with
`q = after:<floor(lower / 1000)> before:<ceil(slice_end / 1000)>`.

### State changes

| From | Event | To | Where |
|---|---|---|---|
| no row, or `ended` | the user presses `[ FETCH PAST EMAILS ]` on a `working` connection | `running`: window from now, `slice_end = now + 1 day`, token null, offset 0, `copied = 0`, `started_at = now`, `ended_at`/`problem`/`wait_until`/`lease_until` null | `startPastFetch` (row lock on `gmail_connections`, conditional upsert) |
| `running` | press again, second tab, posted request | unchanged | same (upsert's `where state = 'ended'` returns nothing) |
| `running` | a thread handled | `page_offset + 1`, `problem = null`; `copied + 1` when its first message created the thread | `runPastFetchPart` / `storeMessage(…, { fetchId })` |
| `running` | page done / slice done | next `page_token`, offset 0 / `slice_end −= 7 days`, token null, offset 0 | `runPastFetchPart` |
| `running` | last slice done (its lower bound is `window_start − 1 day`) | `ended`, `ended_at = now`, lease, wait, problem null | `runPastFetchPart` |
| `running` | Gmail asks to slow down | `wait_until = now + seconds` | `runPastFetchPart` |
| `running` | Gmail can't be reached | `problem = 'unavailable'`, cursor unchanged | `runPastFetchPart` |
| `running` | Google refuses the key | unchanged (connection → `needs_reconnect` through `markNeedsReconnect`) | `runPastFetchPart` |
| any | disconnect, deactivation | row deleted | `forgetGmailInTx` |

### Card state (`pastFetchView`, read with `gmailSettings`)

`GmailSettings` gains `pastFetch: PastFetchView`:

```ts
type PastFetchView =
  | { state: "none" }                                   // never pressed on this connection
  | { state: "running"; copied: number; paused: boolean; unreachable: boolean; waitSeconds: number }
  | { state: "ended"; copied: number; endedAt: Date };
```

`paused` = connection `needs_reconnect`; `unreachable` = `problem = 'unavailable'`; `waitSeconds` = seconds until
`wait_until` (0 when none or past). Shown only for a connected card (`working` or `needs_reconnect`):

| View | Right of "// PAST EMAILS" | Lines |
|---|---|---|
| none, working | `[ FETCH PAST EMAILS ]` | `past_emails_explain` |
| none, needs_reconnect | — | `past_emails_explain` |
| running (not paused) | `FETCHING…` | `past_emails_progress(copied)`; `past_emails_unreachable` when unreachable; `past_emails_leave`; `PastFetchRunner` on a working connection |
| running, paused | `FETCHING…` | `past_emails_progress(copied)`; `past_emails_paused` |
| ended, working | `[ FETCH PAST EMAILS ]` | `past_emails_done(copied)`; `past_emails_last(formatDateTime(endedAt))` |
| ended, needs_reconnect | — | the same two lines |

## Existing entities used

- `gmail_connections` (SF-118): the connection a fetch runs on; only `working` connections run parts. Unchanged columns.
- `email_threads`, `email_messages`, `email_attachments` (SF-118): unchanged tables; the fetch stores through the same
  `storeMessage` and the same unique indexes (`(connection_id, gmail_thread_id)`, `(connection_id, gmail_message_id)`).
- `person_emails` (SF-90): the CRM addresses, read once per examined thread (`select email from person_emails where
  email = any($addresses)`); archived and private people included, deleted people gone.

## Copy rule (pure `planPastThread` in `src/server/gmail/rules.ts`)

```ts
planPastThread(input: {
  messages: { id: string; labelIds: string[]; internalDate: Date; addresses: string[] }[];
  windowStart: Date; windowEnd: Date;
  crmAddresses: ReadonlySet<string>; stored: ReadonlySet<string>;
}): string[]   // message ids to read in full and store, oldest first
```

1. candidates: no `DRAFT` / `SPAM` / `TRASH` label, `windowStart ≤ internalDate ≤ windowEnd` (an unreadable date never counts);
2. none of the candidates has an address in `crmAddresses` → `[]`;
3. else the candidates not in `stored`, by `internalDate` ascending.

## Fake mailbox of 100 conversations (`src/server/gmail/fake-past-mailbox.ts`)

`putPastMailbox(fake, email, { now })` puts these 100 conversations (dates relative to `now`, spread over the last 14
months); the CRM side (people and addresses) is made by the caller (tests: `tests/integration/gmail-helpers.ts`;
dev page: the seeded fake people, or the people the test creates). Addresses used (all clearly fake):
`ana.fake@example.test` and `ana.home@example.test` (Ana Fake, two addresses), `ben.fake@example.test` (Ben Fake),
`pia.private@example.test` (private, another owner), `arlo.archived@example.test` (archived),
`nia.later@example.test` (not in the CRM until US3 scenario 2 adds her), `news@example.test`, teammates
`*@barnacle.ai`.

| Group | Conversations | Copied | Notes |
|---|---|---|---|
| A | 40 | yes | from Ana/Ben at their first address, 1–3 messages within 12 months, some with attachments |
| B | 8 | yes | Ana's second address |
| C | 4 | yes | sent by the user, the CRM person only in Cc (2) or Bcc (2) |
| D | 3 | yes | 1 message 14 months ago + 2 last month: 2 messages stored each |
| E | 3 | yes | the address in other case (`ANA.FAKE@Example.test`) |
| F | 2 | yes | Pia (private) and Arlo (archived) |
| G | 5 | no | newsletters from `news@example.test` |
| H | 5 | no, until Nia is added | with `nia.later@example.test` within 12 months (US3 scenario 2: then 5) |
| I | 8 | no | teammates only |
| J | 8 | no | with a CRM person, every message 13–14 months old |
| K | 4 | no | CRM person only in a 14-month-old message; recent messages between teammates |
| L | 4 | no | drafts to a CRM person |
| M | 3 | no | spam from a CRM person |
| N | 2 | no | in the bin, with a CRM person |
| O | 1 | no | display name "Ana Fake" with `other@example.test` |

Total 100; copied **60**. Tests that need other mailboxes (edge cases "The 12 months", "Large mailbox": 100 all
matching, teammates' mailboxes) put their own messages with `fake.addMessage`.
