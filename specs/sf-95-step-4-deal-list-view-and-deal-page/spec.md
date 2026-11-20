# Feature Specification: Deal list view and deal page

**Feature Branch**: `factory/sf-95-step-4-deal-list-view-and-deal-page`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "step 4 - Deal list view and deal page. The deal list view and the full deal page, with Won and Lost (`docs/PRODUCT.md` section 1), including restoring an archived deal. Notes and the timeline on people and organisations come in the next issue."

## Clarifications

### Session 2026-11-20

- Q: Which design for the deal page? → A: Design: C, solid green `[ WON ]` and red `[ LOST ]` in the header, an arrow-shaped stage bar with days per stage, a strip with value, owner, expected close date and status, then `[ EDIT ]` `[ ARCHIVE ]` `[ DELETE ]` `[ FOLLOW ]`, // DETAILS and // HISTORY below; `[ LOST ]` opens a box over the page asking "Why was this deal lost?" (see `design-options.html`). The deal list follows the People list (filter row, table, preview drawer).
- Q: How does a user give the reason when they mark a deal Lost? → A: They type it as free text.
- Q: Which labels can a deal have? → A: A separate list of deal labels, managed by admins on the existing "Lead sources and labels" admin page.
- Q: Where does the user land after editing, archiving or deleting a deal from its deal page? → A: Editing and archiving bring them back to the deal page; deleting takes them to the deal list with "<title> was deleted."; from the board these stay as today (back to the board) (decided by the factory, to confirm)
- Q: What happens when a lost reason longer than 500 characters is sent? → A: It is refused with "Keep the reason under 500 characters." and the deal stays open; the box does not let more than 500 characters be typed (decided by the factory, to confirm)
- Q: Can an archived person be linked to a deal as another person? → A: No: only people the user can see and that are not archived can be linked; a person archived after being linked stays, marked "Archived" (decided by the factory, to confirm)
- Q: What happens when a deal's main person is changed to someone already listed under "Other people"? → A: They become the main person and leave "Other people" (a person is linked once); the history shows "Edited by <name>: Person" (decided by the factory, to confirm)
- Q: Does the deal list show labels, which are not one of its columns? → A: Yes, under each deal's title (like the email under a person's name), so the label filter's result is visible (decided by the factory, to confirm)
- Q: Where is the deal list's address? → A: `/deals/list`, beside the board at `/deals`, with a "Board / List" switch on both (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the full deal page (Priority: P1)

A team member opens a deal (from a board card's drawer, the deal list, or a shared link) and sees its full page: title, value, pipeline and stage, a stage progress bar showing how many days the deal spent in each stage, owner, followers, expected close date, labels, organisation, main person and other linked people, its status (open, won or lost) and its history in date order. From this page they can edit the deal, archive it, and (admins) delete it.

**Why this priority**: The deal page is where the team reads and works one deal; Won, Lost, restore, followers and linked people all live on it.

**Independent Test**: With the fake data loaded, open a deal that moved through three stages, and confirm the page shows every field, the progress bar with the current stage highlighted and the days spent in each stage, and the history newest first.

**Acceptance Scenarios**:

1. **Given** a deal the user can see, **When** they open its page, **Then** it shows title, value ("£4,000"), "<pipeline> · <stage>", owner, followers, expected close date ("19 Dec 2026"), labels, organisation (linking to its page), main person (linking to their page), other linked people, date added, status and "// HISTORY" (newest first).
2. **Given** a deal in the "Sales" pipeline that spent 3 days in "Qualified" and has been 5 days in "Proposal", **When** its page is shown, **Then** the progress bar shows every Sales stage in order, "Qualified" reads "3 days", "Proposal" is marked as the current stage and reads "5 days", earlier stages it skipped read "0 days" and later stages show no count.
3. **Given** the board's deal drawer, **When** the user follows its "Open deal page" link, **Then** the deal page opens; the page has a link back to the deal's board.
4. **Given** an open deal, **When** the user selects a later or earlier stage on the progress bar, **Then** the deal moves to that stage exactly as a move on the board (recorded in the history and the stage days), and the bar updates.
5. **Given** a deal that does not exist, was deleted or is private to someone else, **When** a user opens its address, **Then** they see "This deal doesn't exist or you can't see it." and nothing about the deal.

---

### User Story 2 - Mark a deal Won or Lost, and reopen it (Priority: P1)

On the deal page, `[ WON ]` closes the deal as won; `[ LOST ]` asks for the reason and closes it as lost. Closed deals leave the board (and its counts and totals) but keep their stage. `[ REOPEN ]` puts a closed deal back on the board where it was.

**Why this priority**: Won and Lost are how the team records results; without them every deal stays on the board forever.

**Independent Test**: Mark a deal Won and confirm it leaves its board column and the column total drops; mark another Lost with reason "Went with a competitor" and confirm the page shows the reason; reopen both and confirm they return to their columns.

**Acceptance Scenarios**:

1. **Given** an open deal, **When** the user presses `[ WON ]`, **Then** the page shows a "Won" badge with the date, the history records "Marked as won by <name>", and the deal no longer appears or counts on the board.
2. **Given** an open deal, **When** the user presses `[ LOST ]`, **Then** a box opens over the page asking "Why was this deal lost?" with `[ MARK AS LOST ]` and `[ CANCEL ]`; on saving with "Went with a competitor" the page shows a "Lost" badge, the date and the reason, and the history records "Marked as lost by <name>: Went with a competitor".
3. **Given** the lost reason is left empty, **When** the user saves, **Then** "Enter why this deal was lost." is shown and the deal stays open.
4. **Given** a won or lost deal, **When** the user presses `[ REOPEN ]`, **Then** the deal is open again, back on the board in the stage it was in, its won or lost date and reason are cleared, and the history records "Reopened by <name>".
5. **Given** a won or lost deal, **When** its page is shown, **Then** `[ WON ]` and `[ LOST ]` are replaced by `[ REOPEN ]`, and the progress bar shows the stages but does not move the deal.
6. **Given** another user closed or changed the deal since the page was loaded, **When** the user presses `[ WON ]`, `[ LOST ]` or `[ REOPEN ]`, **Then** "Someone else changed this deal while you were editing. Reload to see their changes." is shown and nothing changes.

---

### User Story 3 - Browse deals as a list (Priority: P1)

A team member switches the Deals page from "Board" to "List" and sees a table of deals across all pipelines, with a filter row above it, sortable columns, a count and total value of the matching deals, and a "Show closed deals" option. Selecting a row opens the deal drawer; the title links to the deal page.

**Why this priority**: The list is how the team finds a deal without knowing its pipeline, and the only place closed deals can be found.

**Independent Test**: Open the list, filter to pipeline "Sales" and owner "Ada Fake", sort by value high to low, confirm the rows, count and total; tick "Show closed deals" and confirm won and lost deals appear with their status.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they open the deal list, **Then** it shows open, non-archived deals they can see, with columns title, value, organisation, main person, pipeline · stage, owner, expected close date and date added, newest first, 50 per page, and above the table "<n> deals · £<total>" for all matching deals (not only those on the page).
2. **Given** the list, **When** the user filters by any combination of text in the title, pipeline, stage (once a pipeline is chosen), owner and label, **Then** only matching deals are listed and the count and total match them; `[ CLEAR ]` removes every filter.
3. **Given** the list, **When** the user sorts by title, value, organisation, stage, owner, expected close date or date added, ascending or descending, **Then** the rows are in that order; deals with no value, organisation or expected close date come last either way.
4. **Given** the list, **When** the user ticks "Show closed deals", **Then** won and lost deals are listed too, each with a "Won" or "Lost" status, and the count and total include them; a "Status" filter (open, won, lost) narrows them.
5. **Given** filters, sort and page chosen, **When** the user reloads or shares the address, **Then** the same list is shown; unknown or invalid values in the address are ignored and never shown.
6. **Given** the list or the board, **When** the user presses "Board" or "List", **Then** they switch between the two views of Deals.

---

### User Story 4 - Restore an archived deal (Priority: P2)

Archived deals can be found from the list ("Show archived deals") and opened. Their page reads "Archived" and offers `[ RESTORE ]`, which puts the deal back where it was.

**Why this priority**: Archiving from the board is not confirmed (SF-93), so users need a way to undo it; it is used less often than the stories above.

**Independent Test**: Archive a deal from the board, find it in the list with "Show archived deals", restore it from its page, and confirm it is back in its board column with its status unchanged.

**Acceptance Scenarios**:

1. **Given** the list, **When** the user ticks "Show archived deals", **Then** only archived deals are listed (open and closed, still respecting the other filters), each marked "Archived".
2. **Given** an archived deal, **When** its page is shown, **Then** it reads "Archived" with the date, offers `[ RESTORE ]` (and `[ DELETE ]` for admins), and offers no edit, Won, Lost, Reopen, follow or link action.
3. **Given** an archived deal that was open, **When** the user presses `[ RESTORE ]`, **Then** it is back on its board in the stage it was in, and the history records "Restored by <name>".
4. **Given** an archived deal that was won or lost, **When** it is restored, **Then** it keeps its status and stays off the board until reopened.
5. **Given** the stage an archived deal was in has been deleted, **When** it is restored, **Then** it is in the stage its deals were moved to (deleting a stage moves archived deals too, SF-93).

---

### User Story 5 - Linked people, labels and followers (Priority: P2)

On the deal page, a team member links more people to the deal besides its main person (and unlinks them), picks labels from the deal label list, and follows or unfollows the deal.

**Why this priority**: These complete the deal record from PRODUCT §1 and the "one main contact plus any number of linked people" decision; the deal is useful without them.

**Independent Test**: Link "Bob Example" to a deal whose main person is "Ada Example", add the label "Hot", follow the deal; reload and confirm the people, label and follower are shown and the history records the person link.

**Acceptance Scenarios**:

1. **Given** a deal page, **When** the user links a person they can see, **Then** they appear under "Other people" with a link to their page and the history records "Linked <person> by <name>"; `[ UNLINK ]` removes them and records "Unlinked <person> by <name>".
2. **Given** a person already linked (as main person or other person), **When** the user tries to link them again, **Then** "This person is already linked to this deal." is shown and nothing changes.
3. **Given** the edit form, **When** the user picks labels from the deal label list and saves, **Then** the deal page and list show them, the list's label filter finds the deal, and the history shows "Edited by <name>: Labels".
4. **Given** a signed-in admin on the "Lead sources and labels" page, **When** they add a deal label "Hot", rename it to "Very hot" or remove it, **Then** the page lists it under "Deal labels" (apart from the people labels), the deal edit form offers exactly the deal labels, and the person form still offers only the people labels; a deal label name already used by another deal label (ignoring case and surrounding spaces) shows "This name is already used." and nothing is saved; a user who is not an admin gets "You don't have access to this page." and nothing changes.
5. **Given** a deal page, **When** the user presses `[ FOLLOW ]`, **Then** they are listed under "Followers" and the button becomes `[ UNFOLLOW ]`; following is not recorded in the history.
6. **Given** a linked person who is private to someone else, **When** another user views the deal, **Then** that person is never shown or named, and is not counted.

---

### Edge Cases

- Days in a stage are whole days rounded down ("0 days" on the day it entered, "1 day", "12 days"); a deal that left a stage and came back adds both periods together.
- A deal moved from another pipeline: the progress bar shows only the current pipeline's stages; the time spent in the other pipeline's stages stays in the history ("Moved from Sales · Proposal to Partners · Intro").
- Stage days stop counting while a deal is won or lost: a deal won 4 days into "Proposal" still shows "4 days" there a week later; once reopened, the count goes on from 4. Archiving does not stop the count of an open deal.
- A closed deal can still be edited (title, value, owner, labels…) and archived. It cannot change stage until reopened: its progress bar does not move it, and its drawer (opened from the list) shows its "Won" or "Lost" status and no "Move to" picker.
- A lost reason is up to 500 characters; spaces around it are removed. The reason is shown as plain text, never as a link or formatting.
- Marking Won or Lost does not change the deal's value, owner or stage.
- A deal's other linked person is archived: still shown, marked "Archived"; deleted by an admin: removed from the deal, and the history keeps "A deleted person …" (as SF-92).
- A label removed by an admin no longer shows on any deal page or in the list's label filter. A follower who is deactivated stays listed as "<name> (deactivated)".
- Private deals: the list, its count and total, the deal page and every action on it follow the SF-93 rule (only the creator and the current owner see a private deal, admins included); a user who loses sight of a deal after saving it is taken to the list or board with "You can no longer see <title>: only its creator and owner can.".
- A list address with a page number past the last page shows the last page; with a stage that is not in the chosen pipeline, the stage filter is ignored.
- An empty list shows "No deals match these filters." (with filters) or "No deals yet." (without).
- "Show closed deals" and "Show archived deals" together list archived deals of every status.
- An admin deletes a deal from its page after the confirmation "Delete <title> for good? This can't be undone."; they land on the deal list with "<title> was deleted.".

## Requirements *(mandatory)*

### Functional Requirements

**Deal page**

- **FR-001**: Every deal the user can see MUST have its own page showing title, value, pipeline and stage, status, owner, followers, expected close date, labels, organisation, main person, other linked people, date added and the deal's history newest first, with `[ EDIT ]`, `[ ARCHIVE ]` and (admins only) `[ DELETE ]`.
- **FR-002**: The deal page MUST show a stage progress bar with every stage of the deal's current pipeline in order, the current stage marked, and the whole days spent in each stage up to and including the current one, from the recorded stage history.
- **FR-003**: Selecting a stage on the progress bar of an open, non-archived deal MUST move the deal to that stage, recorded exactly as a board move.
- **FR-004**: The board's deal drawer MUST link to the deal page, and the deal page MUST link back to the deal's board.

**Won and Lost**

- **FR-005**: Any user who can see an open deal MUST be able to mark it Won, or Lost with a required reason (up to 500 characters); the date it closed and, for Lost, the reason are kept and shown.
- **FR-006**: Won and lost deals MUST NOT appear or count on the board; they keep their pipeline and stage.
- **FR-007**: Any user who can see a closed deal MUST be able to reopen it; it returns to the board in its stage and its closed date and reason are cleared.
- **FR-008**: Marking Won, marking Lost (with the reason) and reopening MUST each be recorded in the deal's history with who and when, and MUST be refused with the "changed since loaded" message when the deal changed since the page was loaded.

**Deal list**

- **FR-009**: Deals MUST offer a list view, switched to and from the board, listing deals the user can see across all pipelines with title (linking to the deal page), value, organisation, main person, pipeline · stage, owner, expected close date and date added, 50 per page.
- **FR-010**: The list MUST filter by title text, pipeline, stage within the chosen pipeline, owner, label and (when closed deals are shown) status, and sort by title, value, organisation, stage, owner, expected close date and date added in both directions; empty values sort last.
- **FR-011**: By default the list MUST show only open, non-archived deals; "Show closed deals" MUST add won and lost deals with their status; "Show archived deals" MUST show only archived deals.
- **FR-012**: The list MUST show the number and total value of all deals matching the filters.
- **FR-013**: Filters, sort, page and the open drawer MUST be kept in the page address; values that are unknown or invalid MUST be ignored and never shown.

**Restore**

- **FR-014**: Any user who can see an archived deal MUST be able to restore it from its page; it returns to the stage it is in, with its open, won or lost status unchanged, and the restore is recorded in its history.
- **FR-015**: An archived deal's page MUST offer only `[ RESTORE ]` and (admins) `[ DELETE ]`.

**Linked people, labels, followers**

- **FR-016**: Users MUST be able to link any number of other people they can see to a deal and unlink them, besides its main person; a person is linked at most once; links and unlinks are recorded in the history.
- **FR-017**: Users MUST be able to give a deal any number of labels from a deal label list, separate from the people label list; label changes are recorded as an edit. Only admins MUST be able to add, rename and remove deal labels, in a "Deal labels" section of the existing "Lead sources and labels" admin page, enforced on every request; names are unique among deal labels, ignoring case and surrounding spaces.
- **FR-018**: Any user who can see a deal MUST be able to follow and unfollow it themselves; the page lists its followers. Updates sent to followers come with a later feature.

**Access, privacy, messages, look**

- **FR-019**: Every list, page and action MUST require a signed-in, active user; delete MUST be admin only, enforced on every request.
- **FR-020**: The private deal rule (SF-93) and private person rule (SF-92) MUST apply to the list, its counts and totals, the deal page, linked people and every action: no one they hide a deal or person from may see, count or change it.
- **FR-021**: Every message shown MUST be one of the app's fixed messages; text from the page address MUST never be shown; user-entered text (lost reason) is shown as plain text.
- **FR-022**: The list and deal page MUST follow `docs/DESIGN.md` and the existing record pages: the list as for people and organisations (filter row, table, preview drawer when a row is selected), the deal page as design C in `design-options.html` (solid green `[ WON ]` and red `[ LOST ]` in the header, arrow-shaped stage bar with days, a strip with value, owner, expected close date and status, // DETAILS then // HISTORY, the lost reason asked in a box over the page); money in GBP, dates in UK format.

**Fake data**

- **FR-023**: The fake data command MUST add, without duplicates when run again, won and lost deals (with clearly fake lost reasons), at least four deal labels and deals with them, other linked people and followers, at least one archived won or lost deal, and stage histories spread over several days so the progress bar shows varied day counts.

### Key Entities

- **Deal** (from SF-93): gains a status (open, won, lost), the date it was closed, a lost reason, labels, other linked people and followers.
- **Deal link to a person**: a person linked to a deal besides its main person.
- **Deal label**: a name in the admin-managed deal label list (separate from people labels); a deal has any number of them.
- **Follower**: a user following a deal.
- **Stage history** (from SF-93): when a deal entered and left each stage; read to show days per stage.
- **Deal history event** (from SF-93): gains won, lost (with reason) and reopened.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can find any deal by title from the list and open its page in under 30 seconds.
- **SC-002**: Marking a deal Won takes one press; marking it Lost takes one press plus the reason.
- **SC-003**: A list of 2,000 deals with filters and sorting shows a page in under 2 seconds.
- **SC-004**: In automated tests, the days shown per stage equal the recorded stage periods for every deal in the fake data.
- **SC-005**: In automated tests, won, lost and archived deals never appear or count on the board, and reopened or restored open deals always return to their stage.
- **SC-006**: In automated tests, a private deal or private linked person never appears or counts for anyone the privacy rules hide it from, in the list, its totals, the deal page or by direct request.
- **SC-007**: 100% of deal deletes from non-admins are refused in automated tests, including direct requests.

## Assumptions

- Notes, the deal timeline's emails, files, activities and WhatsApp messages, and showing deal events on people's and organisations' timelines (and their deal lists) come in later issues (user request); the deal history here holds the events that exist today plus won, lost and reopened.
- Lost reasons are typed freely; there is no admin-managed list of reasons.
- Users follow and unfollow only themselves; nobody is followed automatically. Notifications to followers come later.
- Closed deals keep their stage; the board has no "show closed" option (the list has it), matching Pipedrive.
- The list has no custom columns, saved filters or bulk actions; custom fields come later.
- Any user can mark Won, Lost, reopen and restore any deal they can see; owner is not a permission (PRODUCT §7).
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here; the deal page follows design C.
