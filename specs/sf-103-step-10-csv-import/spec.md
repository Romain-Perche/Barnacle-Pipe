# Feature Specification: CSV import of people and organisations

**Feature Branch**: `factory/sf-103-step-10-csv-import`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Step 10 - CSV import. Import people and organisations from a CSV file (`docs/PRODUCT.md` section 2). Deals are not imported from CSV."

## User Scenarios & Testing *(mandatory)*

Builds on SF-90 (people and organisations, their fields, duplicate detection by email address, unique organisation names, lead source and label lists kept by admins) and SF-92 (private people are visible only to their creator and owner). Custom fields, ambassador tracking and the Pipedrive import do not exist yet and are not part of this step.

### User Story 1 - Import people from a spreadsheet (Priority: P1)

A team member has a list of contacts in a spreadsheet: for example, the guest list from an exec dinner or a list exported from another tool. They save it as a CSV file, open People and press `[ IMPORT CSV ]`. They choose the file, check how each column of the file matches a person field (the CRM suggests a match from the column headings), see a preview of what will happen, and press `[ IMPORT ]`. The people are added to the CRM, linked to their organisations (new organisations are added when needed), and the import ends with a report of what was added and what was not, and why.

**Why this priority**: This is the feature. Moving contacts from spreadsheets into the CRM by hand, one at a time, is the slowest part of getting started and of every event.

**Independent Test**: Import a fake CSV file of 20 people (with first name, last name, email, phone, organisation, role, lead source and labels columns), 2 of whom have an email address already in the CRM and 1 has an invalid email address; confirm 17 people are added with every value, their organisations are linked or added, and the report lists the 3 rows that were not imported with their reasons.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the People list, **When** they press `[ IMPORT CSV ]`, **Then** an import page opens for people, with a file field, a short note on what the file must look like ("A CSV file saved as UTF-8, with column headings on the first row, up to 5,000 rows.") and `[ DOWNLOAD EXAMPLE FILE ]`, which gives a CSV file with every person column heading and two clearly fake example rows.
2. **Given** a CSV file whose headings are `First name, Last name, Email, Phone, Organisation, Job title, Lead source, Labels`, **When** the user chooses it and presses `[ NEXT ]`, **Then** the page lists each column of the file with its heading, its first two values, and the person field it matches, already chosen ("Job title" matches "Role or job title"; headings are matched ignoring case, spaces and punctuation, and US spellings such as "Organization" match too); a column with no matching field is set to "Don't import".
3. **Given** the column list, **When** the user changes a column's field (or sets it to "Don't import") and presses `[ PREVIEW ]`, **Then** the page shows how many people will be added, how many new organisations will be added (with their names), how many rows will not be imported, each such row with its row number and reason, and the first 5 people as they will be saved.
4. **Given** the preview, **When** the user presses `[ IMPORT ]`, **Then** the people are added, the page shows the report ("17 people imported. 2 organisations added. 3 rows not imported.") with every row not imported (row number, name or email from the row, reason) and a link to the People list, and each imported person's page shows all the imported values and, on its timeline, "Imported from CSV by <user's name>" with the date and time.
5. **Given** a row whose organisation is "fakeco ltd" and an organisation "Fakeco Ltd" already in the CRM, **When** the file is imported, **Then** the person is linked to "Fakeco Ltd" and no new organisation is added; when the organisation name is not in the CRM, one new organisation with that name is added (once, however many rows name it, ignoring case and surrounding spaces), owned by the user who imports.
6. **Given** a row with an email address that a person already in the CRM has (ignoring case and spaces), **When** the file is imported, **Then** the row is not imported, the existing person is left as it is, and the report gives "Ada Example already has this email address." with a link to that person; if the existing person is private and the user cannot see them, the reason reads "Another person already has this email address." and names nobody.
7. **Given** a row that the person form would refuse (no first or last name, an invalid email address, phone number or LinkedIn link, an email address listed twice on the row, a value longer than the form allows), **When** the file is imported, **Then** that row is not imported and the report gives the same message as the form ("Enter a valid email address.", …); every other row is still imported.

---

### User Story 2 - Import organisations (Priority: P2)

A team member has a list of target companies (for example, a list of gym chains for an account-mapping effort). They open Organisations, press `[ IMPORT CSV ]` and go through the same steps with the organisation fields: name, website, sector, size, location and owner.

**Why this priority**: Organisations can already be added through a people import, so a separate organisation import matters less; it is still needed for lists of companies with no contact yet.

**Independent Test**: Import a fake CSV file of 10 organisations, one of whose names is already in the CRM in another case; confirm 9 are added with their website, sector, size and location, and the report lists the existing one as not imported.

**Acceptance Scenarios**:

1. **Given** a signed-in user on the Organisations list, **When** they press `[ IMPORT CSV ]`, **Then** the import page opens for organisations, with its own example file (every organisation column heading and two fake rows).
2. **Given** a file with `Name, Website, Sector, Size, Location`, **When** it is imported, **Then** each organisation's page shows the values, with the website saved like the form saves it (`fakeco.example` becomes `https://fakeco.example`), and its timeline shows "Imported from CSV by <user's name>".
3. **Given** a row whose name matches an organisation already in the CRM (ignoring case and surrounding spaces, archived ones included), **When** the file is imported, **Then** the row is not imported, the existing organisation is left as it is, and the report gives "Fakeco Ltd already exists." with a link to it.
4. **Given** a size value, **When** the file is imported, **Then** a value that is one of the CRM's size bands ("11–50", also written "11-50") is saved as that band, a whole number (for example "35" or "1,200") is saved as the band it falls in, and any other value leaves the size empty and the report lists it as a warning on that row ("Size not recognised: 'medium'"); the organisation is still imported.

---

### User Story 3 - Lists, owners and consent in an import (Priority: P2)

The file may carry each person's lead source, labels, owner and email consent. These are matched to what the CRM already has; nothing is added to the admin-kept lists by an import, and unsubscribed contacts stay unsubscribed.

**Why this priority**: Without these, imported people need editing one by one afterwards, and an unsubscribed contact could be emailed by a campaign.

**Independent Test**: Import a file whose rows use the lead source "referral" (in another case), the label "Hot" (on the list) and "Cold" (not on the list), the owner's email address of an active user, and a consent column with "Unsubscribed" on some rows and nothing on others; confirm the matched values are set, the unmatched ones are listed as warnings, and consent is as chosen.

**Acceptance Scenarios**:

1. **Given** a lead source or label value that matches an entry still offered on the list (ignoring case and surrounding spaces), **When** the file is imported, **Then** the person gets that entry; a labels cell may hold several labels separated by commas or semicolons.
2. **Given** a lead source or label value that is not on the list or was removed from it, **When** the file is imported, **Then** the person is imported without it and the report lists, once per value, "Lead source not on the list: 'Webinar' (rows 4, 9)" or "Label not on the list: 'Cold' (row 7)".
3. **Given** an owner column, **When** a value matches an active user's email address or full name (ignoring case), **Then** that user is the owner; when it matches nobody or a deactivated user, the user who imports becomes the owner and the report lists the value as a warning; without an owner column, the user who imports is the owner of everyone imported.
4. **Given** a consent column, **When** a row's value is "Unsubscribed" (or "unsubscribed", "no", "false", "opted out"), **Then** the person is Unsubscribed; "Subscribed" (or "yes", "true", "opted in") makes them Subscribed.
5. **Given** a people import, **When** the user reaches the preview, **Then** they must choose, with nothing chosen in advance, the consent of people whose row gives none: "Subscribed" or "Unsubscribed"; `[ IMPORT ]` is not possible until they choose, and the preview says how many people that choice applies to.

---

### Edge Cases

- A file that is not a CSV file (for example an Excel `.xlsx` file), is empty, has only a heading row, is larger than 5 MB or has more than 5,000 rows after the headings: the page shows a message saying what is wrong ("Save the file as CSV (UTF-8) and try again.", "The file has no rows to import.", "The file is larger than 5 MB.", "The file has more than 5,000 rows. Split it into smaller files.") and nothing is imported.
- A file that is not valid UTF-8 (for example saved by older Excel as "CSV" in a Windows encoding): "Save the file as CSV (UTF-8) and try again." and nothing is imported, so names such as "Zoë" and "£" are never imported garbled. A UTF-8 file starting with a byte order mark (as Excel saves it) is accepted and the mark is not part of the first heading.
- The same people saved once with commas, once with semicolons and once with tabs between values: each file shows the same headings and first values in the column list, and imports the same people. A value in double quotes holding a comma, a semicolon, a quote written twice (`""`) or a line break shows on the person's page as one value, with that comma, semicolon, single quote or line break.
- A row with more values than there are headings is not imported ("This row has more values than the file has headings."); a row with fewer values is read with the missing values empty; completely empty rows are skipped and not counted.
- A column with no heading is shown as "Column 3" (its position); two columns with the same heading are both listed.
- Two columns set to a field that takes only one value (for example two columns set to "Lead source"): `[ PREVIEW ]` shows "Only one column can be set to Lead source." and nothing moves on. Several columns may be set to email addresses, phone numbers or labels.
- A people file with no column set to a first name, last name or full name: `[ PREVIEW ]` shows "Choose the column with each person's name." An organisations file with no column set to name: "Choose the column with each organisation's name."
- A column set to "Full name" (when no first or last name column is set): "Ada May Example" is saved as first name "Ada", last name "May Example"; a single word is saved as the first name.
- An email or phone cell with several values separated by commas or semicolons: each becomes one of the person's email addresses or phone numbers, in that order, after any from earlier columns. Email and phone columns can be set as Work, Personal or Other (default Work); the first one found is the person's main one.
- Two rows in the same file with the same email address (ignoring case): the first is imported, the later one is not ("Row 4 has the same email address.").
- A row with no email address is always imported if otherwise valid, even when a person with the same name exists; the preview shows how many people have no email address ("12 people have no email address and cannot be checked for duplicates."), so importing the same file twice adds them twice.
- An organisation named on a person row matches an archived organisation: the person is linked to it and the report lists a warning ("Fakeco Ltd is archived.") on that row.
- An organisation name on a person row that would be refused by the organisation form (for example longer than allowed): the row is not imported, with that message.
- A role cell `=SUM(A1:A2)` or `@admin`: the person's page shows exactly `=SUM(A1:A2)` or `@admin` as the role.
- A value with spaces around it (`  COO  `): the person's page shows `COO`. A role longer than the form allows: the row is in the report as not imported, with the form's message.
- A file with `Date added` and `Last contacted` columns: the column list offers only "Don't import" for them; each imported person's page shows today's date as "Date added" and "Last contacted: Never".
- An imported person's page shows no "Private" badge, and another user sees them in the People list; the importing user can tick "Private" on them like on any person they created.
- The user leaves the page after `[ PREVIEW ]` without pressing `[ IMPORT ]`: the People list count is the same as before, and none of the file's people can be found by search.
- The user presses `[ IMPORT ]` twice quickly, or reloads the report page: the People list count goes up by the number in the report once, not twice, and searching for an imported email address finds one person.
- Another user adds a person with the same email address between the preview and `[ IMPORT ]`: that row is not imported and the report (not the preview) says so; the report always tells what really happened.
- The import fails part-way (for example the database stops answering): the page says "The import failed. Nothing was imported. Try again." and the People list count is the same as before.
- A row whose first name is `<a href="https://evil.example">Click</a>` and a lead source `Your account is locked`: the preview, the report and the person's page show that text exactly as typed, with no link, and "Your account is locked" appears only inside quotes in a warning ("Lead source not on the list: 'Your account is locked' (row 2)").
- A user who is not signed in, or is deactivated, opens the import page address: they see the sign-in page, as for every signed-in page; an import request sent without a session adds nobody to the People list.

## Requirements *(mandatory)*

### Functional Requirements

**Starting an import**

- **FR-001**: Every signed-in user MUST be able to import people from a CSV file, starting from `[ IMPORT CSV ]` on the People list, and organisations from a CSV file, starting from `[ IMPORT CSV ]` on the Organisations list. Deals MUST NOT be importable from CSV.
- **FR-002**: The import page MUST offer an example CSV file for its kind of record with every column heading the CRM recognises and two clearly fake rows.
- **FR-003**: The CRM MUST accept CSV files in UTF-8 (with or without a byte order mark), with headings on the first row, values separated by commas, semicolons or tabs (found automatically), double-quoted values as in the common CSV format, up to 5 MB and 5,000 rows; it MUST refuse anything else with a message saying what is wrong, and import nothing.

**Matching columns**

- **FR-004**: After a file is chosen, the CRM MUST list each column (heading, first two values) with the field it will fill, suggesting a match from the heading (ignoring case, spaces and punctuation; common alternatives such as "Organization", "Company", "Job title", "E-mail", "Mobile" included) and "Don't import" when nothing matches; the user MUST be able to change any column's field.
- **FR-005**: The fields a people column can fill are: first name, last name, full name, email address (Work, Personal or Other), phone number (Work, Personal or Other), organisation name, role or job title, lead source, labels, LinkedIn profile link, owner, email consent. The fields an organisation column can fill are: name, website, sector, size, location, owner. Email, phone and label fields MAY be set on several columns; every other field on at most one.

**Preview and import**

- **FR-006**: Before importing, the CRM MUST show a preview: how many records will be added, the new organisations that will be added, every row that will not be imported with its row number and reason, warnings, the number of people without an email address, and the first 5 records as they will be saved.
- **FR-007**: A people import MUST NOT start until the user has chosen the consent ("Subscribed" or "Unsubscribed", no default) for people whose row gives none. A consent value in the file MUST always be used for that row, and an unsubscribed value MUST never be imported as subscribed.
- **FR-008**: Each row MUST be checked by the same rules as the person or organisation form (required name, valid and trimmed email addresses, phone numbers, LinkedIn links and websites, lengths); a row that fails MUST NOT be imported and the report MUST give the form's message. Other rows MUST still be imported.
- **FR-009**: A person row MUST NOT be imported when any of its email addresses belongs to a person already in the CRM (archived and private people included) or to an earlier row in the file; the existing person MUST be left unchanged. The reason MUST name and link the existing person only if the importing user can see them.
- **FR-010**: An organisation row MUST NOT be imported when its name matches an organisation already in the CRM or an earlier row (ignoring case and surrounding spaces, archived ones included); the existing organisation MUST be left unchanged.
- **FR-011**: An organisation name on a person row MUST link the person to the organisation with that name (ignoring case and surrounding spaces, archived ones included, with a warning for archived ones), or else to one new organisation added for that name, owned by the importing user, shared by every row that names it.
- **FR-012**: Lead sources and labels MUST be matched to entries still offered on their lists, ignoring case and surrounding spaces; an import MUST NOT add, rename or bring back entries. Unmatched values MUST be left out of the person and listed as warnings with their rows.
- **FR-013**: Owners MUST be matched to active users by email address or full name, ignoring case; otherwise, and when no owner column is set, the importing user MUST be the owner.
- **FR-014**: Organisation sizes MUST be matched to the CRM's size bands (as written, with a plain hyphen, or as a whole number placed in its band); an unmatched size MUST leave the size empty with a warning.
- **FR-015**: Imported people MUST NOT be private. Date added MUST be the time of the import; last contacted MUST stay empty.
- **FR-016**: An import MUST either complete, adding every row that passes the checks, or, if it fails part-way, add nothing at all. The same uploaded file MUST NOT be imported twice by repeating or reloading the `[ IMPORT ]` request.
- **FR-017**: The CRM MUST NOT keep the uploaded file after the import is done or abandoned.

**Report and history**

- **FR-018**: After an import, the page MUST show a report: counts of records imported, organisations added and rows not imported; every row not imported with its row number, the name or email address from the row and the reason; and every warning. Values from the file MUST be shown only as data, never as links or as the CRM's own messages.
- **FR-019**: Each imported person and organisation MUST get the timeline event "Imported from CSV by <user's name>" with the date and time, in place of "Added by"; linking an imported person to an organisation MUST add the same organisation timeline event as linking by hand.

**Access and messages**

- **FR-020**: Every import page and action MUST require a signed-in, active user; nothing in the preview or report may reveal a private person the user cannot see.
- **FR-021**: Every message shown MUST be one of the app's fixed messages, with values from the file only quoted inside them.
- **FR-022**: The import pages MUST follow `docs/DESIGN.md` and the existing signed-in layout; the People and Organisations lists gain `[ IMPORT CSV ]` beside their add button. No sidebar entry is added.

### Key Entities

- **CSV import**: One run by one user for one kind of record (people or organisations): the column matches chosen, the consent chosen for rows without one, and its outcome (records added, organisations added, rows not imported with reasons, warnings). The uploaded file itself is not kept.
- **Column match**: A column of the file (position, heading) and the field it fills, or "Don't import".
- **Person, Organisation, Lead source, Label, Timeline event**: As in SF-90; a new timeline event kind records that a record was imported from CSV and by whom.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can import a 200-row people file with standard headings, from pressing `[ IMPORT CSV ]` to seeing the report, in under 2 minutes.
- **SC-002**: A 5,000-row file is previewed and imported, each in under 60 seconds, with 2,000 people already in the CRM.
- **SC-003**: In automated tests, 100% of rows whose email address is already in the CRM (any case, spacing, archived or private) are not imported, and the existing person is unchanged.
- **SC-004**: In automated tests, no imported person whose row says unsubscribed is ever saved as subscribed, and no person is given a consent the user did not choose or the file did not give.
- **SC-005**: In automated tests, every row the person or organisation form would refuse is refused by the import with the same message, and every row it would accept is imported with every value.
- **SC-006**: In automated tests, a failed import leaves no record from it behind, and a repeated `[ IMPORT ]` request adds nothing new.
- **SC-007**: In automated tests, no preview or report shows the name, email address or link of a private person the importing user cannot see.

## Assumptions

- Any signed-in user may import, as any user may import from Pipedrive (DECISIONS); imports are not limited to admins.
- A person or organisation already in the CRM is left as it is and the row is reported, as decided for the Pipedrive import (DECISIONS: a record that matches one already in the CRM is never copied); updating existing records from a CSV file is out of scope.
- The import never adds lead sources or labels, because only admins keep those lists (DECISIONS); unmatched values are reported so an admin can add them and the user can re-import or edit.
- Consent is chosen by the user for rows without one, rather than defaulting to Subscribed as for people added by hand, because an imported list may hold people who never agreed to hear from Barnacle (UK GDPR and PECR, PRODUCT §4).
- Custom fields, ambassador ("referred by") tracking, notes and deals are not imported: custom fields and ambassador tracking do not exist yet, and deals are excluded by the user request. Columns for them are set to "Don't import".
- Undoing an import as a whole is out of scope; imported records can be archived or deleted like any others. A history of past imports is out of scope; the report is shown once, at the end of the import.
- People without an email address cannot be checked for duplicates (duplicate detection is by email address, PRODUCT §2); the preview warns about them instead.
- 5,000 rows and 5 MB per file cover the team's lists (a few thousand contacts in total); larger lists are split into several files.
- Files are made with common spreadsheet tools (Excel, Google Sheets, Numbers) or exported from other CRMs; Excel's own file format is not read.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
