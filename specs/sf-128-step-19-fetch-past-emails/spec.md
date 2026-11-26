# Feature Specification: Fetch past emails

**Feature Branch**: `factory/sf-128-step-19-fetch-past-emails`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "Step 19 - Fetch past emails. A \"Fetch past emails\" button on the Gmail card in each user's Settings (`docs/DECISIONS.md`: past email comes in only from this button): it copies the last 12 months of the user's conversations with people in the CRM, by any of their email addresses, exactly as the Gmail sync copies new mail. It runs in parts within the hosting's time limits and Gmail's rate limits, shows its progress on the card (\"<n> conversations copied\"), carries on if the page is closed, and ends with the number copied. Pressing it again (for example after a Pipedrive import) copies only conversations not copied yet; nothing is ever copied twice, and the button cannot run twice at once for the same user. Gmail is faked in tests, with a mailbox of a hundred conversations."

## Clarifications

### Session 2026-11-26

- Q: Which design? → A: Design: B, a "// PAST EMAILS" part inside the Gmail card with its own `[ FETCH PAST EMAILS ]`, a one-line explanation, then the progress ("Fetching past emails: <n> conversations copied", "FETCHING…", "You can leave this page: fetching carries on by itself.") and the result ("Past emails fetched: <n> conversations copied.", "Last fetched <date time>. Press again after an import to copy conversations with new people.") in the same place (see `design-options.html`).
- Q: A conversation the sync already copied: does the fetch add its earlier messages? → A: Yes: the fetch adds the missing earlier messages from the 12 months and does not count the conversation again (A).
- Q: For a conversation that started more than 12 months ago, which messages does the fetch copy? → A: Only its messages from the last 12 months (A).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fetch my last 12 months of conversations with CRM people (Priority: P1)

A team member has connected their Gmail (SF-118), so new mail is copied, but their history with the people already in the CRM is not. On their Settings page, the Gmail card has a "// PAST EMAILS" part with `[ FETCH PAST EMAILS ]` and the line "Copies the last 12 months of your conversations with people in the CRM. Press again after an import: nothing is copied twice." They press it; the card shows that fetching has started and, as it goes, "Fetching past emails: <n> conversations copied". When it ends, the card says "Past emails fetched: <n> conversations copied." and the card's total of conversations copied has gone up by the same number.

**Why this priority**: DECISIONS (2026-11-24) says past email comes in only from this button; without it the CRM has no email history for any contact from before the day each user connected, which is what the team most needs when picking up a relationship.

**Independent Test**: With the fake Gmail holding a mailbox of 100 conversations over the last 14 months (some with CRM people at their first or second address, some with nobody from the CRM, some older than 12 months, some in drafts or spam), connect a fake user, press `[ FETCH PAST EMAILS ]`, let it run to the end, and confirm exactly the expected conversations and their messages are copied, each once, with the final number matching.

**Acceptance Scenarios**:

1. **Given** a connected user whose Gmail card shows "0 conversations copied" and whose fake mailbox holds 100 conversations, 60 of them dated within the last 12 months with a CRM person (at any of that person's addresses) as sender or recipient, **When** they press `[ FETCH PAST EMAILS ]` and it runs to the end, **Then** the card shows "Past emails fetched: 60 conversations copied." and "60 conversations copied".
2. **Given** the same mailbox, **When** the fetch ends, **Then** none of these is copied: a conversation with no CRM person in it (a newsletter, mail between teammates only), a conversation whose messages are all older than 12 months, a draft, mail only in spam or bin.
3. **Given** a conversation with a CRM person, three of its messages within the last 12 months and one older, **When** the fetch ends, **Then** the three recent messages are copied with the same details the Gmail sync keeps (sender, recipients, subject, date, text, attachment names and sizes, never attachment contents) and the older one is not.
4. **Given** a fetch that is running, **When** the user opens or reloads Settings, **Then** the card shows "Fetching past emails: <n> conversations copied" with the number so far, and no `[ FETCH PAST EMAILS ]` button.
5. **Given** a fetch that copied nothing because the mailbox has no conversation with a CRM person in the last 12 months, **When** it ends, **Then** the card shows "Past emails fetched: 0 conversations copied."

---

### User Story 2 - It finishes even if I close the page (Priority: P1)

A mailbox can hold thousands of conversations: fetching them takes longer than one request may last and must respect Gmail's limits. The fetch therefore runs in parts. While Settings is open, the parts follow each other and the progress updates on its own; if the user closes the page or signs out, the fetch carries on without them and has ended by the time they come back.

**Why this priority**: Without parts the fetch fails on any real mailbox; without carrying on, a user who navigates away loses the fetch half done.

**Independent Test**: With the fake Gmail's 100 conversations and a part size made small in tests, press the button, let one part run, close the page (no further requests from the browser), run the app's regular background check a few times, then open Settings and confirm the fetch has ended with the full number, as in US1 scenario 1.

**Acceptance Scenarios**:

1. **Given** a fetch with more to copy than one part handles, **When** Settings stays open, **Then** without the user doing anything the number in "Fetching past emails: <n> conversations copied" goes up after each part, and the card ends with "Past emails fetched: 60 conversations copied."
2. **Given** a fetch started and the page closed after the first part, **When** the tester runs the 15-minute check from the fake mailbox page as often as needed, then opens Settings, **Then** the card shows "Past emails fetched: 60 conversations copied." and "60 conversations copied", the same as with the page open.
3. **Given** Gmail asks the CRM to slow down during a part, **When** that happens, **Then** the card keeps showing "Fetching past emails: <n> conversations copied" with the same number until Gmail's wait is over, then the number goes up again and the fetch ends with "Past emails fetched: 60 conversations copied."
4. **Given** Gmail cannot be reached for a while, **When** a part fails, **Then** the card says "Gmail can't be reached right now. Fetching will carry on by itself." with the number unchanged; once the fake Gmail answers again and the 15-minute check runs, the fetch ends with "Past emails fetched: 60 conversations copied."

---

### User Story 3 - Press it again later; nothing is ever copied twice (Priority: P1)

After a Pipedrive or CSV import adds many people to the CRM, the user presses `[ FETCH PAST EMAILS ]` again. It copies only the conversations with the newly added people (and any other conversation with a CRM person not copied yet); conversations copied before, by an earlier fetch or by the live sync, are not counted again and none of their messages is stored twice. Pressing it twice, in two tabs or quickly, starts one fetch only.

**Why this priority**: The DECISIONS line names this case ("can be pressed again (after an import, for example) and never copies a conversation twice"); duplicates would make every later email view wrong.

**Independent Test**: Run a full fetch, add a CRM person whose address appears in 5 conversations of the fake mailbox, press the button again and confirm "Past emails fetched: 5 conversations copied." with no message stored twice; press it in two sessions at the same moment and confirm one fetch runs.

**Acceptance Scenarios**:

1. **Given** a fetch already ended with 60 conversations copied, **When** the user presses the button again with nothing changed, **Then** it ends with "Past emails fetched: 0 conversations copied." and the total stays 60.
2. **Given** that state and a person added to the CRM (by hand, a CSV import or a Pipedrive import) whose address is in 5 conversations of the last 12 months, **When** the user presses the button again, **Then** it ends with "Past emails fetched: 5 conversations copied." and the total shows 65.
3. **Given** a conversation the live sync already copied (a reply that came in after connecting, in a conversation that started 3 months ago), **When** a fetch runs, **Then**, when that is the only conversation with a CRM person, the card shows "Past emails fetched: 0 conversations copied." and the total is unchanged, and the automated tests find its earlier messages from the last 12 months stored once each beside the reply (clarified 2026-11-26).
4. **Given** a fetch running, **When** a new message from a CRM person arrives and the live sync copies it at the same time, **Then** the card's total goes up by 1 for that conversation, not 2, and the automated tests find the message stored once.
5. **Given** a fetch running, **When** the same user presses the button from another tab or posts the request again, **Then** no second fetch starts and the card shows the running fetch's progress.

---

### User Story 4 - A fetch stops cleanly when the connection changes (Priority: P2)

If Google stops accepting the CRM's access during a fetch, the fetch pauses and carries on after the user reconnects. If the user disconnects Gmail or is deactivated, the fetch stops for good; conversations already copied stay.

**Why this priority**: Rare, but a fetch must never run on a connection the user removed, nor be silently lost when a reconnect fixes things.

**Independent Test**: With the fake Gmail, start a fetch, make the fake Google refuse the key, run a part, confirm the needs-reconnecting state; reconnect and confirm the fetch ends with the full number. Start another fetch, disconnect, and confirm no more parts run and the copied conversations remain.

**Acceptance Scenarios**:

1. **Given** a fetch running, **When** Google refuses the key, **Then** the connection shows "needs reconnecting" (as in SF-118), the card says "Fetching past emails is paused until Gmail is reconnected.", and no part runs.
2. **Given** that paused fetch, **When** the user reconnects with the same account, **Then** the paused line is gone, the progress line comes back, and the fetch ends with "Past emails fetched: 60 conversations copied.", the same as an uninterrupted fetch.
3. **Given** a fetch running, **When** the user disconnects Gmail or an admin deactivates them, **Then** the card shows "Gmail is not connected." and no progress line, running the 15-minute check changes nothing, and after connecting again the total still includes the conversations the fetch copied; after connecting again, the card offers `[ FETCH PAST EMAILS ]` with no end message from the old fetch.

---

### Edge Cases

In these cases the tester puts conversations in the user's fake mailbox (SF-118 fake mailbox page), runs the fetch (and, with the page closed, the 15-minute check from that page), then reads the Gmail card.

- **Private and archived people**: with 2 conversations with a private person (of another owner) and 1 with an archived person, the fetch ends with "Past emails fetched: 3 conversations copied." (who may see them is decided where emails are shown, in later issues); with 1 conversation with a deleted person's address, it ends with "Past emails fetched: 0 conversations copied."
- **Address matching**: a conversation with "ANA@Example.test" (other case) counts for the person with "ana@example.test": the end number is 1; a conversation with "other@example.test" whose display name is "Ana Fake" gives 0.
- **Conversation partly older than 12 months**: a conversation with 1 message from 14 months ago and 2 from last month, all with a CRM person, gives "Past emails fetched: 1 conversations copied." and the automated tests find 2 messages stored for it.
- **CRM person only in an older message**: a conversation whose only message with a CRM person is 14 months old and whose recent messages are between teammates gives "Past emails fetched: 0 conversations copied."
- **The 12 months**: a conversation with a CRM person from 11 months and 29 days before the press counts (end number 1); one from 12 months and 2 days before gives 0. Dates are the time Gmail received or sent each message (DECISIONS SF-118).
- **The test email**: after `[ SEND ME A TEST EMAIL ]`, a fetch ends with "Past emails fetched: 0 conversations copied."
- **Teammates' mailboxes**: when Ada Fake and a second fake user both have the same conversation with a CRM person and both fetch, each card shows "Past emails fetched: 1 conversations copied."; Ada's fetch does not change the second user's card.
- **Large mailbox**: with 100 conversations to copy and a part size of 10 in tests, the progress number on the card after each part is never lower than before, and the end number is 100.
- **Connection not working**: while Gmail is not connected, needs reconnecting, or Gmail is not set up, the card shows no `[ FETCH PAST EMAILS ]`; posting the start request anyway leaves the card unchanged (no progress line).
- **Reload after the end**: after a fetch ends, reloading Settings still shows "Past emails fetched: <n> conversations copied."; it disappears when the user presses the button again (replaced by the progress line) or disconnects.
- **Deactivated user reactivated**: a user deactivated during a fetch, then reactivated, sees "Gmail is not connected." and no progress line; after connecting again they see `[ FETCH PAST EMAILS ]`.

## Requirements *(mandatory)*

### Functional Requirements

**The button**

- **FR-001**: The Gmail card on Settings (SF-118, design B) MUST have a "// PAST EMAILS" part (design B) that shows `[ FETCH PAST EMAILS ]` when, and only when, the user's own connection is working and no fetch of theirs is running or paused. Only the user themselves can start a fetch of their mailbox; admins cannot start or see another user's fetch.
- **FR-002**: Pressing it MUST start one fetch for that user covering the 12 months before the moment it was pressed. A user MUST never have two fetches running at once: a second press, request or tab while one is running or paused MUST start nothing and show the running fetch.

**What is copied**

- **FR-003**: A fetch MUST copy, from the user's mailbox, every conversation that has at least one message dated within its 12 months whose sender or any recipient (to, copy, blind copy) is an address of a person in the CRM at the time that message is examined (any of their addresses, archived and private people included). For each such conversation it MUST copy the messages dated within the 12 months, never drafts, spam or bin.
- **FR-004**: Each message MUST be copied exactly as the Gmail sync copies a new message (SF-118 FR-010: account, sent or received, identifiers, sender, recipients, subject, date, text and HTML, attachment names, types and sizes, never attachment contents), and MUST be stored at most once per account, whether the fetch, a second fetch or the live sync found it first.
- **FR-005**: A conversation already copied for the account before the fetch MUST NOT be counted by the fetch; any of its messages from the 12 months not yet stored MUST be added to it.
- **FR-006**: A fetch MUST NOT change how the live sync works: new mail keeps being copied while a fetch runs.

**Parts, progress, end**

- **FR-007**: A fetch MUST run in parts, each finishing within the hosting's time limit for one request, and MUST keep within Gmail's rate limits; when Gmail asks to slow down, it MUST wait as asked and carry on. It MUST keep how far it has got between parts, so a part that fails or is cut short is taken up again without losing or repeating anything.
- **FR-008**: While Settings is open, the next part MUST start by itself; while nobody has it open, the app's existing 15-minute background check MUST carry the fetch on until it ends.
- **FR-009**: While a fetch runs, the card MUST show "Fetching past emails: <n> conversations copied" with the number of conversations this fetch has copied so far, updated after each part while the page is open, with "FETCHING…" in place of the button and the line "You can leave this page: fetching carries on by itself."; the total "<n> conversations copied" line of the card MUST stay correct throughout.
- **FR-010**: When a fetch ends, the card MUST show "Past emails fetched: <n> conversations copied." with the number this fetch copied and the line "Last fetched <date time>. Press again after an import to copy conversations with new people.", until the user starts another fetch or disconnects.
- **FR-011**: Google refusing the key MUST pause the fetch (the connection becomes "needs reconnecting", SF-118 FR-006) and the card MUST say "Fetching past emails is paused until Gmail is reconnected."; reconnecting MUST resume it. Gmail not answering MUST keep the fetch where it is, show "Gmail can't be reached right now. Fetching will carry on by itself." and try again later. Disconnecting or deactivation MUST end the fetch for good, keeping what it copied.

**Access, messages, fakes**

- **FR-012**: Starting and continuing a fetch from the page MUST require the signed-in, active user who owns the connection; the background continuation MUST only run inside the existing scheduled check (its secret). No answer MUST show email content.
- **FR-013**: Every message shown MUST be one of the app's fixed messages; nothing from Gmail's answers or the page address is shown.
- **FR-014**: The fetch MUST follow design B of `design-options.html` and `docs/DESIGN.md`: a "// PAST EMAILS" part inside the Gmail card, below the card's lines, with the button (or "FETCHING…" while a fetch runs or is paused) on the right of its label, the explanation line before the first fetch, and the progress, paused, unreachable and result lines in that part. Before any fetch the part shows the explanation line of US1.
- **FR-015**: The fake Gmail MUST support everything a fetch uses (searching and listing past conversations, reading them, asking to slow down, not answering), checked against Google's published Gmail description like the rest of the fake; the tests MUST use a fake mailbox of 100 conversations covering every case of FR-003 and the Edge Cases. The fake data command MAY leave the fetch not started.

### Key Entities

- **Past email fetch**: one per user at a time: the connection it runs on, its 12-month window (start and end, fixed when pressed), its state (running, paused, ended, stopped), how far it has got in the mailbox, the number of conversations it has copied, when it started and ended. The last ended fetch is kept to show its end message.
- **Gmail connection, email conversation, email message, email attachment** (existing, SF-118): the fetch adds conversations and messages to them under the same once-only rules.
- **Person and person email address** (existing): the addresses that decide what is copied, read at the time each message is examined.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated tests with the fake mailbox of 100 conversations, a fetch copies 100% of the conversations with a CRM person in the last 12 months and 0 others, and no message is stored twice, whether run once, twice, in parallel with the live sync, or interrupted and resumed.
- **SC-002**: With Settings open, a mailbox with 100 conversations to copy finishes within 2 minutes (not counting waits Gmail asks for), and the progress number on the card changes at least every 30 seconds while copying.
- **SC-003**: With the page closed after the first part, the fetch ends with the same result within the time of the background checks it needs (each check carries it on); in tests, 100% of closed-page fetches end with the same number as open-page fetches.
- **SC-004**: Pressing the button twice at once, from two tabs, starts exactly one fetch in 100% of test runs.
- **SC-005**: No single part runs longer than the hosting allows for one request, and no part goes on sending requests to Gmail after Gmail asked it to slow down.

## Assumptions

- "Last 12 months" is counted back from the moment the button is pressed and fixed for that fetch; it uses the time Gmail received or sent each message, like the live sync (DECISIONS SF-118).
- A conversation is "copied" (and counted) as in SF-118: once one of its messages is stored for the account. The fetch's number counts only conversations new to the account; adding earlier messages to a conversation the live sync already copied fills it in without counting it (US3 scenario 3, clarified 2026-11-26), so "never copied twice" holds at the message level and at the count.
- Only messages dated within the 12 months are copied, even in a conversation that started earlier (clarified 2026-11-26); messages after the press are the live sync's.
- Who a message matches is decided with the CRM's people at the time the fetch examines it, so a person added during a running fetch may or may not be included; pressing again after it ends covers them.
- The fetch continues in the background through the existing 15-minute scheduled check (SF-118), so no new scheduled job is needed; a closed-page fetch may therefore take several checks to end.
- There is no `[ STOP ]` button: the user stops a fetch by disconnecting Gmail; one could be added later if asked.
- Emails are still not shown on timelines or an inbox in this issue (later issues); the user sees the effect through the card's numbers, as in SF-118.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
