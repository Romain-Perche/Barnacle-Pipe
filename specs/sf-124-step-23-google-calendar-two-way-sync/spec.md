# Feature Specification: Google Calendar: two-way sync

**Feature Branch**: `factory/sf-124-step-23-google-calendar-two-way-sync`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "Step 23 - Google Calendar: two-way sync. Activities sync both ways with each user's Google Calendar (`docs/PRODUCT.md` section 5, the Calendar and reminder lines in `docs/DECISIONS.md`), through the Google connection each user already makes for Gmail: connecting also asks for Calendar access, and users connected before are asked to reconnect once. From the CRM to Google: each activity appears in its assignee's primary Google Calendar, at its date and time with its duration (an activity without a time is an all-day event), titled with its type and subject, with its note and a link to it in the CRM. Editing, rescheduling, marking done, reassigning (the event moves to the new assignee's calendar) or deleting the activity updates the event. The CRM never adds guests or sends invitations. Each event carries an email reminder and a pop-up from Google at the same time as the CRM's in-app reminder (15 minutes before an activity with a time, 9:00 UK time on the day for one without); the CRM sends no email itself. From Google to the CRM: changing the time, date or title of a synced event in Google changes the activity. A new event with a person in the CRM as a guest (matched by any of their email addresses) becomes a meeting assigned to the user, linked to that person and their organisation; later changes to it come back too. Other events never come in. Changes arrive through Google's change notifications, plus a check every 15 minutes for anything missed, as for Gmail. Not in this issue: inviting contacts from the CRM, other calendars than the primary one. Google Calendar is faked in tests."

## Clarifications

### Session 2026-11-25

- Q: Does this issue also build the in-app reminder, or only Google's email and pop-up reminders? → A: Only Google's reminders: the in-app reminder is built by SF-123 (Step 17 - Activity reminders in the app); the Google reminders here fire at the same times as SF-123's (B).
- Q: When a synced event is deleted in Google Calendar, what happens to the activity in the CRM? → A: The activity stays in the CRM unchanged and stops syncing: it is no longer in any calendar and is never put back (B).
- Q: Which design? → A: Design: A, one Gmail card on Settings with one added "Calendar" line and the Calendar reconnect message in it; nothing changes on activity screens (see `design-options.html`).

### Plan 2026-11-25

- Q: Which Calendar permission does the CRM ask Google for? → A: `calendar.events.owned` ("See, create, change, and delete events on Google calendars you own"), the narrowest permission that lets the CRM read and change events of the user's primary calendar; not `calendar.events` (every calendar the user can reach) nor `calendar` (sharing and calendar settings) (decided by the factory, to confirm)
- Q: Google allows a reminder only 0 to 40,320 minutes before an event starts, and an all-day event starts at midnight: "9:00 UK time on the day" cannot be set on an all-day event. What does the event of an activity with no time get? → A: an email reminder and a pop-up at the start of its day (0 minutes before: midnight in the user's Google Calendar time zone), the closest time Google allows; the CRM's in-app reminder stays at 9:00 (SF-123) (decided by the factory, to confirm)
- Q: Who else sees the events the CRM puts in a user's calendar (teammates who can see that calendar, people it is shared with)? → A: every event the CRM makes is marked private in Google: people who can see the calendar see only "busy" at that time, never the subject or the note (activities on private people stay private); a task with no time is marked "free", so it never blocks the day (decided by the factory, to confirm)
- Q: When a meeting that came in from Google is deleted in the CRM, is the Google event deleted too (which, when the user organised it, cancels it for its guests, the CRM contact included, without telling them)? → A: no: deleting the activity ends its sync and leaves the Google event as it is; this replaces "deleted" in US4 scenario 3. The same goes when such a meeting is reassigned to a teammate or hidden from the user: its event stays in the user's calendar, unsynced, and no copy is made in anyone else's (decided by the factory, to confirm)
- Q: What does the CRM change on a meeting that came in from Google, whose title and guests are shared with the people invited? → A: only its title (the subject, with no "Meeting · " and no "✓ ") and its start and end, never its description, guests, reminders or privacy; ticking or unticking it changes nothing in Google. When Google refuses a change because the user did not organise the event, the CRM keeps its own value and the event keeps Google's until the next change in Google comes back (decided by the factory, to confirm)
- Q: When the assignee can no longer see a synced activity (a linked person or deal made private by its owner), what happens to the event in their calendar? → A: the event is removed; if they can see the activity again while it is planned and due today or later, it is put back (FR-013: the calendar never shows an activity its owner can't see) (decided by the factory, to confirm)
- Q: What subject does a meeting from Google get when its event has no title? → A: "(No title)", as Google shows it (decided by the factory, to confirm)
- Q: A CRM guest's organisation is archived: is the new meeting linked to it? → A: no, only to the person (an activity on an archived record could not be changed in the CRM) (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect Google with Calendar access (Priority: P1)

A team member opens Settings. The Google card (the SF-118 Gmail card) now asks for Calendar access as well as the two Gmail permissions when they press `[ CONNECT GMAIL ]`. A user who connected before this issue sees that their connection needs Calendar access and reconnects once; their Gmail keeps being copied while they have not.

**Why this priority**: Nothing syncs with a calendar until the CRM may use it; the reconnect is the only step every existing user must take.

**Independent Test**: With the fake Google, connect a fake user and confirm Settings shows Calendar as connected; load a connection made with the Gmail permissions only and confirm Settings asks for a reconnect and the sidebar "Settings" link shows the orange "!", while Gmail copying still works; reconnect and confirm both go away.

**Acceptance Scenarios**:

1. **Given** a user with no Google connection, **When** they press `[ CONNECT GMAIL ]`, **Then** Google asks for the two Gmail permissions and for access to their calendar's events, and after they agree the card headed "Gmail · connected" shows, after the SF-118 lines, the line "Calendar: Syncing your activities with your Google Calendar".
2. **Given** they agree but untick the Calendar permission (or a Gmail one), **When** they come back, **Then** nothing is stored and Settings shows "Google needs all the permissions asked for. Try again and tick every box." (the SF-118 message, now for all permissions).
3. **Given** a user who connected Gmail before this issue (no Calendar permission), **When** they load any signed-in page, **Then** the "Settings" link shows the orange "!", and the card, still headed "Gmail · connected", shows "Reconnect Google to sync your activities with your calendar.", the line "Calendar: Not synced: Calendar access missing", `[ RECONNECT GMAIL ]`, `[ SEND ME A TEST EMAIL ]` and `[ DISCONNECT ]`; a new message from a CRM person still raises "Conversations copied".
4. **Given** that user reconnects with the same account and agrees to everything, **When** they come back, **Then** Settings shows "Gmail reconnected." and the line "Calendar: Syncing your activities with your Google Calendar", the "!" is gone, and their planned activities due today or later are in their fake calendar (US2).
5. **Given** a user who never connects Google, **When** activities are assigned to them, **Then** the activities are saved and shown as before and no fake calendar has an event for them.

---

### User Story 2 - My activities appear in my Google Calendar (Priority: P1)

Every planned activity assigned to a connected user appears in their primary Google Calendar: at its date and time for its duration, or as an all-day event when it has no time, titled with its type and subject, with its note and a link back to it in the CRM, and with an email reminder and a pop-up from Google at the same times as the in-app reminder of SF-123. Whatever is done to the activity in the CRM is reflected in the event.

**Why this priority**: This is the main promise ("activities sync both ways with each user's Google Calendar", PRODUCT §5) and the only way users get an email reminder (DECISIONS 2026-11-24).

**Independent Test**: With the fake Google Calendar, connect Ada Fake, schedule a call tomorrow 10:00 for 30 minutes and a task with no time; confirm two events in her fake calendar with the right times, titles, description, link, reminders and no guests; then edit, reschedule, tick, untick, reassign to Bob Fake (connected) and delete, and confirm the fake calendars after each step.

**Acceptance Scenarios**:

1. **Given** Ada is connected, **When** she schedules "Call Ada about the proposal", a Call due 2 Dec 2026 at 10:00 for 30 minutes, assigned to herself, with the note "Bring the price list", **Then** her primary calendar has one event "Call · Call Ada about the proposal" on 2 Dec 2026 from 10:00 to 10:30 UK time, whose description holds the note and a link that opens the activity in the CRM, with no guests, an email reminder and a pop-up 15 minutes before, and no invitation sent to anyone.
2. **Given** an activity with a time but no duration, **When** it is synced, **Then** the event lasts 30 minutes [decided by the factory, to confirm].
3. **Given** a task "Send contract" due 3 Dec 2026 with no time, **When** it is synced, **Then** the event is an all-day event on 3 Dec 2026 titled "Task · Send contract", with an email reminder and a pop-up at 9:00 UK time on 3 Dec.
4. **Given** a synced activity, **When** someone who can see it changes its subject, type, note, date, time or duration in the CRM, **Then** the same event is changed to match (title, description, times, all-day or not, reminders); no second event is made.
5. **Given** a synced activity, **When** it is ticked done, **Then** the event stays in the calendar with its title starting "✓ " and no reminders; when it is unticked, the title and reminders are back [decided by the factory, to confirm].
6. **Given** a synced activity assigned to Ada, **When** it is reassigned to Bob, **Then** the event is removed from Ada's calendar and one appears in Bob's if Bob is connected; if Bob is not, no calendar has it.
7. **Given** a synced activity, **When** it is deleted in the CRM (by a user, or with the deal, person or organisation it was linked to), **Then** its event is removed from the calendar.
8. **Given** Google cannot be reached when an activity is saved, **When** the user saves, **Then** the activity is saved and the page shows no error; once Google is reachable again and the 15-minute check runs, the fake calendar shows the event with the activity's values.

---

### User Story 3 - Changes made in Google come back to the CRM (Priority: P1)

A user drags a synced event to another day or time in Google Calendar, or renames it: the activity in the CRM follows.

**Why this priority**: Without it the sync is one-way and the CRM shows the wrong time as soon as someone moves a meeting in their calendar.

**Independent Test**: With the fake Google Calendar, change a synced event's start, end and title in Ada's fake calendar, deliver the change notice for one change and drop it for another, run the 15-minute check, and confirm the activities show the new values once each.

**Acceptance Scenarios**:

1. **Given** the synced call of US2 scenario 1, **When** Ada moves the event in Google to 4 Dec 2026 11:00–12:00 and the notice arrives, **Then** the activity is due 4 Dec 2026 at 11:00 with a duration of 1 hour, and shows so on its records, the Activities list and the deal card.
2. **Given** a synced activity with a time, **When** the event is made all-day in Google on 5 Dec 2026, **Then** the activity is due 5 Dec 2026 with no time and no duration; the reverse (all-day to 14:00–14:45) gives time 14:00 and duration 45 minutes.
3. **Given** a synced activity, **When** its event is renamed in Google to "Call · Call Ada about the new price", **Then** the activity's subject becomes "Call Ada about the new price" and its type does not change; a title without the "<Type> · " start becomes the whole subject.
4. **Given** a change notice from Google is lost, **When** the next 15-minute check runs, **Then** the activity shows the new date and time; delivering the same notice afterwards changes nothing more.
5. **Given** a change from Google moves an activity, **When** the change is applied, **Then** the activity's note, links, assignee and done state are unchanged; a change to only the event's description, place or guests in Google leaves the activity exactly as it was.
6. **Given** a synced event is deleted in Google, **When** the change arrives, **Then** the activity is still shown in the CRM with the same subject, date, time, note and links, and it is no longer synced: editing, ticking or reassigning it afterwards puts no event in any fake calendar, and changes made in Google no longer reach it (clarified 2026-11-25).

---

### User Story 4 - Meetings with CRM people come in from Google (Priority: P2)

When a user has an event in their Google Calendar with a guest who is a person in the CRM (any of that person's email addresses), the event becomes a meeting in the CRM, assigned to the user and linked to that person and their organisation, so meetings booked outside the CRM still show on the contact.

**Why this priority**: It keeps the CRM complete without double entry, but the CRM's own activities (US2, US3) come first.

**Independent Test**: With the fake Google Calendar, put three new events in Ada's fake calendar: (a) with guest "ana.k@example.test", the second address of CRM person Ana Fake of Fake Ltd, (b) with only teammates as guests, (c) with no guests; deliver the notices and confirm exactly one meeting linked to Ana Fake and Fake Ltd, assigned to Ada; move (a) in Google and confirm the meeting follows.

**Acceptance Scenarios**:

1. **Given** Ada is connected and Ana Fake (works at Fake Ltd) has the addresses "ana@example.test" and "ana.k@example.test", **When** an event "Intro with Ana" on 8 Dec 2026 15:00–15:45 with the guest "ANA.K@example.test" is created in Ada's primary calendar (by Ada or by anyone inviting her), **Then** the CRM has a planned Meeting "Intro with Ana" due 8 Dec 2026 at 15:00 for 45 minutes, assigned to Ada, linked to Ana Fake and Fake Ltd, with no note, and it shows in Ana's and Fake Ltd's "// NEXT ACTIVITIES" and in Ada's Activities list.
2. **Given** an event whose guests are no CRM people (teammates only, unknown addresses) or that has no guests, **When** it is created or changed, **Then** Ada's Activities list (Planned, assignee Everyone) shows no new activity, then or after the next check.
3. **Given** a meeting that came in from Google, **When** its event's date, time or title changes in Google, **Then** the meeting changes as in US3; **when** it is edited, ticked or deleted in the CRM, **Then** the event in Ada's calendar is updated as in US2, keeping the event's own title without a "Meeting · " start and never touching its guests.
4. **Given** an event with several CRM people as guests, **When** it comes in, **Then** the meeting is linked to the first of them in the event's guest list that Ada can see, and that person's organisation; the Activities list shows it once.
5. **Given** an event whose only CRM guest is a private person Ada cannot see, or an archived person, **When** it is created, **Then** Ada's Activities list shows no new activity.
6. **Given** an event that existed before Ada connected, or that started before today, **When** she connects, **Then** her Activities list shows no activity for it; only events created or changed after connecting and not yet over come in [decided by the factory, to confirm].
7. **Given** an event created in Google by the CRM itself (US2), **When** its notice arrives, **Then** the Activities list still shows that activity once.
8. **Given** a guest who is a CRM person is added to an existing event in Google, **When** the change arrives, **Then** the event comes in from then on as in scenario 1.

---

### Edge Cases

In these cases the tester reads the result on the fake calendar page (FR-015), the activity's record pages, the Activities list and Settings.

- **Disconnect or deactivation**: after Ada disconnects Google (or an admin deactivates her), her fake calendar still has the events already put there, unchanged; rescheduling one of those activities in the CRM leaves its event unchanged; the activities still show in the CRM [decided by the factory, to confirm]. When she connects again, each of her planned activities due today or later has exactly one event in her fake calendar.
- **Google no longer accepts the key**: the card shows the SF-118 state "Gmail · needs reconnecting"; Ada can still schedule and edit activities with no error shown; after she reconnects and the next check runs, her fake calendar shows the values of activities changed meanwhile, and an event moved in Google meanwhile shows its new time in the CRM.
- **Both sides changed**: Ada changes an activity's time to 11:00 in the CRM at 10:00, and the event's time to 14:00 in Google at 10:05, before any sync runs; after the next check, both the activity and the event show 14:00.
- **Past and done activities on connect**: when Ada connects, her fake calendar has events for her planned activities due today or later only; a planned activity due yesterday and a done activity due tomorrow have none.
- **Activity on the clock change**: a call due 29 Mar 2026 at 00:30 for 2 hours shows in the fake calendar from 00:30 to 03:30 UK time (02:30 British Summer Time after the change, 3 hours of clock time apart); an event moved in Google to 10:00 New York time on 4 Dec 2026 shows in the CRM as due 15:00.
- **Times Google allows but the CRM does not**: an event moved in Google to 10:07–10:52 shows in the CRM as due 10:07 for 45 minutes; one moved to 10:00–10:07 shows 5 minutes; one lasting 30 hours shows 24 hours; an all-day event over 4–6 Dec shows as due 4 Dec with no time; in each case the event in the fake calendar keeps the times set in Google.
- **Title limits**: an event renamed in Google to an empty title leaves the activity's subject unchanged; one renamed to 250 characters gives a subject of the first 200.
- **Recurring events**: a new weekly event in Google with a CRM person as a guest adds nothing to the Activities list.
- **Archived records**: when the person an activity is linked to is archived, moving its event in Google to 4 Dec still shows the activity as due 4 Dec on the person's page; `[ EDIT ]` there stays refused with "Restore this record before changing its activities." (SF-109).
- **Private records**: an activity on a private person, assigned to the person's owner, has its event in the owner's fake calendar only, with its subject and note as written.
- **Deleted linked record**: when the only record an activity is linked to is deleted, the activity is gone from the Activities list and its event is gone from the fake calendar.
- **Event declined**: a new event that Ada was invited to and declined, with a CRM person as a guest, adds nothing to the Activities list; when Ada declines a meeting that already came in, the meeting stays in the CRM unchanged and is no longer synced, as in US3 scenario 6.
- **Notices not from Google**: a change notice the CRM cannot confirm came from Google, or for a user with no working connection, is refused; no activity changes and the fake calendar is unchanged.
- **Calendar not set up**: when the app's Calendar settings are missing, `[ CONNECT GMAIL ]` asks only for the Gmail permissions as in SF-118, the card shows no "Calendar" line and no "!" for Calendar, and scheduling an activity puts nothing in any fake calendar; the rest of the app works as before.

## Requirements *(mandatory)*

### Functional Requirements

**Connecting**

- **FR-001**: Connecting Google from Settings (SF-118) MUST also ask for permission to read and change the events of the user's calendars, through the same Internal Google app and the same one connection per user; the connection MUST be refused with nothing stored when any permission is left out.
- **FR-002**: A connection that does not have the Calendar permission MUST be shown as needing a reconnect (the card message of US1 scenario 3 and the orange "!" on the "Settings" link) while Gmail copying carries on; reconnecting with all permissions MUST clear it.
- **FR-003**: Only the user sees and changes their own connection; disconnecting MUST stop calendar sync as well as Gmail (SF-118 FR-005).

**From the CRM to Google**

- **FR-004**: Every planned activity, due today or later at the time it is first synced, assigned to a user with a working Calendar connection MUST have exactly one event in that user's primary calendar, created at most 15 minutes after the activity is saved (immediately when Google answers).
- **FR-005**: The event MUST have: the activity's date and UK time and its duration (30 minutes when it has a time but no duration), or be an all-day event on its date when it has no time; the title "<Type> · <subject>" (except meetings that came from Google, which keep the event's title); a description holding the note and a link that opens the activity in the CRM; no guests; one email reminder and one pop-up, 15 minutes before for an activity with a time and at 9:00 UK time on the day for one without. The CRM MUST never send an invitation or any email itself.
- **FR-006**: Editing, rescheduling, ticking, unticking or deleting an activity, and deleting a record that deletes it, MUST update or remove its event (done: "✓ " title start, no reminders); reassigning MUST remove the event from the old assignee's calendar and create it in the new assignee's calendar when they are connected.
- **FR-007**: Saving an activity MUST never fail or wait because Google is slow or unreachable; any change not yet in Google MUST be sent by the next 15-minute check.

**From Google to the CRM**

- **FR-008**: A change to the date, time, duration or title of a synced event in the user's primary calendar MUST change the linked activity (date, time, duration, subject per US3); no other field of the event MUST change the activity, and a change from Google MUST never change type, note, links, assignee or done state.
- **FR-009**: An event in the user's primary calendar, created or changed after they connected and not yet over, not recurring, not declined by the user, not made by the CRM, with at least one guest whose address (case and surrounding spaces ignored) is an address of a non-archived CRM person the user can see, MUST become exactly one planned Meeting assigned to the user and linked to the first such person and their organisation; later changes to it MUST come back as in FR-008. No other event MUST ever come in.
- **FR-010**: Google MUST tell the CRM about calendar changes through change notifications, renewed before they expire; the CRM MUST also check every working connection every 15 minutes for changes since its last successful check, in the same scheduled job as Gmail, and apply each change once however many notices report it.
- **FR-011**: When the CRM and Google both changed the same field before syncing, the later change MUST win on both sides.

**Reminders**

- **FR-012**: The only reminders added here are the email and pop-up reminders on the Google event (FR-005), at the same times as the in-app reminder of SF-123; this issue adds no in-app reminder and sends no email (clarified 2026-11-25).

**Access, messages, settings, fakes**

- **FR-013**: Every page and action MUST require a signed-in, active user; change notices and scheduled checks MUST be refused unless they carry Google's proof or the app's secret, and never show data in their answer. Calendar sync MUST never make an activity visible to someone who could not see it (SF-109 FR-012).
- **FR-014**: Every message shown MUST be one of the app's fixed messages; text from the page address or Google's answers MUST never be shown; event titles become subjects as plain text only.
- **FR-015**: Google Calendar, its consent screen permission and its change notifications MUST be reached through settings and have fakes checked against Google's published description of the Calendar service, so the feature is built and tested with no real account; a fake calendar page (development and tests only, like the fake mailbox) MUST let a tester see each user's fake events (title, start and end or all-day date, description, guests, reminders, whether the user declined), create, change, decline or delete one with or without delivering its notice, make the fake Google unreachable and reachable again, and run the 15-minute check.
- **FR-016**: The fake data command MUST give the fake user connected to Gmail a Calendar permission and fake events for some of their activities, plus one event with a fake CRM person as a guest, without duplicates when run again.
- **FR-017**: Settings MUST follow design A in `design-options.html`: the SF-118 Gmail card (design B) gains one "Calendar" line ("Syncing your activities with your Google Calendar" or "Not synced: Calendar access missing") and, when Calendar access is missing, the message "Reconnect Google to sync your activities with your calendar." with `[ RECONNECT GMAIL ]`; nothing changes on activity screens; everything follows `docs/DESIGN.md`.
- **FR-018**: An event deleted in Google, or a meeting from Google the user declines, MUST leave its activity unchanged in the CRM and end its sync for good: the activity is never put in a calendar again and later changes in Google never reach it (clarified 2026-11-25).

### Key Entities

- **Google connection** (SF-118 Gmail connection): now also records whether it holds the Calendar permission, how far calendar sync has got in Google's change history, the last successful calendar check and when calendar change notices expire.
- **Calendar event link**: ties one activity (an activity whose event was deleted in Google keeps a mark that it is never synced again) to one event in one user's primary calendar: the event's identifier, whether the event came from Google or was made by the CRM, and what was last sent or received, so each change is applied once and the later change wins.
- **Activity** (SF-109): unchanged fields; may now be created or changed by Google Calendar on behalf of its assignee.
- **Person and person email address** (SF-90): the addresses that decide which events come in.
- **User** (existing): owns the connection and the calendar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An activity scheduled, changed or deleted in the CRM shows in its assignee's Google Calendar within 1 minute when Google is reachable, and within 15 minutes otherwise.
- **SC-002**: An event moved or renamed in Google, or a new event with a CRM person as a guest, shows in the CRM within 2 minutes when notices work, and within 15 minutes when a notice is lost.
- **SC-003**: In automated tests, 100% of planned activities of connected users have exactly one event, in their assignee's calendar only, and 0 events without a visible CRM person as a guest come into the CRM.
- **SC-004**: In automated tests, no event the CRM makes or changes has a guest, and the CRM sends no email.
- **SC-005**: In automated tests, times are right on both sides for activities with and without a time, on either side of midnight and of the clocks changing, in UK time.
- **SC-006**: Every user connected before this issue can restore full sync with one reconnect, taking under 1 minute.

## Assumptions

- The connection is the SF-118 one (same button, card, key, reconnect state and "!"); the Calendar permission is the one that lets the CRM read and change events (not create calendars or share them). The Internal Google app gets it before go-live, like the Gmail ones; no Google review is needed.
- The in-app reminder before an activity is due is SF-123 (Step 17); this issue only matches its times on the Google event.
- "Primary calendar" is the user's own default Google calendar; other calendars are out of scope (user request), as is inviting contacts from the CRM.
- The link in the event opens the activity's box in the CRM (the Activities list with the activity open); it works only for users who can see the activity.
- Google may not allow a reminder after the start of an all-day event ("9:00 on the day"); if its published description confirms this in the plan, the closest allowed setting is used and the choice recorded in `docs/DECISIONS.md` [to verify in the plan].
- The 15-minute check is the existing Gmail scheduled job (SF-118), extended; no new scheduled job.
- Values marked "[decided by the factory, to confirm]" are informed guesses to be confirmed at review.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
