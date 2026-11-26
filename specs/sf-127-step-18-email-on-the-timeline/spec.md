# Feature Specification: Email on the timeline

**Feature Branch**: `factory/sf-127-step-18-email-on-the-timeline`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "Step 18 - Email on the timeline. The emails copied by the Gmail sync appear in the CRM (`docs/PRODUCT.md` section 3, the email lines in `docs/DECISIONS.md`): an EMAIL entry on the timeline of every person in the conversation, of their organisations, and of the deal it is linked to, beside notes and the other entries, with the sender, the recipients, the subject, the date and time, the start of the text, and the names and sizes of its attachments. Opening it shows the whole conversation, oldest first, as plain text; an email's HTML is never shown as a web page. Opening an attachment fetches it from Gmail through the CRM. Linking: a conversation is linked automatically to every person in the CRM by any of their email addresses, and to that person's organisation; it is linked to a deal automatically when one of those people is the main person or a linked person of exactly one open deal. Anyone who can see the conversation can link it to another deal, person or organisation, or unlink it, and it stays as they set it. Who sees it: everyone on the team sees every user's conversations with contacts, except a conversation that includes a private person or is linked to a private deal the viewer cannot see, which is hidden entirely (`docs/DECISIONS.md`). A sent or received email raises the person's Last contacted, never lowering it. The deal, person and organisation pages show their details on the left and the timeline on the right, as in Pipedrive. Not in this issue: writing, replying and forwarding (later issues). Gmail is faked in tests."

## Clarifications

### Session 2026-11-26

- Q: Which design? → A: Design: B, the email in a box with a blue left edge on the timeline (as notes have an orange one); the conversation on its own page with // LINKED TO on the left and // EMAILS on the right (see `design-options.html`).
- Q: What does the timeline show for a conversation of several emails? → A: One EMAIL entry per email, each at its own time; opening any entry shows the whole conversation (A).
- Q: Can a conversation be linked automatically to a private deal? → A: Yes: the private deal hides the conversation from teammates who cannot see the deal (A).

### Plan 2026-11-26

- Q: When the same email is copied into two mailboxes and the copies differ (the sender's copy lists Bcc, a recipient's does not), which copy is shown to the team? → A: The sender's copy (the one Gmail marks as sent), so Bcc shows as the sender sees it, as FR-002 says; otherwise the copy stored first (decided by the factory, to confirm)
- Q: Two copies of one conversation are found to be the same conversation only later (a shared email arrives after each copy was already linked and edited by hand): whose links win? → A: Both conversations' links are kept; for the same record, a choice made by hand beats an automatic link, and between two choices made by hand the later one wins (decided by the factory, to confirm)
- Q: Do emails copied before this issue ships also raise Last contacted? → A: Yes: they are linked and raise Last contacted (never lower it) the first time the 15-minute Gmail check runs after the release (decided by the factory, to confirm)
- Q: Is a person whose link was removed by hand still used to link a deal automatically? → A: No: only people currently linked to the conversation through their address bring a deal; their privacy still hides the conversation while they are in its emails (decided by the factory, to confirm)
- Q: Which deals can be linked by hand? → A: Any deal the user can see that is not archived, Won and Lost included; people and organisations likewise not archived (decided by the factory, to confirm)
- Q: What does a downloaded attachment arrive as? → A: Always as a download (Content-Disposition: attachment, type application/octet-stream, never shown in the browser), under its name with characters a file system refuses replaced, as SF-116 files are (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a contact's emails on their timeline (Priority: P1)

A team member opens a person's page and, in the timeline beside notes, activities, files and changes, sees an EMAIL entry for each email copied from any teammate's Gmail that this person sent, received or was copied on: who sent it, who it went to, the subject, the date and time, the start of its text, and the names and sizes of its attachments. The same entries appear on the timeline of the person's organisation and of the deal the conversation is linked to.

**Why this priority**: Gmail sync (SF-118) copies conversations but nothing shows them yet; seeing every exchange with a contact in one place is the core of "read email inside the app" (PRODUCT §3) and of "one timeline per deal showing everything in date order" (PRODUCT §1).

**Independent Test**: With the fake Gmail, connect Ada Fake, deliver a message from "ana@example.test" (a shared person, Ana Example, at Example Ltd, main person of exactly one open deal) with one attachment, then open Ana's page, Example Ltd's page, the deal page and the deal drawer and confirm one EMAIL entry on each with the expected sender, recipients, subject, time, text start and attachment line.

**Acceptance Scenarios**:

1. **Given** Ada is connected and Ana Example ("ana@example.test") works at Example Ltd, **When** a message from Ana to Ada with subject "Proposal", text "Hi Ada, here are the figures we discussed last week…" and the attachment "figures.pdf" (240 KB) is copied, **Then** Ana's timeline shows, in the day group of the message's Gmail time, an entry tagged EMAIL with that time and the line "Ana Example → Ada Fake", then, in a box with a blue left edge, the subject "Proposal", the start of the text, and "figures.pdf · 240 KB".
2. **Given** that message, **When** a teammate opens Example Ltd's page, **Then** the same EMAIL entry is on its timeline.
3. **Given** Ana is the main person of exactly one open deal "Example Ltd – pilot", **When** the message is copied, **Then** the deal page and the deal drawer show the same EMAIL entry.
4. **Given** Ada replies to Ana from Gmail and the reply is copied, **When** a teammate opens Ana's page, **Then** a second EMAIL entry shows Ada as the sender and Ana as the recipient, at the reply's time, newest first like other entries.
5. **Given** a message from Ana that also has "ben@example.test" (Ben Example, a person at Other Co) in Cc, **When** it is copied, **Then** the entry is on Ana's, Ben's, Example Ltd's and Other Co's timelines, and shows Ben among the recipients (Cc).
6. **Given** Bob Fake is also connected and Ana sends one message to both Ada and Bob, **When** it is copied into both mailboxes, **Then** each timeline shows that email once, not twice.
7. **Given** a message with no text part, only HTML, **When** its entry is shown, **Then** the start of the text is plain text taken from the HTML, with no markup, images or links rendered.

---

### User Story 2 - Read the whole conversation and its attachments (Priority: P1)

From an EMAIL entry, a team member opens the conversation and reads every email in it, oldest first, as plain text, each with its sender, recipients (To and Cc), date and time and attachments. They can open an attachment, which the CRM fetches from Gmail for them.

**Why this priority**: The timeline only shows the start of each email; reading the full exchange and its attachments is what makes the timeline useful without leaving the CRM.

**Independent Test**: With the fake Gmail, copy a three-message conversation (one HTML-only with a script and an image, one with an attachment), open it from the timeline and confirm the order, the plain text, the absence of rendered HTML, and that the attachment download returns the fake Gmail's bytes under its name.

**Acceptance Scenarios**:

1. **Given** a conversation of three emails, **When** a teammate opens its EMAIL entry from Ana's page, **Then** the conversation's own page shows "CONVERSATION · 3 EMAILS", the subject as its heading, "← ANA EXAMPLE" back to Ana's page, // LINKED TO on the left and, under // EMAILS · OLDEST FIRST on the right, the three emails oldest first, each with sender, To, Cc, date and time, the full text as plain text, and its attachments with names, sizes and [ DOWNLOAD ].
2. **Given** an email sent as HTML only, containing a script, an image, styles and links, **When** it is shown, **Then** only its text appears, as plain text: no script runs, no image or outside content is loaded, no styling from the email applies.
3. **Given** an attachment "figures.pdf", **When** a teammate who can see the conversation opens it, **Then** the CRM fetches it from Gmail through the mailbox it was copied from and the browser downloads it as "figures.pdf"; it is never displayed by the CRM as a web page.
4. **Given** the mailbox the email was copied from is disconnected, needs reconnecting, belongs to a deactivated user, or Gmail cannot be reached or no longer has the message, **When** someone opens the attachment, **Then** nothing is downloaded and the page says the attachment cannot be fetched from Gmail right now, naming no technical cause; when the same email was also copied into another teammate's working mailbox, that copy is used instead.
5. **Given** a conversation copied in two teammates' mailboxes, **When** it is opened, **Then** each email appears once.

---

### User Story 3 - Conversations link themselves to people, organisations and deals (Priority: P1)

Without anyone doing anything, each copied conversation is linked to every person in the CRM whose email address (any of them) appears as sender or recipient of one of its emails, to each such person's organisation, and to a deal when one of those people is the main person or a linked person of exactly one open deal.

**Why this priority**: Automatic linking is what puts the entries on the right timelines (PRODUCT §3, "Threads link to deals, people and organisations automatically by matching email addresses").

**Independent Test**: Seed people, organisations and deals in each linking case, copy one conversation per case with the fake Gmail, and confirm which records' timelines show it.

**Acceptance Scenarios**:

1. **Given** Ana has the addresses "ana@example.test" and "ana.example@mail.test", **When** a message to either address is copied, **Then** the conversation is linked to Ana and to her organisation.
2. **Given** Ana is the main person of one open deal and a linked person of no other open deal, **When** her conversation is copied, **Then** it is linked to that deal.
3. **Given** Ana is a linked (not main) person of exactly one open deal, **When** her conversation is copied, **Then** it is linked to that deal.
4. **Given** Ana is on two open deals (main or linked), **When** her conversation is copied, **Then** it is linked to no deal through her; a teammate can link it by hand (US4).
5. **Given** Ana's only deals are Won, Lost or archived, **When** her conversation is copied, **Then** it is linked to no deal.
6. **Given** a conversation with Ana (one open deal A) and Ben (one open deal B), **When** it is copied, **Then** it is linked to both deals.
7. **Given** a conversation already copied with an address no person has, **When** a teammate adds a person with that address, or adds that address to an existing person, **Then** the conversation is linked to that person and their organisation, and to a deal by the same rule, and shows on their timelines.
8. **Given** a later email in the same conversation adds a new CRM person in Cc, **When** it is copied, **Then** the conversation is also linked to that person, their organisation and, by the same rule, a deal.
9. **Given** shared Ana's only open deal is private to Ada, **When** a conversation with Ana is copied, **Then** it is linked to that deal: Ada sees it on Ana's timeline and the deal's, and Bob sees it on neither (clarified 2026-11-26).

---

### User Story 4 - Link or unlink a conversation by hand (Priority: P2)

From the open conversation, anyone who can see it sees what it is linked to (people, organisations, deals) and can link it to another deal, person or organisation, or unlink any of them. Their choice stays: automatic linking never undoes it.

**Why this priority**: Automatic linking cannot be right every time (two open deals, a colleague's other address, an unrelated organisation); PRODUCT §3 asks for "a manual option to link or unlink".

**Independent Test**: Open a conversation linked automatically, unlink its deal and link another deal, a person and an organisation; copy a new email into the same conversation and confirm the links stay as set.

**Acceptance Scenarios**:

1. **Given** an open conversation, **When** a teammate looks at it, **Then** // LINKED TO lists each linked person, organisation and deal with its kind (PERSON, ORG, DEAL), its name linking to its page, and [ UNLINK ], then [ LINK DEAL ], [ LINK PERSON ] and [ LINK ORGANISATION ].
2. **Given** a conversation, **When** a teammate links it to the deal "Other Co – renewal" chosen from deals they can see, **Then** the conversation shows on that deal's timeline at once.
3. **Given** a conversation, **When** a teammate links it to a person or organisation they can see, **Then** it shows on that record's timeline, even when that person is not in its emails.
4. **Given** a conversation linked automatically to Ana's deal, **When** a teammate unlinks the deal, **Then** it leaves the deal's timeline, and a later email in the conversation, or a change to Ana's deals, never links that deal again.
5. **Given** a teammate unlinks Ana, who is in the conversation, **Then** it leaves Ana's timeline and is never linked to her again automatically; a teammate can link her again by hand.
6. **Given** the pickers, **When** a teammate searches for a deal, person or organisation to link, **Then** only records they can see are offered, archived ones excluded.

---

### User Story 5 - Private people and deals keep their conversations hidden (Priority: P1)

Everyone on the team sees every user's conversations with contacts, except that a conversation which includes a private person, or is linked to a private deal or person, that the viewer cannot see is hidden from that viewer entirely: no entry on any timeline, no conversation page, no attachment.

**Why this priority**: The privacy rule (DECISIONS kickoff and 2026-11-24) must hold from the first moment emails are shown.

**Independent Test**: With a private person "Pia Private" owned by Ada, copy a conversation with Pia and a shared person Ana; confirm Ada sees it everywhere and Bob sees it nowhere, including by its address.

**Acceptance Scenarios**:

1. **Given** Pia is private to Ada, **When** a conversation that includes Pia's address and Ana's is copied (from any mailbox), **Then** Ada sees its EMAIL entries on Ana's, Pia's and their organisations' timelines, and Bob sees them on none, including Ana's and the organisations'.
2. **Given** that conversation, **When** Bob opens its address or one of its attachments' addresses directly, **Then** he gets the same "not found" as for a conversation that never existed, and nothing about it (subject, names) is shown.
3. **Given** a conversation with Ana only, **When** a teammate links it to a private deal of Ada's, **Then** it disappears for everyone but those who can see that deal.
4. **Given** a conversation hidden from Bob because of Pia, **When** Ada makes Pia shared, **Then** Bob sees it.
5. **Given** a conversation copied from Ada's mailbox, **When** Bob (who can see everyone in it) opens Ana's page, **Then** he sees it, though it is not from his own mailbox.
6. **Given** a teammate unlinks private Pia from a conversation she is in, **Then** the conversation stays hidden from those who cannot see Pia (she is still in its emails).

---

### User Story 6 - Email raises Last contacted (Priority: P2)

Each email sent to or received from a person (as sender, To, Cc or Bcc) sets their Last contacted to the email's time when that is later than what it shows; it never lowers it.

**Why this priority**: Last contacted is "filled in automatically" (PRODUCT §2); emails are the most frequent contact.

**Independent Test**: Copy emails at different times for a person whose Last contacted is set by a done call, and confirm the value after each.

**Acceptance Scenarios**:

1. **Given** Ana's Last contacted is 20 Nov 2026, **When** an email from her at 25 Nov 2026 14:05 is copied, **Then** her Last contacted is 25 Nov 2026 14:05.
2. **Given** Ana's Last contacted is 25 Nov 2026, **When** an email of 22 Nov 2026 is copied, **Then** it stays 25 Nov 2026.
3. **Given** Ada sends Ana and Ben one email (Ben in Bcc), **When** it is copied, **Then** both people's Last contacted are raised.
4. **Given** a private person, **When** an email with them is copied, **Then** their Last contacted is raised like anyone else's.

---

### User Story 7 - Details on the left, timeline on the right (Priority: P2)

The deal, person and organisation pages show the record's details on the left and the timeline on the right, as in Pipedrive.

**Why this priority**: With emails added the timeline becomes the main part of the page; side by side, a user reads the details and the history without scrolling past one to reach the other.

**Independent Test**: Open a person, an organisation and a deal page on a wide screen and on a narrow one and check where each section is.

**Acceptance Scenarios**:

1. **Given** a wide screen, **When** a teammate opens a person, organisation or deal page, **Then** the details (the record's fields, // MORE DETAILS, "Referred by", and for a deal its stage bar, value and linked people) are in a left column, and the note box, // NEXT ACTIVITIES, // FILES and // TIMELINE are in a right column, in that order.
2. **Given** a narrow screen, **When** the page is opened, **Then** the columns stack, details first.
3. **Given** the new layout, **When** a teammate adds a note, schedules an activity, adds a file, and on a deal presses Won, **Then** the note, the activity, the file and the "Won" change each show in the right column, and [ EDIT ] and [ ARCHIVE ] are still in the page header.

---

### Edge Cases

- **Conversation with no CRM person left**: after an admin deletes a person in it, the conversation still shows on the other linked records' timelines; a conversation linked to nothing shows on no timeline.
- **Deleted deal or organisation**: its links go; the conversation stays on the other records.
- **Archived person, organisation or deal**: links stay and the entries still show on the archived record's page; an archived person in a conversation does not hide it.
- **Person changes organisation**: conversations already linked to the old organisation stay linked to it; later emails link the new one too.
- **Deal later Won, Lost or archived**: an automatic deal link made while it was open stays.
- **Several of a person's addresses in one email**: the email is shown once on their timeline and raises Last contacted once.
- **Teammate addresses**: emails between Ada and Bob (both barnacle.ai, no CRM person) are not copied (SF-118) so never shown; a barnacle.ai address is never linked to a CRM person by mistake unless a person has it.
- **Missing sender name or subject**: the entry shows the bare address, and "(no subject)" for an empty subject.
- **Very long email or conversation**: the timeline entry shows at most the first 200 characters of the text, ending in "…"; the open conversation shows every email in full.
- **Email with only attachments, no text**: the entry shows no text line, only the attachments.
- **Many attachments**: the entry lists every attachment name with its size.
- **Same conversation in two mailboxes**: each email appears once on timelines and in the conversation; a link change made on it applies to the conversation as a whole.
- **Header text with markup**: names, subjects and text that look like HTML are shown as typed, never interpreted.
- **Hidden linked record**: a conversation linked to a record the viewer cannot see is hidden (private person or deal); organisations are never private.
- **Timeline paging**: EMAIL entries are paged with the other entries ([ SHOW MORE ]), in time order.
- **Mailbox owner deactivated or disconnected**: their copied emails still show (DECISIONS SF-118); only attachments become unavailable unless another working mailbox has a copy.

## Requirements *(mandatory)*

### Functional Requirements

**Timeline**

- **FR-001**: Each copied email MUST appear as one EMAIL entry on the timeline of every record its conversation is linked to (people, organisations, deals), on record pages and the deal drawer, in time order among the other entries, grouped by day with the EMAIL tag and the time.
- **FR-002**: An EMAIL entry MUST show the sender (name and address), the recipients (To and Cc; Bcc only when the copied email shows it, as on a teammate's sent email), the subject ("(no subject)" when empty), the date and time Gmail received or sent it, the start of its text as plain text, and each attachment's name and size.
- **FR-003**: An email copied into several teammates' mailboxes MUST appear once on each timeline and once in its conversation.
- **FR-004**: An email's HTML MUST never be shown as a web page anywhere: text is shown as plain text (taken from the HTML when there is no text part), with no script, image, style or outside content loaded.

**Conversation**

- **FR-005**: Opening an EMAIL entry MUST show its whole conversation on its own page (design B), oldest first, each email with sender, To, Cc, date and time, full plain text and attachments, with what the conversation is linked to in a left column, and a way back to the record it was opened from.
- **FR-006**: Opening an attachment MUST fetch it from Gmail through the CRM, from a working mailbox holding that email, and deliver it as a download under its name; when no working mailbox can provide it, the user MUST get a plain message that the attachment cannot be fetched from Gmail right now.

**Linking**

- **FR-007**: A conversation MUST be linked automatically to every person whose email address (any of theirs, compared without case) is the sender or a recipient (To, Cc, Bcc) of one of its emails, and to each such person's organisation.
- **FR-008**: A conversation MUST be linked automatically to a deal when one of its automatically linked people is the main person or a linked person of exactly one open, unarchived deal; each such person can bring one deal.
- **FR-009**: Automatic linking MUST run when an email is copied and when a person is added or given a new email address (for conversations already copied).
- **FR-010**: Anyone who can see a conversation MUST be able to link it to a deal, person or organisation they can see (not archived), and unlink any of its links.
- **FR-011**: A link removed by hand MUST never be added again automatically; a link added by hand MUST never be removed automatically (only deleting the record removes it).

**Visibility**

- **FR-012**: Every user MUST see every user's copied conversations, except a conversation in which a person the viewer cannot see is a sender or recipient, or which is linked to a person or deal the viewer cannot see; such a conversation MUST be hidden entirely from that viewer (no entry, no conversation page, no attachment, no name or subject), answering as for one that does not exist.
- **FR-013**: Linking pickers MUST offer only records the user can see.

**Last contacted**

- **FR-014**: Each copied email MUST set the Last contacted of every person who is its sender or recipient to the email's time when that is later than their current value, never lowering it.

**Layout**

- **FR-015**: The deal, person and organisation pages MUST show the details in a left column and the note box, next activities, files and timeline in a right column on wide screens, stacking details first on narrow ones; every existing action keeps working.

**General**

- **FR-016**: All user-facing text MUST come from the app's message list; text from emails (names, subjects, bodies, file names) MUST be shown as text, never interpreted.
- **FR-017**: Gmail MUST be faked in tests and development; nothing in this issue needs a real Google account.

### Key Entities

- **Conversation**: an email thread copied by the Gmail sync (one copy per mailbox that has it, shown as one); has a subject and emails.
- **Email**: one message of a conversation: sender, To, Cc, Bcc, subject, Gmail time, text, direction, attachments (names and sizes).
- **Attachment**: name, type, size of a file on an email; its content stays in Gmail and is fetched when opened.
- **Conversation link**: a conversation ↔ person, organisation or deal; made automatically or by hand; a hand-removed link is remembered so it is not made again.
- **Person / Organisation / Deal**: existing records; a person's Last contacted is raised by emails.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of copied emails with a CRM person appear on that person's timeline within one page load after they are copied.
- **SC-002**: In tests, no conversation that includes a private person or private deal is visible, through any page, entry or attachment address, to a user who cannot see that person or deal (0 leaks).
- **SC-003**: In tests, no part of an email's HTML is ever rendered: script, images and styles from emails never take effect.
- **SC-004**: A user can go from a person's page to reading a full 10-email conversation in one click.
- **SC-005**: After a manual unlink, 0 automatic relinks of that record happen, whatever new emails arrive.
- **SC-006**: Every email sent or received raises Last contacted when later, and lowers it in 0 cases.
- **SC-007**: Each email shows once per timeline even when copied into several mailboxes.

## Assumptions

- Duplicate copies of the same email across mailboxes are matched by the email's own identifier (Message-ID) (decided by the factory, to confirm).
- "Exactly one open deal" is counted per person, among open (not Won, Lost or archived) deals where they are main or linked person; deal privacy does not change the count, so a conversation can be auto-linked to a private deal and then hidden from those who cannot see it (clarified 2026-11-26).
- People and organisations show the conversations linked to them directly; a deal's conversations do not also appear on the timelines of the deal's other people or organisation unless linked to them (decided by the factory, to confirm).
- Linking and unlinking make no timeline CHANGE entry and no notification (decided by the factory, to confirm).
- Automatic links already made stay when the reason changes (a person changes organisation, a deal closes, an address is removed from a person) (decided by the factory, to confirm).
- Attachments are always downloaded, never previewed, in this issue (decided by the factory, to confirm).
- Emails come only from the existing Gmail sync (SF-118); "Fetch past emails", the Inbox, writing, replying and forwarding are later issues. Emails copied before this issue are linked when it ships, so they appear too.
- The deal drawer keeps its one-column layout; only the three record pages change layout. The look follows `docs/DESIGN.md` and design B of `design-options.html`.
