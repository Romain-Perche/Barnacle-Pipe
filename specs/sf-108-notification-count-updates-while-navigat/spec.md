# Feature Specification: Notification count updates while navigating

**Feature Branch**: `factory/sf-108-notification-count-updates-while-navigat`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Notification count updates while navigating. The "Notifications (n)" count in the sidebar only updates on a full page reload. It should be up to date on every page the user opens inside the app, including after clicking a sidebar link ([SF-102](https://linear.app/alexis-noe/issue/SF-102/step-5-timeline-and-notes), SC-002)."

## Context

SF-102 added @mentions in notes and a "Notifications (n)" link in the sidebar showing the number of unread mentions. Its
success criterion SC-002 says: "A mentioned teammate sees the notification count on the next page they load, with no
manual refresh of anything else." Today the count is only worked out when the browser loads a page in full (typing an
address, reloading, signing in). Moving between pages inside the app (sidebar links, links in lists, the board, record
pages, back and forward) keeps the sidebar on screen and leaves its count as it was, so a teammate who was mentioned
meanwhile does not see the new count until they reload the page. This issue closes that gap; it adds no new
notification kinds and changes nothing about when a notification is read.

## Clarifications

### Session 2026-11-23

- Q: Must the count also change while the user stays on one page (live updates)? → A: No: the issue asks for the count on every page the user opens; it is worked out when a page opens, and live updates without navigation stay out of scope (decided by the factory from the issue text)
- Q: What does "shows Notifications (n)" mean on screen? → A: The sidebar's "Notifications" link shows the orange badge with n and its accessible name is "Notifications (n)"; with no unread notification there is no badge and the name is "Notifications" (as built in SF-102)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The count is right after clicking around the app (Priority: P1)

Bob Fake has the app open. Ada Fake writes a note on a deal mentioning "@Bob Fake". Without reloading, Bob clicks a
link in the sidebar (for example "Deals" or "People"); the page he lands on shows "Notifications (1)" in the sidebar.

**Why this priority**: This is the reported defect and the whole point of SF-102 SC-002: a mention is useless if the
teammate does not notice it until they happen to reload.

**Independent Test**: Sign in as Bob Fake with no unread notifications and open any signed-in page. In another browser
session, as Ada Fake, save a note mentioning Bob. In Bob's session, without reloading, click a sidebar link: the sidebar
shows "Notifications (1)".

**Acceptance Scenarios**:

1. **Given** Bob has a signed-in page open with no unread notifications, **When** a note mentioning Bob is saved by someone else and Bob then clicks any sidebar link, **Then** the page that opens shows "Notifications (1)" in the sidebar.
2. **Given** the same start, **When** Bob instead follows a link inside the page (a person in the people list, a deal on the board or in the deal list, an organisation, a linked record on a record page), **Then** the page that opens shows "Notifications (1)".
3. **Given** the same start, **When** Bob clicks the sidebar link of the page he is already on, **Then** the page shows "Notifications (1)".
4. **Given** Bob has 2 unread notifications shown, **When** the note with one of the mentions is deleted, or edited so it no longer mentions Bob, and Bob then opens another page in the app, **Then** the sidebar shows "Notifications (1)".
5. **Given** Bob has 1 unread notification, **When** the record of that notification stops being visible to Bob (made private by someone else, deleted) and Bob then opens another page in the app, **Then** the "Notifications" link shows no badge, as after a full reload.

---

### User Story 2 - The count is right after Bob's own changes (Priority: P2)

When Bob does something in the app that changes his own count (opens a notification, presses `[ MARK ALL AS READ ]`,
or saves a change that shows or hides a record he was mentioned on), the next page he sees shows the new count.

**Why this priority**: Opening a notification and marking all read already refresh the count today; this story makes
sure the fix keeps that, and covers Bob's other actions that change what he can see.

**Independent Test**: As Bob with 2 unread notifications, open one from the Notifications page: the record page shows
"Notifications (1)"; press `[ MARK ALL AS READ ]`: the Notifications page shows no count.

**Acceptance Scenarios**:

1. **Given** Bob has 2 unread notifications, **When** Bob opens one from the Notifications page, **Then** the record page he lands on shows "Notifications (1)".
2. **Given** Bob has unread notifications, **When** Bob presses `[ MARK ALL AS READ ]`, **Then** the page shows no count.
3. **Given** Bob has 1 unread notification shown and, in another session, Ada saves a note mentioning Bob, **When** Bob then saves a note of his own on any record (without reloading), **Then** the record page after the save shows "Notifications (2)".

---

### User Story 3 - The count is right after going back or forward (Priority: P3)

Bob uses the browser's back and forward buttons to move between pages of the app. The page he goes to shows the
current count, not the count from when he first saw it.

**Why this priority**: Back and forward are common, but less frequent than clicking links; the count being briefly old
here is less harmful than on a fresh click.

**Independent Test**: As Bob, open the people list, then a person. As Ada, mention Bob. As Bob, press the browser's
back button: the people list shows "Notifications (1)".

**Acceptance Scenarios**:

1. **Given** Bob visited page A and then page B with no unread notifications, **When** a note mentioning Bob is saved and Bob presses back to page A, **Then** page A shows "Notifications (1)".

---

### Edge Cases

- The count goes from a number to none (Bob marks all read in another tab, then clicks a sidebar link in this one): the "Notifications" link shows no badge; it never shows "0".
- Bob follows a link to a deal that was deleted after the link was shown: the deal's not-found page opens inside the sidebar layout, and the sidebar shows the current count (for example "Notifications (1)" after a new mention).
- Bob is signed out in another tab, then clicks a sidebar link in this one: the sign-in page opens and no sidebar or count is shown.
- Bob has 12 unread notifications and a 13th mention is saved: after a sidebar link the badge shows "13", the same as after a full reload.
- Bob clicks "People" and then quickly "Deals" right after a new mention: the Deals page opens with "Notifications (1)", not the count from before the mention.
- Bob opens a page inside the app and then reloads it in full: the badge shows the same number before and after the reload.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every signed-in page MUST show, in the sidebar, the user's unread notification count as it is at the moment the page is opened, however the page is reached: a full load, a sidebar link, a link inside a page, the result of a form, or the browser's back and forward buttons.
- **FR-002**: The count MUST follow the existing rules of SF-102: it counts only unread notifications of the signed-in user on records they can see at that moment; it shows nothing when there are none.
- **FR-003**: The count is worked out when a page opens; updating it while the user stays on one page without opening another (live updates) is out of scope.
- **FR-004**: Opening a page MUST NOT mark any notification read; notifications stay read only when opened from the Notifications page or with `[ MARK ALL AS READ ]` (SF-102).
- **FR-005**: The rest of the sidebar MUST behave as today: the current page stays highlighted, the admin links show only to admins, the user's name and `[ Sign out ]` stay in place.
- **FR-006**: Moving between pages MUST stay as responsive as it is today for the user: no full page reload is introduced for every link.
- **FR-007**: The behaviour MUST be covered by a browser test that saves a mention for a user who already has a page open and checks the count after a sidebar link, a link inside a page and a back navigation, with no full reload.

### Key Entities

- **Unread notification count**: the number of a user's unread mention notifications on records they can currently see (defined in SF-102); shown in the sidebar as "Notifications (n)".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested ways of moving between signed-in pages (sidebar link, link inside a page, form result, back, forward), the page opened shows the same count as a full reload at that moment.
- **SC-002**: A mentioned teammate sees the new count on the very next page they open inside the app, with no reload (SF-102 SC-002 met).
- **SC-003**: No page that opened without a full browser reload before this change needs one after it (the sidebar stays on screen while moving between pages).

## Assumptions

- "Up to date" means up to date when a page is opened; a count that changes in front of the user without any navigation (push or periodic polling) is not asked for and stays out of scope.
- A link prefetched before the mention was saved must still show the current count when it is clicked; the count is worked out when the page is opened, not when the link first appeared.
- No change to how notifications are created, read, listed or hidden; SF-102 rules stay as they are.
- No database change is needed.
- Two browser sessions (two fake users) are enough to test this with the fake Google sign-in (`isFakeAllowed()`).
