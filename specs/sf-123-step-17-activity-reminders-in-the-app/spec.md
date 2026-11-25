# Feature Specification: Activity reminders in the app

**Feature Branch**: `factory/sf-123-step-17-activity-reminders-in-the-app`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "Step 17 - Activity reminders in the app. A reminder before each planned activity is due (`docs/PRODUCT.md` section 5, the reminders line in `docs/DECISIONS.md`): its assignee gets a notification on the Notifications page, with the sidebar count, like an assignment (\"Call: intro call with Bob Example at 10:00\"). It follows the activity when it is moved, reassigned, done or deleted, and is hidden like the activity when the assignee cannot see a linked record. Not in this issue: reminder emails (Google Calendar sends them, in the Calendar issue)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Be reminded before a planned activity is due (Priority: P1)

A team member has a call planned for 10:00. Shortly before it is due, the sidebar's "Notifications (n)" count goes up and the Notifications page lists a reminder: "Call: intro call with Bob Example at 10:00", with "Due <due date and time>". Opening it lands on the activity's deal (else its person, else its organisation, else the Activities list) and marks it read, like an assignment notification (SF-109).

**Why this priority**: This is the whole feature: nobody misses a call, meeting or task because they did not look at the Activities list.

**Independent Test**: With the fake data loaded, as Ada Fake schedule a call on a deal assigned to herself, due today 20 minutes from now at a round time; reload any page before and after the reminder time and confirm the count and the Notifications page change only after it; open the reminder and confirm it lands on the deal page and the count goes down by 1.

**Acceptance Scenarios**:

1. **Given** a planned activity with a due time, assigned to Ada, **When** Ada loads any signed-in page from 15 minutes before its due time, **Then** the sidebar shows "Notifications (<n+1>)" and the Notifications page lists, among her mentions and assignments ordered newest first by the reminder time, "<Type>: <subject> at <HH:MM>" (for example "Call: intro call with Bob Example at 10:00") with the reminder time as its date and "Due <due date and time>".
2. **Given** a planned activity with a due date and no time, assigned to Ada, **When** Ada loads a page from 09:00 UK time on its due date, **Then** the reminder is listed as "<Type>: <subject>" with "Due <due date>".
3. **Given** the same activity, **When** Ada loads a page before the reminder time, **Then** no reminder is shown or counted.
4. **Given** an unread reminder, **When** Ada opens it, **Then** she lands on the activity's deal page, else its person, else its organisation, else the Activities list; the reminder shows as read and the count goes down by 1. `[ MARK ALL AS READ ]` marks every reminder already shown as read, and none still to come.
5. **Given** a user schedules an activity for themselves, **When** its reminder time comes, **Then** they get the reminder (unlike an assignment, a reminder is also for activities a user assigned to themselves).
6. **Given** an activity assigned to Bob by Ada, **When** its reminder time comes, **Then** Bob has both notifications: the assignment ("Ada Fake assigned you a call: …") and the reminder as two lines; opening the reminder marks only the reminder read and the assignment line stays Unread.

---

### User Story 2 - The reminder follows the activity (Priority: P1)

Activities change after they are planned: they are moved to another time, handed to a teammate, ticked done or deleted. The reminder always matches the activity as it is now, so nobody is reminded of a call that moved, that a teammate now owns, or that is already done.

**Why this priority**: A stale reminder is worse than none: it sends people to calls that are not happening.

**Independent Test**: As Ada Fake, with a reminder shown for a call, move the call to tomorrow, then reassign it to Bob Fake, then tick it done, and after each step reload the Notifications pages of Ada and Bob and confirm what each shows and counts.

**Acceptance Scenarios**:

1. **Given** an activity with a reminder (shown or still to come), **When** its due date or time is changed, **Then** the old reminder is gone and a new unread one comes at the new reminder time; if the new reminder time has already passed but the new due moment has not, the new reminder is shown at once.
2. **Given** an activity is changed to a due moment that has already passed, **When** it is saved, **Then** it has no reminder (the old one is gone too).
3. **Given** an activity with a reminder, **When** its assignee is changed from Ada to Bob, **Then** Ada's reminder is gone and no longer counted, and Bob gets an unread one at the reminder time (at once if that time has passed and the due moment has not).
4. **Given** an activity with a reminder, **When** it is ticked done, **Then** the reminder is gone and no longer counted; **When** it is unticked while still before its due moment, **Then** the reminder is back as it was (read or unread); after its due moment, no reminder comes back.
5. **Given** an activity with a reminder, **When** it is deleted (directly, or with the record it was linked to), **Then** the reminder is gone.
6. **Given** an activity with a reminder, **When** only its subject, type, note, duration or links are changed, **Then** the reminder keeps its time and read state and shows the new type and subject.

---

### User Story 3 - Reminders stay private like the activity (Priority: P2)

A reminder is shown only to its assignee and only while they can see every record the activity is linked to, like the activity itself (SF-109) and assignment notifications.

**Why this priority**: A reminder must never reveal a private deal or person, but it only matters once reminders exist.

**Independent Test**: As Ada Fake, with Bob Fake's reminder shown for a call on Ada's deal, make the deal private; as Bob confirm the reminder is neither shown nor counted; share the deal again and confirm it comes back.

**Acceptance Scenarios**:

1. **Given** a reminder for an activity linked to a deal or person that becomes hidden from its assignee, **When** the assignee loads any page, **Then** the reminder is not shown or counted, and opening its address answers as for any hidden notification.
2. **Given** that record becomes visible to them again, **When** they load a page, **Then** the reminder is back with its read state, if the activity still has one.
3. **Given** any other user, admins included, **When** they load the Notifications page, **Then** they never see someone else's reminder.

---

### User Story 4 - Try reminders with the fake data (Priority: P3)

A developer or reviewer loads the fake data and sees reminders without waiting for a clock.

**Why this priority**: Needed to check the screens, not by users.

**Independent Test**: Run the fake data command twice, sign in as Ada Fake and confirm the Notifications page shows read and unread reminders, and that nothing is duplicated.

**Acceptance Scenarios**:

1. **Given** the fake data command is run (once or again), **When** a fake user opens Notifications, **Then** they see at least one unread reminder for a timed activity, one for an activity with no time, and one read reminder, and at least one planned activity of theirs has a reminder still to come; nothing is duplicated.

---

### Edge Cases

- An activity scheduled with a due moment less than 15 minutes ahead (or, with no time, scheduled on its due date after 09:00) gets its reminder at once: the next page load shows it as unread and the count goes up by 1.
- An activity scheduled with a due moment already past (logging a call that happened) never gets a reminder: the Notifications page lists none for it and the count does not change.
- Activities whose due moment was already past when this feature goes live get no reminder (the fake data's overdue activities show none); planned activities due later get one as for any other activity.
- A reminder stays on the Notifications page after the activity's due moment, until the activity is done, moved, reassigned or deleted; the page lists exactly one reminder line for the activity, never a second "overdue" one.
- Times are UK time (Europe/London), across the clocks changing: the reminder is 15 real minutes before the due instant, so a call at 02:10 on the night the clocks go forward (29 Mar 2026) has its reminder dated 29 Mar 2026 00:55 on the Notifications page and is not shown on a page loaded at 00:50; a task with no time has its reminder dated 09:00 on its due date in both winter and summer.
- An activity linked to an archived record still gets its reminder: the Notifications page lists it and opening it lands on the archived record's page (the activity stays in the Activities list too, SF-109).
- An activity assigned to a deactivated user: no other user's Notifications page lists its reminder; when it is reassigned to an active user, that user's page lists the reminder as in US2 scenario 3.
- A private record handed over with a deactivated user's records (SF-97, SF-92): the activity keeps its assignee; that assignee's Notifications page lists the reminder only while they can see the record, and the new owner's page does not list it.
- Two reminders with the same reminder time are listed newest activity first, in the same order on every reload.
- The reminder appears on the next page load or client navigation after its reminder time (the sidebar count is asked again after each navigation, SF-108); a page left open past the reminder time still shows the old count until the user reloads or navigates.
- A subject such as `<b>Call</b> https://example.com` is shown in the reminder exactly as typed: no bold text and no link.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every planned activity MUST have one reminder for its assignee, due 15 minutes before its due moment when it has a time, and at 09:00 UK time on its due date when it has none (its reminder time).
- **FR-002**: A reminder MUST be shown and counted only from its reminder time, only to the activity's current assignee, only while the activity is planned and only while the assignee can see every record the activity is linked to (the activity visibility rule of SF-109). Nobody else, admins included, sees it.
- **FR-003**: A reminder MUST be listed on the Notifications page among mentions and assignments, newest first by its reminder time, as "<Type>: <subject> at <HH:MM>" (or "<Type>: <subject>" with no time), with the reminder time as its date and "Due <due date and time>"; it MUST count in the sidebar's "Notifications (n)" while unread. All text comes from the app's one message list.
- **FR-004**: Opening a reminder MUST mark it read and go to the activity's deal, else its person, else its organisation, else the Activities list; `[ MARK ALL AS READ ]` MUST mark every reminder already shown as read and leave reminders still to come unread.
- **FR-005**: Changing an activity's due date or time MUST replace its reminder with a new unread one at the new reminder time; changing its assignee MUST remove the old assignee's reminder and give the new assignee an unread one. When the new reminder time has passed but the due moment has not, the new reminder MUST show at once; when the due moment has passed, there MUST be none.
- **FR-006**: Ticking an activity done MUST hide its reminder; unticking it before its due moment MUST bring the reminder back as it was; deleting the activity, directly or with a linked record, MUST remove it. Changing only its type, subject, note, duration or links MUST keep the reminder's time and read state, showing the current type and subject.
- **FR-007**: An activity saved (scheduled, moved or reassigned) after its due moment MUST get no reminder; activities whose due moment was past when this feature goes live MUST get none.
- **FR-008**: A reminder MUST be sent to its assignee whoever scheduled the activity, themselves included, independently of any assignment notification about the same activity.
- **FR-009**: Reminders MUST NOT send any email or anything outside the app; reminder emails come from Google Calendar in the Calendar issue.
- **FR-010**: The fake data command MUST add, without duplicates when run again, read and unread reminders for the fake users (timed and untimed activities) and at least one planned activity whose reminder is still to come.

### Key Entities *(include if feature involves data)*

- **Reminder**: a notification to an activity's assignee that the activity is soon due: its activity, its reminder time (worked out from the due date and time), and whether the assignee has read it. At most one per activity, for the current assignee and the current due moment.
- **Activity** (SF-109): planned or done, due date and optional time, assignee, links to a deal, person and organisation; now also has its reminder.
- **Notification** (SF-102, SF-109): mentions and assignments, now also reminders, on one page and in one count.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated tests, a reminder is shown and counted on the first page load at or after its reminder time and never before it, for activities with and without a time, on both sides of midnight and of the clocks changing in UK time.
- **SC-002**: In automated tests, after an activity is moved, reassigned, ticked done, unticked or deleted, the old and new assignees' Notifications pages and counts match the activity as it is now, with no stale reminder.
- **SC-003**: In automated tests, a reminder about an activity linked to a private deal or person is never shown or counted for anyone the privacy rules hide it from, and no user ever sees another user's reminder.
- **SC-004**: The Notifications page and the sidebar count stay under 1 second for a user with 500 planned activities and 200 notifications.
- **SC-005**: A user can go from a reminder to the activity's record in one click.

## Assumptions

- Reminder lead times: 15 minutes before a timed activity, 09:00 UK time on the due date for an activity with no time (decided by the factory, to confirm). The Calendar issue should give the synced event's email reminder the same lead time.
- Reminders are in-app only here (user request; `docs/DECISIONS.md`): the Notifications page and the sidebar count, like assignments. The CRM sends no reminder email itself.
- A reminder appears when the user next loads or navigates a page after its reminder time; no live push to an open page, and no setting to turn reminders off or change the lead time in this issue.
- One reminder per activity; there is no snooze, and no second notice when an activity becomes overdue (the Activities list already shows Overdue in red).
- The Notifications page keeps its current layout, paging and read/unread look (SF-102, SF-109); a reminder is one more kind of line.
- No browser tests (`docs/DECISIONS.md`): unit and integration tests, and the AI review checks the screens.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
