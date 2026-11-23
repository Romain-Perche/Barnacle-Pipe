# Feature Specification: Ambassador tracking

**Feature Branch**: `factory/sf-114-step-9-ambassador-tracking`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "step 9 - Ambassador tracking. Ambassador tracking (`docs/PRODUCT.md` section 2): record which ambassador referred each person or deal, and give each ambassador a page with what they've brought in and their latest updates. Ambassadors are people in the CRM (`docs/DECISIONS.md`)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mark a person as an ambassador (Priority: P1)

A team member opens a person who refers business to Barnacle and marks them as an ambassador. From then on that person is listed on an "Ambassadors" page reached from the sidebar, and can be chosen as the ambassador who referred other people and deals. Ambassadors stay ordinary people in the CRM: they never sign in.

**Why this priority**: Nothing else in this feature works until the team can say who the ambassadors are; ambassador tracking is a "must have" (PRODUCT priorities).

**Independent Test**: With the fake data loaded, edit "Ada Example", tick "Ambassador" and save; confirm the person page shows "Ambassador", Ada is on the Ambassadors page, and Ada is offered when choosing "Referred by" on another person.

**Acceptance Scenarios**:

1. **Given** a person the user can see who is not archived, **When** they tick "Ambassador" on the person's form and save, **Then** the person page shows that the person is an ambassador with a link to their ambassador page, and the change is recorded on the person's timeline ("Made an ambassador" by the user).
2. **Given** the Ambassadors page, **When** it is shown, **Then** it lists every ambassador the user can see, by name, with their organisation, the number of people and of deals they referred, the total value of their open deals and of their won deals (GBP), and the date of their latest referral; each row opens the ambassador page.
3. **Given** no ambassador the user can see, **When** the Ambassadors page is shown, **Then** it says "No ambassadors yet. Tick Ambassador on a person to add one."
4. **Given** an ambassador, **When** a user unticks "Ambassador" and saves, **Then** the person leaves the Ambassadors page and is no longer offered as a referrer; people and deals they already referred keep them as "Referred by" and the change is recorded ("No longer an ambassador").
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

1. **Given** an ambassador the user can see, **When** their ambassador page is opened (from the Ambassadors page, a "Referred by" link or their person page), **Then** it shows their name, organisation, role, email addresses and phone numbers, owner, a link to their person page, and a summary: people referred, deals referred, open deals' total value, won deals' total value, and the number of lost deals.
2. **Given** the ambassador page, **When** it is shown, **Then** "// PEOPLE REFERRED" lists the people they referred (name, organisation, owner, date added), newest first, each linking to the person page.
3. **Given** the ambassador page, **When** it is shown, **Then** "// DEALS REFERRED" lists the deals they referred (title, pipeline and stage, value, status Open, Won or Lost, owner), open deals first then by most recently changed, each linking to the deal page.
4. **Given** the ambassador page, **When** it is shown, **Then** "// LATEST UPDATES" lists the newest 20 notes and changes on the ambassador's own timeline and on the timelines of the people and deals they referred, newest first, in the timeline look already used (day headings, tags, time); each entry from a referred record names that record with a link to it, and appears only once.
5. **Given** latest updates of more than 20 entries, **When** the user presses `[ SHOW MORE ]`, **Then** the next 20 are added in order without repeating or skipping any.
6. **Given** an ambassador with no referrals and no notes, **When** the page is shown, **Then** the summary shows zeros and £0, the lists say "No people referred yet." and "No deals referred yet.", and latest updates shows only what exists on the ambassador's own timeline.
7. **Given** a person who is not and never was an ambassador and has no referrals, **When** a user opens their ambassador page address directly, **Then** "This ambassador doesn't exist or you can't see them." is shown; a former ambassador with referrals still has their page, marked "No longer an ambassador".

---

### User Story 4 - Private records stay private (Priority: P1)

The existing private rules apply everywhere ambassadors appear: a private ambassador, a private referred person and a private referred deal are only seen, counted and offered for the people allowed to see them.

**Why this priority**: The team decision is that a private contact or deal is hidden from everyone but those allowed, admins included; totals and lists on the ambassador page must not leak them.

**Independent Test**: As Ada Fake, make a deal referred by an ambassador private; as Bob Fake (an admin), open the ambassador page and the Ambassadors page and confirm the deal is not listed, not counted in any number or total, and none of its notes appear in latest updates.

**Acceptance Scenarios**:

1. **Given** a private referred person or deal, **When** someone it is hidden from opens the ambassador page or the Ambassadors page, **Then** it is not listed, not counted in any count or total, and none of its timeline entries appear in latest updates; nothing gives away that it exists.
2. **Given** a private ambassador, **When** someone they are hidden from opens the Ambassadors page or a "Referred by" picker, **Then** the ambassador is not listed or offered, and their ambassador page shows "This ambassador doesn't exist or you can't see them."
3. **Given** a shared person or deal referred by a private ambassador, **When** someone the ambassador is hidden from opens it, **Then** "Referred by" is shown as "Referred by a private person" with no name or link; when they edit and save it without touching "Referred by", the referrer is kept.
4. **Given** a private ambassador or private referred records handed over with a deactivated user's private records (SF-92, SF-97), **When** the new owner opens the ambassador page, **Then** they see them as any owner would.

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

- An ambassador is deleted by an admin: every person and deal they referred keeps no referrer ("Referred by" empty), and their timelines record "Referred by cleared (a deleted person)"; if the ambassador was private when deleted, nothing about them is recorded (as SF-92).
- A referred person or deal is deleted: it leaves the ambassador's lists, counts, totals and latest updates.
- A referred person or deal is archived: it stays on the ambassador page, marked "Archived", still counted; an archived deal's value counts in the open or won total as its status says.
- An ambassador can themselves have been referred by another ambassador; the chain is not followed (each page shows only direct referrals).
- An ambassador referred a deal and its main person separately: each counts once in its own list; the deal is never counted as a person or the other way round.
- A deal with no value counts as £0 in totals; a lost deal's value is in neither total.
- Reopening a won or lost deal moves its value back to the open total.
- Two ambassadors with the same name are told apart in the picker by their organisation and email address.
- Merging duplicate people is not part of the app yet; nothing here depends on it.
- The person form's "Ambassador" tick and "Referred by" field are not shown on an archived record's page as editable (archived records cannot be edited, as today).
- A lead source "Ambassador" already exists; choosing a referrer does not change the person's lead source, and the lead source does not require a referrer.
- The ambassador page of someone with many referrals shows the newest 50 people and 50 deals with `[ SHOW MORE ]` for each list.

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
- **FR-016**: The Ambassadors page and the ambassador page MUST follow `docs/DESIGN.md` and the existing people pages (design C list, design B timeline for latest updates); the chosen design is recorded in this spec's clarifications.

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
