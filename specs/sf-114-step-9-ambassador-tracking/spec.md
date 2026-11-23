# Feature Specification: Ambassador tracking

**Feature Branch**: `factory/sf-114-step-9-ambassador-tracking`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "step 9 - Ambassador tracking. Ambassador tracking (`docs/PRODUCT.md` section 2): record which ambassador referred each person or deal, and give each ambassador a page with what they've brought in and their latest updates. Ambassadors are people in the CRM (`docs/DECISIONS.md`)."

## Clarifications

### Session 2026-11-23

- Q: Which design for the ambassador page? → A: Design: B, its own one-column page: header with `[ PERSON PAGE ]`, summary strip (people referred, deals referred, open, won, lost), "// PEOPLE REFERRED", "// DEALS REFERRED", then "// LATEST UPDATES" grouped by day (see `design-options.html`).
- Q: How does a person become an ambassador? → A: An "Ambassador" tick on the person's form; only ticked people can be picked as "Referred by".
- Q: What does the ambassador page show as "latest updates"? → A: The newest notes and changes on the ambassador and on every person and deal they referred, merged by date.
- Q: Is a new deal's "Referred by" filled in from its main person? → A: Yes, pre-filled on the add deal form and changeable before saving (decided by the factory, to confirm)
- Q: What happens when "Ambassador" is unticked on someone who has referrals? → A: Their referrals are kept, they leave the Ambassadors page and the pickers, and their page stays reachable marked "No longer an ambassador" (decided by the factory, to confirm)
- Q: Does a timeline show a "Referred by" change that names a private person the reader can't see? → A: No, the entry is left out for them, as every other entry about a hidden person (SF-92); the record's own "Referred by" line still says "Referred by a private person" (decided by the factory, to confirm)
- Q: Who can open a former ambassador's page? → A: Only users who can see the person and at least one person or deal they referred; for anyone else it shows "This ambassador doesn't exist or you can't see them." (decided by the factory, to confirm)
- Q: Do "latest updates" include the entries of deals the ambassador is linked to as a contact (not referred)? → A: No: only the ambassador's own person timeline and the people and deals they referred (decided by the factory, to confirm)
- Q: What is the "latest referral" date on the Ambassadors page? → A: The date "Referred by" was last set to that ambassador on a person or deal the user can see, not the record's date added (decided by the factory, to confirm)
- Q: Does the Ambassadors page have filters and pages? → A: No: one table of every ambassador the user can see, by name A–Z (tens of ambassadors); filters can come later (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mark a person as an ambassador (Priority: P1)

A team member opens a person who refers business to Barnacle and marks them as an ambassador. From then on that person is listed on an "Ambassadors" page reached from the sidebar, and can be chosen as the ambassador who referred other people and deals. Ambassadors stay ordinary people in the CRM: they never sign in.

**Why this priority**: Nothing else in this feature works until the team can say who the ambassadors are; ambassador tracking is a "must have" (PRODUCT priorities).

**Independent Test**: With the fake data loaded, edit "Ada Example", tick "Ambassador" and save; confirm the person page shows "Ambassador", Ada is on the Ambassadors page, and Ada is offered when choosing "Referred by" on another person.

**Acceptance Scenarios**:

1. **Given** a person the user can see who is not archived, **When** they tick "Ambassador" on the person's form and save, **Then** the person page shows an "Ambassador" badge next to the name and an `[ AMBASSADOR PAGE ]` link that opens their ambassador page, and the change is recorded on the person's timeline ("Made an ambassador" by the user).
2. **Given** the Ambassadors page, **When** it is shown, **Then** it lists every ambassador the user can see, by name, with their organisation, the number of people and of deals they referred, the total value of their open deals and of their won deals (GBP), and the date of their latest referral; each row opens the ambassador page.
3. **Given** no ambassador the user can see, **When** the Ambassadors page is shown, **Then** it says "No ambassadors yet. Tick Ambassador on a person to add one."
4. **Given** an ambassador, **When** a user unticks "Ambassador" and saves, **Then** the person is no longer on the Ambassadors page, the "Ambassador" badge is gone from their person page, and they are not offered in any "Referred by" picker; people and deals they already referred still show "Referred by <their name>", and their timeline shows "No longer an ambassador" by the user.
5. **Given** an archived ambassador, **When** the Ambassadors page is shown, **Then** they are still listed, marked "Archived", but they are not offered as a referrer on any form until restored.

---

### User Story 2 - Record who referred a person or a deal (Priority: P1)

When adding or editing a person or a deal, a team member picks the ambassador who referred it in a "Referred by" field. The person page, the deal page and the deal drawer show "Referred by <ambassador>" linking to the ambassador's page.

**Why this priority**: This is the first PRODUCT rule of ambassador tracking ("Record which ambassador referred each contact or deal"); the ambassador page has nothing to show without it.

**Independent Test**: Set "Referred by: Ada Example" on the person "Bob Sample" and on a deal; confirm both pages show "Referred by Ada Example", both timelines record the change, and Ada's ambassador page lists them.

**Acceptance Scenarios**:

1. **Given** the add or edit form of a person or a deal, **When** the user opens "Referred by", **Then** they can choose one of the ambassadors they can see who are not archived (searching by name), or leave it empty; it is optional.
2. **Given** a person or deal saved with "Referred by: Ada Example", **When** its page is shown, **Then** it shows "Referred by Ada Example" linking to Ada's ambassador page; the deal drawer on the board and deal list shows the same.
3. **Given** "Referred by" is set, changed or cleared, **When** the record is saved, **Then** its timeline records "Referred by set to <name>", "Referred by changed from <old> to <new>" or "Referred by cleared", with who and when.
4. **Given** a person's form, **When** the user tries to choose the person themselves as their own referrer, **Then** they are not offered; a direct request doing so is refused with "A person can't be their own referrer." and nothing is saved.
5. **Given** a direct request naming as referrer someone who is not an ambassador, is archived, or whom the user cannot see, **When** it is saved, **Then** it is refused with "Choose an ambassador from the list." and nothing is saved.
6. **Given** a new deal whose main person was referred by an ambassador, **When** the user picks that main person on the add deal form, **Then** "Referred by" is filled in with the same ambassador, and the user can change or clear it before saving; editing a deal never changes its "Referred by" on its own.
7. **Given** a person or deal whose referrer has since stopped being an ambassador or been archived, **When** its edit form is opened and saved without touching "Referred by", **Then** the referrer is kept.

---

### User Story 3 - The ambassador page: what they brought in and their latest updates (Priority: P1)

Each ambassador has a page showing what they've brought in (the people and deals they referred, with totals) and their latest updates (the newest notes and changes on the ambassador and on what they referred), so the team can see at a glance how valuable an ambassador is and what is happening with their introductions.

**Why this priority**: This is the second PRODUCT rule of ambassador tracking ("Each ambassador has a page showing what they've brought in and their latest updates").

**Independent Test**: With fake data where an ambassador referred three people and two deals (one open, one won), open the ambassador's page and confirm the counts, the open and won totals, the two lists, and that a note just added on one of the referred deals appears first under latest updates.

**Acceptance Scenarios**:

1. **Given** an ambassador the user can see, **When** their ambassador page is opened (from the Ambassadors page, a "Referred by" link or their person page), **Then** it shows (design B) the kind "AMBASSADOR", their name with role and organisation, `[ PERSON PAGE ]` opening their person page, their email addresses, phone numbers and owner, and a summary strip with five boxes: "People referred" (a number), "Deals referred" (a number), "Open" (total value of open deals, £), "Won" (total value of won deals, £, in green) and "Lost" (number of lost deals, in red).
2. **Given** the ambassador page, **When** it is shown, **Then** "// PEOPLE REFERRED" lists the people they referred (name, organisation, owner, date added), newest first, each linking to the person page.
3. **Given** the ambassador page, **When** it is shown, **Then** "// DEALS REFERRED" lists the deals they referred (title, pipeline and stage, value, status Open, Won or Lost, owner), open deals first then by most recently changed, each linking to the deal page.
4. **Given** the ambassador page, **When** it is shown, **Then** "// LATEST UPDATES" lists the newest 20 notes and changes on the ambassador's own timeline and on the timelines of the people and deals they referred, newest first, under one heading per day ("// TODAY · <date>", "// <date>"), each with a tag (NOTE, CHANGE, PERSON for an entry from a referred person, DEAL for an entry from a referred deal) and its time; each entry from a referred record shows that record's name as a link to its page, and no entry is listed twice.
5. **Given** latest updates of more than 20 entries, **When** the user presses `[ SHOW MORE ]`, **Then** the next 20 are added in order without repeating or skipping any.
6. **Given** an ambassador with no referrals and no notes, **When** the page is shown, **Then** the summary shows zeros and £0, the lists say "No people referred yet." and "No deals referred yet.", and latest updates shows only what exists on the ambassador's own timeline.
7. **Given** a person who is not and never was an ambassador and has no referrals, **When** a user opens their ambassador page address directly, **Then** "This ambassador doesn't exist or you can't see them." is shown; a former ambassador with referrals still has their page, marked "No longer an ambassador".

---

### User Story 4 - Private records stay private (Priority: P1)

The existing private rules apply everywhere ambassadors appear: a private ambassador, a private referred person and a private referred deal are only seen, counted and offered for the people allowed to see them.

**Why this priority**: The team decision is that a private contact or deal is hidden from everyone but those allowed, admins included; totals and lists on the ambassador page must not leak them.

**Independent Test**: As Ada Fake, make a deal referred by an ambassador private; as Bob Fake (an admin), open the ambassador page and the Ambassadors page and confirm the deal is not listed, not counted in any number or total, and none of its notes appear in latest updates.

**Acceptance Scenarios**:

1. **Given** a private referred person or deal, **When** someone it is hidden from opens the ambassador page or the Ambassadors page, **Then** it is not listed, not counted in any count or total, and none of its timeline entries appear in latest updates; the summary strip and the Ambassadors page row show the same numbers and totals as if the record did not exist.
2. **Given** a private ambassador, **When** someone they are hidden from opens the Ambassadors page or a "Referred by" picker, **Then** the ambassador is not listed or offered, and their ambassador page shows "This ambassador doesn't exist or you can't see them."
3. **Given** a shared person or deal referred by a private ambassador, **When** someone the ambassador is hidden from opens it, **Then** "Referred by" is shown as "Referred by a private person" with no name or link; when they edit and save it without touching "Referred by", the referrer is kept.
4. **Given** a private ambassador or private referred records handed over with a deactivated user's private records (SF-92, SF-97), **When** the new owner opens the ambassador page, **Then** the new owner can open the private ambassador's page, and sees the private referred records listed and counted in the summary strip.

---

### User Story 5 - Find people and deals by ambassador (Priority: P2)

On the People list and the Deals list, a team member filters by "Referred by" to see everything one ambassador brought in, together with the other filters.

**Why this priority**: Useful for follow-up and later for campaigns to an ambassador's introductions, but the ambassador page already shows the same records, so it comes second.

**Independent Test**: On the People list choose "Referred by: Ada Example" and confirm only the people Ada referred are listed, and the filter combines with the existing ones and is kept in the page address.

**Acceptance Scenarios**:

1. **Given** the People list or the Deals list, **When** the user picks an ambassador in the "Referred by" filter, **Then** only the records referred by that ambassador (that the user can see) are listed, combined with the other filters; the deal list's count and total follow the filter.
2. **Given** the "Referred by" filter, **When** its options are shown, **Then** they list the ambassadors the user can see, plus any former or archived ambassador who still referred a record the user can see.

---

### Edge Cases

- An admin deletes an ambassador: every person and deal they referred shows no "Referred by" line, and each one's timeline shows "Referred by cleared (a deleted person)"; if the ambassador was private when deleted, those timelines show no entry about it (as SF-92).
- A referred person or deal is deleted: the ambassador page no longer lists it, the summary strip numbers and totals go down by it, and none of its entries are under "// LATEST UPDATES".
- A referred person or deal is archived: the ambassador page still lists it with an "Archived" tag and still counts it; an archived open deal's value is in "Open", an archived won deal's in "Won".
- An ambassador who was themselves referred by another ambassador: their person page shows "Referred by <the other ambassador>", and the other ambassador's page lists them under "// PEOPLE REFERRED" but none of the people or deals they referred.
- An ambassador referred both a deal and that deal's main person: the person is listed once under "// PEOPLE REFERRED", the deal once under "// DEALS REFERRED", and "People referred" and "Deals referred" each count 1.
- A referred deal with no value is shown with "—" as value and adds £0 to "Open" or "Won"; a lost deal's value is in neither "Open" nor "Won" and adds 1 to "Lost".
- A referred deal marked Won then reopened: on the ambassador page its status shows "Open", its value is back in "Open" and no longer in "Won".
- Two ambassadors with the same name: the "Referred by" picker shows each with their organisation and first email address, so the two lines differ.
- An archived person or deal: its page shows no editable "Ambassador" tick or "Referred by" field (archived records cannot be edited, as today); a direct request to change them is refused with the existing archived-record message.
- A person with lead source "Ambassador" and no "Ambassador" tick: they are not on the Ambassadors page and not offered in the "Referred by" picker; choosing a referrer leaves the person's lead source as it was.
- An ambassador page with more than 50 people or 50 deals referred: each list shows the newest 50 (deals: open first) with `[ SHOW MORE ]`, which adds the next 50 without repeating or skipping any.
- A referred deal or person whose name contains markup such as "<b>Fake</b>": it is shown as plain text everywhere on the Ambassadors page and the ambassador page.

## Requirements *(mandatory)*

### Functional Requirements

**Ambassadors**

- **FR-001**: Any signed-in user who can edit a person MUST be able to mark them as an ambassador or unmark them; the change MUST be recorded on the person's timeline.
- **FR-002**: An "Ambassadors" link MUST be in the sidebar for every user, opening a list of the ambassadors the user can see with, for each: name, organisation, number of people referred, number of deals referred, open deals' total value, won deals' total value, latest referral date, and "Archived" when archived.
- **FR-003**: Ambassadors MUST remain people (DECISIONS: they never sign in); being an ambassador MUST NOT change any other rule about the person (privacy, owner, consent, archive, delete).

**Referrals**

- **FR-004**: People and deals MUST each have an optional "Referred by" naming at most one ambassador, settable on their add and edit forms, and shown on the person page, the deal page and the deal drawer with a link to the ambassador page.
- **FR-005**: Only active (not archived) ambassadors the user can see MUST be offered and accepted as a new referrer; a person MUST NOT be their own referrer; an unchanged existing referrer MUST be kept on save even if no longer offered.
- **FR-006**: Setting, changing or clearing "Referred by" MUST be recorded on the record's timeline with who and when.
- **FR-007**: The add deal form MUST pre-fill "Referred by" from the chosen main person's referrer, changeable before saving.

**Ambassador page**

- **FR-008**: Each ambassador (and each former ambassador who still has referrals) MUST have a page showing their contact details, a link to their person page, a summary (people referred, deals referred, open total, won total, lost count), the list of people referred, and the list of deals referred, as described in User Story 3.
- **FR-009**: The ambassador page MUST show "// LATEST UPDATES": the notes and changes of the ambassador and of the people and deals they referred, merged newest first, 20 at a time, each entry from a referred record naming and linking that record, never repeated.
- **FR-010**: Lists of people and deals referred MUST show 50 at a time with `[ SHOW MORE ]`.

**Lists**

- **FR-011**: The People list and the Deals list MUST offer a "Referred by" filter that combines with their existing filters and is kept in the page address.

**Access, privacy, messages, look**

- **FR-012**: Every page and action MUST require a signed-in, active user; nothing here is admin-only.
- **FR-013**: The private person rule (SF-92) and private deal rule (SF-93) MUST apply to ambassadors, referrals, the Ambassadors page, the ambassador page (lists, counts, totals, latest updates), pickers and filters: nothing hidden from a user may be shown, counted or offered to them, enforced on every request.
- **FR-014**: Deleting an ambassador MUST clear "Referred by" on what they referred, following the SF-92 rule for events about deleted (and deleted private) people.
- **FR-015**: Every message shown MUST be one of the app's fixed messages; text from the page address MUST never be shown.
- **FR-016**: The ambassador page MUST follow design B in `design-options.html`: one column with header and `[ PERSON PAGE ]`, a summary strip like the deal page's, "// PEOPLE REFERRED" and "// DEALS REFERRED" tables, and "// LATEST UPDATES" in the day-grouped timeline look (SF-102). The Ambassadors page MUST follow the People list (design C table) and `docs/DESIGN.md`; the "Ambassadors" link sits in the sidebar after "Organisations".

**Fake data**

- **FR-017**: The fake data command MUST add, without duplicates when run again, a few clearly fake ambassadors with referred people and deals (open, won and lost), at least one private ambassador, one private referred deal, one former ambassador with referrals, and notes on referred records.

### Key Entities

- **Ambassador**: a person in the CRM marked as an ambassador; can be chosen as a referrer; has an ambassador page.
- **Referral**: the "Referred by" link from one person or one deal to the ambassador who brought it in; at most one per record.
- **Ambassador summary**: counts and totals derived from the referrals a given user can see (people, deals, open value, won value, lost count).
- **Timeline entry** (from SF-90/SF-93/SF-102): notes and changes; the ambassador page reads those of the ambassador and their referrals.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can set who referred a person or deal in under 15 seconds while editing it.
- **SC-002**: From the sidebar, a user reaches any ambassador's page in two clicks and sees what they brought in without opening any other page.
- **SC-003**: An ambassador page with 200 referred records and 1,000 timeline entries shows its first screen in under 2 seconds.
- **SC-004**: In automated tests, every count and total on the Ambassadors page and the ambassador page equals the records the viewing user can see, for shared, private, archived, won, lost and reopened records.
- **SC-005**: In automated tests, a private ambassador or private referred record never appears, counts or is offered for anyone the privacy rules hide it from, on any page, list, picker, filter or direct request.
- **SC-006**: 100% of direct requests setting a referrer who is not an active, visible ambassador, or a person as their own referrer, are refused in automated tests.

## Assumptions

- "Ambassador" is a yes/no mark on a person rather than a label, lead source or pipeline, so the list of ambassadors is explicit and does not depend on lists admins can rename; the existing "Ambassadors" pipeline (deals about recruiting ambassadors) and "Ambassador" lead source are left as they are and are not linked to this mark.
- Organisations do not have a "Referred by"; PRODUCT asks for contacts and deals only.
- One referrer per person or deal; no split credit, commission or reward tracking.
- "What they've brought in" means the people and deals referred, with deal values in GBP (DECISIONS: GBP only); "latest updates" means the newest notes and changes on the ambassador and on those referrals. Emails and activities join the timeline, and so latest updates, when later issues add them.
- Ambassadors never sign in or see their page (DECISIONS); sharing pages with ambassadors (account map) is a later, nice-to-have feature.
- Setting "Referred by" through the CSV import and the Pipedrive import is not part of this issue.
- Anyone who can edit a person or deal can set its referrer and mark ambassadors, as for other person fields; it is not admin-only.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
