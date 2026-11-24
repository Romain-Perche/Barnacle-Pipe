# Feature Specification: Campaigns — segments

**Feature Branch**: `factory/sf-120-step-15-campaigns-segments`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 15 - Campaigns: segments. Choosing who a campaign goes to (`docs/PRODUCT.md` section 4, "Choosing recipients", and the segments line in `docs/DECISIONS.md`): everyone in the CRM, everyone on the deals of a pipeline or of one of its stages, or a filter on any person field (lead source, label, organisation, owner, role, custom fields). A choice can be saved as a named segment, shared by the whole team, and edited, renamed or deleted. It shows how many people it reaches now, with unsubscribed people, people with no email address, archived people and duplicate addresses removed, and says that recipients are worked out when the campaign is sent. Only people the user can see are counted. Not in this issue: picking a segment in a campaign and sending (a later issue)."

## Clarifications

### Session 2026-11-24

- Q: Which design? → A: Design: C, a Segments table (Name, Who, Reaches now, Last changed) and one page per segment with a count strip (Reaches now, Archived, Unsubscribed, No email address), "// WHO" and "// CONDITIONS" sections, `[ EDIT ]` opening the form on its own page (see `design-options.html`).
- Q: Which deals does a pipeline or stage segment count? → A: The user picks Open, Won, Lost or All deals; Open is picked first; archived deals never count.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save a segment and see how many people it reaches (Priority: P1)

A team member opens a "Segments" page from the sidebar. They press `[ NEW SEGMENT ]`, give the segment a name and choose who it reaches: everyone in the CRM, or everyone on the deals of one pipeline, or of one stage of a pipeline. Before and after saving they see how many people it reaches now, with what was removed and why, and a line saying that recipients are worked out when the campaign is sent. The saved segment is listed on the Segments page for the whole team.

**Why this priority**: "Choose a pipeline and email everyone in it" is the campaign feature the team uses most (PRODUCT section 4); a later campaign issue needs saved segments to pick from.

**Independent Test**: With fake people and deals, save "Exec Dinner — all" (pipeline Exec Dinner) and "Sales — Proposal" (stage Proposal of Sales); confirm each is listed with the expected count, that unsubscribed, archived and address-less people are left out and counted under the right reason, and that a person on two deals of the pipeline is counted once.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the Segments page, **When** they press `[ NEW SEGMENT ]`, **Then** the new segment form opens on its own page with a name, a "Who" choice ("Everyone in the CRM", "People on the deals of a pipeline", "People on the deals of a stage"), and, for the last two, the pipeline (and then one of its stages) and the deal status: "Open deals" (chosen first), "Won deals", "Lost deals" or "All deals".
2. **Given** a stage choice with 2 open deals (one with a main contact and one other linked person, one with a main contact only), 1 won deal and 1 archived open deal in that stage, all with subscribed people who have an email address, **When** the count is shown with "Open deals", **Then** it says "Reaches 3 people now"; with "All deals" it counts the won deal's people too; the archived deal's people are never counted through it.
3. **Given** a filled-in form, **When** the user presses `[ COUNT AGAIN ]` (and when they save), **Then** it shows "Reaches <n> people now", the numbers left out — "<a> unsubscribed", "<b> with no email address", "<c> archived" — and the line "Recipients are worked out when the campaign is sent, so this number can change." (from the messages file).
4. **Given** a valid form, **When** the user saves it, **Then** the segment's own page opens with its name, "Last changed by <user> · <date time>", the count strip (Reaches now, Archived, Unsubscribed, No email address), the line of scenario 3, a "// WHO" section (Deals: Open deals; Pipeline · stage: Sales · Proposal) and a "// CONDITIONS" section listing each condition; and the Segments table lists it with its name (a link to its page), a plain-words summary of its choice (e.g. "People on open deals of Sales · Proposal + 3 conditions"), its count now, and who last changed it and when.
5. **Given** a name that is empty, longer than 100 characters, or the same as another segment's (ignoring case and spaces at either end), **When** the user saves, **Then** nothing is saved, the form keeps what was chosen, and the message says "Give the segment a name.", "A segment name can be at most 100 characters." or "There is already a segment called <name>."
6. **Given** a pipeline or stage choice with no pipeline or no stage picked, **When** the user saves, **Then** nothing is saved and the message says "Choose a pipeline." or "Choose a stage."
7. **Given** a person matched more than once (on several deals of the pipeline, or with several email addresses), **When** the count is worked out, **Then** they are counted once, under one address: their first email address.

---

### User Story 2 - Filter by person fields (Priority: P1)

On the same form, the user narrows who is reached with conditions on person fields: lead source, label, organisation, owner, role and the admin's people custom fields. Conditions can be added to any "Who" choice (everyone, a pipeline or a stage), and a person must match all of them.

**Why this priority**: PRODUCT section 4 asks for "filter by any field"; segments such as "everyone from the exec dinner lead source owned by Duncan" are as common as pipeline sends.

**Independent Test**: Save "Inbound, labelled Hot, owned by a fake user" on "Everyone in the CRM" and confirm the count equals the People list with the same filters, minus unsubscribed, archived and address-less people.

**Acceptance Scenarios**:

1. **Given** the segment form, **When** the user presses `[ ADD CONDITION ]` and picks a field, **Then** they get an input fitting the field: Lead source, Label, Organisation and Owner — one or more values from the current lists (a person matches any of them; Label matches a person who has any of the chosen labels); Role — text the role contains (ignoring case); people custom fields — the same tests as the People list filter of that type (SF-115: contains text, number/money/date from–to, a choice or "Empty", has a choice, Yes/No/Empty), for every people custom field whether or not it is shown in the list.
2. **Given** several conditions, **When** the count is worked out, **Then** only people matching every condition (and the "Who" choice) are counted; each condition can be removed with `[ REMOVE ]`.
3. **Given** a condition with no value chosen or typed, **When** the user saves, **Then** nothing is saved and the message names the field, e.g. "Lead source: choose at least one."; values that do not fit the field type are refused as in the People list filter, with a message naming the field.
4. **Given** the Organisation and Owner pickers, **When** they offer values, **Then** they offer only organisations the user can find on the Organisations list and active and deactivated users by name; Label and Lead source offer the current lists, plus a removed label or lead source already in the segment.

---

### User Story 3 - Edit, rename and delete segments (Priority: P2)

Segments are shared: anyone on the team can open a segment, change its choice or conditions, rename it, or delete it after a confirmation.

**Why this priority**: The team reuses segments across campaigns (PRODUCT: "Save filters as reusable segments"); they must be kept up to date, but creating them comes first.

**Independent Test**: As one user save a segment; as another user rename it, change its stage, and confirm the Segments page shows the new name, summary, count and "changed by"; then delete it and confirm it is gone for both.

**Acceptance Scenarios**:

1. **Given** any user and any segment, **When** they press `[ EDIT ]` on the segment's page, **Then** the form opens on its own page with its name, choice and conditions, and saving applies the same checks as adding.
2. **Given** two users editing the same segment, **When** the second saves after the first, **Then** nothing is saved for the second and the message says "Someone else changed this segment. Open it again to see their changes."
3. **Given** a segment, **When** a user presses `[ DELETE ]` on its page, **Then** a confirmation names the segment; confirming deletes it for everyone, returns to the Segments page and shows "Segment <name> deleted."; cancelling changes nothing.
4. **Given** a segment deleted by someone else, **When** a user opens, saves or deletes it, **Then** they see "This segment no longer exists." and nothing is changed.

---

### Edge Cases

- **Private people and deals**: with one private person created by Grace Fake in an "Everyone in the CRM" segment, Grace sees a count one higher than Ada; Ada's page shows no number or message about hidden people. A private deal Ada cannot see adds none of its people to Ada's count for its pipeline.
- **Left-out reasons**: a person who is archived and unsubscribed and has no email address adds 1 to "archived" only; one who is unsubscribed with no address adds 1 to "unsubscribed" only; one subscribed with no address adds 1 to "with no email address".
- **Nobody reached**: the count says "Reaches 0 people now"; saving still works and the segment is listed with 0.
- **Removed things in a segment**: a pipeline, stage, organisation or people custom field that has since been deleted, or a choice that has been removed, is shown in the segment's summary and form as "(deleted)"; a deleted pipeline, stage, organisation or field matches nobody, the segment's row in the Segments table and its page say "This segment refers to something that was deleted. Edit it before using it." A removed label, lead source or custom-field choice still matches the people who have it. A deactivated user as owner still matches the people they own.
- **Stage moves**: after a deal's only person is moved with the deal to another stage, the stage segment's count shown on the next page load is 1 lower.
- **Archived organisations**: a segment with the condition Organisation = an archived organisation still counts that organisation's subscribed, non-archived people with an address.
- **Unsafe input**: a segment named `<b>Test</b>` is listed with those characters shown as typed, not in bold; a made-up segment id or condition value in the page address shows "This segment no longer exists." or is ignored, never shown back.
- **Not signed in / deactivated**: opening the Segments page signed out goes to the sign-in page; a deactivated user's session is refused as on other pages and nothing is saved.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The sidebar MUST have a "Segments" link for every signed-in user, opening the Segments page: a table of every saved segment (Name linking to the segment's page, Who as a summary of its choice, Reaches now, Last changed by and when), ordered by name, with `[ NEW SEGMENT ]`. Each segment has its own page (count strip, "// WHO", "// CONDITIONS", `[ EDIT ]`, `[ DELETE ]`); adding and editing use a form on its own page (Design C).
- **FR-002**: Users MUST be able to choose who a segment reaches: everyone in the CRM; the people on the deals of one pipeline; or the people on the deals of one stage of a pipeline. For a pipeline or stage, the user MUST choose the deal status: Open (default), Won, Lost or All; archived deals never count.
- **FR-003**: A person MUST be reached through a deal when they are its main contact or one of its other linked people.
- **FR-004**: Users MUST be able to add any number of conditions on person fields — lead source, label, organisation, owner, role, and every people custom field — to any "Who" choice; a person MUST match every condition. Choice-like conditions (lead source, label, organisation, owner, single and multiple choice custom fields) accept one or more values and match any of them; other custom field types use the People list filter tests (SF-115); role matches text it contains, ignoring case.
- **FR-005**: Users MUST be able to save a choice as a named segment. Names MUST be 1 to 100 characters after trimming and unique among segments ignoring case.
- **FR-006**: Segments MUST be shared by the whole team: every signed-in user can see, edit, rename and delete every segment. Deleting MUST ask for confirmation.
- **FR-007**: A segment MUST store the choice and conditions, never a list of people: recipients are worked out each time.
- **FR-008**: The segment form, the segment's page and the Segments table MUST show how many people the segment reaches now, worked out when shown, and (on the form and the segment's page) the numbers left out as archived, unsubscribed and with no email address (each person under one reason, in that order).
- **FR-009**: Each reached person MUST be counted once and with one address (their first email address), however many deals or addresses match.
- **FR-010**: Only people the user can see MUST be counted (the private rule: creator or owner), and only deals the user can see MUST reach people; nothing shown MUST reveal how many people or deals were hidden.
- **FR-011**: The form and every count MUST say "Recipients are worked out when the campaign is sent, so this number can change."
- **FR-012**: Saving over a segment that someone else changed since it was opened MUST be refused with a message, saving nothing.
- **FR-013**: A segment that refers to a deleted pipeline, stage, organisation or custom field MUST still be listed and editable, show the deleted part as "(deleted)", match nobody through that part and say so on its row and its page.
- **FR-014**: Every segment page and action MUST check that the user is signed in and active, first; all user-facing text MUST come from the messages file.
- **FR-015**: The fake data command MUST add a few segments with clearly fake names covering each kind of choice.

### Key Entities

- **Segment**: a named, team-shared choice of recipients. Has a name, a "Who" (everyone, pipeline or stage, with a deal status), a list of conditions, who created it and when, who last changed it and when, and a version used to detect a concurrent change.
- **Condition**: one test on a person field within a segment: the field (lead source, label, organisation, owner, role or a people custom field) and its value(s) or range.
- **Reach (worked out, not stored)**: for a user at a moment, the people the segment reaches — visible, not archived, subscribed, with an email address — counted once each, plus the numbers left out by reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a segment "everyone on open deals of a pipeline" and see its count in under 1 minute.
- **SC-002**: For every fake data scenario in the tests, the count equals exactly the number of distinct visible, subscribed, non-archived people with an email address matching the choice and conditions; never more.
- **SC-003**: No count, summary or message ever includes or hints at a person or deal the viewing user cannot see (checked with two users and private records).
- **SC-004**: The Segments page with 50 segments over 10,000 people and 5,000 deals shows all its counts in under 2 seconds.
- **SC-005**: A change made to a segment by one user is what every other user sees on their next page load.

## Assumptions

- The look follows Design C of `design-options.html` and `docs/DESIGN.md`; the Segments link goes in the main sidebar group after Activities, where Campaigns will join it later.
- Email addresses are unique across the CRM, so a "duplicate address" can only come from the same person matched more than once; removing duplicates means counting each person once with one address.
- A person's first email address (the one listed first on their record) is the one a campaign will use; the sending issue may change this.
- Only person fields are offered as conditions; deal and organisation custom fields are not, and conditions cannot be combined with "or" between fields.
- The count is shown, not the list of people; listing the recipients and picking a segment in a campaign, the send confirmation count and the 1,000-a-day limit belong to the later campaign issue.
- No timeline entries or notifications are made for segment changes.
- Unsubscribed is the person's existing consent field; nothing in this issue changes consent.
