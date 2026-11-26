# Implementation Plan: Email on the timeline

**Branch**: `factory/sf-127-step-18-email-on-the-timeline` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/sf-127-step-18-email-on-the-timeline/spec.md`

## Summary

The emails SF-118 copies from each teammate's Gmail appear on the CRM's timelines, open as a conversation page
(design B), link themselves to people, organisations and deals, and raise Last contacted.

- **One conversation across mailboxes.** SF-118 stores one `email_threads` row per mailbox. A new table
  `email_conversations` groups them: a thread joins the conversation of any other mailbox's thread that holds a message
  with the same Message-ID; two conversations found to be one are merged. Each email is shown once: copies share a
  `dedupe_key` (the Message-ID, else the mailbox's own Gmail id), and the sender's copy is the one shown.
- **After-store step, one code path.** `email_messages.linked_at` is null until the message is "processed":
  conversation found or made, its addresses added to `email_conversation_addresses`, the conversation linked
  automatically, the people in it given a later Last contacted. `storeMessage` (SF-118) runs this in its own
  transaction. Emails copied before this issue have `linked_at` null: the 15-minute `runGmailCheck` processes them
  (`catchUpEmails`), so no data migration in SQL.
- **Links.** Table `email_links`: one row per conversation and person, organisation or deal, `how` auto/manual,
  `removed` for an unlink made by hand (so automatic linking, an `insert … on conflict do nothing`, never puts it back).
  Automatic linking (`autoLink`, set-based SQL) runs after each stored email and after a person is added or saved, and
  after CSV and Pipedrive imports of people.
- **Visibility.** `visibleConversation()` in `records/visibility.ts`: hidden when a person in its emails (any address
  of `email_conversation_addresses`) or a linked person or deal (not removed) is one the viewer cannot see. Every read
  of conversations, emails, attachments and links uses it; a hidden conversation answers 404 like a missing one.
- **Timeline.** `readTimeline` merges EMAIL entries (one per shown email of each conversation linked directly to the
  record), like done activities: read from the email tables, never copied into `timeline_events`. The entry: blue left
  edge box with sender → recipients, subject, the first 200 characters of plain text (HTML turned to text by the
  existing `htmlToText`), attachment names and sizes.
- **Conversation page** `/emails/[id]` (design B): `← <RECORD>` back link (`?from=person-12`), "CONVERSATION · N
  EMAILS", subject, `// LINKED TO` (left: [ UNLINK ], [ LINK DEAL ] / [ LINK PERSON ] / [ LINK ORGANISATION ]) and
  `// EMAILS · OLDEST FIRST` (right: full plain text in `pre-wrap`, To, Cc, Bcc, attachments with [ DOWNLOAD ]). No
  email HTML is ever put in the page.
- **Attachments** `/emails/attachments/[id]/download`: checks visibility, then fetches the bytes from Gmail
  (`messages.get` to find the part, `messages.attachments.get` when the bytes are not inline) through a working
  mailbox holding a copy (its own first), and streams them as `application/octet-stream` with
  `Content-Disposition: attachment`. No working copy → 303 to the conversation page with the "can't be fetched from
  Gmail right now" notice.
- **Layout.** Person, organisation and deal pages: details left (`.recordcols`), note box, // NEXT ACTIVITIES,
  // FILES, // TIMELINE right; stacked under 1000 px. The note box moves out of `RecordTimeline` to the top of the
  right column. The deal drawer is unchanged.

## Technical Context

**Language/Version**: TypeScript 6, Node (Vercel), Next.js 16 App Router, React 19

**Primary Dependencies**: existing only (`next`, `react`, `postgres`, `geist`); no new package (`dependencies.json` is
`[]`): HTML → text reuses `src/server/pipedrive/html.ts`, download names reuse `safeDownloadName`

**Storage**: Postgres (postgres.js, plain SQL). New migration `migrations/0020_email_timeline.sql`

**Testing**: Vitest unit (pure rules) and integration (real Postgres, `FakeGoogleMail` through `useGmailFetchForTests`,
every Gmail request checked against `.factory/schemas/gmail-api.json` by `tests/fakes/gmail.ts`)

**Target Platform**: Vercel (Pro), Supabase Postgres

**Project Type**: web application (single Next.js project)

**Performance Goals**: a record page's timeline adds one email query (limit + 1 rows) and one attachments query; the
after-store step is a handful of set-based statements per message; `catchUpEmails` handles at most 500 messages per
15-minute run

**Constraints**: no Google call inside `sql.begin()`; email HTML never rendered; attachments up to Gmail's 25 MB
streamed (route `maxDuration = 60`, Google call time-out 30 s for attachments); private rule holds for admins too

**Scale/Scope**: a small team (≈10 users), thousands of people, tens of thousands of emails

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unfilled template; the project's rules are `AGENTS.md`, `docs/PRODUCT.md`,
`docs/DESIGN.md` and `docs/DECISIONS.md`. Checked against them:

| Rule (AGENTS.md / DECISIONS) | How this plan meets it |
|---|---|
| Server components by default | Conversation page, timeline entries, links panel are server components; the only client parts are the existing `PersonPicker` / `OrganisationPicker` reused in the link forms |
| `requireUser()` on every page and action | `/emails/[id]` page, the download route and the two link actions start with `requireUser()` |
| User-facing text from `messages.ts`; never text taken from a URL | New keys listed in [contracts/routes.md](./contracts/routes.md#messages); `?from=` and `?link=` and `?notice=` are parsed to fixed values, never shown |
| Migrations: transaction-safe statements, RLS on every new table | `0020_email_timeline.sql`: `create table` + `enable row level security`, `alter table … add column`, indexes, no `concurrently` |
| One visibility rule per record kind, used by every read | `visibleConversation()` beside `visibleFile()`; every conversation, email, attachment and link read uses it |
| No Google call inside `sql.begin()` | The download route reads the candidates, then calls Gmail outside any transaction; `storeMessage` makes no network call |
| Fakes only for outside services; checked against the schema | `FakeGoogleMail` gains attachment bytes and `GET …/messages/{id}/attachments/{attachmentId}` (in the pinned `gmail-api.json`) |
| A private contact or deal hides its emails (kickoff, 2026-11-24) | `visibleConversation()`; hidden answers the same 404 as a missing id |
| Emails kept after disconnect/deactivation (SF-118) | Reads never filter on the connection's state; only attachment download needs a working mailbox |
| Fake data clearly fake | Seed adds no new names; the SF-118 seed conversations go through the real path and get linked |

No violation: Complexity Tracking stays empty.

**Post-design re-check**: unchanged: the design adds tables, one visibility fragment and routes in the existing
patterns, no new dependency, no second way of doing something the repo already does.

## Project Structure

### Documentation (this feature)

```text
specs/sf-127-step-18-email-on-the-timeline/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── routes.md        # pages, routes, actions, messages
│   └── gmail.md         # the Gmail calls and the fake's additions
├── dependencies.json    # []
├── blueprints.json      # [] (no blueprint index in this run)
└── tasks.md             # Phase 2 (/speckit-tasks, not here)
```

### Source Code (repository root)

```text
migrations/0020_email_timeline.sql                 # new: email_conversations, email_conversation_addresses, email_links,
                                                    #      email_threads.conversation_id, email_messages.linked_at / dedupe_key
src/server/emails/                                  # new folder (SF-127)
├── rules.ts            # pure: emailText, emailPreview (200), recipientsLine, parseFrom/fromHref, mergeLinkChoice,
│                       #       attachmentParts re-export use, contentDisposition
├── process.ts          # processMessage(db, messageId) (conversation + addresses + autoLink + Last contacted),
│                       # autoLink(db, conversationIds), linkForPeople(db, personIds), catchUpEmails(now)
├── conversations.ts    # getConversation, linkChoices, linkRecord, unlinkRecord
├── timeline.ts         # timelineEmails(viewerId, target, limit) → TimelineEntry[] (kind "email")
└── attachments.ts      # attachmentAccess, fetchAttachment (Gmail, candidate mailboxes in order)
src/server/gmail/rules.ts         # + attachmentParts(payload) shared by readMessage and the download
src/server/gmail/google-api.ts    # + getAttachment(access, messageId, attachmentId) (30 s time-out)
src/server/gmail/sync.ts          # storeMessage calls processMessage; runGmailCheck calls catchUpEmails first
src/server/gmail/fake-gmail.ts    # + attachment bytes (NewMessage.attachments[].data), inline small parts, attachments route
src/server/records/visibility.ts  # + visibleConversation()
src/server/records/timeline.ts    # + kind "email", TimelineEntry.email, merge of timelineEmails
src/server/records/timeline-view.ts  # entryTag → "EMAIL"
src/server/records/people.ts      # createPerson / updatePerson call linkForPeople
src/server/imports/imports.ts     # runImport (people) calls linkForPeople
src/server/pipedrive/imports.ts   # people page transaction calls linkForPeople for the people it added
src/server/messages.ts            # new keys (contracts/routes.md § Messages)
src/app/(app)/emails/[id]/page.tsx        # the conversation page (design B) + not-found.tsx
src/app/(app)/emails/[id]/LinkedTo.tsx    # // LINKED TO with the link forms
src/app/(app)/emails/EmailBody.tsx        # one email (header lines, pre-wrap text, attachments)
src/app/(app)/emails/actions.ts           # linkRecord, unlinkRecord
src/app/(app)/emails/attachments/[id]/download/route.ts   # maxDuration = 60
src/app/(app)/records/RecordTimeline.tsx  # EMAIL entries; note box moved out
src/app/(app)/records/TimelineNoteBox.tsx # new: the note box, first in the right column
src/app/(app)/records/EmailEntry.tsx      # the EMAIL entry (blue left edge)
src/app/(app)/people/[id]/page.tsx, organisations/[id]/page.tsx, deals/[id]/page.tsx   # two columns
src/app/globals.css                       # .recordcols, .emailbody, .kd.email, .conv*
AGENTS.md                                 # layout lines for src/server/emails and src/app/(app)/emails
tests/unit/emails-rules.test.ts, tests/integration/emails-*.test.ts, tests/fakes/gmail.ts (attachments route check)
```

**Structure Decision**: the single Next.js project as today; domain code in a new `src/server/emails/` (the Gmail
folder stays about talking to Gmail and copying), UI in `src/app/(app)/emails/`.

## Build steps (in order)

1. **Migration** `0020_email_timeline.sql` exactly as [data-model.md § Migration](./data-model.md#migration).
2. **Pure rules** `src/server/emails/rules.ts` and `attachmentParts` in `gmail/rules.ts` (readMessage uses it, so the
   positions stored and the positions read at download are the same walk) — unit tests first.
3. **Processing** `process.ts` ([data-model.md § Processing](./data-model.md#processing-an-email)); `storeMessage`
   calls `processMessage(db, msgId)` inside its transaction; `runGmailCheck` calls `catchUpEmails(now)` after the mode
   check and before the connections. `createPerson` / `updatePerson` / CSV `runImport` / the Pipedrive people page
   call `linkForPeople(db, ids)` at the end of their transaction.
4. **Visibility** `visibleConversation()`; **timeline** `timelineEmails` merged into `selectEntries` when
   `show.activitiesOf` is set (record timelines and the drawer, not the ambassador's latest updates).
5. **Conversation page, link actions, download route** per [contracts/routes.md](./contracts/routes.md);
   Gmail additions and fake per [contracts/gmail.md](./contracts/gmail.md).
6. **Layout** of the three record pages, `TimelineNoteBox`, CSS (design B of `design-options.html`: the email box
   `border-left: 3px solid var(--blue)`, the EMAIL tag solid blue like NOTE is orange).
7. **AGENTS.md** layout lines; **docs/DECISIONS.md**: one line each for the factory choices once confirmed (Build
   adds them only after the Plan Review: they are in spec.md § Clarifications).

No blueprint applies (no `blueprints/INDEX.md` in this run): `blueprints.json` stays `[]`, no exception, no
`docs/DECISIONS.md` blueprint line.

## Outside services

- Gmail API (users.messages.get, users.messages.attachments.get): schema https://github.com/googleapis/google-api-go-client/blob/3f740bc15212818d4d0eb041b02c951457ff63fa/gmail/v1/gmail-api.json
- Google OAuth 2.0 token endpoint (oauth2.googleapis.com/token, refresh of the mailbox's access token, reused from SF-118): no public schema found on GitHub (googleapis/google-api-go-client oauth2/v2/oauth2-api.json covers only tokeninfo and userinfo; googleapis/googleapis has no definition of the token endpoint)

## Complexity Tracking

No violation to justify.
