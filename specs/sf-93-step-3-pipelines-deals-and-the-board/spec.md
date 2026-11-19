# Feature Specification: Pipelines, deals and the board

**Feature Branch**: `factory/sf-93-step-3-pipelines-deals-and-the-board`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "step 3 - Pipelines, deals and the board. Pipelines with their stages, deals, and the board view (`docs/PRODUCT.md` section 1). The list view and the full deal page come in the next issue."

## Clarifications

### Session 2026-11-19

- Q: Who can create, rename, reorder and delete pipelines and stages? → A: Admins only, on a "Pipelines" page in the "// Admin" group.
- Q: Which design for the deals board? → A: Design: A, rounded cards in stage columns, a pipeline picker above the board, and a deal drawer on the right (see `design-options.html`).
- Q: Until activities exist (later issue), does every card show "No next activity"? → A: No: cards show no warning until the activities feature adds it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a pipeline as a board (Priority: P1)

A team member opens "Deals" from the sidebar and sees the board of a pipeline: one column per stage, in the pipeline's order, each headed by the stage name, the number of deals in it and their total value. Each deal is a rounded card showing its title, organisation, main person and value (the "No next activity" warning comes with the activities feature). A pipeline picker above the board switches to any other pipeline (Sales, Ambassadors, Fractional CTO, Exec Dinner…).

**Why this priority**: The board is how the team works its deals every day in Pipedrive today; it is the first screen they need to move over.

**Independent Test**: With the fake data loaded, open Deals, pick the "Sales" pipeline and confirm each stage column shows the right count and total, and that each card shows its title, organisation, person, value and the warning.

**Acceptance Scenarios**:

1. **Given** a signed-in user and pipelines with deals, **When** they open Deals, **Then** the board of the first pipeline (in pipeline order) is shown with one column per stage, in stage order, each headed "<stage name>", "<n> deals" and the total value ("£12,500").
2. **Given** a deal "Fakeco website" worth £4,000 linked to "Fakeco Ltd" and main person "Ada Example", **When** the board is shown, **Then** its card shows "Fakeco website", "Fakeco Ltd", "Ada Example" and "£4,000", and no "No next activity" warning.
3. **Given** the board of one pipeline, **When** the user picks another pipeline in the picker, **Then** that pipeline's board is shown and the page address names it, so reloading or sharing the address shows the same board.
4. **Given** a stage with no deals, **When** the board is shown, **Then** its column shows "0 deals", "£0" and "No deals in this stage.".
5. **Given** a CRM with no pipelines, **When** a user opens Deals, **Then** the page reads "No pipelines yet."; an admin also sees a `[ ADD PIPELINE ]` link to the Pipelines page, and other users see no link.

---

### User Story 2 - Add a deal (Priority: P1)

A team member presses `[ ADD DEAL ]` on a board (or `+` at the top of a column) and enters a title, value, organisation, main person, expected close date, owner, pipeline and stage. The deal appears on the board in the chosen stage.

**Why this priority**: Without deals the board is empty; adding deals is part of the minimum useful slice.

**Independent Test**: Add a deal to the "Proposal" stage of "Sales" with a new organisation name and an existing person, then confirm the card appears in that column and the column count and total go up.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the "Sales" board, **When** they add a deal "Fakeco website", value "4000", organisation "Fakeco Ltd", person "Ada Example", stage "Proposal", **Then** the card appears in the "Proposal" column, the owner is the user who added it, and the column's count and total include it.
2. **Given** a user presses `+` on the "Qualified" column, **When** the form opens, **Then** the pipeline and stage are already set to that pipeline and "Qualified".
3. **Given** a user adding a deal, **When** they leave the title empty or type a value that is not an amount of money (negative, letters, more than two decimals), **Then** the form shows "Enter a deal title." or "Enter a value in pounds, for example 4000 or 4000.50." next to the field and nothing is saved.
4. **Given** a user picks a person linked to "Fakeco Ltd" and leaves the organisation empty, **When** they save, **Then** the deal is linked to "Fakeco Ltd" as well.
5. **Given** a user types an organisation name that does not exist, **When** they save, **Then** the deal is linked to a new organisation with that name, exactly as the organisation field on the person form works.

---

### User Story 3 - Move deals between stages (Priority: P1)

A team member drags a card from one column to another; the deal moves to that stage, both column counts and totals update, and the move is recorded with who did it and when. Users who cannot drag (keyboard, touch) change the stage from the deal's drawer.

**Why this priority**: Moving deals through stages is the main thing the board is for, and the stage history it records is what the deal page (next issue) uses for days spent in each stage.

**Independent Test**: Drag a card from "Qualified" to "Proposal", reload the page and confirm the card is in "Proposal", both columns' counts and totals are right, and the deal's history shows "Moved from Qualified to Proposal by <name>".

**Acceptance Scenarios**:

1. **Given** a card in "Qualified", **When** the user drags it onto the "Proposal" column, **Then** the card shows in "Proposal" straight away, both columns' counts and totals update, and after a reload the card is still in "Proposal".
2. **Given** a deal moved from "Qualified" to "Proposal", **When** anyone opens the deal's drawer, **Then** its history shows "Moved from Qualified to Proposal by <name>" with the date and time.
3. **Given** the deal's drawer, **When** the user picks another stage (or another pipeline and stage) and saves, **Then** the deal moves exactly as by dragging, and is recorded the same way.
4. **Given** a card dropped back onto its own column, **When** the drop ends, **Then** nothing changes and nothing is recorded.
5. **Given** another user archived or moved a deal since the board was loaded, **When** the user drags its card, **Then** the board shows "This deal changed since you loaded the board. The board has been refreshed." and shows the deal where it now is (or not at all if archived).

---

### User Story 4 - Look at and edit a deal from the board (Priority: P2)

Selecting a card opens a drawer on the right (like the people preview drawer) showing the deal's details and its history, with `[ EDIT ]`, `[ ARCHIVE ]` and, for admins, `[ DELETE ]`. The full deal page comes in the next issue.

**Why this priority**: Users need to correct a value or owner and remove dead deals, but the board is usable for viewing and moving deals without it.

**Independent Test**: Select a card, edit its value from £4,000 to £5,000, and confirm the drawer, card and column total show the new value and the history shows the edit.

**Acceptance Scenarios**:

1. **Given** the board, **When** a user selects a card, **Then** a drawer shows title, pipeline and stage, value, organisation (linking to its page), main person (linking to their page), owner, expected close date, date added and "// HISTORY" (newest first); the open drawer is part of the page address.
2. **Given** the drawer, **When** a user edits the value and saves, **Then** the card and column total show the new value and the history shows "Edited by <name>: Value".
3. **Given** the drawer, **When** a user presses `[ ARCHIVE ]`, **Then** the card leaves the board, the column count and total drop, and the history records "Archived by <name>".
4. **Given** a signed-in admin, **When** they press `[ DELETE ]` and confirm "Delete Fakeco website for good? This can't be undone.", **Then** the deal is gone and the board shows "Fakeco website was deleted.".
5. **Given** a user who is not an admin, **When** they look at the drawer, **Then** there is no `[ DELETE ]`, and a direct delete request shows "You don't have access to this page." and deletes nothing.

---

### User Story 5 - Manage pipelines and stages (Priority: P2)

An admin, on the "Pipelines" page in the "// Admin" group, manages pipelines and their stages: they are are created, renamed, reordered and deleted. Deleting a stage or pipeline that still has deals asks where to move them.

**Why this priority**: The team already has many pipelines and adds one per team member; they must be able to shape them. The fake data gives a working board without this page, so it comes after the board.

**Independent Test**: Create a pipeline "Partners" with stages "Intro", "Talking", "Signed"; rename "Talking" to "In talks"; move "Signed" first; delete "Intro"; confirm the board shows "Signed", "In talks" in that order.

**Acceptance Scenarios**:

1. **Given** a signed-in admin, **When** they add a pipeline "Partners", **Then** it has no stages, appears in the board's pipeline picker, and its board reads "This pipeline has no stages yet.".
2. **Given** a pipeline, **When** the user adds, renames or reorders its stages, **Then** the board shows the columns with the new names in the new order, and deals stay in their (renamed) stages.
3. **Given** pipelines in the picker, **When** the user reorders pipelines, **Then** the picker lists them in the new order and the first one is the board shown by default.
4. **Given** a stage with deals (archived ones included), **When** the user deletes it, **Then** they must pick another stage of the same pipeline; the deals move there, each deal's history records "Moved from <old stage> to <new stage> by <name> (stage deleted)", and the stage is gone.
5. **Given** a pipeline with deals, **When** the user deletes it, **Then** they must pick a stage in another pipeline to move its deals to; a pipeline with no deals is deleted after a confirmation.
6. **Given** a name already used by another pipeline (ignoring case and surrounding spaces), or by another stage in the same pipeline, **When** the user saves, **Then** "This name is already used." is shown and nothing is saved.
7. **Given** a signed-in user who is not an admin, **When** they open the Pipelines page address or send a change directly, **Then** "You don't have access to this page." is shown and nothing changes; their sidebar has no "Pipelines" link.

---

### User Story 6 - Private deals (Priority: P3)

The person who added a deal can mark it private. A private deal is visible only to them — admins included — on boards, in column counts and totals, and by address.

**Why this priority**: Required by the team decision on private contacts and deals; it must exist from the start so emails and notes attached to deals later never leak.

**Independent Test**: As user A, add a deal and mark it private; as user B and as an admin, confirm the card is absent, the column count and total exclude it, and its drawer address shows the board with no drawer.

**Acceptance Scenarios**:

1. **Given** user A created a deal, **When** A ticks "Private" and saves, **Then** A's card and drawer show a "Private" badge.
2. **Given** a private deal of A, **When** any other user (admins included) views the board, **Then** the card is not shown, the column count and total do not include it, and an address naming its drawer shows the board with no drawer.
3. **Given** a deal created by A, **When** another user edits it, **Then** the "Private" option is not offered to them, and no edit, move, archive or delete request from them changes a private deal.
4. **Given** a deal whose main person is private to A, **When** another user views the deal's card or drawer, **Then** no person is shown (the private person is never named).

---

### Edge Cases

- A value typed as `£4,000.50` or ` 4000.5 ` is saved as £4,000.50; card and column totals show whole pounds when there are no pence ("£4,000") and two decimals otherwise ("£4,000.50"). An empty value shows "—" on the card and counts as £0 in the total.
- A deal with no organisation or no person: the card simply leaves that line out.
- A long title or organisation name wraps on the card; it never widens the column.
- The deal's person or organisation is archived: the card and drawer still show it, marked "Archived" in the drawer. An admin deletes the organisation or person: the deal stays, with no organisation or person.
- A deal's owner is deactivated: the deal keeps that owner, shown with "(deactivated)"; deactivated users are not offered as new owners.
- Two users edit the same deal in the drawer at the same time: the second save shows "Someone else changed this deal while you were editing. Reload to see their changes." and does not overwrite the first.
- A board address naming a pipeline that does not exist, or a drawer for a deal that does not exist, is archived, is in another pipeline or is private to someone else: the first pipeline's board (or the named board) is shown with no drawer, and no text from the address is shown.
- A pipeline has 10 or more stages: the board scrolls sideways, and every column header still shows its full stage name, count and total.
- A stage holds 200 deals: the column scrolls on its own, and its header shows "200 deals" and the total of all 200, not only of those on screen.
- The last stage of a pipeline cannot be deleted while the pipeline has deals ("A pipeline with deals needs at least one stage.").
- Cards in a column are ordered by when the deal entered that stage, most recent at the top, so a deal just dragged in appears first.
- Archived deals are never shown on the board and never counted, but stay in their stage, so restoring one (from the deal page, next issue) puts it back where it was.
- A drag that fails (connection lost) puts the card back where it was and shows "The deal could not be moved. Try again.".
- Deleting a deal's main person never deletes the deal; deleting a pipeline or stage never deletes deals.

## Requirements *(mandatory)*

### Functional Requirements

**Pipelines and stages**

- **FR-001**: There MUST be any number of pipelines, each with a name (required, unique ignoring case and surrounding spaces) and a position in the pipeline order.
- **FR-002**: Each pipeline MUST have its own ordered list of stages, each with a name (required, unique within its pipeline ignoring case and surrounding spaces).
- **FR-003**: Only admins MUST be able to create, rename, reorder and delete pipelines and stages, on a "Pipelines" page; the app MUST enforce this on every request, not only by hiding links. Every user sees and uses every pipeline's board.
- **FR-004**: Deleting a stage or pipeline that holds deals (archived ones included) MUST require choosing a stage to move them to (same pipeline for a stage, another pipeline for a pipeline); each moved deal's history records the move. Deleting never deletes deals.

**Deals**

- **FR-005**: Signed-in users MUST be able to add and edit deals. A deal has: title (required), value in GBP (optional, zero or more, up to two decimals), pipeline and stage (required), organisation (optional, picked or created by name as on the person form), main person (optional, picked from people the user can see), owner (an active user; defaults to whoever adds it), expected close date (optional), date added (automatic), and a private flag.
- **FR-006**: When a deal is saved with a main person who has an organisation and no organisation was chosen, the deal MUST be linked to that person's organisation.
- **FR-007**: Every deal MUST keep a history of what happened to it, newest first, with who and when: added, edited (with the names of the fields changed), moved from one stage to another (including between pipelines), archived. Each stage move MUST record when the deal entered and left each stage, so the deal page can later show days spent in each stage.
- **FR-008**: Any signed-in user MUST be able to archive any deal they can see; only admins MUST be able to delete a deal for good, after a confirmation, enforced on every request.

**Board**

- **FR-009**: The board MUST show one pipeline at a time: one column per stage in stage order, each with the stage name, the number of deals and their total value, counting only non-archived deals the viewer can see.
- **FR-010**: Each card MUST show the deal's title, organisation name, main person's name and value. Cards MUST NOT show a "No next activity" warning in this issue; the activities feature adds it.
- **FR-011**: Users MUST be able to move a deal to another stage by dragging its card onto another column, and also by choosing the stage (or pipeline and stage) in the deal's drawer, for users who cannot drag.
- **FR-012**: A move MUST be refused, with the board refreshed and a message, when the deal changed (moved, edited, archived, deleted) since the board was loaded.
- **FR-013**: The chosen pipeline and the open deal drawer MUST be kept in the page address. With no pipeline in the address, the board MUST show the first pipeline in pipeline order.
- **FR-014**: Selecting a card MUST open a drawer showing the deal's details and history with `[ EDIT ]`, `[ ARCHIVE ]`, `[ DELETE ]` (admins only) and `[ CLOSE ]`.

**Private deals**

- **FR-015**: The user who created a deal MUST be able to mark it private or not private; nobody else may change it.
- **FR-016**: A private deal MUST be invisible to everyone except its creator, admins included: not on boards, in counts or totals, in drawers or by address, and no edit, move, archive or delete request from anyone else may change it. A private person linked to a deal MUST never be shown to anyone but that person's creator.

**Access, navigation, messages, look**

- **FR-017**: Every board, deal and pipeline page and action MUST require a signed-in, active user.
- **FR-018**: The sidebar's main navigation MUST gain "Deals"; the "// Admin" group MUST gain "Pipelines".
- **FR-019**: Every message shown to users MUST be one of the app's fixed messages; text from the page address MUST never be shown.
- **FR-020**: The board, cards, drawer and forms MUST follow `docs/DESIGN.md` and the existing signed-in layout: design A in `design-options.html`: stage columns with a header (stage name, `+`, "<n> deals · £total"), rounded cards, a "Pipeline: <name>" picker and `[ ADD DEAL ]` above the board, and the deal drawer on the right (details, `[ EDIT ]`, `[ ARCHIVE ]`, `[ DELETE ]` for admins, "// HISTORY"); cards are the one rounded surface, money in GBP, dates in UK format ("19 Nov 2026").

**Fake data**

- **FR-021**: The fake data command MUST add, without duplicates when run again, the pipelines Sales, Ambassadors, Fractional CTO and Exec Dinner plus one personal pipeline named after a fake user (e.g. "Ada Fake's pipeline"), each with 3–7 stages, and at least 40 deals spread across them with clearly fake titles, linked to fake people and organisations, covering several owners, deals with and without value, organisation and person, an empty stage, at least one archived deal and at least one private deal.

### Key Entities

- **Pipeline**: A named sales process (Sales, Ambassadors…). Name, position in the pipeline order; has ordered stages.
- **Stage**: A step in one pipeline. Name, position within its pipeline; holds deals.
- **Deal**: A piece of business. Title, value (GBP), pipeline and stage, organisation, main person, owner (user), expected close date, date added, private flag and creator, archived flag. Later issues add other linked people, followers, labels, won/lost status and custom fields.
- **Stage history**: When a deal entered and left each stage and who moved it.
- **Deal history event**: Something that happened to a deal: what, who, when, and for edits the fields that changed. Later features (notes, emails, activities) add their own events to this timeline.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a deal with title, value, organisation and person in under 1 minute.
- **SC-002**: Moving a deal to another stage takes one drag; the card shows in its new column within 1 second.
- **SC-003**: A board with 10 stages and 500 open deals shows in under 2 seconds.
- **SC-004**: In automated tests, every column's count and total equals the number and sum of the visible, non-archived deals in that stage, after adds, edits, moves, archives and deletes.
- **SC-005**: In automated tests, a private deal never appears, and never counts, for any user other than its creator (admins included), on any board, total, drawer or direct address.
- **SC-006**: 100% of deal deletes from non-admins, and of pipeline and stage changes from non-admins, are refused in automated tests, including direct requests that bypass the page.
- **SC-007**: Deleting a stage or pipeline never loses a deal: in automated tests the number of deals is the same before and after.

## Assumptions

- The deals list view (sorting, filters, "show closed deals") and the full deal page (stage progress bar with days per stage, followers, other linked people, labels, Won and Lost buttons with a lost reason, full timeline, restore) are the next issue (user request). Until then every deal is open, and archived deals cannot be restored from the UI.
- Activities do not exist yet, so cards have no "No next activity" warning; the activities feature adds it to the card (PRODUCT §1).
- Deals are shared across the team (PRODUCT §7): any user can view, edit and move any deal they can see, whoever the owner is. Owner is a label of responsibility, not a permission.
- Money is GBP only (DECISIONS); values are not converted or shown in other currencies.
- A fresh CRM starts with no pipelines; the fake data and, later, the Pipedrive import fill them.
- Cards cannot be reordered by hand inside a column; their order comes from when they entered the stage.
- The board has no filters in this issue; filtering deals comes with the list view.
- Deal events (added, moved) are kept on the deal only for now; showing them on the linked person's and organisation's timelines comes with the full deal page.
- The board is for desktop browsers; on small screens a basic usable layout and the drawer's stage picker are enough.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
