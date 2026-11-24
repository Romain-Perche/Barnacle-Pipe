# Feature Specification: Pipedrive import — connection, people and organisations

**Feature Branch**: `factory/sf-117-step-11a-pipedrive-import-connection-peo`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 11a - Pipedrive import: connection, people and organisations. The first half of the Pipedrive import (`docs/PRODUCT.md` section 2, the kickoff lines on the import in `docs/DECISIONS.md`): a user saves their Pipedrive API token in their settings, the app checks it, and the user imports people and organisations with all their fields: several emails and phones, organisation, role, lead source, LinkedIn, labels, owner, unsubscribed status, and custom fields that match a CRM custom field by name and type. Owners are matched to CRM users by email address; a Pipedrive owner with no CRM user gives the record to the importing user, and the report says so. A record visible only to its owner in Pipedrive is private in the CRM. The import runs in parts the app can resume, with a progress screen, so it fits Vercel's time limit and Pipedrive's rate limits on a few thousand records. Deals, notes, activities and files come in the next issue: their checkboxes are not shown yet."

## Clarifications

### Session 2026-11-24

- Q: Which design do you want for the Pipedrive import screens? → A: Design: B, Settings holds the token; the import has its own page with a step bar (1 CHOOSE, 2 IMPORTING, 3 REPORT), like the CSV import (see `design-options.html`).
- Q: A Pipedrive contact is "Owner only" and owned by another user. Who can see it in the CRM after an import? → A: Only its owner: the owner counts as its creator, and the importing user does not see it (unless they are the owner).
- Q: A person already in the CRM is Subscribed, and the same person is unsubscribed in Pipedrive. What does the import do? → A: The CRM person becomes Unsubscribed, nothing else changes, a timeline entry is added, and the report lists it.
- Q: An admin deleted a person or organisation that came from Pipedrive (for example after an erasure request). A later import finds it in Pipedrive again. Is it added back? → A: No: the CRM remembers the Pipedrive record and counts it as "already imported"; it is never added again (decided by the factory, to confirm)
- Q: How long after the progress page is closed does the import show as paused? → A: 30 seconds without a part; the page then shows "Import paused: …" with `[ CONTINUE ]` and does not carry on by itself (decided by the factory, to confirm)
- Q: Pipedrive asks the CRM to wait a long time (for example its daily limit is used up). How long does the import wait? → A: It shows the wait and carries on by itself after at most 5 minutes; if Pipedrive still refuses, it waits again; the user can stop it at any time (decided by the factory, to confirm)
- Q: When no token encryption key is set in development, does the app use a built-in one? → A: No: without `PIPEDRIVE_TOKEN_KEY` the Pipedrive section says "The Pipedrive import isn't set up yet." everywhere, so a copied example settings file can never carry a usable key to production (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

Builds on SF-90 (people and organisations, their fields, duplicate detection by email address, unique organisation names, admin-kept lead source and label lists), SF-92 (a private person is visible only to their creator and owner), SF-103 (CSV import: matching rules for lists, owners, sizes and consent, the "imported" timeline entry) and SF-115 (custom fields and their types). The kickoff decisions on the Pipedrive import in `docs/DECISIONS.md` apply: any user can import, each imported record keeps its Pipedrive ID, an already imported record is left as it is, a record matching one already in the CRM (a person by email, an organisation by name) is linked to it and never copied, unmatched custom fields are listed in the report, the token is stored encrypted and never shown again, and everything is built and tested against a fake Pipedrive only. Deals, notes, activities and files are the next step (SF-117 part b).

### User Story 1 - Connect a Pipedrive account (Priority: P1)

A team member opens their settings, pastes the API token from their Pipedrive account ("Personal preferences → API" in Pipedrive) and presses `[ SAVE TOKEN ]`. The CRM checks the token with Pipedrive straight away: when Pipedrive accepts it, the settings show which Pipedrive user and company the token belongs to; when it does not, nothing is saved and the user is told why. The token itself is never shown again.

**Why this priority**: Nothing can be imported without a working connection, and the token is a secret that gives access to the whole Pipedrive account, so it must be checked and kept safely before anything else.

**Independent Test**: With the fake Pipedrive, save a token it accepts and confirm the settings show "Connected to Pipedrive as <fake user> (<fake company>)" and no part of the token; save a token it refuses and confirm the message and that nothing is saved; remove the token and confirm the settings are back to the empty field.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they open Settings (a new "Settings" link at the bottom of the sidebar, beside their name), **Then** the page shows a "// PIPEDRIVE" section with a token field, a short note on where to find the token in Pipedrive, and `[ SAVE TOKEN ]`.
2. **Given** a token the fake Pipedrive accepts, **When** the user saves it, **Then** the section shows "Connected to Pipedrive as Fake Person (Fakeco Pipedrive)" with the date the token was saved, `[ REPLACE TOKEN ]`, `[ REMOVE TOKEN ]` and `[ IMPORT FROM PIPEDRIVE ]`; the token is not shown, not even in part, and is not in the page's source.
3. **Given** a token Pipedrive refuses, **When** the user saves it, **Then** the page shows "Pipedrive did not accept this token. Copy it again from Pipedrive and try again." and nothing is saved (an earlier saved token, if any, is kept).
4. **Given** Pipedrive cannot be reached when the user saves a token, **When** the check fails, **Then** the page shows "Pipedrive can't be reached right now. Try again in a minute." and nothing is saved.
5. **Given** a saved token, **When** the user presses `[ REMOVE TOKEN ]` and confirms, **Then** the token is deleted and the section is back to the empty token field; a running import of that user stops (see User Story 3).
6. **Given** two users, **When** each saves their own token, **Then** each sees only their own connection; no user, admins included, can see or use another user's token.

---

### User Story 2 - Import people and organisations with all their fields (Priority: P1)

A connected user presses `[ IMPORT FROM PIPEDRIVE ]`, ticks People and Organisations (the only two choices in this step) and presses `[ IMPORT ]`. Every person and organisation their token can read in Pipedrive comes into the CRM with everything the CRM keeps about it: several email addresses and phone numbers, organisation, role, lead source, LinkedIn link, labels, owner, email consent, privacy, and the custom fields that match a CRM custom field. Records that match one already in the CRM are linked to it, not copied. The import ends with a report of what was imported, what was linked, and what was left out and why.

**Why this priority**: This is the move from Pipedrive. Contacts and organisations are the base every later import (deals, notes, activities, files) hangs on.

**Independent Test**: With the fake Pipedrive holding 30 people and 10 organisations (some with several emails and phones, labels, a custom field "Budget" (number) that exists in the CRM and "Favourite colour" that does not, one unsubscribed person, one person visible only to its owner, one owner with no CRM user, one person whose email is already in the CRM, one organisation whose name is already in the CRM), run an import and confirm every value on the imported records, the links to the existing person and organisation, and the report lines.

**Acceptance Scenarios**:

1. **Given** a connected user, **When** they press `[ IMPORT FROM PIPEDRIVE ]`, **Then** the "Import from Pipedrive" page opens with "← Settings", the title "Import from Pipedrive" under "// PIPEDRIVE", the Pipedrive company name in the header and the step bar "1 CHOOSE · 2 IMPORTING · 3 REPORT" on "1 CHOOSE"; it shows "What to import" with two checkboxes, People and Organisations (both unticked), a note on what happens to records already in the CRM, and `[ IMPORT ]`; there is no checkbox for deals, notes, activities or files. `[ IMPORT ]` with nothing ticked shows "Tick what to import." and starts nothing.
2. **Given** a Pipedrive person with two email addresses (work, marked primary; home) and three phone numbers (work, mobile, home), **When** imported, **Then** the CRM person has both email addresses and all three phone numbers in Pipedrive's order, the primary one first as the main one, with Pipedrive's "work" as Work, "home" and "mobile" as Personal, and anything else as Other.
3. **Given** a Pipedrive person with a first and last name, **When** imported, **Then** the CRM person has the same first and last name; a Pipedrive person with only a full name is split as the CSV import splits it ("Ada May Example" → "Ada" / "May Example").
4. **Given** a Pipedrive person linked to an organisation, **When** imported, **Then** the CRM person is linked to the CRM organisation imported from (or linked to) that Pipedrive organisation; this is true even when only People is ticked: the person's organisation is then imported or linked with it (see FR-012).
5. **Given** a Pipedrive person with a job title, a lead source, a LinkedIn link (in Pipedrive fields named, ignoring case, spaces and punctuation, "Job title" or "Role"; "Lead source" or "Source"; "LinkedIn", "LinkedIn profile" or "LinkedIn URL"), **When** imported, **Then** the CRM person has that role, LinkedIn link and lead source; a lead source not on the CRM's list is left out and the report lists it once with the number of people ("Lead source not on the list: 'Webinar' (4 people)").
6. **Given** a Pipedrive person with labels, **When** imported, **Then** each label whose name matches a label still offered on the CRM's people label list (ignoring case and surrounding spaces) is set; others are left out and listed in the report, as for lead sources. An import never adds to the admin-kept lists.
7. **Given** a Pipedrive person whose marketing status is "unsubscribed", **When** imported, **Then** the CRM person is Unsubscribed; "subscribed" makes them Subscribed; for people with any other status or none ("no consent", "archived", not set), the user chooses on the import page, with nothing chosen in advance, "Subscribed" or "Unsubscribed" before `[ IMPORT ]` is possible (the choice is shown only when People is ticked).
8. **Given** a Pipedrive person or organisation whose owner's email address is the email address of an active CRM user (ignoring case), **When** imported, **Then** that user is the CRM owner; when the owner's email matches no active CRM user (none, or a deactivated one), the importing user is the owner and the report lists, once per Pipedrive owner, "Owner Jane Fake (jane@fake.example) has no CRM user: 12 records given to you."
9. **Given** a Pipedrive person or organisation visible only to its owner ("Owner only" in Pipedrive), **When** imported, **Then** the CRM person is private and its owner is also its creator, so only the owner sees it: another user, the importing user included (unless they are the owner), does not find it in the People list or by search, and the report counts it without naming it ("3 private people of other owners imported."). When that owner has no CRM user, the importing user becomes owner and creator and is the only one who sees it; an organisation is never private in the CRM (the CRM has no private organisations) and the report says how many owner-only organisations were imported as shared. A record visible to a group or the whole company in Pipedrive is shared in the CRM.
10. **Given** a Pipedrive organisation with an address, a website, an industry and a number of employees, **When** imported, **Then** the CRM organisation has the address as its location, the website saved like the form saves it, the industry as its sector, and the number of employees as the matching size band (as the CSV import does); a value the organisation form would refuse or a size that cannot be placed in a band is left out and listed as a warning; the organisation is still imported.
11. **Given** a Pipedrive custom field whose name matches a CRM custom field of the same kind of record (ignoring case and surrounding spaces) and whose type can be read as that field's type (FR-016), **When** imported, **Then** each record gets the value in that CRM field; a Pipedrive option (single or multiple choice) that is not a current choice of the CRM field is left out and listed in the report.
12. **Given** a Pipedrive custom field with no CRM custom field of the same name, or one whose type cannot be read as the CRM field's type, **When** imported, **Then** its values are not imported and the report lists the field once, with the reason ("No CRM field named 'Favourite colour'." or "'Budget' is a text field in Pipedrive and a number field in the CRM.").
13. **Given** a Pipedrive person one of whose email addresses a person already in the CRM has (ignoring case and spaces, archived and private people included), **When** imported, **Then** no new person is added: the existing CRM person is linked to that Pipedrive person, left exactly as it is, and the report lists it as linked ("Ada Example was already in the CRM: linked, not changed."), naming the person only if the importing user can see them ("A person already in the CRM has this email address: linked, not changed.").
14. **Given** a person already in the CRM (linked as in scenario 13, or imported by an earlier import) who is Subscribed in the CRM and unsubscribed in Pipedrive, **When** the import reaches them, **Then** their page shows "Unsubscribed", nothing else on it changes, their timeline shows "Unsubscribed by the Pipedrive import of <user's name>" with the date and time, and the report lists "Ada Example is unsubscribed in Pipedrive: now Unsubscribed in the CRM." (or "A person already in the CRM is unsubscribed in Pipedrive: now Unsubscribed in the CRM." when the importing user cannot see them). A person Unsubscribed in the CRM is never made Subscribed by an import.
15. **Given** a Pipedrive organisation whose name matches an organisation already in the CRM (ignoring case and surrounding spaces, archived ones included), **When** imported, **Then** no new organisation is added; the existing one is linked and left exactly as it is, and the report lists it as linked.
16. **Given** an import that has finished, **When** the step bar reaches "3 REPORT", **Then** it shows counts (people imported, organisations imported, people linked, organisations linked, already imported before, not imported), every record not imported with its Pipedrive name and the reason, the owner lines, the custom fields not imported, the list values left out, and every other warning, plus links to the People and Organisations lists; each imported record's page shows every imported value and, on its timeline, "Imported from Pipedrive by <user's name>" with the date and time.

---

### User Story 3 - A long import runs in parts, with progress, and can be resumed (Priority: P1)

An import of a few thousand records takes longer than one request is allowed to run, and Pipedrive limits how fast it may be read. The import therefore runs in parts: the progress screen shows what has been done so far and moves on by itself; when Pipedrive asks the CRM to slow down, the import waits and carries on; when the user closes the page or something fails half-way, the import can be resumed where it stopped, never importing a record twice.

**Why this priority**: Without it, a real Pipedrive account (a few thousand contacts) cannot be imported at all on the hosting the CRM runs on.

**Independent Test**: With the fake Pipedrive holding 3,000 people and 800 organisations and set to answer "too many requests" every few calls, run an import, close the page half-way, open it again, resume, and confirm every record is imported exactly once and the report counts match the fake data.

**Acceptance Scenarios**:

1. **Given** the user presses `[ IMPORT ]`, **When** the import starts, **Then** the progress screen shows each ticked kind with "<done> of <total>" (for example "Organisations 320 of 800", "People 0 of 3,000") and a bar, updates by itself (the numbers change within 10 seconds while records are being imported) while the page is open, and shows the report when everything is done.
2. **Given** Pipedrive answers that the CRM is reading too fast, **When** the import is running, **Then** the progress screen shows "Pipedrive asked us to slow down. Carrying on in <n> seconds." and the import carries on by itself after that time; nothing is skipped or imported twice.
3. **Given** a running import, **When** the user closes the page or loses their connection, **Then** the import pauses; when they open Settings or the Pipedrive import page again, it shows "Import paused: Organisations 800 of 800, People 1,200 of 3,000." with `[ CONTINUE ]` and `[ STOP IMPORT ]`; `[ CONTINUE ]` carries on from where it stopped.
4. **Given** a part fails (Pipedrive can't be reached, a server error, the request runs out of time), **When** the failure happens, **Then** nothing from that part is half-saved (each record is saved whole or not at all), the screen shows "The import stopped: Pipedrive can't be reached right now." with `[ CONTINUE ]`, and continuing imports each record at most once.
5. **Given** the token is refused by Pipedrive during an import (revoked or removed), **When** the next part runs, **Then** the import pauses with "Pipedrive no longer accepts your token. Save a new token in Settings, then continue."; records already imported stay.
6. **Given** a running or paused import, **When** the user presses `[ STOP IMPORT ]` and confirms, **Then** no more records are imported, the records already imported stay, and the report shows what was done with "Stopped by you before the end."
7. **Given** a user with a running or paused import, **When** they try to start another one, **Then** they are taken to that import instead; one import per user at a time.
8. **Given** a finished import, **When** the user starts a new import from the same Pipedrive company, **Then** records imported before are left as they are, counted in the report as "already imported", and only new Pipedrive records are added.
9. **Given** two users connected to the same Pipedrive company, **When** both import (one after the other or at the same time), **Then** each Pipedrive record is in the CRM once; the second import counts the first one's records as already imported.

---

### Edge Cases

- The token field is empty, has spaces around it, or is longer than any Pipedrive token: empty shows "Paste your Pipedrive API token."; spaces are removed before checking; a value longer than 200 characters is refused with the "did not accept" message without asking Pipedrive.
- A user replaces a token with one from a different Pipedrive company while an import is paused: `[ CONTINUE ]` shows "This import is from another Pipedrive company. Stop it, or save the token of that company again." and imports nothing.
- The same email address on two Pipedrive people: the first one read is imported; the second is not imported ("Another Pipedrive person, Ada Example, has the same email address.").
- A Pipedrive person whose email addresses match two different CRM people: not imported and not linked ("Its email addresses belong to more than one person in the CRM."); nothing in the CRM changes.
- Two Pipedrive organisations with the same name (ignoring case and spaces): the first is imported, the second is linked to it and the report lists it.
- A Pipedrive value the person or organisation form would refuse: an invalid email address or phone number, or a LinkedIn link that is not a link, is left out with a warning on that person ("Email address 'ada@' is not valid: left out."); the person is still imported if what is left is valid. A person with no usable name (empty after trimming) is not imported ("No name."). A value longer than the form keeps is not cut: it is left out with a warning ("Role longer than 200 characters: left out."), except a name, which makes the record not imported with the form's message.
- A person whose Pipedrive organisation could not be imported (for example its name is longer than allowed): the person is imported without an organisation and the report says why.
- A Pipedrive organisation that is linked to an existing CRM organisation that is archived: linked with a warning ("Fakeco Ltd is archived."); a person linked to it keeps the link.
- A Pipedrive record deleted in Pipedrive between two parts of the import: it is not in the CRM and the report does not count it as not imported; a record added in Pipedrive during an import is in the CRM after the next import at the latest (counted there as imported).
- A Pipedrive custom field of a type the CRM has no equivalent for (address, user, person, organisation, phone, time, time range, date range, autonumber): not imported, listed once in the report ("'Region' is an address field in Pipedrive: not imported.").
- A custom value that does not fit the CRM field's limits (text longer than allowed, a number with too many decimals): left out for that record with a warning; other values are kept.
- A Pipedrive field named like a built-in field the CRM fills from it ("Job title", "Lead source", "LinkedIn") is used for the built-in field and not listed as an unmatched custom field, even if a CRM custom field has the same name.
- A Pipedrive name, label or custom value such as `<a href="https://evil.example">Click</a>` or `Your account is locked`: the progress screen, the report and the record's pages show it exactly as text, with no link, and a Pipedrive value only ever appears inside quotes in a report line.
- A person linked (not imported) because their email address was already in the CRM: their page shows the same values, owner and privacy as before the import; only a Subscribed person whom Pipedrive says is unsubscribed changes, to Unsubscribed (User Story 2, scenario 14). A person Pipedrive says is subscribed but the CRM says Unsubscribed stays Unsubscribed.
- An imported person's Date added is the date the record was added in Pipedrive; Last contacted stays empty (it comes with activities in the next step).
- The importing user is deactivated while their import is running or paused: no further part runs (parts only run for a signed-in, active user); the records already imported stay, and their token is deleted when they are deactivated, since users are never deleted and nobody else may use it.
- A user who is not signed in or is deactivated opens the Settings or import page address, or sends a save-token or import-part request: they get the sign-in page or a refusal; nothing is saved or imported.
- No token encryption key is set up for the CRM: the Pipedrive section shows "The Pipedrive import isn't set up yet." and no token can be saved; the app is otherwise unaffected.

## Requirements *(mandatory)*

### Functional Requirements

**Connection**

- **FR-001**: Every signed-in, active user MUST have a Settings page, reached from the sidebar, with a "// PIPEDRIVE" section where they can save, replace and remove their own Pipedrive API token.
- **FR-002**: Before saving a token, the CRM MUST check it with Pipedrive and MUST save it only when Pipedrive accepts it; the page MUST then show the Pipedrive user name, the Pipedrive company name and the date saved. A refused token or an unreachable Pipedrive MUST leave any earlier token in place and show a fixed message.
- **FR-003**: A saved token MUST be stored encrypted with a key kept outside the database and the repo, MUST never be shown again or sent to the browser in any form, and MUST be usable only for its own user's imports. Removing a token MUST delete it, and deactivating a user MUST delete their token.

**Starting an import**

- **FR-004**: A connected user MUST be able to start an import from an "Import from Pipedrive" page with the checkboxes People and Organisations only; deals, notes, activities and files MUST NOT be offered in this step.
- **FR-005**: When People is ticked, the page MUST ask, with nothing chosen in advance, which consent ("Subscribed" or "Unsubscribed") to give imported people whose Pipedrive marketing status is neither subscribed nor unsubscribed, and MUST NOT start until it is chosen.
- **FR-006**: Each user MUST have at most one running or paused import at a time.

**What is imported**

- **FR-007**: A Pipedrive person MUST be imported with: first and last name (or a full name split as the CSV import does), every email address and phone number in Pipedrive's order with the primary one first and kinds mapped (work → Work, home and mobile → Personal, others → Other), organisation, role, lead source, LinkedIn link, labels, owner, email consent, privacy, Date added (from Pipedrive), and matched custom field values.
- **FR-008**: A Pipedrive organisation MUST be imported with: name, website, sector (from industry), size (from the number of employees, placed in the CRM's size band), location (from the address), owner and matched custom field values.
- **FR-009**: Role, lead source and LinkedIn link MUST be taken from the Pipedrive person fields named, ignoring case, spaces and punctuation, "Job title" or "Role"; "Lead source" or "Source"; "LinkedIn", "LinkedIn profile" or "LinkedIn URL".
- **FR-010**: Lead sources and labels MUST be matched to entries still offered on their CRM lists, ignoring case and surrounding spaces; an import MUST NOT add, rename or bring back list entries. Unmatched values MUST be left out and listed once each in the report with how many records had them.
- **FR-011**: Owners MUST be matched to active CRM users by the Pipedrive owner's email address, ignoring case. A record whose owner matches nobody MUST be owned by the importing user, and the report MUST list each such Pipedrive owner with the number of records given to the importing user.
- **FR-012**: A person's Pipedrive organisation MUST be linked to its CRM organisation; when Organisations is not ticked, the organisation of each imported person MUST still be imported (or linked) with all its fields, and no other organisation.
- **FR-013**: A Pipedrive person visible only to its owner MUST be private in the CRM with its CRM owner as its creator, so only that owner sees it (the importing user only when they are the owner, including when the Pipedrive owner has no CRM user); every other person MUST be shared, with the importing user as creator. The report MUST count, not name, private people the importing user cannot see. Organisations MUST be imported as shared, and the report MUST say how many were owner-only in Pipedrive.
- **FR-014**: A Pipedrive marketing status of "unsubscribed" MUST always give an Unsubscribed person, and "subscribed" a Subscribed one; no person may be imported as Subscribed unless Pipedrive says subscribed or the user chose Subscribed for people without a status.
- **FR-015**: Values the person or organisation form would refuse (invalid email address, phone number, link or website; too long) MUST be left out with a warning, never cut or changed; a record MUST NOT be imported only when its name is missing or refused.
- **FR-016**: A Pipedrive custom field MUST be imported only into a CRM custom field of the same kind of record whose name matches (ignoring case and surrounding spaces) and whose type is compatible: text → Text, large text → Long text (or Text when it fits), numerical → Number, monetary → Money (GBP amounts only; other currencies left out with a warning), date → Date, single option → Single choice, multiple options → Multiple choice, single option with exactly the options Yes and No → Yes / No. Options MUST be matched to current CRM choices by name, ignoring case; unmatched options MUST be left out and listed. Every Pipedrive custom field not imported MUST be listed once in the report with its reason. Imported custom values MUST NOT add timeline entries of their own.

**Matching and repeats**

- **FR-017**: Each record imported or linked MUST keep its Pipedrive company and Pipedrive ID; no Pipedrive record may ever lead to two CRM records, whether imports are repeated, resumed, or run by two users at once.
- **FR-018**: A Pipedrive person MUST be linked, not imported, when one of its email addresses belongs to exactly one person already in the CRM (ignoring case and spaces; archived and private people included); a Pipedrive organisation MUST be linked when its name matches an organisation already in the CRM (ignoring case and surrounding spaces; archived ones included). A linked or already imported record MUST be left exactly as it is, with one exception: a person Subscribed in the CRM whom Pipedrive says is unsubscribed MUST become Unsubscribed, with the timeline entry "Unsubscribed by the Pipedrive import of <user's name>" and a report line. An import MUST never make an Unsubscribed person Subscribed.
- **FR-019**: The report and progress screen MUST name or link a CRM person only if the importing user can see them.

**Running in parts**

- **FR-020**: An import MUST run as a series of parts, each short enough to finish within the hosting's time limit for one request, moved on by the progress screen while it is open; the import MUST pause when no progress screen is open and MUST be resumable from where it stopped with `[ CONTINUE ]`.
- **FR-021**: Each record MUST be saved whole or not at all; a failed or interrupted part MUST leave no half-saved record, and resuming MUST NOT import a record twice.
- **FR-022**: When Pipedrive asks the CRM to slow down, the import MUST wait the time Pipedrive asks for (or a short default) and carry on by itself, showing the wait on the progress screen; it MUST read at a pace that stays within Pipedrive's limits for one token during normal running.
- **FR-023**: The user MUST be able to stop a running or paused import; records already imported MUST stay.
- **FR-024**: The progress screen MUST show, for each ticked kind, records done and total, and the current state (running, waiting for Pipedrive, paused, stopped with reason, finished).

**Report and history**

- **FR-025**: A finished or stopped import MUST end with a report: counts of records imported, linked, already imported and not imported per kind; every record not imported with its Pipedrive name and reason; owners without a CRM user; list values and custom fields not imported; and every warning. The latest report MUST stay available to the user on the import page until they start another import.
- **FR-026**: Each imported person and organisation MUST get the timeline entry "Imported from Pipedrive by <user's name>" with the date and time; linking an imported person to an organisation MUST add the same organisation timeline entry as linking by hand. Linked records MUST get no new timeline entry.

**Access, messages and look**

- **FR-027**: Every settings and import page and action MUST require a signed-in, active user and act only on that user's own token and import.
- **FR-028**: Every message shown MUST be one of the app's fixed messages; values from Pipedrive MUST appear only as data, quoted inside them, never as links or markup.
- **FR-029**: The Settings page and import pages MUST follow `docs/DESIGN.md`, the existing signed-in layout (design B sidebar) and design B in `design-options.html`. The sidebar gains "Settings" at the bottom, above `[ SIGN OUT ]`; Settings holds the "// PIPEDRIVE" section (token, connection, `[ IMPORT FROM PIPEDRIVE ]`). The import has its own page: "← Settings", label "// PIPEDRIVE", title "Import from Pipedrive", the Pipedrive company name in the header, and the step bar "1 CHOOSE · 2 IMPORTING · 3 REPORT" with the current step highlighted and finished steps ticked. "2 IMPORTING" shows three counts (Imported, Linked to CRM records, Not imported), "// PROGRESS" with a bar and "<done> of <total>" per kind and the state, the note "Keep this page open: the import moves on while it is open. Closing it pauses the import." and `[ STOP IMPORT ]`. "3 REPORT" shows the same three counts, "// NOT IMPORTED" (Pipedrive record, reason) and the warnings.
- **FR-030**: The whole feature MUST work and be tested against a fake Pipedrive, available only where fake services are allowed; the address of Pipedrive MUST be a setting.

### Key Entities

- **Pipedrive connection**: One per user: the encrypted token, the Pipedrive user name, company ID and company name it belongs to, and the date it was saved.
- **Pipedrive import**: One run by one user: what was ticked, the consent chosen for people without a status, its state (running, waiting, paused, stopped, finished, with the reason), where it has got to for each kind, the counts, and its report (records not imported with reasons, owner lines, list values and custom fields left out, warnings).
- **Pipedrive link**: For each CRM person or organisation imported or linked: the Pipedrive company, kind and ID it came from, so a record is never imported twice and the next step can attach deals, notes, activities and files to it.
- **Person, Organisation, Lead source, Label, Custom field and value, Timeline entry**: As in SF-90, SF-92 and SF-115; new timeline entry kinds record that a record was imported from Pipedrive and by whom, and that a person was made Unsubscribed by a Pipedrive import and by whose import.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from pasting a token to seeing the import running in under 2 minutes.
- **SC-002**: An account of 3,000 people and 800 organisations is fully imported in under 30 minutes with the progress screen open, with every part finishing within the hosting's time limit for one request, even when the fake Pipedrive asks the CRM to slow down.
- **SC-003**: In automated tests, closing and resuming an import at any point, repeating it, or two users importing the same company at once leaves exactly one CRM record per Pipedrive record.
- **SC-004**: In automated tests, no person unsubscribed in Pipedrive is ever imported as Subscribed, and no person is given a consent neither Pipedrive nor the user gave.
- **SC-005**: In automated tests, every Pipedrive person or organisation whose email or name matches a CRM record is linked to it, and the CRM record is unchanged, except a Subscribed person unsubscribed in Pipedrive, who is then Unsubscribed.
- **SC-006**: In automated tests, every owner-only Pipedrive person is private in the CRM and visible only to its CRM owner (not to the importing user, unless owner, nor to a third user); no report or progress screen shows a private person the importing user cannot see.
- **SC-007**: In automated tests, no page, page source, log line or report contains any part of a saved token, and the stored value is not the token in plain text.
- **SC-008**: In automated tests, 100% of the fake data's values (emails, phones, organisation, role, lead source, LinkedIn, labels, owner, consent, privacy, matched custom fields) appear on the imported records, and every value left out appears in the report with its reason.

## Assumptions

- Pipedrive has no built-in role, lead source or LinkedIn fields for people in the account's typical setup; they are custom fields there, read by name (FR-009). Organisation website, industry and number of employees are read from Pipedrive's fields with those names.
- People whose Pipedrive marketing status is "no consent", "archived" or not set get the consent the user chooses, as the CSV import does for rows without consent (SF-103), because UK GDPR and PECR forbid guessing consent.
- A private imported person's creator is their CRM owner (clarified), so a teammate's owner-only Pipedrive contacts never become visible to whoever ran the import.
- The CRM has no private organisations, so owner-only Pipedrive organisations come in shared and the report counts them.
- The import moves forward only while the user's progress screen is open (no background jobs or scheduled tasks in the app's hosting); leaving pauses it. Undoing a whole import is out of scope; imported records can be archived or deleted like any others.
- Ambassador ("Referred by") links, deals, notes, activities, files, and the follow-ups on people (Last contacted) come with or after the next step; they are not read from Pipedrive here.
- Updating records already in the CRM from Pipedrive is out of scope (DECISIONS: a record already imported, or matched, is left as it is).
- Only the latest report per user is kept; earlier reports are replaced when a new import starts.
- A token encryption key and the Pipedrive address are new settings, listed in `.env.example` and the README; technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
