# Feature Specification: Activities

**Feature Branch**: `factory/sf-109-step-6-activities`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Step 6 - Activities. Calls, meetings and tasks on deals, people and organisations, the Activities list showing what's due and overdue, scheduling a follow-up from a deal or contact, and the \"no next activity\" warning on deal cards (`docs/PRODUCT.md` sections 1 and 5). Activities show on the timeline. Google Calendar sync and reminders come in a later issue."

## Clarifications

### Session 2026-11-23

- Q: Which design? → A: Design: A, the Activities list is a table like the People list (quick filters Overdue / Today / This week / Planned / Done, then assignee and type), overdue rows with a red left edge and a red OVERDUE mark; the activity form and "Schedule a follow-up?" open in a box over the page, like the lost reason box; board cards end with a line "⚠ No next activity" in amber or "Next: <date> · <type>" (see `design-options.html`).
- Q: Should a done call or meeting update the linked person's "Last contacted" date? → A: Yes: a done call or meeting sets it to the activity's due date when that is later; a task never does.
- Q: Should the app notify a teammate when someone else assigns them an activity? → A: Yes: an in-app notification on the Notifications page, like a mention.
- Q: When a deal or person becomes private after an activity was assigned to someone who can no longer see it, what happens to the activity? → A: It stays assigned to them but is hidden from them everywhere (list, card, notification) until they can see the record again; nothing is reassigned automatically (decided by the factory, to confirm)
- Q: What does the "This week" quick filter show? → A: Planned activities due Monday to Sunday of the current UK week, overdue ones from earlier in the week included; done ones only under "Done" (decided by the factory, to confirm)
- Q: Can an activity be linked to an archived record, or to a won or lost deal, when it is scheduled or edited? → A: No archived record is offered or accepted ("Restore this record before changing its activities."); only open deals are offered, and a won or lost deal already linked stays (decided by the factory, to confirm)
- Q: After ticking an activity on the Activities list, is "Schedule a follow-up?" offered? → A: No, only on record pages and the deal drawer, as US2 says; the list stays a quick ticking screen (decided by the factory, to confirm)
- Q: What date does a done call or meeting with no time give "Last contacted"? → A: When a call or meeting is marked done, "Last contacted" becomes its due date, or the moment it was marked done if the due date is later, so it never shows a date in the future (alexis@barnacle.ai)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Schedule an activity on a deal, person or organisation (Priority: P1)

A team member opens a deal, a person or an organisation and presses `[ SCHEDULE ACTIVITY ]`. They pick the type (Call, Meeting or Task), write a subject ("Call Ada about the proposal"), pick a due date and optionally a time and a duration, choose who it is assigned to (themselves by default) and optionally add a note. The activity is linked to the record it was scheduled from (and, from a deal, to the deal's main person and organisation as well) and shows in the record's "// NEXT ACTIVITIES" above the timeline.

**Why this priority**: Activities are a "must have" (PRODUCT §5) and the base of every other story here: the list, the follow-ups, the card warning and the timeline entries all need activities to exist.

**Independent Test**: With the fake data loaded, schedule a call for tomorrow at 10:00 on a deal, a meeting on a person and a task with no time on an organisation; confirm each shows in its record's "// NEXT ACTIVITIES" with type, subject, due date and time, and assignee; edit one, delete another and confirm the result after a reload.

**Acceptance Scenarios**:

1. **Given** a deal, person or organisation the user can see and that is not archived, **When** they press `[ SCHEDULE ACTIVITY ]` (the form opens in a box over the page), fill in type "Call", subject "Call Ada about the proposal", due date tomorrow, time 10:00 and press `[ SAVE ]`, **Then** the activity is shown in the record's "// NEXT ACTIVITIES" as "CALL · Call Ada about the proposal · <date> 10:00 · <assignee name>", and the form closes.
2. **Given** the activity form is opened from a deal with main person "Ada Example" and organisation "Example Ltd Fake", **When** it is shown, **Then** the deal, Ada Example and Example Ltd Fake are already filled in as linked records; the user can remove the person or organisation, or pick another person or organisation they can see, before saving.
3. **Given** the activity form is opened from a person who belongs to an organisation, **When** it is shown, **Then** the person and their organisation are filled in; a deal can be picked (any open deal the user can see).
4. **Given** the subject is empty or only spaces, or no due date is given, **When** the user presses `[ SAVE ]`, **Then** "Give the activity a subject." or "Pick a due date." is shown and nothing is saved; a subject longer than 200 characters or a note longer than 10,000 characters is refused with "Keep the subject under 200 characters." or "Keep the note under 10,000 characters.".
5. **Given** an activity the user can see, **When** they press `[ EDIT ]`, change any field and press `[ SAVE ]`, **Then** the new values are shown everywhere the activity appears; `[ CANCEL ]` keeps the old ones. If someone else changed or deleted it since the page was loaded, "Someone else changed this activity while you were editing. Reload to see their changes." (or "This activity doesn't exist any more.") is shown and nothing changes.
6. **Given** an activity the user can see, **When** they press `[ DELETE ]` and confirm "Delete this activity? This can't be undone.", **Then** it disappears from every record, list and timeline and "Activity deleted." is shown.
7. **Given** an activity with a time and a duration of 30 minutes, **When** it is shown, **Then** it reads "<date> 10:00–10:30"; an activity with no time reads "<date>" only and counts as due all that day.

---

### User Story 2 - Mark an activity done and schedule the follow-up (Priority: P1)

When a call, meeting or task is done, the team member ticks it. It leaves the record's "// NEXT ACTIVITIES" and is written on the timeline. Straight after, the app offers to schedule the follow-up on the same records, so a deal or contact is never left without a next step.

**Why this priority**: "Schedule a follow-up straight from a deal or contact" is asked for by name (PRODUCT §5); ticking things off is how the team uses activities every day.

**Independent Test**: On a deal with one planned call, tick the call; confirm it moves to the timeline tagged ACTIVITY with "Done", and the "Schedule a follow-up?" form opens with the deal, its person and organisation filled in; save a follow-up task for next Monday and confirm it is the deal's next activity.

**Acceptance Scenarios**:

1. **Given** a planned activity the user can see, **When** they tick its box (on a record page, the deal drawer or the Activities list), **Then** it is marked done with who did it and when, it leaves "// NEXT ACTIVITIES", and it shows on the timeline of each linked record tagged ACTIVITY, with its type, subject, note, "Done by <name>" and the time it was marked done.
2. **Given** the user just marked an activity done on a record page or the deal drawer, **When** the page updates, **Then** a "Schedule a follow-up?" box opens over the page with the same linked records and assignee filled in and no date; `[ SAVE ]` schedules it as in US1, `[ NOT NOW ]` closes it.
3. **Given** a done activity, **When** the user unticks it, **Then** it is planned again: it leaves the timeline and is back in "// NEXT ACTIVITIES" with its original due date.
4. **Given** a call or meeting linked to a person, **When** it is marked done, **Then** the person's "Last contacted" becomes the earlier of its due date and time (the start of that UK day when it has no time) and the moment it was marked done, if that is later than the current value: a call due 20 Nov 2026 ticked on 23 Nov shows 20 Nov; a call due 30 Nov ticked on 23 Nov shows 23 Nov, never a future date. Tasks never change it; unticking does not move "Last contacted" back.

---

### User Story 3 - The Activities list: what's due and overdue (Priority: P1)

A team member opens "Activities" from the sidebar and sees their planned activities, overdue first and then by due date, with quick filters for Overdue, Today, This week, Planned and Done, and filters for assignee and type. Each row shows the linked deal, person and organisation with links to them, and a box to tick it done.

**Why this priority**: The Activities list "showing what's due and overdue" is named in PRODUCT §5; it is the start-of-day screen for each team member.

**Independent Test**: With the fake data loaded, sign in as Ada Fake, open Activities and confirm only her planned activities are shown, overdue ones first in red with "Overdue"; switch to "Today", then to assignee "Everyone", then to type "Meeting", and confirm the rows and count each time; tick one done from the list.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they open Activities, **Then** the list shows the planned activities assigned to them that they can see, overdue ones first then by due date and time (activities with no time after the timed ones of the same day), 50 per page, with the count shown ("// 12 ACTIVITIES"); each row shows the done box, type, subject, due date and time, assignee, and the linked deal, person and organisation, each a link to its page.
2. **Given** a planned activity whose due date is before today, or whose due date is today and whose time (plus duration, if any) has passed, **When** it is shown anywhere, **Then** it shows the mark "Overdue" in red; an activity due today and not yet overdue shows the mark "Today".
3. **Given** the Activities list, **When** the user picks the quick filter Overdue, Today, This week (Monday to Sunday, UK time), Planned (all not done) or Done, **Then** only those activities are shown; Done is sorted by when they were marked done, newest first.
4. **Given** the Activities list, **When** the user picks an assignee (any user, active or deactivated, or "Everyone") and a type (Call, Meeting, Task or all), **Then** only matching activities are shown; the filters are kept in the page address so the view can be reloaded or shared.
5. **Given** no activity matches, **When** the list is shown, **Then** "No activities here." is shown with `[ SCHEDULE ACTIVITY ]`.
6. **Given** the Activities list, **When** the user presses `[ SCHEDULE ACTIVITY ]` there, **Then** the activity form opens with no linked record; an activity may be saved with no deal, person or organisation, or with any of them picked.

---

### User Story 4 - "No next activity" warning on deal cards (Priority: P2)

On the deals board, an open deal with no planned activity shows a "No next activity" warning on its card, so the team sees at a glance which deals have stalled. Deals with a next activity show its date instead, marked when it is overdue.

**Why this priority**: PRODUCT §1 asks for the warning on cards; it depends on activities existing (US1), and was left out of SF-93 until now.

**Independent Test**: On the board, find a deal with no activity and confirm "No next activity" on its card; schedule a task on it from the drawer and confirm the warning is replaced by the task's date; mark the task done and confirm the warning is back.

**Acceptance Scenarios**:

1. **Given** an open deal with no planned activity linked to it, **When** the board is shown, **Then** its card ends with the line "⚠ No next activity" in amber.
2. **Given** an open deal with one or more planned activities, **When** the board is shown, **Then** its card ends with the line "Next: <earliest due date> · <its type>" (for example "Next: 25 Nov · Call"), with the mark "Overdue" in red when that activity is overdue, and no "No next activity" line.
3. **Given** a deal on the board, **When** the user opens its drawer, **Then** the drawer shows its "// NEXT ACTIVITIES" with the done boxes and `[ SCHEDULE ACTIVITY ]`; scheduling or ticking one there updates the card when the drawer closes.
4. **Given** a planned activity linked to a deal that only users other than the viewer can see (for example one linked to a private person hidden from the viewer), **When** the board is shown to the viewer, **Then** the card counts only activities the viewer can see; with none, it shows "No next activity".

---

### User Story 5 - Private records keep their activities private (Priority: P1)

Activities follow the existing private rules: an activity linked to a private person or a private deal is seen only by the users who can see every record it is linked to, everywhere it could appear (record pages, timelines, the Activities list, the deal card, counts).

**Why this priority**: The team decision is that a private contact or deal is hidden from everyone but those allowed, admins included; activities often say who is being met and why.

**Independent Test**: As Ada Fake, make a deal private and schedule a call on it assigned to herself; as Bob Fake (an admin), open the Activities list with "Everyone", the deal's organisation and its main person, and confirm the call appears nowhere and changes no count.

**Acceptance Scenarios**:

1. **Given** an activity linked to a record hidden from a user, **When** that user opens the Activities list (any filter), a linked record they can see, or the board, **Then** the activity is not shown and not counted.
2. **Given** the activity form on a private record, **When** the user picks the assignee, **Then** only active users who can see every linked record are offered; an assignee sent directly who cannot see them is refused with "<name> can't see this record, so the activity can't be assigned to them." and nothing is saved.
3. **Given** a direct request to view, edit, tick or delete an activity the user cannot see, **When** it is sent, **Then** "This activity doesn't exist or you can't see it." is shown and nothing changes.
4. **Given** a private deal or person is handed over with a deactivated user's private records (SF-97, SF-92), **When** the new owner opens it, **Then** they see its activities; the activities keep their assignee.

---

### User Story 6 - Know when a teammate assigns you an activity (Priority: P2)

When a team member schedules an activity and assigns it to a teammate, or reassigns an existing one to them, the teammate is told in the app: the sidebar's "Notifications (n)" count goes up and the Notifications page lists it beside their mentions.

**Why this priority**: A task given to someone else must not be missed (clarified); activities are useful without it, so it comes after the list and the card warning.

**Independent Test**: As Ada Fake, schedule a call on a deal assigned to Bob Fake; sign in as Bob Fake and confirm the sidebar shows "Notifications (1)" and the page lists "Ada Fake assigned you a call: <subject>" with its due date; open it and confirm it lands on the deal page and the count goes back to 0.

**Acceptance Scenarios**:

1. **Given** Ada schedules an activity assigned to Bob, or edits one so that Bob becomes its assignee, **When** Bob loads any signed-in page, **Then** the sidebar shows "Notifications (<n+1>)" and the Notifications page lists, newest first among his mentions, "Ada Fake assigned you a <call|meeting|task>: <subject>" with the date it was assigned and "Due <due date and time>".
2. **Given** a user schedules or reassigns an activity to themselves, **When** it is saved, **Then** no notification is created.
3. **Given** an unread assignment notification, **When** Bob opens it, **Then** he lands on the page of the activity's deal (else its person, else its organisation; the Activities list when it has no link), and the notification shows as read and the count goes down by 1; `[ MARK ALL AS READ ]` marks it read too.
4. **Given** an activity assigned to Bob is reassigned to Cy or deleted, **When** Bob opens the Notifications page, **Then** the notification about it is gone and the count no longer includes it; Cy gets one as in scenario 1. Editing other fields, ticking or unticking it changes no notification.
5. **Given** an activity linked to a record that becomes hidden from Bob, **When** Bob opens the Notifications page, **Then** its notification is not shown or counted (as for mentions, SF-102).

---

### Edge Cases

- An archived deal, person or organisation still shows its activities and their entries on its timeline, but has no `[ SCHEDULE ACTIVITY ]`, no done boxes and no `[ EDIT ]`/`[ DELETE ]`; a direct request answers "Restore this record before changing its activities." Its planned activities stay in the Activities list, with the record marked "Archived", and can be ticked there only once the record is restored.
- An activity linked to several records (deal, person, organisation) appears once in each record's "// NEXT ACTIVITIES" or timeline, and once in the Activities list. On a person's or organisation's timeline that also shows their deals' entries (SF-102), a done activity linked both to the person and to the deal appears once.
- A deal that is won or lost keeps its activities; it is no longer on the board, so no warning applies. Reopening it puts it back with the warning rule.
- When a deal is deleted, its activities that are linked to nothing else are deleted; those also linked to a person or organisation stay on them without the deal. The same holds when a person or organisation is deleted. An activity linked to a person who was private when deleted is deleted with them.
- When a person is removed from a deal, or a deal's organisation is changed, activities already linked keep their links; linking is only changed by editing the activity.
- An activity assigned to a user who is later deactivated stays assigned to "<name> (deactivated)", is still shown and can be reassigned by anyone who can see it; deactivated users are never offered as new assignees.
- Due dates and times are UK time (Europe/London), including across the clocks changing: an activity due today at 00:30 UK time shows "Today" until 00:30 and "Overdue" after; one due 29 Mar 2026 at 01:30 (a time that does not exist that night) is refused with "Pick a time that exists in UK time."
- A due date in the past is allowed (logging a call that already happened); the activity can be ticked done straight away.
- A call or meeting due in the future and ticked done early gives "Last contacted" the moment it was ticked, not its due date.
- A duration is only allowed with a time; it is from 5 minutes to 24 hours, in steps of 5 minutes ("Pick a time before setting a duration.", "Pick a duration between 5 minutes and 24 hours.").
- Two users tick the same activity at the same moment: the timeline shows one ACTIVITY entry for it, "Done by <the first user's name>".
- The note on an activity is plain text, line breaks kept, never shown as a link or markup.
- A planned activity linked to nothing shows only in the Activities list.
- When `[ SHOW MORE ]` on a timeline adds entries from a day already shown, activity entries go under that day's heading like notes (SF-102).

## Requirements *(mandatory)*

### Functional Requirements

**Activities**

- **FR-001**: Signed-in users MUST be able to schedule, edit and delete activities. An activity has: type (Call, Meeting or Task — a fixed list), subject (required, up to 200 characters), due date (required), time (optional), duration (optional, only with a time), assignee (an active user; defaults to the user scheduling it), note (optional plain text up to 10,000 characters), and links to at most one deal, one person and one organisation (all optional).
- **FR-002**: `[ SCHEDULE ACTIVITY ]` MUST be offered on every deal page, deal drawer, person page and organisation page whose record is not archived, and on the Activities list; it MUST pre-fill the links as in US1 scenarios 2 and 3.
- **FR-003**: Each deal, person and organisation page, and the deal drawer, MUST show "// NEXT ACTIVITIES" above the timeline: the planned activities linked to the record, earliest due first, each with its done box, type, subject, due date and time, assignee and overdue/today mark.
- **FR-004**: Users MUST be able to mark an activity done and undo it; done records who and when. A done activity MUST appear on the timeline of each linked record (tagged ACTIVITY, at the time it was marked done) with its type, subject, note and "Done by <name>"; a planned activity MUST NOT appear on the timeline.
- **FR-005**: After marking an activity done from a record page or the deal drawer, the app MUST offer "Schedule a follow-up?" with the same links and assignee pre-filled.
- **FR-006**: Marking a call or meeting done MUST set the "Last contacted" of its linked person to the earlier of its due date (and time) and the moment it was marked done, when that is later than the current value; "Last contacted" MUST never be a future date.
- **FR-007**: Edits and deletes MUST be refused with the "changed since loaded" or "doesn't exist any more" message when the activity changed or was deleted since the page was loaded.

**Activities list**

- **FR-008**: The sidebar MUST have an "Activities" link to the Activities list, defined as in US3: planned activities assigned to the user by default, quick filters Overdue / Today / This week / Planned / Done, assignee and type filters kept in the page address, sorting overdue first then by due date and time, 50 per page with a count.
- **FR-009**: An activity MUST be "Overdue" when not done and its due date is before today, or it is due today with a time (plus duration) that has passed; "Today" when not done, due today and not overdue. Both MUST be shown wherever the activity appears.

**Deal cards**

- **FR-010**: Each open deal's card on the board MUST show "No next activity" as a warning when the viewer can see no planned activity linked to it; otherwise it MUST show the earliest planned activity's due date, marked when overdue. This replaces SF-93's rule of showing no warning.

**Access, privacy, archive, messages, look**

- **FR-011**: Every page and action MUST require a signed-in, active user; nothing here is admin-only. Any user who can see an activity can edit, tick, untick or delete it, whoever it is assigned to.
- **FR-012**: An activity MUST be visible only to users who can see every record it is linked to (private person rule SF-92, private deal rule SF-93), on every page, list, count, card and direct request; its assignee MUST be a user who can see every linked record.
- **FR-013**: Activities linked to an archived record MUST stay visible; scheduling, editing, ticking and deleting them MUST be refused until the record is restored.
- **FR-014**: When a deal, person or organisation is deleted, its link MUST be removed from its activities, and an activity left with no link that had one MUST be deleted; activities linked to a person who was private when deleted MUST be deleted.
- **FR-015**: Every message shown MUST be one of the app's fixed messages; text from the page address MUST never be shown; subject and note are shown as plain text only.
- **FR-016**: The Activities list, the activity form, "// NEXT ACTIVITIES" and the card line MUST follow design A in `design-options.html` (a table like the People list, the form and "Schedule a follow-up?" in a box over the page, a last line on each board card); the ACTIVITY timeline entry MUST follow the timeline's design B (SF-102), and everything `docs/DESIGN.md`.

**Notifications**

- **FR-018**: Scheduling an activity assigned to someone other than the user saving it, or changing its assignee to someone else, MUST give the new assignee one unread notification on the Notifications page ("<name> assigned you a <type>: <subject>", the date, "Due <due date and time>"), counted in the sidebar; the old assignee's notification about it MUST be removed on reassignment, and every notification about it when it is deleted. Opening it MUST go to the activity's deal, else person, else organisation, else the Activities list, and mark it read. It MUST follow the mention rules of SF-102 for read/unread, `[ MARK ALL AS READ ]` and hiding while the record is hidden.

**Fake data**

- **FR-017**: The fake data command MUST add, without duplicates when run again, read and unread assignment notifications and activities of each type for the fake users: overdue, due today, due later, with and without a time, done ones on timelines, at least one on a private deal and one on a private person, and at least one open deal with no planned activity.

### Key Entities

- **Activity**: a call, meeting or task: type, subject, due date, optional time and duration, assignee (user), note, done or planned (with who marked it done and when), who created it and when, and optional links to one deal, one person and one organisation.
- **Notification** (from SF-102): now also tells a user they were assigned an activity; disappears when they are no longer its assignee or it is deleted.
- **Timeline entry** (from SF-90/SF-102): a done activity is shown on the timelines of the records it is linked to, tagged ACTIVITY.
- **Deal, Person, Organisation, User** (existing): what activities are linked to and assigned to; a person's "Last contacted" is now filled by done calls and meetings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can schedule an activity from a deal, person or organisation page in under 30 seconds.
- **SC-002**: A user can mark an activity done and schedule its follow-up in under 30 seconds, without leaving the page.
- **SC-003**: The Activities list with 2,000 activities shows its first page, with any filter, in under 2 seconds; the board with 500 open deals shows every card's warning or next date in under 2 seconds.
- **SC-004**: In automated tests, every open deal card shows "No next activity" exactly when the viewer can see no planned activity linked to the deal.
- **SC-005**: In automated tests, an activity linked to a private deal or private person never appears or counts for anyone the privacy rules hide it from, on any page, list, card or by direct request.
- **SC-006**: In automated tests, "Overdue" and "Today" are correct for activities with and without a time on either side of midnight and of the clocks changing, in UK time.

## Assumptions

- Google Calendar sync and reminders (email and in-app) come in a later issue (user request); nothing here sends anything outside the app.
- The activity types are a fixed list of Call, Meeting and Task; admins cannot add types in this issue.
- An activity links to at most one deal, one person and one organisation (as in Pipedrive); meeting attendees beyond the linked person, and guests from outside the team, come with Google Calendar sync.
- The Activities list shows the user's own activities by default; anyone can switch to another user or "Everyone" (team data is shared, PRODUCT §7).
- Only done activities appear on the timeline (planned ones are in "// NEXT ACTIVITIES"); scheduling, editing or deleting an activity is not itself a timeline entry.
- Done calls and meetings fill a person's "Last contacted" (clarified; SF-90 left it to activities and email); tasks do not.
- The board shows the next activity's date or the warning; the deal list and person and organisation lists get no activity column in this issue.
- Being assigned an activity by someone else is notified in the app only (clarified); no email. Reminders before an activity is due come with the later issue.
- Pipedrive import of activities is part of the import issue, not this one.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
