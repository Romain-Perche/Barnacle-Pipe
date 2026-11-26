# Feature Specification: Write an email from a deal or contact

**Feature Branch**: `factory/sf-129-step-20-write-an-email-from-a-deal-or-co`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "Step 20 - Write an email from a deal or contact. A [ WRITE EMAIL ] button on the deal, person and organisation pages and the deal drawer (`docs/PRODUCT.md` section 3) opens an email box over the page: To (filled with the deal's main person or the person, their first email address; any address can be added or removed), Cc and Bcc, Subject, and the text, written as plain text with line breaks. Attachments: files already on the record, or files from the computer, up to Gmail's limit of 25 MB in total. [ SEND ] sends it from the user's own Gmail through the existing send function: it appears in their Gmail Sent folder and at once on the record's timeline, linked to the record it was written from and to the people it went to. A user without a working Gmail connection sees the button with a link to connect Gmail in Settings, and nothing is sent. Sending to an Unsubscribed person is allowed: consent is for campaigns only. Not in this issue: reply and forward, templates, scheduled sending, open and click tracking. Gmail is faked in tests."

## Clarifications

### Session 2026-11-26

- Q: Which design? → A: Design: B, `[ WRITE EMAIL ]` in the // TIMELINE heading next to the note box; the email box is a tall panel on the right side of the screen, over the dimmed page, as in Pipedrive; a short EMAIL entry on the timeline with `[ SHOW ALL ]` (see `design-options.html`; the person's answer: "Put it on the side of the screen, just like in pipedrive").
- Q: Does an email sent from the CRM update the Last contacted date of the CRM people it goes to? → A: Yes: it is set to the send time, never lowered, like a done call or meeting (A).
- Q: Is a file attached from the computer also saved in the record's // FILES? → A: No: the file goes only in the email; the timeline entry shows its name and size (A).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write and send an email from a deal or a person (Priority: P1)

A team member is on a deal page (or a person page, or has a deal open in the board's drawer) and wants to email the contact. They press `[ WRITE EMAIL ]` in the // TIMELINE heading; the email box opens as a tall panel on the right side of the screen with To already filled with the deal's main person's (or the person's) first email address. They type a subject and a few lines of text, optionally add a Cc, and press `[ SEND ]`. The email leaves from their own Gmail address, is in their Gmail Sent folder, and the box closes on the same page, where the email is now the newest entry of the timeline.

**Why this priority**: "Compose … from a deal or contact" and "emails sent from the app appear in Gmail Sent" are Must haves (PRODUCT §3); this is the core of the issue and works without attachments.

**Independent Test**: With the fake Gmail and a fake user connected, open a deal whose main person has two addresses, press `[ WRITE EMAIL ]`, check To holds only the first address, type a subject and two lines of text, press `[ SEND ]`, then confirm the fake mailbox holds one sent message from the user's address with that subject and the two lines, and the deal's timeline shows it at once.

**Acceptance Scenarios**:

1. **Given** a connected user on the page of a deal whose main person is Ana Fake with the addresses "ana@example.test" (first) and "ana.k@example.test", **When** they press `[ WRITE EMAIL ]`, **Then** the email box opens as a panel on the right side of the screen, headed "// NEW EMAIL · <record name>", with "From <their address>", To holding "ana@example.test" only, empty Cc, Bcc, Subject and text, and the left part of the deal page is still shown, dimmed, beside the panel.
2. **Given** the same box, **When** they type the subject "Next steps" and the text "Hi Ana,⏎⏎Here is the plan." and press `[ SEND ]`, **Then** one email is sent from their own Gmail to "ana@example.test" with that subject and that text with its line breaks kept, it is in their Gmail Sent folder, the box closes, the page shows "Email sent to ana@example.test." once, and the deal's timeline shows the email as its newest entry.
3. **Given** a connected user on Ana Fake's person page, **When** they press `[ WRITE EMAIL ]`, **Then** To holds "ana@example.test".
4. **Given** a connected user with a deal open in the board's drawer, **When** they press `[ WRITE EMAIL ]` in the drawer and send, **Then** the email box opens as the panel on the right, over the board and the drawer, with the drawer's deal's main person's first address in To, and after sending the board shows the same deal's drawer open with the email as the newest entry of its timeline.
5. **Given** a connected user on an organisation page, **When** they press `[ WRITE EMAIL ]`, **Then** To is empty, and they can type any address and send.
6. **Given** the box with "ana@example.test" in To, **When** the user removes it, adds "ben@example.test" to To, "cat@example.test" to Cc and "dan@example.test" to Bcc, and sends, **Then** the email goes to exactly those three addresses in those fields, and Ana Fake is not among its recipients.
7. **Given** the box filled in, **When** the user closes it with `[ CANCEL ]` or the close button, **Then** the box closes, the fake mailbox's Sent mail has no new message and the timeline has no new entry.

---

### User Story 2 - The sent email is on the timelines of the record and of the people it went to (Priority: P1)

The email the user just sent shows at once, without waiting for the Gmail sync, as an EMAIL entry on the timeline of the record it was written from and on the timeline of every CRM person it went to (To, Cc or Bcc). Teammates who can see those records see it too. When the Gmail sync later copies the same message from the user's Sent folder, it is not shown a second time.

**Why this priority**: The timeline is the team's shared history of a deal or contact (PRODUCT §1, §2: "one timeline … emails …"); an email sent from the CRM that does not show there would be lost to the team.

**Independent Test**: Send an email from a deal to its main person and to a second CRM person in Cc; confirm an EMAIL entry on the deal, on both people's timelines, and that a teammate sees it; then run the fake Gmail's sync and confirm each timeline still shows exactly one entry for it.

**Acceptance Scenarios**:

1. **Given** an email sent from the deal "Fake Deal Ltd renewal" to Ana Fake (To) and Ben Fake (Cc, a CRM person on no deal), **When** anyone who can see these records opens them, **Then** the deal's page and drawer, Ana Fake's page, Ben Fake's page and the deal's organisation's page each show one entry tagged EMAIL at the send time with the sender's name, the addresses it went to, the number of files, the subject and the start of the text, and `[ SHOW ALL ]`; pressing `[ SHOW ALL ]` shows "To", "Cc" (and "Bcc" when any) addresses, the whole text with its line breaks, and the attachments' names and sizes.
2. **Given** an email sent from Ana Fake's person page, **When** the deal on which Ana Fake is the main person is opened, **Then** the email is not on that deal's timeline (it was written from the person, not the deal), and Ana Fake's organisation page does not show it (an organisation shows its own and its deals' entries, not its people's).
3. **Given** an email sent from an organisation page to "ana@example.test", **When** the organisation and Ana Fake's page are opened, **Then** both show the entry once.
4. **Given** an email sent to an address that belongs to no CRM person, **When** the record it was written from is opened, **Then** the entry is there; no person is created.
5. **Given** a sent email, **When** the Gmail sync (push notice or the 15-minute check) copies the user's mailbox, **Then** every timeline still shows that email exactly once, and the user's Settings count of conversations copied counts its conversation once.
6. **Given** an email that went to a private person whom a teammate cannot see, **When** that teammate opens the record it was written from, **Then** the email is not shown to them at all (DECISIONS 2026-11-24: a conversation that includes someone the user cannot see is hidden entirely).
7. **Given** a person who received the email, **When** their page is opened, **Then** their "Last contacted" is the send time, unless it was already later.

---

### User Story 3 - Attach files from the record or from the computer (Priority: P2)

In the email box the user can attach files already in the record's "// FILES" (for example the proposal PDF saved on the deal) and files picked from their computer, as long as all attachments together stay within 25 MB, Gmail's limit. The recipients get the files as ordinary email attachments.

**Why this priority**: Attachments, "including attaching files already saved on the deal", are a Should have (PRODUCT priorities, §3, §5); sending text works without them.

**Independent Test**: With the fake Storage and fake Gmail, add a 2 MB PDF to a deal's files, open the email box, attach it and a 1 MB image from the computer, send, and confirm the fake mailbox's sent message has both attachments with the same names, types and bytes; then try files totalling more than 25 MB and confirm sending is refused with the size message and nothing is sent.

**Acceptance Scenarios**:

1. **Given** a deal whose "// FILES" lists "proposal.pdf" (2 MB) and "logo.png" (300 KB), **When** the user opens the email box, **Then** it offers those two files to attach, with their names and sizes, none attached in advance.
2. **Given** the user attaches "proposal.pdf" from the record and "notes.docx" (1 MB) from their computer, **When** they send, **Then** the email carries both files with their names and contents, the box showed each attachment's name and size with a way to remove it, and the timeline entry lists "proposal.pdf" and "notes.docx" with their sizes.
3. **Given** attachments that already total 24 MB, **When** the user adds a 2 MB file, **Then** the box shows "Attachments can be 25 MB in total at most."; pressing `[ SEND ]` shows the same message, and the fake mailbox's Sent mail has no new message; after removing the 2 MB file, `[ SEND ]` sends the email.
4. **Given** a person page, **When** the email box opens, **Then** it offers only that person's own files (not the files of their deals); on an organisation page, only the organisation's own files.
5. **Given** a record file that a teammate deletes after the box was opened, **When** the user sends with it attached, **Then** nothing is sent and the box shows "One of the attached files is no longer on the record. Remove it and send again.", keeping what was typed.
6. **Given** files from the computer attached and sent, **When** the record is opened, **Then** its "// FILES" list has the same files as before sending.

---

### User Story 4 - Without a working Gmail connection, the button leads to Settings (Priority: P2)

A user who has not connected Gmail, or whose connection needs reconnecting, still sees `[ WRITE EMAIL ]`. Pressing it explains that their Gmail must be connected first, with a link to Settings, and offers no `[ SEND ]`; nothing is ever sent for them.

**Why this priority**: Every user must understand why they cannot send and how to fix it, but the happy path (US1-US3) comes first.

**Independent Test**: With a fake user with no Gmail connection, press `[ WRITE EMAIL ]` on a deal and confirm the message, the link to Settings and no `[ SEND ]`; then make a connected user's fake Google refuse the key and press `[ SEND ]`, confirming the reconnect message, nothing in the fake mailbox's Sent and nothing on the timeline.

**Acceptance Scenarios**:

1. **Given** a user with no Gmail connection (never connected, or disconnected), **When** they press `[ WRITE EMAIL ]`, **Then** the box shows "Connect your Gmail in Settings to send email from the CRM." with a `[ GO TO SETTINGS ]` link to Settings, and no fields and no `[ SEND ]`.
2. **Given** a user whose Gmail connection needs reconnecting, **When** they press `[ WRITE EMAIL ]`, **Then** the box shows "Reconnect your Gmail in Settings to send email from the CRM." with the same link, and no `[ SEND ]`.
3. **Given** a connected user with the box filled in, **When** Google no longer accepts the key at the moment they press `[ SEND ]`, **Then** nothing is sent, nothing is added to any timeline, the box stays open with what they typed and shows the reconnect message and link of scenario 2, and the "Settings" link in the sidebar shows the orange "!".
4. **Given** the app's Gmail settings are not set up (Gmail off), **When** any user presses `[ WRITE EMAIL ]`, **Then** the box shows "Email can't be sent from the CRM right now." and no `[ SEND ]`.

---

### User Story 5 - Emailing an Unsubscribed person is allowed (Priority: P3)

A person marked Unsubscribed has opted out of campaigns only. A user can still write to them one-to-one: they are filled into To like anyone else, and sending is not blocked or warned about.

**Why this priority**: A rule to get right (consent is for campaigns only, PRODUCT §4) rather than a flow of its own.

**Independent Test**: Make Ana Fake Unsubscribed, write from her page and send; confirm To was filled, no warning was shown, the email was sent and her Consent is still Unsubscribed.

**Acceptance Scenarios**:

1. **Given** Ana Fake is Unsubscribed, **When** the user writes from her page or her deal, **Then** To holds her first address, no consent warning is shown, and `[ SEND ]` sends the email.
2. **Given** that email is sent, **When** her page is opened, **Then** her Consent is still Unsubscribed and her timeline shows the EMAIL entry.

---

### Edge Cases

- **Nothing to fill**: for a deal with no main person, a deal whose main person has no email address, a person with no email address, or a deal whose main person the user cannot see (private), the box opens with To empty; typing "ana@example.test" in To and sending sends the email.
- **Archived records**: an archived deal, person or organisation page (and an archived deal's drawer) shows no `[ WRITE EMAIL ]` (as with notes and files). When a teammate archives the record while the box is open, `[ SEND ]` shows "This record is archived: restore it to send email from it." and the fake mailbox's Sent mail has no new message.
- **Record no longer visible or deleted while writing**: when the record is deleted, or made private by a teammate so the user can no longer see it, while the box is open, `[ SEND ]` shows "This record doesn't exist or you can't see it." and the fake mailbox's Sent mail has no new message.
- **Addresses**: `[ SEND ]` with "ana@" in To shows "ana@ is not a valid email address." and the fake mailbox's Sent mail has no new message. With "Ana@Example.test" in To and "ana@example.test " in Cc, the sent message has that address once, in To. Pasting "a@example.test, b@example.test; c@example.test" in To shows three addresses.
- **Required fields**: `[ SEND ]` with To empty shows "Add at least one address in To."; with the subject empty, "Add a subject."; with 101 addresses across To, Cc and Bcc, "An email can go to 100 addresses at most."; with a 251-character subject, "The subject can be 250 characters at most."; with a 100,001-character text, "The text can be 100,000 characters at most." In each case the fake mailbox's Sent mail has no new message. An empty text with a subject sends.
- **Sending to oneself or a teammate**: sending to "bob@barnacle.ai" (a teammate, not a CRM person) succeeds; the record it was written from shows the EMAIL entry and no person page gains one.
- **One CRM person with two addresses in To and Cc**: Ana Fake's page shows one EMAIL entry for it, listing both addresses.
- **Gmail slow or failing (not the key)**: with the fake Gmail set to fail, `[ SEND ]` leaves the box open with every address, the subject, the text and the attachments still there, shows "The email could not be sent. Try again in a minute.", and no timeline gains an entry.
- **Double press**: pressing `[ SEND ]` twice quickly leaves one new message in the fake mailbox's Sent mail and one new EMAIL entry on the timeline.
- **Sent but the CRM could not record it** (checked by automated tests, it cannot be caused in the running app): when Gmail accepted the email but recording it failed, the user sees "Email sent to …", not a failure, and after the next Gmail sync the email shows once on the timelines of the CRM people it went to.
- **Line breaks and characters**: the text "Bonjour Zoë,⏎⏎<b>prix</b> 🎉⏎https://example.test" is in the fake mailbox's sent message exactly as typed, and the EMAIL entry, after `[ SHOW ALL ]`, shows "<b>prix</b>" as those characters (not bold), on separate lines as typed.
- **Big files from the computer**: choosing a 30 MB file from the computer shows "Attachments can be 25 MB in total at most." at once and the file is not in the attachments list.
- **Deactivated sender**: after an admin deactivates Ada Fake, the EMAIL entries she sent still show "Ada Fake" as the sender.

## Requirements *(mandatory)*

### Functional Requirements

**The button and the box**

- **FR-001**: The deal page, the deal drawer, the person page and the organisation page MUST show `[ WRITE EMAIL ]` in the // TIMELINE heading (design B) to every signed-in active user who can see the record, except on archived records. It MUST NOT be shown anywhere else in this issue (not on lists, the board's cards or the Activities list).
- **FR-002**: `[ WRITE EMAIL ]` MUST open the email box as a tall panel on the right side of the screen over the dimmed page (design B; for the drawer, the board and the open deal stay behind it; closing or sending returns to the same place) with: From (the user's connected address, not changeable), To, Cc, Bcc, Subject, the text (a plain multi-line text area), Attachments, `[ SEND ]` and `[ CANCEL ]`.
- **FR-003**: To MUST start with the first email address of the deal's main person (deal page and drawer) or of the person (person page), when there is one and the user can see that person; otherwise empty. On an organisation page To MUST start empty. Cc, Bcc, Subject, text and attachments MUST start empty.
- **FR-004**: The user MUST be able to add any email address to To, Cc and Bcc (one at a time or several pasted, separated by commas, semicolons or spaces) and remove any of them, including the one filled in.
- **FR-005**: Before sending, the CRM MUST check the email (Edge Cases: valid addresses, duplicates kept once, at least one To, a subject, at most 100 addresses, length limits, attachments within 25 MB) and, when anything fails, send nothing and show each problem with one of the app's fixed messages, keeping everything typed and attached.

**Sending**

- **FR-006**: `[ SEND ]` MUST send the email once from the user's own Gmail address through the CRM's existing single send function (SF-118), as plain text with the line breaks typed, with its attachments, to exactly the To, Cc and Bcc addresses chosen; it MUST be in the user's Gmail Sent folder. Open and click tracking MUST NOT be added.
- **FR-007**: Sending to a person marked Unsubscribed MUST be allowed, with no warning, and MUST NOT change their Consent: consent applies to campaigns only.
- **FR-008**: When the user has no working Gmail connection (none, disconnected, needs reconnecting) or Gmail is not set up for the app, the box MUST show the matching message of US4 and a link to Settings (except when Gmail is off), offer no `[ SEND ]`, and the CRM MUST refuse any send for that user without contacting Gmail. When Google refuses the key at send time, the connection MUST be marked as needing reconnecting (as SF-118 does) and the box MUST show US4 scenario 3.
- **FR-009**: When Gmail cannot be reached or fails for another reason, nothing MUST be recorded, and the box MUST stay open with all input kept and show "The email could not be sent. Try again in a minute."
- **FR-010**: Pressing `[ SEND ]` again on the same box (double press, resubmission) MUST NOT send a second email or add a second entry.

**Attachments**

- **FR-011**: The box MUST offer to attach the files listed in the record's own "// FILES" that the user can see (SF-116: a person's or organisation's own files, not their deals' files), and files chosen from the user's computer, several of each; each attachment MUST show its name and size and can be removed before sending.
- **FR-012**: All attachments of one email together MUST be at most 25 MB (counted on the files' own sizes); a single computer file over 25 MB MUST be refused as soon as it is chosen; the email MUST NOT be sent while the total is over.
- **FR-013**: An attached record file MUST be sent with its stored name, type and exact contents; one no longer on the record at send time MUST stop the send with the message of US3 scenario 5. Files from the computer MUST be sent with their name, type and exact contents and MUST NOT be added to the record's files.

**Recording and showing the email**

- **FR-014**: As soon as Gmail accepts the email, the CRM MUST record it, before the page shows "Email sent to …": sender, To, Cc, Bcc, subject, text, the send time, Gmail's message and conversation identifiers, and each attachment's name, type and size (never its contents, as for synced email, SF-118).
- **FR-015**: The recorded email MUST be linked to the record it was written from and to every CRM person (archived and private ones included) with any of their addresses among To, Cc or Bcc, and MUST appear at once as one EMAIL entry on the timeline of each of these records (deal page and drawer, person page, organisation page), placed by its send time among the other entries. Entries a record already shows from its linked deals keep the existing rules and appear once.
- **FR-016**: When the Gmail sync later copies the same message from the user's mailbox, it MUST be recognised as the email already recorded: no second entry on any timeline and no second count in the user's conversations copied.
- **FR-017**: The EMAIL entry MUST first show, on its short form (design B), the sender's name, the time, the addresses it went to, the number of files, the subject, the start of the text and `[ SHOW ALL ]`; `[ SHOW ALL ]` MUST show "To", "Cc" and "Bcc" addresses (Cc and Bcc only when there are any), the whole text with its line breaks as plain text (never as HTML), and the attachments' names and sizes. It MUST sit among the other timeline entries (design B of SF-102, a new EMAIL tag) and offer no reply, forward, edit or delete in this issue.
- **FR-018**: An EMAIL entry MUST be shown only to users who can see the record and every CRM person linked to the email (DECISIONS 2026-11-24); a user who cannot see one of them MUST not see the entry anywhere, and no message may hint that it exists.
- **FR-019**: Sending MUST set the "Last contacted" of every CRM person the email was linked to (FR-015) to the send time when that is later than their current value, never lowering it.
- **FR-020**: Sending MUST NOT notify anyone in the app and MUST NOT change the record, its owner, its stage or its consent.

**Access, messages, fakes**

- **FR-021**: Every page and action MUST require a signed-in active user; the send action MUST check, again at send time, that the user can see the record (and the deal's or person's record files they attach) and that it is not archived.
- **FR-022**: Every message shown MUST be one of the app's fixed messages, built only from addresses the user typed or the record's own data; text from the page address or from Google's answers MUST never be shown. Addresses, subject and text MUST be shown as plain text everywhere.
- **FR-023**: The whole feature MUST be built, run locally and tested with the existing fake Gmail and fake Storage (no real account); the fake Gmail MUST accept messages with attachments and keep them in the user's fake Sent mail so tests can read their recipients, text and attachment bytes, checked against Google's published description of the Gmail service like the existing fakes.
- **FR-024**: The fake data command SHOULD give the connected fake user at least one email sent from a fake deal to its fake main person, so the EMAIL entry can be seen after seeding, without duplicates when run again.

### Key Entities

- **Sent email** (a copied email message, SF-118, recorded at send time): the user's Gmail connection, direction "sent", Gmail's message and conversation identifiers, sender, To, Cc, Bcc, subject, text, send time.
- **Email attachment** (existing, SF-118): name, type and size of each attachment of the email; no contents.
- **Email link**: which records an email belongs to: the record it was written from (a deal, a person or an organisation) and every CRM person it went to. Later issues (automatic and manual thread linking, the inbox) build on it.
- **Record file** (existing, SF-116): a file in a record's "// FILES", which can be attached.
- **Gmail connection** (existing, SF-118): decides whether the user can send.
- **Person** (existing): their first email address fills To; their "Last contacted" is raised by sending.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a deal or person page, a user can send a short email to the main contact in under 1 minute, with no address to type.
- **SC-002**: In automated tests, 100% of emails sent from the box are in the fake Gmail's Sent mail exactly once, with exactly the chosen To, Cc and Bcc addresses, the typed subject and text (line breaks kept), and attachments byte-for-byte equal to the files chosen.
- **SC-003**: The sent email is on the timeline of the record it was written from and of every CRM person it went to on the first page load after sending, and still exactly once after the Gmail sync has run, in 100% of test runs.
- **SC-004**: In automated tests, 0 emails are sent for a user with no working Gmail connection, for an archived or no longer visible record, with an invalid address, or with attachments over 25 MB in total.
- **SC-005**: In automated tests, 0 EMAIL entries are shown to a user who cannot see the record or one of the CRM people the email went to.
- **SC-006**: After a failed send (Gmail unavailable, key refused, a check failing), the user loses nothing they typed or attached in 100% of cases.

## Assumptions

- The existing send function (SF-118) is extended for attachments rather than replaced; it stays the only way the CRM sends email.
- Reply, forward, templates, merge fields, scheduled sending, open and click tracking, HTML or formatted text, signatures, drafts saved in the CRM or Gmail, the inbox view, and linking synced conversations to deals, people and organisations automatically or by hand are not in this issue (user request; PRODUCT §3 later steps). Showing synced emails (written in Gmail itself) on timelines is also a later issue: only emails sent from the CRM box get EMAIL entries here.
- Each email starts a new Gmail conversation (no "in the same thread" until reply exists).
- An email written from an organisation page starts with an empty To: an organisation has no main person (decided by the factory, to confirm).
- A subject is required and the text may be empty; at most 100 addresses per email, subject 250 characters, text 100,000 characters (decided by the factory, to confirm).
- Sending from the CRM counts as contacting the person and raises "Last contacted", like a done call or meeting (SF-109) (clarified 2026-11-26).
- Files from the computer stay only in the email and are not saved to the record (clarified 2026-11-26); to keep one on the record, the user adds it to "// FILES" first.
- The 25 MB limit is counted on the attached files' own sizes, which is how Gmail shows its limit to users; Gmail's own limit on the encoded message is large enough for this.
- Bcc addresses are shown on the timeline entry to teammates who can see it: they are the team's own record of who was written to.
- The design is B of `design-options.html` (clarified 2026-11-26) with `docs/DESIGN.md` and SF-102's timeline design B. The "without a working Gmail" message of US4 shows inside the same right-side panel.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply (no Google call inside a database transaction, fixed messages, fakes for outside services) and are not repeated here.
