# Feature Specification: Custom fields

**Feature Branch**: `factory/sf-115-step-7-custom-fields`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "step 7 - Custom fields. Custom fields (`docs/PRODUCT.md` sections 2 and 7): admins add their own fields to people, organisations and deals, and rename, reorder and delete them. Field types: text, long text, number, money (GBP), date, single choice and multiple choice from a list the admin edits, and yes/no. Custom fields show on the record page and in its add and edit forms, can be shown as columns in the People, Organisations and Deals lists, and can filter those lists. Changes to them show on the timeline like other field changes. The CSV import can map a column to a custom field (SF-103 left this out because custom fields did not exist yet). A custom field's values follow the record's private rules. Deleting a field deletes its values, after a confirmation that says how many records have a value."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admins manage custom fields (Priority: P1)

An admin opens a "Custom fields" page in the "// Admin" group of the sidebar. It has one section per record kind (People, Organisations, Deals). In each section the admin adds a field by giving it a name and a type, renames it, moves it up or down, and deletes it. For single choice and multiple choice fields the admin edits the list of choices: add, rename, reorder and remove.

**Why this priority**: Nothing else in this feature works until a field exists; PRODUCT section 7 says admins manage custom fields.

**Independent Test**: As an admin, add the people field "Dietary needs" (single choice: None, Vegetarian, Vegan), rename it to "Diet", move it above another field, and confirm the new order and name show on a person's edit form. As a user who is not an admin, confirm the page is not in the sidebar and a direct visit or request is refused.

**Acceptance Scenarios**:

1. **Given** an admin on the Custom fields page, **When** they add a field with a name, a record kind and one of the eight types (Text, Long text, Number, Money (£), Date, Single choice, Multiple choice, Yes/No), **Then** the field is listed last in that kind's section with its type.
2. **Given** the add form, **When** the name is empty, longer than 60 characters, or the same as another custom field or built-in field of the same record kind (ignoring case and spaces at either end), **Then** the field is not added and the message says "Give the field a name.", "A field name can be at most 60 characters." or "There is already a field called <name>."
3. **Given** a Single choice or Multiple choice field being added, **When** it has no choices, **Then** it is not added and the message says "Add at least one choice."; two choices of one field cannot have the same name (ignoring case), and a choice name is at most 60 characters.
4. **Given** an existing field, **When** the admin renames it, **Then** the new name shows everywhere the field shows (forms, record pages, list columns, filters, import mapping); the name rules of scenario 2 apply.
5. **Given** a kind's fields, **When** the admin moves a field up or down, **Then** that order is used on the record page, the add and edit forms, the list columns and the filters.
6. **Given** a choice field, **When** the admin renames a choice, **Then** every record that has it shows the new name; **When** they reorder choices, **Then** forms and filters use the new order; **When** they remove a choice, **Then** it stays on the records that already have it and in the list filter, and is no longer offered on add and edit forms (as removed labels, SF-95).
7. **Given** a field, **When** the admin looks at it, **Then** its type is shown and cannot be changed; to change type the admin deletes the field and adds a new one.
8. **Given** a user who is not an admin, **When** they open the page or send any custom field change directly, **Then** they get the existing "admins only" page or refusal, and nothing changes.

---

### User Story 2 - Fill in and see custom fields on records (Priority: P1)

A team member adds or edits a person, organisation or deal and fills in its custom fields under the built-in ones. The record page shows the values in its details. Every change to a custom field is recorded on the record's timeline like other field changes.

**Why this priority**: This is why the fields exist: recording information the built-in fields do not cover.

**Independent Test**: With the people field "Diet" (single choice) and the deal field "Contract end" (date), edit a person and a deal, fill them in, and confirm the record pages show the values and each timeline shows the change with who and when.

**Acceptance Scenarios**:

1. **Given** custom fields for a record kind, **When** a user opens the add or edit form of such a record, **Then** each field is shown in the admin's order, after the built-in fields, with an input matching its type: one line of text; several lines; a number; a pound amount; a date picker; a choice list with an empty option; tick boxes for each choice; a Yes/No choice with an empty option. Every custom field is optional.
2. **Given** a form with custom values, **When** it is saved with a value that does not fit the type (text over 255 characters, long text over 10,000, a number that is not a number or has more than 4 decimal places or is beyond ±1,000,000,000,000, a money amount the deal value would refuse, a date that is not a real date, a choice that is not offered), **Then** nothing is saved, the form keeps what was typed, and the message names the field, e.g. "Birthday: enter a real date.", "Head count: enter a number.", "Notes: at most 10,000 characters."
3. **Given** a record with custom values, **When** its page is shown (and the deal drawer for deals), **Then** the details list each custom field with a value, in order, formatted like the app's other values: money as £ with pence only when not whole, dates as "24 Nov 2026", multiple choices joined by commas in choice order, Yes/No as "Yes" or "No", long text keeping its line breaks; fields with no value are shown with "—".
4. **Given** a custom value is set, changed or cleared on save, **When** the timeline is shown, **Then** it has a CHANGE entry per changed field — "<Field> set to <value>", "<Field> changed from <old> to <new>" or "<Field> cleared" — with who and when, in the same look as other field changes; a long text change says "<Field> changed" without the text.
5. **Given** a save that changes no custom value, **When** the timeline is shown, **Then** no custom field entry is added.
6. **Given** a removed choice on a record, **When** its edit form is opened and saved without touching that field, **Then** the value is kept; once the user unticks or changes it and saves, the edit form no longer offers that choice.
7. **Given** a record whose custom value names a field the admin renamed after the change, **When** its timeline is shown, **Then** the old entries keep the name the field had at the time of the change.

---

### User Story 3 - Custom fields in the People, Organisations and Deals lists (Priority: P2)

An admin marks a custom field "Show in list". It then appears as a column in its kind's list (People, Organisations or Deals) and as a filter in that list's filter row, combined with the other filters and kept in the page address.

**Why this priority**: Finding and comparing records by their custom values is the next most useful thing after storing them; campaigns (PRODUCT section 4) will later filter by custom fields too.

**Independent Test**: Mark "Diet" "Show in list"; confirm the People list has a "Diet" column and a "Diet" filter, and choosing "Vegan" lists only vegan people, combined with "Owner".

**Acceptance Scenarios**:

1. **Given** a custom field marked "Show in list", **When** its kind's list is shown, **Then** it has a column for the field after the built-in columns, in the admin's order, showing the value formatted as on the record page (long text cut to its first 80 characters with "…"), "—" when empty; fields not marked do not appear.
2. **Given** a column for a custom field, **When** the user sorts by it (Text, Number, Money, Date, Single choice, Yes/No), **Then** the list is ordered by that value, empty values last in both directions; Long text and Multiple choice columns are not sortable.
3. **Given** a filter for a custom field, **When** the user sets it, **Then** only matching records are listed: Text and Long text — contains the typed words (ignoring case); Number and Money — from and/or to (inclusive); Date — from and/or to (inclusive); Single choice — one choice, or "Empty"; Multiple choice — has the chosen choice; Yes/No — Yes, No or Empty. The deal list's count and total follow the filter.
4. **Given** a list address with a filter or sort for a custom field that no longer exists, is no longer shown in the list, or has an invalid value, **When** the page is opened, **Then** that filter or sort is ignored as if absent, and nothing from the address is shown as text.
5. **Given** more than 8 fields of a kind marked "Show in list", **When** the admin tries to mark one more, **Then** the tick stays off and the message says "At most 8 custom fields can be shown in a list."

---

### User Story 4 - Delete a custom field with a clear warning (Priority: P2)

An admin deletes a custom field they no longer need. Before anything is deleted, a confirmation says how many records have a value in it; confirming deletes the field and every value.

**Why this priority**: Admins need to clean up mistakes and old fields, but the delete is permanent, so the warning must be precise.

**Independent Test**: With "Diet" filled in on 3 people (one of them private to someone else), press `[ DELETE ]` on "Diet"; confirm the confirmation says "3 people have a value in Diet", that confirming removes the field from forms, pages, columns and filters, and that cancelling changes nothing.

**Acceptance Scenarios**:

1. **Given** a field, **When** the admin presses `[ DELETE ]`, **Then** a confirmation shows the field name and the number of records of that kind that have a value in it (archived records included, private records included in the count only — no names), e.g. "3 people have a value in Diet. Deleting the field deletes these values for good.", with `[ DELETE FIELD ]` and `[ CANCEL ]`; with no values it says "No record has a value in Diet."
2. **Given** the confirmation, **When** the admin confirms, **Then** the field and all its values are deleted at once, it disappears from every form, page, list column, filter and import mapping, and the notice says "Diet deleted." (the field's name).
3. **Given** the confirmation, **When** the admin cancels, **Then** nothing changes.
4. **Given** a deleted field, **When** a record's timeline is shown, **Then** the earlier change entries about it are kept, with the name the field had; no new timeline entry is added on each record for the delete.
5. **Given** a user editing a record while the field is deleted, **When** they save the form with a value for the deleted field, **Then** the rest of the form is saved and the deleted field's value is ignored.

---

### User Story 5 - Map CSV columns to custom fields (Priority: P2)

On the columns step of the CSV import (SF-103), a team member can map a column to any custom field of people (for a people import) or of organisations (for an organisations import). Values are checked like on the form.

**Why this priority**: Data being moved into the CRM often has these extra columns; SF-103 deferred it until custom fields existed.

**Independent Test**: With the people field "Diet" (single choice) and a CSV with a "Diet" column, import it; confirm the column is suggested for "Diet", the preview shows the values, and imported people have them; a row with "Pescatarian" (not a choice) is imported without a Diet value and the preview and report warn about it.

**Acceptance Scenarios**:

1. **Given** custom fields for the kind being imported, **When** the columns step is shown, **Then** each custom field is offered as a target after the built-in fields, and a column whose heading matches a field name (ignoring case, spaces and punctuation) is suggested for it; each custom field can be mapped from at most one column.
2. **Given** a mapped Single choice or Multiple choice field, **When** a cell matches a choice name (ignoring case), **Then** that choice is set; a Multiple choice cell may list several choices separated by commas or semicolons; a value naming no current choice is not set, and a warning lists the value and how many rows had it, as unknown labels today.
3. **Given** a mapped Yes/No field, **When** a cell says yes, y, true or 1 (or no, n, false, 0, ignoring case), **Then** Yes (or No) is set; anything else is not set and is warned about.
4. **Given** a mapped Number, Money or Date field, **When** a cell does not read as a valid value (dates as 24/11/2026, 24 Nov 2026 or 2026-11-24; money with or without £ and commas), **Then** the value is not set, the row is still imported, and a warning lists the value and how many rows had it; Text and Long text cells over their length limit make the row not imported, with the existing "too long" reason.
5. **Given** an import whose preview was made before a mapped custom field was deleted, **When** it is run, **Then** the import does not use the deleted field and the report says so; nothing else changes.

---

### User Story 6 - Custom values follow the record's private rules (Priority: P1)

A custom value is part of its record: whoever cannot see a private person or deal cannot see, filter by, sort by, count or learn anything from its custom values.

**Why this priority**: The team decision is that a private contact or deal is hidden from everyone but those allowed, admins included; new fields must not leak them.

**Independent Test**: As Ada Fake, set "Diet: Vegan" on a person private to Ada; as Bob Fake (admin), filter the People list by "Diet: Vegan" and confirm the person is not listed or counted, and the delete confirmation for "Diet" gives a number without any name.

**Acceptance Scenarios**:

1. **Given** a private record, **When** someone it is hidden from uses a list column, filter or sort on a custom field, **Then** the record is not in the list and the list's count does not include it.
2. **Given** an admin deleting a field, **When** the confirmation counts records with a value, **Then** private records hidden from the admin are counted, and nothing about them but the number is shown.
3. **Given** a hidden private record, **When** someone it is hidden from sends any direct request to read or change its custom values, **Then** they get the existing "doesn't exist or you can't see it" result and nothing changes.

---

### Edge Cases

- A field name the same as a built-in field of that kind (e.g. a people field "Email address" or "Owner"), or as another custom field: refused with "There is already a field called <name>."
- Renaming a choice to the name of another choice of the same field: refused; removing the last offered choice of a field: refused with "A choice field needs at least one choice."
- An admin adds a field while a user has an edit form open: after the user saves, the record page shows what they typed and "—" for the new field.
- Two admins rename the same field one after the other from pages opened at the same time: after reloading, the page shows the name saved last, the field is listed once, and the fields are still listed in a single order with no field missing.
- An archived record: its page shows its custom values; it cannot be edited (as today), and a direct request to change them is refused with the existing archived-record message.
- Deleting a person, organisation or deal (admin, for good): its custom values are deleted with it.
- A Number of 0, a Money of £0 and Yes/No set to "No" are values, shown as "0", "£0" and "No", counted in the delete confirmation and matched by filters; only an empty field is "—".
- A Multiple choice field with all its ticks removed on save: the value is cleared and the timeline says "<Field> cleared".
- Text with markup such as "<b>Fake</b>", in a field name, a choice name or a value: shown as plain text everywhere.
- A Money custom field on a deal is not added to the deal's value, board totals or the deal list total; only the deal value counts there.
- The hand-over of a deactivated user's private people and deals (SF-92, SF-97) hands over their custom values with them, unchanged.
- The People, Organisations and Deals lists with no custom field shown: they look exactly as today.
- The Pipedrive import is not part of this issue; DECISIONS already says Pipedrive custom fields with no matching CRM field are listed in its report.

## Requirements *(mandatory)*

### Functional Requirements

**Managing fields (admins)**

- **FR-001**: Admins MUST be able to add custom fields to people, organisations and deals, each with a name (1–60 characters, unique within the kind among custom and built-in fields, ignoring case) and one of eight types: Text, Long text, Number, Money (GBP), Date, Single choice, Multiple choice, Yes/No.
- **FR-002**: Admins MUST be able to rename and reorder fields, and mark or unmark a field "Show in list" (at most 8 per kind); a field's type MUST NOT change after it is added.
- **FR-003**: For Single choice and Multiple choice fields, admins MUST be able to add, rename, reorder and remove choices (1–60 characters, unique within the field ignoring case, at least one offered choice); a removed choice MUST stay on records that have it and in list filters, and MUST NOT be offered on forms.
- **FR-004**: Admins MUST be able to delete a field only after a confirmation that names the field and gives the number of records of that kind that have a value (all records, private and archived included, number only); confirming MUST delete the field and all its values together.
- **FR-005**: A kind MUST hold at most 50 custom fields and a choice field at most 100 choices; going over is refused with "A kind can have at most 50 custom fields." or "A field can have at most 100 choices."

**Values on records**

- **FR-006**: The add and edit forms of people, organisations and deals MUST show the kind's custom fields, after the built-in fields, in the admin's order, with an input per type; every custom field is optional.
- **FR-007**: Values MUST be checked on every save: Text ≤ 255 characters, Long text ≤ 10,000, Number with at most 4 decimal places within ±1,000,000,000,000, Money with the same rules as the deal value (pounds and pence, not negative), Date a real calendar date, choices only from the offered list (or the removed choice the record already has); a failed check saves nothing and names the field.
- **FR-008**: The person page, organisation page, deal page and deal drawer MUST show every custom field of the kind with its value, or "—" when empty, formatted as in User Story 2.
- **FR-009**: Setting, changing or clearing a custom value MUST add a CHANGE entry to the record's timeline with the field's name at the time, the old and new values (long text: just "changed"), who and when; renaming or deleting a field MUST NOT rewrite earlier entries.

**Lists**

- **FR-010**: Fields marked "Show in list" MUST appear as columns in the People, Organisations or Deals list, after the built-in columns, and as filters in that list's filter row, combined with the other filters and kept in the page address, with the matching rules of User Story 3.
- **FR-011**: Text, Number, Money, Date, Single choice and Yes/No columns MUST be sortable, empty values last.
- **FR-012**: A list address naming a deleted, hidden-from-list or invalid custom field filter or sort MUST be treated as if that part were absent.

**CSV import**

- **FR-013**: The CSV import's columns step MUST offer the kind's custom fields as targets, suggest them by matching heading, and read values with the rules of User Story 5; values that cannot be read MUST be left empty and listed as warnings with their row count; text over its limit MUST stop the row with the existing "too long" reason.

**Access, privacy, messages, look**

- **FR-014**: Every Custom fields page and action MUST require a signed-in admin, checked on every request; filling in values MUST be open to anyone who can edit the record.
- **FR-015**: Custom values MUST follow the private person (SF-92) and private deal (SF-93) rules everywhere — pages, drawer, forms, lists, columns, filters, sorts, counts and totals, import steps and direct requests: nothing hidden from a user may be shown, counted or used to find records for them.
- **FR-016**: Every message shown MUST be one of the app's fixed messages (with field and choice names from the database as the only inserted text); text from the page address MUST never be shown.
- **FR-017**: The Custom fields page MUST follow `docs/DESIGN.md` and the existing admin pages (Lead sources and labels, Pipelines), and sit in the sidebar's "// Admin" group; record pages, forms and lists MUST show custom fields in the same look as their built-in fields.

**Fake data**

- **FR-018**: The fake data command MUST add, without duplicates when run again, a few clearly fake custom fields of every type across the three kinds (some shown in lists, one with a removed choice), values on some fake records including a private person and a private deal, and the matching timeline entries.

### Key Entities

- **Custom field**: belongs to one record kind (person, organisation or deal); has a name, a type, a position in the kind's order and a "Show in list" mark.
- **Choice**: an item of a Single choice or Multiple choice field; has a name, a position, and whether it is still offered (removed choices stay for records that have them).
- **Custom value**: the value of one custom field on one record (at most one per field and record; a Multiple choice value is a set of choices); deleted with its field or its record; visible only to who can see the record.
- **Timeline entry** (from SF-90/SF-93/SF-102): a CHANGE entry records a custom value set, changed or cleared, with the field's name at the time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can add a single choice field with five choices and see it on a record's edit form in under 2 minutes.
- **SC-002**: A user can fill in a record's custom fields while editing it with no extra page or step.
- **SC-003**: A list of 5,000 people with 8 custom columns and a custom filter shows its first page in under 2 seconds.
- **SC-004**: In automated tests, a private record's custom values never appear, match a filter, affect an order or a count for anyone the privacy rules hide it from, on any page, list, filter, sort, import step or direct request.
- **SC-005**: In automated tests, the delete confirmation's number equals the number of records that have a value in the field, for shared, private and archived records, and after confirming no value of the field remains.
- **SC-006**: In automated tests, 100% of saves with a value that does not fit its field's type, and 100% of custom field changes sent by users who are not admins, are refused with nothing saved.
- **SC-007**: A CSV of 1,000 people with three columns mapped to custom fields imports every readable value, and every unreadable one is listed as a warning with its row count.

## Assumptions

- "Show in list" is set by an admin for everyone (decided by the factory, to confirm): columns and filters are the same for every user, and per-user column choices are not part of this issue.
- Every custom field is optional; required custom fields, default values, help text and per-pipeline deal fields are not part of this issue.
- A field's type cannot be changed (decided by the factory, to confirm): converting values between types is error-prone, and delete-and-add covers the rare case.
- A removed choice behaves like a removed label (DECISIONS SF-95); renaming a choice changes it everywhere, as renaming a label does.
- Deleting a field is permanent (no undo or archive) and writes no entry on each record's timeline; earlier change entries about it stay as history.
- Money custom fields are in GBP only (DECISIONS) and never add to deal values or totals.
- The CSV import covers people and organisations only (SF-103), so deal custom fields are not importable; the Pipedrive import and campaign segments (PRODUCT section 4) using custom fields come later.
- Anyone who can edit a record can fill in its custom fields, as for built-in fields; managing the fields themselves is admin-only (PRODUCT section 7).
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
