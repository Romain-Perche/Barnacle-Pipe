# Contracts: pages, routes, actions (SF-127)

Every page and route starts with `requireUser()`; every action with `requireUser()`. A conversation the user cannot
see (`visibleConversation`) or that does not exist gives the same answer: `notFound()` / 404 / `not_found`.

## Record pages (changed)

`/people/[id]`, `/organisations/[id]`, `/deals/[id]`:

```text
RecordHeader (kind, name, [ EDIT ] [ ARCHIVE ] …)            ← unchanged, above both columns
notices (NoteNotices, ActivityNotices, file notices)          ← unchanged, above both columns
.recordcols
├── left:  // DETAILS (+ deal: StageBar, value, linked people), // MORE DETAILS, Referred by
└── right: TimelineNoteBox (not when archived) · // NEXT ACTIVITIES · // FILES · // TIMELINE
```

Under 1000 px the columns stack, left first. The deal drawer (`DealDrawer.tsx`) is unchanged: one column, read-only
timeline (with EMAIL entries).

## EMAIL timeline entry

On every record timeline and the drawer, among the other entries, newest first, in its UK day group:

```text
EMAIL  <Sender name or address> → <To names>[ · Cc <names>][ · Bcc <names>]               14:05
       ┃ <Subject or "(no subject)">                    (box, 3px blue left edge)
       ┃ <first 200 characters of the plain text>…     (only when there is text)
       ┃ figures.pdf · 240 KB   notes.txt · 1 KB        (every attachment, formatFileSize)
```

- `<li id="email-<messageId>">`; the subject links to `/emails/<conversationId>?from=<kind>-<recordId>#email-<messageId>`.
- Tag `EMAIL` (`.kd.email`: solid blue). Every string is a React text node.

## `GET /emails/[id]` — the conversation page (design B)

| Query | Meaning |
|---|---|
| `from=person-<id>` \| `organisation-<id>` \| `deal-<id>` | back link "← <NAME IN CAPITALS>" to that record when the viewer can see it; anything else: no back link |
| `link=deal` \| `person` \| `organisation` | shows that link form in // LINKED TO |
| `notice=attachment-unavailable` \| `linked` \| `unlinked` \| `link-refused` | one fixed message from `messages.ts` |

```text
← ANA EXAMPLE
CONVERSATION · 3 EMAILS                 (templates.conversation_count(n))
<Subject of the oldest email>           (h1, "(no subject)" when empty)
.recordcols
├── // LINKED TO
│     PERSON  Ana Example (link)  [Archived]   [ UNLINK ]
│     ORG     Example Ltd                      [ UNLINK ]
│     DEAL    Example Ltd – pilot              [ UNLINK ]
│     (none: "Not linked to any record.")
│     [ LINK DEAL ] [ LINK PERSON ] [ LINK ORGANISATION ]   (links to ?link=…)
│     form when ?link=: picker + [ LINK ] + [ CANCEL ]
└── // EMAILS · OLDEST FIRST
      <article id="email-<messageId>">  Sender <address>        20 NOV 2026 11:30
        To …  · Cc …  · Bcc … (only when the shown copy has it)
        full plain text (white-space: pre-wrap)
        figures.pdf · 240 KB  [ DOWNLOAD ] → /emails/attachments/<attachmentId>/download
```

Order: `received_at asc, id asc`, one per `dedupe_key` (shown copy: data-model.md). `not-found.tsx`: the generic
"This conversation doesn't exist or you can't see it." with no subject or names.

## `GET /emails/attachments/[id]/download` — route handler

`export const maxDuration = 60`.

| Case | Answer |
|---|---|
| id not a number, attachment missing, conversation hidden | 404 (`notFound()`), body says nothing about it |
| fetched through a working mailbox | 200, streamed bytes; headers: `content-type: application/octet-stream`, `content-disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded safeDownloadName(name)>`, `content-length: <bytes>`, `x-content-type-options: nosniff`, `content-security-policy: sandbox`, `cache-control: no-store`, `referrer-policy: no-referrer` |
| no working mailbox can provide it (disconnected, needs reconnect, deactivated, Gmail down, message or part gone) | 303 → `/emails/<conversationId>?notice=attachment-unavailable#email-<messageId>`, `cache-control: no-store` |

Candidate order: the attachment's own copy, then the other copies of the same email (same conversation and
`dedupe_key`), by id; only `gmail_connections.state = 'working'`.

## Server actions — `src/app/(app)/emails/actions.ts`

### `linkRecord(formData)`

Fields: `conversationId`, `kind` (`deal` | `person` | `organisation`), `dealId` | `personId` | `organisationId`, `from`.

In one transaction: conversation row `for update` and `visibleConversation` → else `not_found`; the target visible
(`visiblePerson` / `visibleDeal`) and not archived → else `link-refused`; upsert the link (data-model.md § State
changes). Then `revalidatePath` and redirect `/emails/<id>?from=…&notice=linked`. Linking to a private deal the user
can see is allowed (the conversation then hides from others).

### `unlinkRecord(formData)`

Fields: `conversationId`, `linkId`, `from`. Conversation visible and the link of that conversation and not removed →
`removed = true`; redirect `?notice=unlinked`. Unlinking may make the conversation visible to more people; never hides
it from the user who acts.

## Server functions (for tests and pages)

| Function | File | Returns |
|---|---|---|
| `processMessage(db, messageId)` | `src/server/emails/process.ts` | conversation id |
| `autoLink(db, conversationIds)` | same | void |
| `linkForPeople(db, personIds)` | same | void |
| `catchUpEmails(now)` | same | number processed |
| `timelineEmails(viewerId, target, limit)` | `src/server/emails/timeline.ts` | `TimelineEntry[]` (kind `email`) |
| `getConversation(viewerId, id)` | `src/server/emails/conversations.ts` | `{ id, subject, emails[], links[] } \| null` |
| `linkChoices(viewerId)` | same | `{ deals, people, organisations }` (visible, not archived) |
| `linkRecord(actorId, input)` / `unlinkRecord(actorId, input)` | same | `{ status: "ok" \| "not_found" \| "refused" }` |
| `attachmentAccess(viewerId, id)` | `src/server/emails/attachments.ts` | `{ attachment, candidates[] } \| null` |
| `fetchAttachment(access)` | same | `{ bytes: Uint8Array } \| "unavailable"` |

`TimelineEntry` gains `email: TimelineEmail | null`:
`{ messageId, conversationId, from: {name, email}, to[], cc[], bcc[], subject, preview: string | null, attachments: {id, name, size}[] }`;
`EventKind` gains `"email"`; `entryTag` returns `"EMAIL"`.

## Messages

New keys in `src/server/messages.ts` (exact wording Build's choice, in the house style):

- `email_no_subject` — "(no subject)"
- `email_attachment_unavailable` — "This attachment can't be fetched from Gmail right now. Try again later."
- `email_not_found` — "This conversation doesn't exist or you can't see it."
- `email_linked` / `email_unlinked` — "Linked." / "Unlinked."
- `email_link_refused` — "This record can't be linked: it was archived or you can't see it."
- `email_no_links` — "Not linked to any record."
- `templates.conversation_count(n)` — "CONVERSATION · 1 EMAIL" / "CONVERSATION · n EMAILS"
