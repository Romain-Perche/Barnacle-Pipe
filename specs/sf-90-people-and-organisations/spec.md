# Feature Specification: People and organisations

**Feature Branch**: `factory/sf-90-people-and-organisations`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "People and organisations with their pages and lists (`docs/PRODUCT.md` section 2). Leave custom fields, imports and ambassador tracking for later issues."

## Clarifications

### Session 2026-11-19

- Q: Which design do you want for the People list and the person page? → A: Design: C, a filter row above the table, a preview drawer when a row is selected, and a one-column record page (details, then timeline) (see `design-options.html`).
- Q: What email consent does a new person get when someone adds them by hand? → A: Subscribed: campaigns can reach them until they unsubscribe.
- Q: Who can add, rename and remove lead sources and labels? → A: Admins only, on an admin page; everyone picks from the lists.
- Q: When an admin deletes a person, is anything about them kept (their timeline, an organisation's "linked/unlinked" events naming them)? → A: No: the person, their email addresses, phone numbers, labels, timeline and every organisation event about them are removed for good. (decided by the factory, to confirm)
- Q: Can other users see an organisation's timeline events about a private person ("Ada Example linked by …")? → A: No: those events are shown only to the private person's creator, like the person. (decided by the factory, to confirm)
- Q: Does being chosen as owner of a private person let that user see them? → A: No: only the creator sees a private person, whoever the owner is. (decided by the factory, to confirm)
- Q: Do an organisation's people list and its "number of people" include archived people? → A: No: only people who are not archived and that the viewer can see. (decided by the factory, to confirm)
- Q: When adding a person, are archived organisations offered in the organisation picker? → A: No; typing the exact name of an archived organisation and choosing to add it shows "<name> already exists." with a link to it, and nothing is saved. (decided by the factory, to confirm)
- Q: An admin adds a lead source or label with the name of one they removed earlier: new entry or the old one back? → A: The removed entry comes back (same entry, so people who kept it count as having it). (decided by the factory, to confirm)
- Q: Do website and LinkedIn links open in a new tab? → A: Yes, in a new tab, without passing the CRM's address to the other site. (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a person and find them again (Priority: P1)

A team member meets someone (for example at an exec dinner), opens People from the sidebar, presses `[ ADD PERSON ]` and fills in what they know: first and last name, one or more email addresses and phone numbers, role or job title, lead source, LinkedIn profile link, labels and email consent. They become the owner unless they pick someone else. After saving they land on the person's page. Later, anyone on the team opens the People list, types part of the name, an email address or the organisation name in the search field, and opens the person's page.

**Why this priority**: People are the core of the CRM: deals, email, campaigns, notes and activities all hang off them. Adding and finding people is the minimum useful slice.

**Independent Test**: Sign in, add a person with two email addresses and one phone number, then find them from the People list by searching for their second email address and open their page.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they add a person with first name "Ada", last name "Example", email addresses `ada@example.com` and `ada.home@example.net`, phone `+44 20 7946 0000`, role "COO", lead source "Referral", **Then** the person's page shows all those values, the owner is the user who added them, consent shows "Subscribed", "Date added" shows today's date (for example "19 Nov 2026") and "Last contacted" shows "Never".
2. **Given** a person saved with several email addresses, **When** any user searches the People list for any one of them (or part of the name, or the organisation name), **Then** the person appears in the results.
3. **Given** a signed-in user editing a person, **When** they change the role, add a phone number, remove an email address and save, **Then** the page shows the new values and the person's timeline shows, at the top, "Edited by <user's name>: Role, Email addresses, Phone numbers" with the date and time.
4. **Given** a user adding a person, **When** they leave both first and last name empty, or type an email address or LinkedIn link that is not valid, **Then** the form shows a message next to the field ("Enter a first or last name.", "Enter a valid email address.", "Enter a LinkedIn profile link (linkedin.com/…).") and nothing is saved.
5. **Given** a person already in the CRM with `ada@example.com`, **When** any user adds or edits another person with `ADA@example.com`, **Then** the form shows "Ada Example already has this email address." with a link to that person's page, and nothing is saved (duplicate detection).

---

### User Story 2 - Organisations and the people who work there (Priority: P1)

A team member adds an organisation (name, website, sector, size, location, owner) from the Organisations list, or types a new organisation name while adding a person. The organisation's page shows its details, everyone linked to it, and its timeline. From a person's page they can open the organisation and back.

**Why this priority**: Barnacle sells to companies; deals, campaigns (filter by organisation) and the account map all need organisations linked to people. It is as fundamental as people.

**Independent Test**: Add an organisation, add two people linked to it, open the organisation's page and confirm both people are listed with their roles; open the Organisations list and find it by name.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they add an organisation "Fakeco Ltd" with website `fakeco.example`, sector "Fitness", size "201–1,000", location "London", **Then** its page shows those values with the website as a link to `https://fakeco.example`, owner the user who added it, and an empty people list ("No people yet.").
2. **Given** an organisation "Fakeco Ltd", **When** a user adds or edits a person and picks "Fakeco Ltd" as their organisation, **Then** the person's page links to the organisation and the organisation's page lists the person with their role.
3. **Given** a user adding a person, **When** they type an organisation name that does not exist yet and choose "Add organisation 'New Org'", **Then** the person is saved linked to a new organisation "New Org" owned by that user.
4. **Given** an organisation "Fakeco Ltd" already exists, **When** a user adds another organisation called " fakeco ltd ", **Then** the form shows "Fakeco Ltd already exists." with a link to it, and nothing is saved.
5. **Given** a person linked to an organisation, **When** a user clears the person's organisation and saves, **Then** the person shows no organisation and the organisation's page no longer lists them.

---

### User Story 3 - Browse, sort and filter the lists (Priority: P2)

A team member opens the People list to see everyone, sorted and filtered: by owner, label, lead source, organisation or consent status, and sorted by name, organisation, date added or last contacted. The Organisations list works the same way with its own columns and filters. Archived records are hidden unless asked for.

**Why this priority**: With hundreds of contacts (the team is moving over from Pipedrive), lists with filters are how people work day to day, but the CRM is already usable with search alone.

**Independent Test**: With the fake data loaded, filter the People list to lead source "Exec dinner" and owner "Ada Fake", sort by date added, and confirm only matching people appear in the right order; then do the same for organisations by sector.

**Acceptance Scenarios**:

1. **Given** the People list, **When** a user opens it, **Then** a search field and a row of filters sit above the table, and each person is one row showing name (with their main email address beneath), organisation, role, owner, labels, lead source, consent and last contacted, sorted by name A–Z, 50 rows per page, with the total count shown ("// 132 PEOPLE").
2. **Given** the People list, **When** a user picks filters (owner, label, lead source, organisation, consent status) and a sort column, **Then** only matching people are shown in that order, the count updates, and copying the page address into a new tab shows the same filtered, sorted list.
3. **Given** filters that match nobody, **When** the list is shown, **Then** it reads "No people match these filters." with a `[ CLEAR FILTERS ]` link.
4. **Given** the Organisations list, **When** a user opens it, **Then** each organisation is one row showing name, website, sector, size, location, owner and number of people, with filters for owner, sector and size and sorting by name, number of people and date added.
5. **Given** archived people and organisations, **When** a user ticks "Show archived", **Then** archived records appear marked "Archived"; when unticked they are hidden from the list and from search.
6. **Given** the People list, **When** a user selects a row (anywhere except the name link), **Then** the row is highlighted and a preview drawer opens on the right showing the person's name, organisation and role, main email address, main phone number, lead source and consent, with `[ OPEN PAGE ]`; the list keeps its filters, and pressing `[ OPEN PAGE ]` or the name link opens the person's page.
7. **Given** the Organisations list, **When** a user selects a row, **Then** a preview drawer shows the organisation's name, website, sector, size, location, owner and number of people, with `[ OPEN PAGE ]`.
8. **Given** a preview drawer is open, **When** the user presses `[ CLOSE ]`, **Then** the drawer closes and the same list page, filters and sort order are shown; the open drawer is part of the page address, so reloading shows it again.

---

### User Story 4 - Archive, restore and delete (Priority: P2)

Any team member can archive a person or organisation that is no longer relevant and restore it later. Only an admin can delete one for good, after confirming.

**Why this priority**: Keeps lists clean without losing history; follows the team decision that anyone archives and only admins delete (DECISIONS).

**Independent Test**: As a user, archive a person and confirm they disappear from the list but their page still opens with "Archived" and `[ RESTORE ]`; as an admin, delete them and confirm the page shows "Page not found.".

**Acceptance Scenarios**:

1. **Given** a signed-in user on a person's or organisation's page, **When** they press `[ ARCHIVE ]`, **Then** the page shows an "Archived" badge and `[ RESTORE ]`, the record no longer appears in its list or search (unless "Show archived" is ticked), and the timeline shows "Archived by <name>".
2. **Given** an archived record, **When** a user presses `[ RESTORE ]`, **Then** it appears in its list and search again and the timeline shows "Restored by <name>".
3. **Given** a signed-in admin, **When** they press `[ DELETE ]` on a person and confirm "Delete Ada Example for good? This can't be undone.", **Then** the People list shows "Ada Example was deleted." and opening the old page address shows "Page not found.".
4. **Given** an admin deletes an organisation with people linked to it, **When** they confirm, **Then** the organisation is gone and those people remain with no organisation.
5. **Given** a signed-in user who is not an admin, **When** they look at a record's page, **Then** there is no `[ DELETE ]` button, and a direct delete request shows "You don't have access to this page." and deletes nothing.
6. **Given** an archived organisation, **When** a user opens a person linked to it, **Then** the person's page still shows the organisation, marked "Archived".

---

### User Story 5 - Private people (Priority: P2)

The person who added a contact can mark them private. A private person, and everything about them, is visible only to that creator: no other user sees them in lists, search, organisation pages or by opening their page address — admins included.

**Why this priority**: Required by PRODUCT §3 and DECISIONS for personal or sensitive contacts; it must exist from the start so private contacts never leak once email and notes attach to them.

**Independent Test**: As user A, add a person and mark them private; as user B and as an admin, confirm the person is absent from the list, search and their organisation's page, and that their page address shows "Page not found."

**Acceptance Scenarios**:

1. **Given** user A created a person, **When** A ticks "Private" and saves, **Then** A's page for the person shows a "Private" badge and the person stays in A's lists and search.
2. **Given** a person marked private by A, **When** any other user (admins included) opens the People list, searches, opens the linked organisation's page or opens the person's page address, **Then** the person does not appear and the page address shows "Page not found."; the organisation's people count excludes them.
3. **Given** a person created by A, **When** any other user edits that person, **Then** the "Private" option is not offered to them.
4. **Given** a private person with `secret@example.com`, **When** another user adds a person with `secret@example.com`, **Then** the form shows "Another person already has this email address." without naming or linking the private person, and nothing is saved.

---

### User Story 6 - Admins keep the lead source and label lists (Priority: P3)

An admin opens "Lead sources and labels" in the "// Admin" group and adds, renames or removes lead sources (starting with Duncan's LinkedIn, Referral, Exec dinner, Inbound, Event, Ambassador) and labels. Everyone then picks from these lists on people.

**Why this priority**: The lists come pre-filled, so the CRM works without this page; it lets the team adapt over time.

**Independent Test**: As an admin, rename "Event" to "Events", add the label "Hot", remove "Inbound"; as a user, confirm people already set to "Event" now show "Events", "Hot" can be picked, and "Inbound" is no longer offered but people already set to it still show it.

**Acceptance Scenarios**:

1. **Given** a fresh CRM, **When** an admin opens "Lead sources and labels", **Then** the lead sources Duncan's LinkedIn, Referral, Exec dinner, Inbound, Event and Ambassador are listed, and the label list is empty with an add field.
2. **Given** an admin, **When** they rename a lead source or label, **Then** every person who had it shows the new name.
3. **Given** an admin, **When** they remove a lead source or label that people use, **Then** it is no longer offered when adding or editing people, people who had it keep showing it, and the list filters still offer it while anyone has it.
4. **Given** an admin, **When** they add a name that already exists (ignoring case and surrounding spaces), **Then** "This name is already on the list." is shown and nothing is added.
5. **Given** a user who is not an admin, **When** they open the page address directly or send a change, **Then** "You don't have access to this page." is shown and nothing changes; their sidebar has no link to it.

---

### Edge Cases

- A person is saved with the same email address twice on their own record (`a@x.com` and `A@x.com `): the form shows "This email address is listed twice." and nothing is saved.
- A person saved with the email address ` Ada@Example.COM ` shows `ada@example.com` on their page. A phone number shows as typed, without surrounding spaces; a phone number with anything other than digits, spaces, `+`, `(`, `)`, `-` and `.` shows "Enter a valid phone number." and nothing is saved.
- A website typed as `fakeco.example` is saved as `https://fakeco.example`; `not a site` shows "Enter a valid website address." and nothing is saved. A LinkedIn link typed as `linkedin.com/in/ada-example` shows as `https://linkedin.com/in/ada-example`; `https://example.com/ada` shows "Enter a LinkedIn profile link (linkedin.com/…)." and nothing is saved.
- A website or LinkedIn link typed as `javascript:alert(1)` (or any address not starting with http or https) shows the same message as above and nothing is saved.
- A person's owner is deactivated: the person keeps that owner, shown with "(deactivated)"; deactivated users are not offered when choosing a new owner.
- Two users edit the same person at the same time: the second save shows "Someone else changed this person while you were editing. Reload to see their changes." and does not overwrite the first: after reloading, the page shows the first user's values.
- The search field gets text with `%`, `_` or quotes: searching `50%` lists only people whose name, email address or organisation contains `50%`, and an unmatched search shows "No people match these filters.".
- A search that matches more than 50 people shows 50 rows, the total count of matches and a link to the next page.
- A list address with a page number beyond the last page shows the last page's rows, and the page number shown is the last one.
- Adding a person with the email address of an archived person shows "Ada Example already has this email address." with a link to the archived person's page, which shows "Archived" and `[ RESTORE ]`; nothing is saved.
- After an admin deletes a person, adding a new person with that person's email address saves and opens the new person's page.
- A private person whose creator is later deactivated stays private: an admin's People list and search do not show them, and their page address shows "Page not found." (DECISIONS).
- Someone opens a person or organisation address that does not exist or is not a number: the page shows "Page not found." inside the normal sidebar layout.
- The Organisations list address `/organisations?sector=Your account is locked, call 0800 000` shows every organisation, the Sector filter shows "Any sector", and the text "Your account is locked" appears nowhere on the page (unknown sector values are ignored, like other unknown filter values).
- In the person form, a user types "Brand New Org" in the organisation field without choosing anything from the list and presses `[ SAVE ]`: the person is saved linked to a new organisation "Brand New Org". Before saving, the field shows "A new organisation "Brand New Org" will be added.".
- Editing a person linked to "Sample Studios Fake", a user replaces the organisation text with "Fake" and presses `[ SAVE ]` without choosing from the list: the person is saved linked to a new organisation "Fake"; the person is never silently left with no organisation. Clearing the field with `[ CLEAR ]` and saving leaves the person with no organisation.
- In the organisation field, a user types "Sample" (which only partly matches "Sample Studios Fake") and presses Enter: the field keeps "Sample" and shows that a new organisation "Sample" will be added; it does not switch to "Sample Studios Fake". Typing "sample studios fake" and pressing Enter chooses the existing "Sample Studios Fake".
- In the person form, a user types "  sample studios fake  " (other case, spaces around it) in the organisation field without choosing from the list and presses `[ SAVE ]`: the person is linked to the existing "Sample Studios Fake", no "will be added" hint shows, and the Organisations list still has exactly one "Sample Studios Fake". Typing the name of an archived organisation in another case and saving shows "<name> already exists." with a link to it, and nothing is saved.
- After "Ada Example was deleted." shows on the People list, reloading the page no longer shows it.
- An admin renames a lead source or label to the name of one removed earlier: the form shows "A removed entry already has this name. Add it again to bring it back." and nothing is saved.
- The person form has no "Last contacted" or "Date added" field; the person's page shows "Last contacted: Never" until later features (email, activities) fill it in.

## Requirements *(mandatory)*

### Functional Requirements

**People**

- **FR-001**: Signed-in users MUST be able to add, view and edit people. A person has: first name, last name (at least one required), any number of email addresses, any number of phone numbers, at most one organisation, role or job title, lead source (one, from the lead source list, optional), LinkedIn profile link, owner (an active user; defaults to whoever adds the person), labels (any number, from the label list), email consent (Subscribed or Unsubscribed; defaults to Subscribed), date added and last contacted.
- **FR-002**: Each email address and phone number MUST have a kind (Work, Personal or Other, default Work). The first one listed is the person's main one and is shown in lists; users can change the order.
- **FR-003**: Date added MUST be set automatically when the person is created and MUST NOT be editable. Last contacted MUST NOT be editable by users; it shows "Never" until later features record contact.
- **FR-004**: Email addresses MUST be validated, trimmed, compared without regard to letter case, and unique across all people, archived and private ones included (duplicate detection). Saving a person with an address another person already has MUST be refused with a message that names and links that person, unless the user cannot see them, in which case the message names nobody.
- **FR-005**: LinkedIn links MUST be http(s) addresses on linkedin.com; website addresses MUST be http(s) addresses. Typed addresses without a scheme get `https://` added. Other schemes MUST be refused.
- **FR-006**: Changes to consent status MUST be recorded on the person's timeline with who changed it and when, like any other edit.

**Organisations**

- **FR-007**: Signed-in users MUST be able to add, view and edit organisations. An organisation has: name (required, unique ignoring case and surrounding spaces, archived organisations included), website, sector (free text), size (one of 1–10, 11–50, 51–200, 201–1,000, 1,000+, or not set), location (free text), owner (an active user; defaults to whoever adds it) and date added.
- **FR-008**: When adding or editing a person, users MUST be able to pick an existing organisation by typing part of its name, or create a new one by name in the same step. Text typed but not chosen from the list is saved as shown: it links the non-archived organisation with that name (ignoring case and spaces at the start or end), else adds a new organisation with that name; an empty field means no organisation.
- **FR-009**: An organisation's page MUST list the people linked to it that the viewer can see, with each person's name, role and main email address, linking to their pages.

**Pages and timeline**

- **FR-010**: Each person and organisation MUST have its own page showing all its fields, its owner, its archived/private status and its timeline.
- **FR-011**: The timeline MUST list, newest first, every event on the record with the user who did it and the date and time (UK time): added, edited (with the names of the fields that changed), archived, restored, and, for an organisation, people linked or unlinked. Later features (notes, emails, activities, files, deals) add their own events to this same timeline.

**Lists, search, sort and filter**

- **FR-012**: The People list MUST show the columns in US3 scenario 1, 50 rows per page, with a total count, search by any part of a name, any email address or the organisation name, filters for owner, label, lead source, organisation and consent status, and sorting by name, organisation, date added and last contacted (either direction).
- **FR-013**: The Organisations list MUST show name, website, sector, size, location, owner and number of people, 50 rows per page, with a total count, search by name or website, filters for owner, sector and size, and sorting by name, number of people and date added.
- **FR-014**: Search, filters, sort order, page, "Show archived" and the open preview drawer MUST be kept in the page address, so a list view can be reloaded, bookmarked or shared.
- **FR-015**: Lists and search MUST hide archived records unless "Show archived" is ticked, and MUST always hide private people from everyone but their creator.

**Archive and delete**

- **FR-016**: Any signed-in user MUST be able to archive and restore any person or organisation they can see.
- **FR-017**: Only admins MUST be able to delete a person or organisation for good, after a confirmation; the app MUST enforce this on every request, not only by hiding the button. Deleting an organisation leaves its people with no organisation.

**Private people**

- **FR-018**: The user who created a person MUST be able to mark them private or not private; nobody else may change it.
- **FR-019**: A private person MUST be invisible to everyone except their creator, admins included: not in lists, search results, counts, organisation pages, filters or by direct page address ("Page not found."), and no edit, archive or delete request from anyone else may change them.

**Lead sources and labels**

- **FR-020**: Admins MUST be able to add, rename and remove lead sources and labels on a "Lead sources and labels" page in the "// Admin" group. Names MUST be trimmed and unique within their list, ignoring case.
- **FR-021**: The lead source list MUST start with: Duncan's LinkedIn, Referral, Exec dinner, Inbound, Event, Ambassador.
- **FR-022**: Renaming MUST change the name everywhere it is used. Removing MUST stop it being offered for new choices while people who have it keep it; filters MUST offer every value still in use.

**Access, navigation and messages**

- **FR-023**: Every people and organisation page and action MUST require a signed-in, active user; the lead source and label page and its actions MUST require an admin.
- **FR-024**: The sidebar's main navigation MUST gain "People" and "Organisations" entries; the "// Admin" group MUST gain "Lead sources and labels".
- **FR-025**: Every message shown to users MUST be one of the app's fixed messages; text from the page address (search terms aside, shown back only inside the search field) MUST never be shown as a message.
- **FR-026**: Lists, forms and pages MUST follow `docs/DESIGN.md`, the existing signed-in layout and design C in `design-options.html`: on both lists, a search field and a row of filters above a table in the Users page style, and selecting a row opens a preview drawer on the right with `[ OPEN PAGE ]` and `[ CLOSE ]`; a person's or organisation's page is one column: the header (name, "Archived"/"Private" badges, `[ EDIT ]`, `[ ARCHIVE ]` or `[ RESTORE ]`, and `[ DELETE ]` for admins), then "// DETAILS" with the fields in two columns, then (organisations only) "// PEOPLE", then "// TIMELINE".

**Fake data**

- **FR-027**: The fake data command MUST add, without creating duplicates when run again, at least 30 fake people and 8 fake organisations with clearly fake names and `example.com`/`example.net`-style addresses, covering every lead source, several labels, both consent statuses, several owners, people with no organisation, at least one archived person and organisation, and at least one private person.
- **FR-028**: A private person MUST NOT be shown in a preview drawer to anyone but their creator; a page address asking for one shows the list without a drawer.

### Key Entities

- **Person**: A contact. Names, email addresses and phone numbers (each with a kind and an order), optional organisation, role, lead source, LinkedIn link, owner (user), labels, consent status, private flag and creator, archived flag, date added, last contacted.
- **Organisation**: A company or body. Name (unique), website, sector, size band, location, owner (user), archived flag, date added; has many people.
- **Lead source**: An admin-kept list entry (name, still offered or removed); a person has at most one.
- **Label**: An admin-kept list entry (name, still offered or removed); a person has any number.
- **Timeline event**: Something that happened to a person or organisation: what, who, when, and for edits the fields that changed. Later features add more kinds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a person with name, email, organisation and lead source in under 1 minute.
- **SC-002**: A user can find any visible person by name, email address or organisation from the People list in under 10 seconds, with 2,000 people in the CRM.
- **SC-003**: People and Organisations lists, with any combination of filters and sorting, show their first page in under 2 seconds with 2,000 people and 500 organisations.
- **SC-004**: 100% of attempts to save a second person with an email address already in the CRM are refused in automated tests, whatever the letter case, spacing, archived or private status.
- **SC-005**: In automated tests, a private person never appears to any user other than their creator (admins included) on any list, search, organisation page, count or direct address.
- **SC-006**: 100% of delete requests and lead source/label changes from non-admins are refused in automated tests, including direct requests that bypass the page.
- **SC-007**: After loading fake data, every filter and sort option on both lists returns at least one result.

## Assumptions

- Custom fields, Pipedrive and CSV imports, and ambassador tracking (who referred a contact, ambassador pages) are out of scope (user request). The "Ambassador" lead source is only a list value here.
- Deals, notes, emails, activities and files do not exist yet; the timeline shows only record events until those features add theirs, and "Last contacted" stays "Never".
- People and organisations are shared across the team (PRODUCT §7): any user can view and edit any record they can see, whoever the owner is. Owner is a label of responsibility, not a permission.
- Only people can be private (DECISIONS: "a private contact or deal"); organisations are always shared.
- The team is responsible for only adding contacts it may email (UK B2B, with an opt-out in every campaign). Unsubscribing from campaign emails arrives with the mass email feature.
- Labels apply to people only (PRODUCT §2 lists labels for people, not organisations).
- A person belongs to at most one organisation, as in Pipedrive.
- Organisation names are unique, matching the decision that Pipedrive import links organisations by name.
- Duplicate detection refuses the save rather than offering a merge; merging people is left for a later issue.
- Dates are shown in UK time and format ("19 Nov 2026"), as on the Users page.
- Lists are for desktop browsers; a basic usable layout on smaller screens is enough.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
