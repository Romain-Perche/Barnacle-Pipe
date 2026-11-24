# Feature Specification: Gmail: connect and sync

**Feature Branch**: `factory/sf-118-step-13-gmail-connect-and-sync`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 13 - Gmail: connect and sync. Each user connects their own barnacle.ai Gmail account (`docs/PRODUCT.md` section 3, the email lines in `docs/DECISIONS.md`). In their settings, \"Connect Gmail\" asks Google for access through the existing Internal Google app (read, send, and change labels); the access key is stored encrypted and never shown; the user can disconnect. The settings show the connected address, the last sync and how many conversations were copied, and \"Reconnect Gmail\" when Google no longer accepts the key. Sync: Gmail push notifications through Google Cloud Pub/Sub, renewed every day, plus a check every 15 minutes for anything missed. Only conversations with people in the CRM (any of their email addresses) are copied, from the moment the account is connected: messages sent and received, with the names and sizes of their attachments. Sending: a server function sends an email from the user's Gmail (later issues use it); here, \"Send me a test email\" in the settings proves it works. Not in this issue: showing emails on timelines, past emails, writing emails. Gmail and Pub/Sub are faked in tests."

## Clarifications

### Session 2026-11-24

- Q: Which design? → A: Design: B, a "Settings" link in the sidebar for everyone, Gmail as a card on the Settings page (state, connected as, last sync, conversations copied, copying since, the buttons in the card heading), and an orange "!" on the "Settings" link on every page while Gmail needs reconnecting (see `design-options.html`).
- Q: What happens to a user's copied emails when they disconnect Gmail or are deactivated? → A: They are kept: they are the team's history with the contact (A).
- Q: What runs the 15-minute check and the daily renewal? → A: Vercel scheduled jobs (cron), on the Vercel Pro plan (A).


## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect my Gmail account (Priority: P1)

A team member opens their own Settings page (the "Settings" link in the sidebar) and, in the Gmail card, presses `[ CONNECT GMAIL ]`. Google asks them, through the team's existing Internal Google app, to let the CRM read their mail, send mail as them and change labels. They agree and come back to Settings, which now shows "Connected as <their address>", the last sync ("Not synced yet" until the first one) and "0 conversations copied". They never see the access key Google gave the CRM.

**Why this priority**: Gmail sync is a Must have (PRODUCT §3, "read and send email inside the app"); nothing else in this issue or the later email issues works until an account is connected.

**Independent Test**: With the fake Google and fake Gmail, sign in as a fake user, press `[ CONNECT GMAIL ]`, agree on the fake consent screen and confirm Settings shows the connected address; confirm the stored key is not readable as plain text in the database and appears in no page, message or log.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no Gmail connected, **When** they open Settings, **Then** the Gmail card shows "Gmail is not connected." and `[ CONNECT GMAIL ]`, and the sidebar shows a "Settings" link with no "!".
2. **Given** they press `[ CONNECT GMAIL ]` and agree on Google's screen with their own account, **When** they come back, **Then** Settings shows "Gmail connected." once, "Connected as <address>", "Last sync: Not synced yet", "0 conversations copied", `[ SEND ME A TEST EMAIL ]` and `[ DISCONNECT ]` in a card headed "Gmail · connected", and Gmail starts telling the CRM about new mail.
3. **Given** they cancel or refuse on Google's screen, **When** they come back, **Then** nothing is stored and Settings shows "Gmail was not connected." with `[ CONNECT GMAIL ]` again.
4. **Given** they choose a different Google account than the one they sign in to the CRM with, **When** they come back, **Then** nothing is stored and Settings shows "Connect the Gmail account you sign in with (<their sign-in address>)."
5. **Given** they agree but leave out one of the three permissions on Google's screen, **When** they come back, **Then** nothing is stored and Settings shows "Gmail needs all the permissions asked for. Try again and tick every box."

---

### User Story 2 - Conversations with CRM people are copied as they happen (Priority: P1)

Once connected, every email the user sends or receives in Gmail to or from someone in the CRM (any of that person's email addresses) is copied into the CRM within a minute or so: who it is from and to, the subject, the date, the text, and the names and sizes of its attachments. Mail with nobody from the CRM in it is never copied. If a notice from Gmail is lost, the check every 15 minutes still copies the message.

**Why this priority**: Copying the conversations is the point of the sync (PRODUCT §3, DECISIONS 2026-11-24) and what the later timeline, inbox and campaign issues are built on.

**Independent Test**: With the fake Gmail, connect a fake user, then put into their fake mailbox (a) a message from a CRM person's second email address with two attachments, (b) a reply sent by the user to a CRM person, (c) a message from someone not in the CRM, (d) a message dated before the connection; send the push notice for some and drop it for others, run the 15-minute check, and confirm exactly (a) and (b) are copied once each with their attachment names and sizes, and the counter shows the right number of conversations.

**Acceptance Scenarios**:

In these scenarios the tester uses the fake Gmail mailbox page (FR-018) to put messages in the user's mailbox, and reads the result on Settings: "Conversations copied" and "Last sync". Emails are not shown anywhere else in this issue.

1. **Given** a connected user with "0 conversations copied" and a CRM person with the addresses "ana@example.test" and "ana.k@example.test", **When** a message from "ana.k@example.test" with two attachments arrives in the user's mailbox and its notice is delivered, **Then** after a page reload Settings shows "1 conversation copied" and "Last sync" shows the time of that sync.
2. **Given** the same user, **When** they send an email from Gmail itself (not the CRM) to "ana@example.test" in a new conversation, **Then** Settings shows "2 conversations copied".
3. **Given** a message whose sender and recipients are none of the CRM's people's addresses (a newsletter, an email between teammates only), **When** it arrives and its notice is delivered, **Then** "Conversations copied" does not change and "Last sync" does change.
4. **Given** a conversation already copied, **When** a new message in that conversation arrives, even one that only goes to teammates, **Then** "Conversations copied" does not change (the message is added to the conversation already counted).
5. **Given** a message from "ana@example.test" in a new conversation whose notice is dropped, **When** the next 15-minute check runs, **Then** "Conversations copied" goes up by 1; delivering the same notice again afterwards leaves it unchanged.
6. **Given** a message from "ana@example.test" dated the day before the account was connected, **When** sync runs, **Then** "Conversations copied" does not change (past email is a later issue, "Fetch past emails").
7. **Given** a copied message with a 20 MB attachment "contract.pdf", **When** the automated tests read what was stored, **Then** they find "contract.pdf" and its size and no attachment contents.

---

### User Story 3 - Send an email from my Gmail (Priority: P1)

The CRM can send an email from the user's own Gmail address: later issues (writing emails, replies, campaigns) use this. Here, `[ SEND ME A TEST EMAIL ]` on Settings sends the user an email from their own Gmail to themselves, so they can see that sending works and that it shows in their Gmail Sent folder.

**Why this priority**: Sending is half of "read and send email inside the app" (PRODUCT §3) and every later email issue, campaigns included (DECISIONS 2026-11-24), sends through it.

**Independent Test**: With the fake Gmail, press `[ SEND ME A TEST EMAIL ]` and confirm the fake mailbox received one message from and to the user's address with the fixed subject and text, and Settings shows "Test email sent to <address>. Check your inbox."; make the fake Gmail refuse and confirm the failure message.

**Acceptance Scenarios**:

1. **Given** a connected user, **When** they press `[ SEND ME A TEST EMAIL ]`, **Then** one email with the subject "Barnacle CRM test email" and a short fixed text is sent from their Gmail to their own address, it is in their Gmail Sent folder, and Settings shows "Test email sent to <address>. Check your inbox."
2. **Given** Gmail does not answer or refuses for a reason other than the key, **When** they press it, **Then** Settings shows "The test email could not be sent. Try again in a minute." and nothing else changes.
3. **Given** the send function is called (by a later feature) for a connected user with recipients, subject, text and optionally the conversation to reply in, **When** it succeeds, **Then** the email goes from the user's own address, in that conversation when one was given, and the function returns Gmail's identifiers of the message and conversation; for a user with no working connection it refuses without sending.
4. **Given** the test email (to the user only, who is not a CRM person), **When** sync runs, **Then** it is not copied.

---

### User Story 4 - Disconnect, and reconnect when Google stops accepting the key (Priority: P2)

A user can disconnect Gmail at any time: the CRM stops syncing and forgets the key. If Google stops accepting the key (the user removed the CRM's access in their Google account, an admin reset it, the password changed), Settings says so and offers `[ RECONNECT GMAIL ]`; after reconnecting, sync carries on.

**Why this priority**: Users must stay in control of access to their mailbox, and a connection that silently stopped would lose mail without anyone knowing; but the happy path (US1-US3) comes first.

**Independent Test**: With the fake Gmail, connect, then disconnect and confirm the key is gone, Gmail's notices for the user stop and copied conversations remain; connect again, make the fake Google refuse the key, run the check and confirm Settings shows the reconnect state; reconnect and confirm a new message is copied.

**Acceptance Scenarios**:

1. **Given** a connected user, **When** they press `[ DISCONNECT ]` and confirm "Disconnect Gmail? New email will stop being copied. Emails already copied stay in the CRM.", **Then** Settings shows "Gmail disconnected." and `[ CONNECT GMAIL ]`; the fake Google shows the key cancelled and Gmail's notices for the user stopped, and the stored key is gone (checked by automated tests); a new message from a CRM person no longer changes anything.
2. **Given** a connected user whose key Google no longer accepts, **When** a sync, renewal or send finds this, **Then** the connection is marked as needing reconnecting, its sync stops, and Settings shows "Google no longer accepts the CRM's access to <address>. Reconnect to carry on copying email." with `[ RECONNECT GMAIL ]` and `[ DISCONNECT ]`, the last sync and count as they were, and the "Settings" link in the sidebar shows an orange "!" on every page.
3. **Given** a connection needing reconnecting with "37 conversations copied", **When** the user reconnects with the same account, **Then** Settings shows "Gmail reconnected.", the working state and still 37, and the "!" is gone from the "Settings" link; a new message from a CRM person in a new conversation then raises it to 38, and a message already copied before is not counted again.
4. **Given** a connection needing reconnecting, **When** the user opens Settings, **Then** `[ SEND ME A TEST EMAIL ]` is not offered, and a later feature that calls the send function for them gets a refusal saying they must reconnect Gmail, with nothing sent.

---

### Edge Cases

- **Person added to the CRM later**: a message from "new@example.test" arrives, then a person with that address is added; the next check leaves "Conversations copied" unchanged (the later "Fetch past emails" covers it). A message from that address arriving after the person was added raises it by 1.
- **Address match**: a message from "ANA@Example.test " (other case, extra space) raises "Conversations copied" by 1; a message from "other@example.test" whose display name is "Ana Fake" does not.
- **Private and archived people**: a message from the address of a private person, or of an archived person, raises "Conversations copied" by 1, as for anyone else (who may see it is decided where emails are shown, in later issues: DECISIONS 2026-11-24). After a person is deleted, a new message from their address does not.
- **Same conversation in two mailboxes**: when two connected teammates both get a message from "ana@example.test", each one's Settings shows the count going up by 1 (each mailbox's copy is kept for its owner, with the email's own identifiers so later issues can show it once on a timeline).
- **Drafts, spam, bin**: a draft to "ana@example.test", or a message from her that lands in spam, leaves "Conversations copied" unchanged. Moving a copied message to the bin in Gmail leaves the count unchanged.
- **Large catch-up**: when sync was stopped for a while (Gmail's change history no longer available, the app down), after the next check the count includes every matching message since the last successful sync, not only recent ones.
- **Notices not from Google**: a notice sent to the CRM without Google's proof, or for an address with no working connection, is refused and leaves "Last sync" and "Conversations copied" unchanged.
- **Deactivated user**: when an admin deactivates a user, their Gmail sync stops and their key is forgotten, as on disconnect; when reactivated and signed in again, their Settings shows "Gmail is not connected." and `[ CONNECT GMAIL ]`.
- **Gmail not set up**: when the app's Gmail settings (Google Cloud notices, the encryption key) are missing, Settings shows "Gmail can't be connected right now." and no `[ CONNECT GMAIL ]`; the rest of the app works.
- **Connecting twice**: after connecting in two tabs one after the other, Settings shows one connection; a Gmail account already connected to another CRM user cannot be connected (it is always the user's own sign-in address, US1 scenario 4).
- **Renewal fails**: when the daily renewal fails for a reason other than the key, Settings still shows the connection as working, and a new message from a CRM person still raises the count by the next 15-minute check.
- **Messages with only HTML or only attachments**: a message from "ana@example.test" with no text part raises the count by 1 like any other; an attachment with no name is stored as "(no name)" with its size (checked by automated tests).

## Requirements *(mandatory)*

### Functional Requirements

**Connecting**

- **FR-001**: Every signed-in, active user MUST have a Settings page for their own account, reached from a "Settings" link in the sidebar's main group, shown to everyone, with a Gmail card. Only the user themselves sees and changes their Gmail connection; nothing here is admin-only and admins cannot see or change another user's connection.
- **FR-002**: `[ CONNECT GMAIL ]` MUST ask Google, through the team's existing Internal Google app, for exactly these permissions: read mail, send mail as the user, and change labels. The connection MUST be refused, with nothing stored, when the user cancels, leaves out a permission, or picks a Google account other than their CRM sign-in address (US1 scenarios 3-5). The return from Google MUST be checked to belong to the request the same user started.
- **FR-003**: The key Google gives MUST be stored encrypted with a secret kept in the app's settings, never in the repo; it MUST never be shown on any page, sent to the browser, written to a log or put in a message.
- **FR-004**: Settings MUST show, for a connected user: the connected address, the time of the last successful sync ("Not synced yet" before the first), the number of conversations copied from this account, `[ SEND ME A TEST EMAIL ]` and `[ DISCONNECT ]`; for a connection Google no longer accepts: the message and `[ RECONNECT GMAIL ]` of US4 scenario 2.
- **FR-005**: `[ DISCONNECT ]` MUST, after confirmation, stop Gmail's notices for the account, ask Google to cancel the key, and delete the key; the CRM MUST work even if Google cannot be reached to cancel. Conversations already copied MUST stay.
- **FR-006**: Whenever Google refuses the key (on a sync, a renewal or a send), the connection MUST be marked as needing reconnecting and its sync stopped until the user reconnects or disconnects.

**Sync**

- **FR-007**: For every working connection, Gmail MUST tell the CRM about new mail through Google Cloud notices; the CRM MUST renew them at least once every 24 hours.
- **FR-008**: The CRM MUST also check every working connection every 15 minutes for changes since its last successful sync and copy anything missed, and MUST accept only notices it can confirm come from the team's Google Cloud setup.
- **FR-009**: Only messages dated from the moment the account was connected MUST be copied. A message MUST be copied when its sender or any of its recipients (to, copy, blind copy) is an address of a person in the CRM (any of their addresses, archived and private people included), or when it belongs to a conversation already copied for that account. Drafts, spam and bin MUST never be copied.
- **FR-010**: For each copied message the CRM MUST keep: the account it came from, whether it was sent or received, Gmail's message and conversation identifiers, the email's Message-ID, sender, recipients (to, copy, blind copy where Gmail gives them), subject, date, text and HTML as received, and the name, type and size of each attachment, never the attachment contents.
- **FR-011**: A message MUST be copied at most once per account however many notices or checks report it; a conversation MUST be counted once however many messages it has.
- **FR-012**: After any sync, "Last sync" MUST be the time of the latest successful sync of that account and the conversation count MUST match the conversations copied.

**Sending**

- **FR-013**: The CRM MUST have one server function that sends an email from a user's own Gmail account (recipients, subject, text, optionally HTML and the conversation to reply in), so the email is in the user's Gmail Sent folder and in the right conversation, and returns Gmail's message and conversation identifiers. It MUST refuse without sending when the user has no working connection. It is not offered anywhere in the app except the test email in this issue.
- **FR-014**: `[ SEND ME A TEST EMAIL ]` MUST send one email with the subject "Barnacle CRM test email" and a fixed text from the user's Gmail to their own address, through FR-013, and show the messages of US3.

**Access, messages, settings, fakes**

- **FR-015**: Every page and action MUST require a signed-in, active user; scheduled checks, renewals and Google's notices MUST be refused unless they carry the app's secret or Google's proof (FR-008), and never show data in their answer.
- **FR-016**: Every message shown MUST be one of the app's fixed messages (built only from the user's own address where a message names one); text from the page address or from Google's answers MUST never be shown.
- **FR-017**: The Settings page MUST follow design B in `design-options.html` (a "Settings" sidebar link, Gmail as a card with a green dot and "Gmail · connected" or a red dot and "Gmail · needs reconnecting", the buttons in the card heading) and `docs/DESIGN.md`. While the user's connection needs reconnecting, the "Settings" link MUST show an orange "!" on every signed-in page; it MUST go away once they reconnect or disconnect.
- **FR-018**: Gmail, Google's consent screen for these permissions and Google Cloud notices MUST be reached through settings and have fakes, so the whole feature is built, run locally and tested with no real account (team decision, kickoff); the fakes MUST be checked against Google's published descriptions of these services, like the existing Google fake. The fake consent screen and a fake mailbox page (where a tester puts a received or sent message in a user's fake mailbox, with or without delivering its notice, and runs the 15-minute check) MUST only work where the fake Google login works (development and tests).
- **FR-019**: The fake data command MUST give at least one fake user a connected fake Gmail account with a few copied conversations (with attachments) with fake CRM people, without duplicates when run again.

### Key Entities

- **Gmail connection**: one per user at most: the connected address, the encrypted key, its state (working, needs reconnecting), when it was connected, how far sync has got in Gmail's change history, the last successful sync, and when Gmail's notices expire.
- **Email conversation**: a Gmail conversation copied for one connection: Gmail's conversation identifier, subject, and its copied messages.
- **Email message**: one copied message (FR-010): sent or received, identifiers, sender, recipients, subject, date, text and HTML.
- **Email attachment**: name, type and size of one attachment of a copied message; no contents.
- **Person and person email address** (existing, SF-90): the addresses that decide what is copied.
- **User** (existing): owns the connection; deactivating stops it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can connect their Gmail from Settings in under 1 minute, not counting time spent reading Google's screen.
- **SC-002**: An email to or from a CRM person shows as copied (in the count and last sync) within 2 minutes of arriving in Gmail when notices work, and within 15 minutes when a notice is lost.
- **SC-003**: In automated tests, 100% of messages involving a CRM person sent or received after connecting are copied exactly once, and 0 messages without a CRM person (outside conversations already copied) or dated before the connection are copied.
- **SC-004**: In automated tests, the stored key never appears in plain text in the database, on any page, in any message or in any log.
- **SC-005**: When Google stops accepting the key, Settings shows the reconnect state at the next sync or check (within 15 minutes) in 100% of test runs, and after reconnecting new mail is copied again without copying anything twice.
- **SC-006**: The test email arrives in the user's inbox and Sent folder within 1 minute of pressing the button.

## Assumptions

- Showing emails on timelines and in an inbox, linking conversations to deals, people and organisations, "Fetch past emails", and writing, replying and forwarding are later issues (user request); this issue copies and stores, and offers sending only through the test email.
- Who may see a copied conversation (DECISIONS 2026-11-24: hidden from a user who cannot see someone in it) is applied where conversations are shown, in the later issues; nothing copied here is shown to anyone but the counts on the user's own Settings.
- The connected account must be the address the user signs in with: every user is a barnacle.ai account (DECISIONS kickoff), and "their own barnacle.ai Gmail account" (PRODUCT §3) is read as that one.
- The Internal Google app gets the Gmail permissions and a Google Cloud topic for notices before go-live; because the app is Internal, no Google review is needed. These are set up with the other real accounts before go-live.
- The 15-minute check and the daily renewal are Vercel scheduled jobs (the app's first), which needs the Vercel Pro plan (clarified 2026-11-24); each call carries the app's secret.
- Copied messages are kept (clarified 2026-11-24) when a user disconnects, is deactivated, or deletes a message in Gmail, and when a person is deleted; removing them is a later decision. Messages are not changed when edited labels or read state change in Gmail in this issue (the label permission is asked now for later issues, so users need not reconnect).
- Attachment contents are not copied in this issue: names and sizes only, as asked.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
