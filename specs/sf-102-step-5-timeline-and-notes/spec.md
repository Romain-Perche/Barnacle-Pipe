# Feature Specification: Timeline and notes

**Feature Branch**: `factory/sf-102-step-5-timeline-and-notes`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "step 5 - Timeline and notes. The timeline on deals, people and organisations, and notes with @mentions (`docs/PRODUCT.md` sections 1, 2 and 5). A person's and an organisation's timeline also show what happens on their deals. Emails, files and activities will be added to the timeline by later issues."

## Clarifications

### Session 2026-11-20

- Q: Which design for notes and the timeline? → A: Design: B, the timeline grouped by day ("// TODAY · 20 NOV 2026", then "// 19 NOV 2026"…), each entry with a NOTE, DEAL or CHANGE tag, its time, and notes in a box with an orange left edge; the note box with `[ CANCEL ]` and `[ ADD NOTE ]` sits above the timeline (see `design-options.html`).
- Q: How does a teammate learn they were mentioned in a note? → A: In the app only: "Notifications (n)" in the sidebar and a Notifications page; no email.
- Q: Who can edit or delete a note? → A: Anyone who can see the note can edit or delete it, like Pipedrive.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write notes on deals, people and organisations (Priority: P1)

A team member opens a deal, a person or an organisation and writes a note in a box above its timeline (for example what was said on a call). The note appears at the top of the timeline with who wrote it and when. Anyone who can see the note can later edit it or delete it.

**Why this priority**: Notes are a "must have" (PRODUCT §5) and the main thing the team adds to a record day to day; without them the timeline only holds automatic changes.

**Independent Test**: With the fake data loaded, add a note "Called Ada, wants a proposal by Friday" on a deal, a person and an organisation; confirm each shows at the top of its timeline with the author and time; edit one, delete another, and confirm the result after a reload.

**Acceptance Scenarios**:

1. **Given** a deal, person or organisation the user can see and that is not archived, **When** they type a note and press `[ ADD NOTE ]`, **Then** the note is shown at the top of the record's timeline, under the "// TODAY · <date>" heading, tagged NOTE, with the author's name, the time and the full text (line breaks kept), and the box is empty again.
2. **Given** the note box is empty or only spaces, **When** the user presses `[ ADD NOTE ]`, **Then** "Write something before adding the note." is shown and nothing is saved.
3. **Given** a note longer than 10,000 characters is sent, **When** it is saved, **Then** "Keep the note under 10,000 characters." is shown and nothing is saved; the box does not let more than 10,000 characters be typed.
4. **Given** a note the user can see (theirs or a teammate's), **When** they press `[ EDIT ]` on it, change the text and press `[ SAVE ]`, **Then** the timeline shows the new text in the same place (by its original date), still under its author's name, marked "edited by <their name>"; `[ CANCEL ]` keeps the old text.
5. **Given** a note the user can see (theirs or a teammate's), **When** they press `[ DELETE ]` and confirm "Delete this note? This can't be undone.", **Then** the note is removed from every timeline it appeared on and "Note deleted." is shown.
6. **Given** a note on a record the user cannot see (deleted, or private to someone else), **When** they send a direct request to edit or delete it, **Then** "This note doesn't exist or you can't see it." is shown and nothing changes.
7. **Given** another user edited or deleted the note since the page was loaded, **When** the user saves their edit, **Then** "Someone else changed this note while you were editing. Reload to see their changes." (or, if deleted, "This note doesn't exist any more.") is shown and nothing changes.
8. **Given** an archived deal, person or organisation, **When** its page is shown, **Then** its notes are shown on its timeline but there is no note box and no `[ EDIT ]` or `[ DELETE ]` on notes; restoring it brings them back.

---

### User Story 2 - One timeline per record, including what happens on its deals (Priority: P1)

Every deal, person and organisation page ends with one "// TIMELINE" listing everything about it newest first: notes and changes (added, edited, moved, won, lost, linked…). A person's timeline also shows what happens on the deals they are linked to (as main person or other person), and an organisation's timeline what happens on its deals, each such entry naming the deal it came from with a link to it.

**Why this priority**: PRODUCT §1 and §2 ask for one timeline per deal, and the same timeline on people and organisations; seeing a contact's deal activity in one place is why the team opens a contact.

**Independent Test**: Link "Ada Example" and "Example Ltd Fake" to a deal; add a note on the deal and move it to another stage; open Ada's and Example Ltd Fake's pages and confirm both entries appear on their timelines under the deal's title, among their own notes and changes in date order.

**Acceptance Scenarios**:

1. **Given** a deal page, **When** it is shown, **Then** its "// TIMELINE" (formerly "// HISTORY") lists the deal's notes and every change already recorded, newest first, under one heading per day ("// TODAY · 20 NOV 2026", "// 19 NOV 2026"), each entry with its tag (NOTE or CHANGE), who and the time.
2. **Given** a person who is the main person or another linked person of a deal, **When** their page is shown, **Then** their timeline holds their own notes and changes and every note and change of that deal, merged newest first; each deal entry has the tag DEAL and shows the deal's title, linking to the deal page, above the note or change.
3. **Given** an organisation that is the organisation of a deal, **When** its page is shown, **Then** its timeline holds its own notes and changes and every note and change of that deal, in the same way.
4. **Given** a person is unlinked from a deal (or a deal's organisation is changed), **When** the person's (or the old organisation's) timeline is shown, **Then** that deal's entries no longer appear on it; the person's link and unlink stay on the deal's own timeline.
5. **Given** a timeline with more than 50 entries, **When** it is shown, **Then** the newest 50 are listed with `[ SHOW MORE ]`, which adds the next 50 in order without repeating or skipping any.
6. **Given** a record with no notes and only its "Added" entry, **When** its page is shown, **Then** the timeline shows that entry and the note box; nothing else is invented.
7. **Given** an archived deal, **When** the person's or organisation's timeline is shown, **Then** that deal's entries are still shown (the deal title marked "Archived"); a deleted deal's entries are gone from every timeline.

---

### User Story 3 - @mention a teammate in a note (Priority: P2)

While writing a note, a team member types "@" and picks a teammate from a list; the saved note shows "@<name>" highlighted. The mentioned teammate sees a "Notifications" link in the sidebar with the number of unread mentions, and a page listing them, each opening the record where they were mentioned.

**Why this priority**: PRODUCT §5 asks for @mentions that notify teammates; notes are useful without them, so they come second.

**Independent Test**: As Ada Fake, write a note on a deal mentioning "@Bob Fake"; sign in as Bob Fake and confirm the sidebar shows "Notifications (1)", the page lists "Ada Fake mentioned you in a note on <deal title>" with the start of the note, and opening it goes to the deal page and clears the count.

**Acceptance Scenarios**:

1. **Given** the note box, **When** the user types "@" followed by letters, **Then** a list offers the active users whose name starts with or contains those letters and who can see the record; choosing one puts "@<name>" in the note.
2. **Given** a saved note mentioning "@Bob Fake", **When** it is shown on any timeline, **Then** "@Bob Fake" stands out from the rest of the text; the rest of the note is plain text.
3. **Given** a note mentioning Bob Fake is saved, **When** Bob Fake loads any signed-in page, **Then** the sidebar shows "Notifications (1)", and the Notifications page lists, newest first, "<name> mentioned you in a note on <record name>" (<name> is who saved the note with the mention) with the date, the first 200 characters of the note and a link to the record.
4. **Given** an unread notification, **When** Bob opens it, **Then** Bob lands on the record's page, the notification is marked read and the count goes down; `[ MARK ALL AS READ ]` marks every one read.
5. **Given** a user mentions themselves, or mentions the same person twice in one note, **When** the note is saved, **Then** nobody gets a notification for themselves and each person gets one notification per note.
6. **Given** a note is edited to add "@Cy Fake" and keep "@Bob Fake", **When** it is saved, **Then** only Cy Fake gets a new notification; a mention removed by an edit removes that person's notification about the note.
7. **Given** a note is deleted, **When** a mentioned user opens the Notifications page, **Then** the notification about it is gone and the count no longer includes it.

---

### User Story 4 - Private records keep their notes private (Priority: P1)

Notes follow the existing private rules: a note on a private person or private deal is seen only by the people who can see that record, everywhere it could appear (the record's own timeline, a person's or organisation's timeline showing deal entries, mention lists and notifications).

**Why this priority**: The team decision is that a private contact or deal hides its notes from everyone but those allowed, admins included; breaking it would leak private conversations.

**Independent Test**: As Ada Fake, make a deal private and add a note on it; as Bob Fake (an admin), open the deal's organisation and main person and confirm no entry of the deal appears; confirm Bob is not offered in Ada's mention list for that deal.

**Acceptance Scenarios**:

1. **Given** a private deal, **When** someone it is hidden from opens its person's or organisation's timeline, **Then** no note or change of that deal appears, and no count or gap gives it away.
2. **Given** a private person, **When** someone they are hidden from opens an organisation or deal they are linked to, **Then** nothing on those timelines names that person or shows their notes (as today for changes).
3. **Given** a note box on a private record, **When** the user types "@", **Then** only users who can see the record are offered; a mention of anyone else sent directly is refused with "<name> can't see this record, so they can't be mentioned." and nothing is saved.
4. **Given** a shared deal with a note mentioning Bob Fake is later made private so Bob cannot see it, **When** Bob opens his Notifications page, **Then** that notification is not shown or counted, and opening its link shows "This deal doesn't exist or you can't see it."; if the deal is shared again, the notification is back.
5. **Given** a private deal's notes, **When** the deal is handed over with a deactivated user's private records (SF-97), **Then** its notes go with it and are seen by the new owner.

---

### Edge Cases

- A deal whose main person is also its organisation's person: the deal's entries appear once on the person's timeline and once on the organisation's, never twice on the same timeline.
- A person linked to a deal, unlinked, then linked again: the deal's entries (all of them, from before and after) show on their timeline again while they are linked.
- Changes that are recorded on the deal and on a linked person at the same time (for example "Linked Ada Example") appear once on Ada's timeline: the person's own entry, not the deal's copy as well.
- A mentioned user who is later deactivated stays shown as "@<name>" in the note and gets no further notifications; deactivated users are never offered in the mention list.
- "@" followed by text that is not a chosen user (for example an email address "ada@example.fake") is kept as plain text and notifies nobody.
- A teammate who is renamed: existing mentions show their current name.
- A note on a person deleted by an admin is deleted with them (as their timeline, SF-90); notes on a deleted organisation or deal likewise; notifications about them disappear.
- A note's text is shown exactly as typed: never as a link, formatting or markup, apart from the highlighted mentions; spaces at the start and end are removed, inner line breaks kept.
- Editing a note to empty text is refused with "Write something before adding the note."; to remove it, the user presses `[ DELETE ]`.
- A note whose author is deactivated stays under "<name> (deactivated)", and anyone who can see it can still edit or delete it.
- A note edited by several people shows "edited by <name>" with the last person who edited it.
- When `[ SHOW MORE ]` adds entries from a day already shown, they go under that day's heading; no day heading appears twice.
- A timeline entry with no note shows the tag CHANGE (or DEAL for a deal's change on a person or organisation) and one line of text; a note shows its full text in a box with an orange left edge.
- Two users add notes at the same moment: both are kept, each in its place.
- A notification about a record that was archived still opens the record's page (showing "Archived").
- A Notifications page with more than 50 notifications shows the newest 50 with `[ SHOW MORE ]`; with none, "No notifications yet.".

## Requirements *(mandatory)*

### Functional Requirements

**Timeline**

- **FR-001**: Every deal, person and organisation page MUST show one "// TIMELINE" listing the record's notes and recorded changes newest first, each with who and when (UK date and time); the deal page's "// HISTORY" becomes this timeline.
- **FR-002**: A person's timeline MUST also list the notes and changes of every deal they are linked to (as main person or other linked person), and an organisation's timeline those of every deal whose organisation it is, for as long as the link lasts; each such entry MUST name the deal with a link to its page, and MUST appear at most once per timeline.
- **FR-003**: Timelines MUST show the newest 50 entries first and load older ones 50 at a time, in a stable order, without repeating or skipping entries.
- **FR-004**: The timeline MUST be the one place later features add their entries (emails, campaign emails, files, activities, WhatsApp messages); this feature adds notes only.

**Notes**

- **FR-005**: Any signed-in user who can see a deal, person or organisation that is not archived MUST be able to add a note to it: plain text, required, up to 10,000 characters after removing surrounding spaces, line breaks kept.
- **FR-006**: Any user who can see a note MUST be able to edit its text; an edited note keeps its author, original date and place and is marked "edited by <name of the last editor>". Edits MUST be refused with the "changed since loaded" message when the note changed since the page was loaded.
- **FR-007**: Any user who can see a note MUST be able to delete it after confirming; it disappears from every timeline. Nobody who cannot see the note's record can edit or delete it, enforced on every request.
- **FR-008**: A note MUST be removed for good when the record it is on is deleted.
- **FR-009**: Notes on archived records MUST stay visible; adding, editing and deleting notes MUST be refused until the record is restored.

**Mentions and notifications**

- **FR-010**: While writing or editing a note, typing "@" MUST offer the active users who can see the record, filtered by the letters typed; choosing one adds a mention of that user, shown as "@<their current name>" and highlighted wherever the note is shown.
- **FR-011**: Saving a note MUST give each mentioned user (other than the user saving it) one unread notification for that note; editing MUST notify only newly mentioned users and remove the notification of users no longer mentioned; deleting the note MUST remove its notifications.
- **FR-012**: Every signed-in page MUST show a "Notifications" link in the sidebar with the number of unread notifications; the Notifications page MUST list the user's notifications newest first ("<name> mentioned you in a note on <record name>" (<name> is who saved the note with the mention), date, first 200 characters of the note, read or unread), 50 at a time.
- **FR-013**: Opening a notification MUST take the user to the record's page and mark it read; `[ MARK ALL AS READ ]` MUST mark every notification of the user read. Users MUST only ever see their own notifications.

**Access, privacy, messages, look**

- **FR-014**: Every page and action MUST require a signed-in, active user; nothing here is admin-only.
- **FR-015**: The private person rule (SF-92) and private deal rule (SF-93) MUST apply to notes, to deal entries on person and organisation timelines, to the mention list and to notifications: no one a record is hidden from may see, count or change its notes, be mentioned on it, or see a notification about it while it is hidden.
- **FR-016**: Every message shown MUST be one of the app's fixed messages; text from the page address MUST never be shown; note text is shown as plain text only.
- **FR-017**: The timeline MUST follow design B in `design-options.html`: entries grouped under one heading per day ("// TODAY · <date>", then "// <date>"), each with a NOTE, DEAL or CHANGE tag and its time, notes in a box with an orange left edge, mentions highlighted, the note box with `[ CANCEL ]` and `[ ADD NOTE ]` above the timeline. The Notifications page MUST follow `docs/DESIGN.md` and the existing pages (design B sidebar).

**Fake data**

- **FR-018**: The fake data command MUST add, without duplicates when run again, notes (clearly fake text) on deals, people and organisations, some with mentions of fake users and some edited, at least one note on a private deal and on a private person, and unread and read notifications.

### Key Entities

- **Note**: text written on one deal, person or organisation; has an author, the date written, who last edited it and when, and the users it mentions.
- **Mention**: a user named in a note; shown with the user's current name.
- **Notification**: a message to one user that they were mentioned in a note; read or unread; disappears with the note or the mention.
- **Timeline entry** (from SF-90/SF-93/SF-95): a recorded change or a note on a record; a person's and an organisation's timeline also read the entries of their deals.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a note to a deal, person or organisation in under 30 seconds from opening its page.
- **SC-002**: A mentioned teammate sees the notification count on the next page they load, with no manual refresh of anything else.
- **SC-003**: A timeline with 1,000 entries (own and from deals) shows its first page in under 2 seconds.
- **SC-004**: In automated tests, every note and change of a deal appears exactly once on the timeline of each person and organisation linked to it, and on no other.
- **SC-005**: In automated tests, a note on a private deal or private person, and every notification about it, never appears or counts for anyone the privacy rules hide it from, on any timeline, list or by direct request.
- **SC-006**: 100% of edits and deletes of a note by a user who cannot see its record are refused in automated tests, including direct requests.

## Assumptions

- Emails, campaign emails, files, activities and WhatsApp messages on the timeline come in later issues (user request); this issue adds notes and shows the existing changes.
- Notifications are in-app only (clarified): no email is sent for a mention. Followers' updates (SF-95) are not part of this issue.
- Notes are plain text; no rich formatting, attachments, pinning or reactions. Timeline filters (notes only, emails only…) come when the timeline has more kinds of entries.
- An organisation's timeline shows its own deals' entries, not those of deals of its people; a person's timeline shows only deals they are linked to.
- Edits of a note are not kept as a separate history; the note shows its current text and "edited by <name>".
- Adding a note does not change a person's "last contacted" date (that comes from emails and activities).
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
