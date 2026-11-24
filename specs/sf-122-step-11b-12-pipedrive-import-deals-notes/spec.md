# Feature Specification: Pipedrive import — deals, notes, activities and files

**Feature Branch**: `factory/sf-122-step-11b-12-pipedrive-import-deals-notes`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 11b/12 - Pipedrive import: deals, notes, activities and files. The second half of the Pipedrive import (`docs/PRODUCT.md` sections 1, 2 and 5, the kickoff lines on the import in `docs/DECISIONS.md`), on the import started in the previous issue: deals (pipelines and stages matched by name and created when missing, value, owner, main person, other linked people, organisation, labels, won or lost with the lost reason, custom fields), notes, activities (calls, meetings and tasks with their due dates, done or not, assignee) and files, each on the deal, person or organisation it belongs to in Pipedrive. A deal, note, activity or file whose record was not imported is skipped and listed in the report. Files over 25 MB are skipped and listed. Pipedrive emails are not imported: email comes with the Gmail issues."

## Clarifications

### Session 2026-11-24

- Q: When Deals, Notes, Activities or Files is ticked, how do people and organisations come in? → A: People and Organisations are ticked with them and cannot be unticked; a record is skipped only when its person or organisation could not be imported.
- Q: The team rule says only admins create pipelines and stages. Can any user's import create missing ones? → A: Yes: any import creates missing pipelines and stages, never renames, reorders or deletes them, and the report lists them; `docs/DECISIONS.md` records this exception.
- Q: What happens to Pipedrive activities of a type the CRM does not have (deadline, email, lunch, custom types)? → A: They come in as tasks; the report counts them per Pipedrive type.
- Q: A Pipedrive note between 10,001 and 100,000 characters is longer than the note box accepts (10,000): import it or skip it? → A: Import it whole, so no history is lost; it shows and can be deleted like any note, and editing it asks to shorten it to 10,000 characters before saving (decided by the factory, to confirm)
- Q: A note, activity or file whose CRM record is archived (an archived deal, or a linked archived person or organisation): import it or skip it? → A: Import it onto that record, as history that belongs there, even though the forms refuse new notes and files on archived records (decided by the factory, to confirm)
- Q: A file attached to a Pipedrive email that is also on a deal, person or organisation: import it? → A: No: email attachments never come in (FR-020); they are counted in the "on Pipedrive emails" line of the report, not listed one by one (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

Builds on SF-117 part a (the Pipedrive connection, the import page with its step bar CHOOSE · IMPORTING · REPORT, the import in parts with progress, pause, continue and stop, owner matching by email, owner-only records made private with their owner as creator, custom fields matched by name and type, the Pipedrive link that stops a record being imported twice, the report). It also builds on SF-93 / SF-95 (pipelines, stages, deals, won / lost with a free-text lost reason, deal labels, other linked people, followers, days per stage), SF-102 (notes on the timeline), SF-109 (activities, Last contacted), SF-115 (custom fields on deals) and SF-116 (files, 25 MB limit, the file store). The kickoff decisions on the Pipedrive import in `docs/DECISIONS.md` still apply: any user can import, each imported record keeps its Pipedrive ID, an already imported record is left as it is, each ticked type comes with all the information the CRM uses for it, unmatched custom fields are listed in the report, and everything is built and tested against a fake Pipedrive only.

### User Story 1 - Import deals into the right pipelines and stages (Priority: P1)

A connected user opens "Import from Pipedrive", ticks Deals (which ticks People and Organisations too, see FR-002) and presses `[ IMPORT ]`. Every deal their token can read in Pipedrive comes into the CRM in the pipeline and stage of the same name, with its value, owner, main person, other linked people, organisation, labels, followers, expected close date, status (open, won, or lost with its reason), privacy and matched custom fields. Pipelines and stages the CRM does not have yet are created so that the boards look like Pipedrive's.

**Why this priority**: Deals in lots of pipelines are the core of the CRM (`docs/PRODUCT.md` §1); without them the team cannot leave Pipedrive.

**Independent Test**: With the fake Pipedrive holding 3 pipelines ("Sales" also in the CRM with one extra Pipedrive stage, "Exec Dinner" in the CRM under the name "exec dinner ", "Fake Partners" not in the CRM), 40 deals (open, won, lost with and without a reason, one owner-only, one in USD, one with two participants, labels on and off the CRM list, a custom field "Budget" (number) in the CRM and "Region" not), run an import and confirm every deal on the board, list and deal page, the created pipeline and stage, and the report lines.

**Acceptance Scenarios**:

1. **Given** a connected user on "1 CHOOSE", **When** the page opens, **Then** "What to import" shows six checkboxes, all unticked: People, Organisations, Deals, Notes, Activities, Files; there is no checkbox for emails, and a note says "Pipedrive emails are not imported: they will come from Gmail."
2. **Given** a Pipedrive pipeline whose name matches a CRM pipeline (ignoring case and surrounding spaces), **When** its deals are imported, **Then** each deal is in that CRM pipeline, in the stage whose name matches its Pipedrive stage (ignoring case and surrounding spaces); a Pipedrive stage that pipeline lacks is added at the end of the CRM pipeline, in Pipedrive's order, and the report lists it ("Stage 'Proposal' added to the pipeline Sales.").
3. **Given** a Pipedrive pipeline with no CRM pipeline of that name, **When** Deals is imported, **Then** a CRM pipeline of that name is created with all its Pipedrive stages in Pipedrive's order, at the end of the pipeline list, and the report lists it ("Pipeline 'Fake Partners' added with 5 stages."). Every active Pipedrive pipeline and stage is matched or created, including ones with no deal, so the boards match Pipedrive's. A CRM pipeline or stage is never renamed, reordered or deleted by an import.
4. **Given** a Pipedrive deal, **When** imported, **Then** the CRM deal has its title, value (GBP, to the penny), owner (matched as in SF-117), main person, organisation, expected close date, Date added (Pipedrive's added date), labels matching a deal label still offered on the CRM list (others left out and listed once with a count, as for people labels), followers who are active CRM users (matched by email; others left out without a report line) and matched deal custom fields (as in SF-117 FR-016, with "Budget" filled and "Region" listed as "No CRM field named 'Region'.").
5. **Given** a Pipedrive deal with participants besides its main person, **When** imported, **Then** each participant the import brought into the CRM (imported or linked) is one of the deal's other linked people; a participant who was not is left out with a warning on the deal ("Linked person 'Ada Example' was not imported: left out."); the deal is still imported.
6. **Given** a won Pipedrive deal, **When** imported, **Then** the CRM deal is Won, closed on Pipedrive's won date; a lost deal is Lost, closed on Pipedrive's lost date, with Pipedrive's lost reason as its reason, or "No reason given in Pipedrive." when it has none; an open deal is open.
7. **Given** an imported deal, **When** its page opens, **Then** the stage bar shows it in its stage since Pipedrive's last stage change date (or its added date when it never moved), with no earlier stages filled in, and the timeline shows "Imported from Pipedrive by <user's name>" with the date and time.
8. **Given** a Pipedrive deal visible only to its owner, **When** imported, **Then** the CRM deal is private and its owner is also its creator, so only the owner sees it (as people in SF-117); the report counts private deals of other owners without naming them ("2 private deals of other owners imported.").
9. **Given** a Pipedrive deal whose value is in another currency than GBP, **When** imported, **Then** the deal is imported without a value and the report warns "Value in USD, not GBP: left out." on that deal.
10. **Given** a Pipedrive deal whose main person or organisation in Pipedrive was not brought into the CRM (not imported and not linked, for example the person had no name), **When** Deals is imported, **Then** the deal is not imported and the report lists it with the reason ("Its person 'No Name Fake' was not imported." or "Its organisation 'Fakeco' was not imported.").
11. **Given** a deal archived in Pipedrive, **When** imported, **Then** the CRM deal is imported archived.

---

### User Story 2 - Import notes onto the right records (Priority: P1)

Every Pipedrive note on a deal, person or organisation comes into the CRM as a note on the matching CRM record's timeline, at the date and time it was written in Pipedrive, by the teammate who wrote it.

**Why this priority**: Notes hold the history of every relationship; leaving them behind means leaving Pipedrive open forever (`docs/PRODUCT.md` §2: "Import from Pipedrive (people, organisations, deals, notes)").

**Independent Test**: With the fake Pipedrive holding 50 notes (on deals, people and organisations, one on a deal and a person, one on a person not imported, one on a Pipedrive lead, one with HTML formatting and an @-mention, one by a Pipedrive user with no CRM user), run an import and confirm each note on the right timeline with its text, author and time, and the report lines.

**Acceptance Scenarios**:

1. **Given** a Pipedrive note on a deal, person or organisation the import brought into the CRM, **When** imported, **Then** the record's timeline shows it as a NOTE at the date and time it was added in Pipedrive, written by the CRM user matched to its Pipedrive author (by email), or by the importing user when the author has no active CRM user (counted in that owner's report line, as in SF-117).
2. **Given** a Pipedrive note attached to several records (for example a deal and its person), **When** imported, **Then** it is added once, on the deal: the deal's timeline shows it once, and the person's timeline shows it once, as an entry of their deal; a note on a person and an organisation (no deal) is added once, on the person.
3. **Given** a Pipedrive note whose record (the deal, or the person when there is no deal, or the organisation when there is neither) was not brought into the CRM, **When** Notes is imported, **Then** the note is not imported and the report lists it with the start of its text and the reason ("Its deal 'Fakeco renewal' was not imported."); it is never moved to another record instead.
4. **Given** a Pipedrive note with formatting (paragraphs, line breaks, bold, lists, links), **When** imported, **Then** the CRM note is its plain text, keeping line breaks and the text of links, with no markup, and a link's address kept after its text when the two differ; a Pipedrive @-mention becomes plain text ("@Jane Fake"), and nobody is notified.
5. **Given** an imported note, **When** a teammate who can see the record opens it, **Then** they can edit or delete it like any note (SF-102).

---

### User Story 3 - Import activities with their dates, status and assignee (Priority: P1)

Every Pipedrive call, meeting and task comes into the CRM with its subject, due date and time, duration, note, done or not, assignee and the deal, person and organisation it is linked to, so the Activities list and the board's next-activity line are right from day one.

**Why this priority**: The Activities list, "⚠ No next activity" on deal cards and Last contacted all depend on activities; without them every deal looks neglected after the move.

**Independent Test**: With the fake Pipedrive holding 60 activities (calls, meetings, tasks, deadlines, done and planned, overdue, with and without a time, assigned to each fake user and to one with no CRM user, one on a deal not imported, one on nothing), run an import and confirm the Activities list, the deal cards' last line, the timelines' done activities, Last contacted on the people, and the report lines.

**Acceptance Scenarios**:

1. **Given** a Pipedrive activity of type call, meeting or task, **When** imported, **Then** the CRM activity has the same type, subject, due date, due time (shown in UK time), duration, note (as plain text, as in User Story 2), deal, person and organisation, and its assignee is the CRM user matched to the Pipedrive assignee by email, or the importing user when none (counted in that owner's report line).
2. **Given** a Pipedrive activity of another type (deadline, email, lunch, or a type the account added), **When** imported, **Then** the CRM activity is a task with all the other values of scenario 1, and the report has one line per Pipedrive type ("14 'deadline' activities imported as tasks.").
3. **Given** a done Pipedrive activity, **When** imported, **Then** the CRM activity is done, marked done at Pipedrive's done date and time by its assignee, and shows on the record's timeline there; a done call or meeting raises its person's Last contacted by the SF-109 rule (never lowering it).
4. **Given** a planned Pipedrive activity, **When** imported, **Then** it shows on the Activities list as Overdue, Today or planned by its due date, and the deal's board card shows its next date instead of "⚠ No next activity".
5. **Given** a Pipedrive activity linked to a deal, person or organisation the import did not bring into the CRM, **When** Activities is imported, **Then** the activity is not imported and the report lists it with its subject and the reason; an activity linked to nothing in Pipedrive is imported with no link.
6. **Given** an activity imported and assigned to someone other than the importing user, **When** the import ends, **Then** no notification is created for it (an import notifies nobody), and the assignee finds it on their Activities list.

---

### User Story 4 - Import files onto the right records (Priority: P2)

Every file attached to a Pipedrive deal, person or organisation is copied into the CRM's file store and listed in that record's "// FILES", where it can be previewed, downloaded and deleted like any file. Files over 25 MB are left out and listed.

**Why this priority**: Files are a "should have" (`docs/PRODUCT.md` priorities), and the import is still useful without them; they come after the records they hang on.

**Independent Test**: With the fake Pipedrive holding 12 files (PDF, PNG, a Word document, one of 26 MB, one empty, one on a person not imported, one attached to a Pipedrive email, one Google Drive link), run an import with the fake file store and confirm the files in "// FILES" with their names, sizes and dates, their FILE timeline entries, preview and download, and the report lines.

**Acceptance Scenarios**:

1. **Given** a Pipedrive file on a deal, person or organisation the import brought into the CRM, **When** imported, **Then** the record's "// FILES" lists it with its Pipedrive name, size, kind and upload date, uploaded by the CRM user matched to its Pipedrive uploader (or the importing user), and the timeline shows its FILE entry at that date; it previews and downloads with exactly the bytes Pipedrive holds.
2. **Given** a file attached to several records in Pipedrive, **When** imported, **Then** it is added once, on the deal, else the person, else the organisation, as for notes; a file whose record was not brought into the CRM is not imported and listed ("Its person 'No Name Fake' was not imported.").
3. **Given** a Pipedrive file over 25 MB, **When** Files is imported, **Then** it is not imported and the report lists it with its name and size ("Over 25 MB (26.1 MB)."); nothing of it is stored.
4. **Given** an empty file, a file name longer than 255 characters, a file Pipedrive no longer has, a file attached only to a Pipedrive email, or a linked document (Google Drive and similar), **When** Files is imported, **Then** it is not imported and the report lists it with its reason.
5. **Given** the file store is not set up or cannot be reached, **When** the user ticks Files and presses `[ IMPORT ]`, or the store fails during an import, **Then** "Files can't be reached right now. Try again in a minute." is shown, the import does not start (or pauses with `[ CONTINUE ]`), and no file is half-stored.

---

### User Story 5 - The report and repeats cover the new kinds (Priority: P1)

The progress screen and the report count deals, notes, activities and files like people and organisations, an import can be repeated or resumed without ever adding any of them twice, and the report lists every skipped one with its reason.

**Why this priority**: The kickoff promises an import that never duplicates and ends with a report of what was left out; both must hold for the new kinds, which are far more numerous.

**Independent Test**: With the fake Pipedrive holding 3,000 people, 800 organisations, 2,000 deals, 10,000 notes, 8,000 activities and 300 files and set to answer "too many requests" every few calls, run an import, close the page half-way, continue, then run a second import, and confirm each Pipedrive record is in the CRM exactly once and the counts match.

**Acceptance Scenarios**:

1. **Given** an import with Deals, Notes, Activities and Files ticked, **When** it runs, **Then** "// PROGRESS" shows a line per ticked kind in the order Organisations, People, Deals, Notes, Activities, Files with "<done> of <total>" and a bar, and the paused message lists them in the same order.
2. **Given** a finished import, **When** the report opens, **Then** it shows per kind the counts imported, linked (people and organisations only), already imported and not imported; the pipelines and stages added; every deal, note, activity and file not imported with its Pipedrive name (a note by the start of its text) and reason; the warnings; and links to the Deals board and the Activities list beside the People and Organisations links.
3. **Given** a finished import, **When** the user runs it again, **Then** deals, notes, activities and files imported before are left as they are (even if edited or deleted in the CRM since) and counted as already imported; only ones new in Pipedrive are added.
4. **Given** a note, activity or file that was skipped because its record was not imported, **When** a later import brings that record in, **Then** the note, activity or file is imported then.
5. **Given** a part that fails half-way (Pipedrive or the file store unreachable, time running out), **When** the user continues, **Then** the report's imported count of each kind equals the number of those records in the fake Pipedrive minus those listed as not imported, and no deal, note, activity or file appears twice on any page.

---

### Edge Cases

- The user ticks Deals, Notes, Activities or Files: People and Organisations become ticked and cannot be unticked while one of those four is ticked (the consent choice then shows); when the user unticks all four, People and Organisations stay ticked and can be unticked again. If the page is sent without People or Organisations while one of the four is ticked, the server ticks them itself, and the progress screen shows lines for Organisations and People.
- A user who is not an admin imports deals whose Pipedrive pipelines or stages are missing from the CRM: the import creates them exactly as for an admin; the Pipelines admin page then shows them, and the report lists each one added. The user still cannot add, rename, reorder or delete pipelines or stages on the Pipelines admin page.
- Two Pipedrive pipelines whose names differ only in case or spaces: both pipelines' deals are on the one CRM pipeline's board; two such stages of one pipeline likewise share one CRM stage; the report warns once ("Pipedrive pipelines 'Sales' and 'sales ' were imported into one pipeline.").
- A Pipedrive pipeline or stage name the CRM form would refuse (longer than 100 characters): the pipeline or stage is not created, its deals are not imported, and the report says why.
- A deal title the deal form would refuse (empty, longer than 200 characters): not imported with the form's message. A value over the CRM's limit, a negative value or an invalid expected close date: left out with a warning; the deal is still imported.
- A lost reason longer than 500 characters: the deal is imported as Lost with the reason "Lost reason too long to import from Pipedrive." and the report warns; a reason is never cut.
- A deal whose main person was linked to an existing CRM person (same email): the deal is on that existing person, who is otherwise left as they are.
- A deal whose main person is a private CRM person (linked or imported) whom the importing user cannot see: the deal is imported on that person; the report line for the deal shows "a private person" instead of their name.
- Notes, activities and files on a private deal or person (including a linked private person): a user who cannot see the record finds none of them on the Activities list, in Notifications or on any timeline, and the importing user's report counts them ("4 notes on private records of other owners imported.") without naming the record.
- A note longer than the CRM keeps (100,000 characters) or empty once its markup is removed: not imported and listed. An activity note longer than 10,000 characters: left out with a warning. An activity subject empty or longer than 200 characters, or with no due date: not imported and listed. A duration that is not a whole number of 5 minutes between 5 minutes and 24 hours: rounded up to the next 5 minutes when within the range, else left out with a warning.
- Notes, activities and files on Pipedrive leads, projects or emails: not imported; the report counts them in one line per kind ("14 notes on Pipedrive leads: not imported.").
- A Pipedrive deal, note, activity or file deleted between two parts: it is not in the CRM and the report has no line for it; one added during the import is in the CRM after the next import at the latest, counted there as imported.
- A deal or record imported earlier and since deleted in the CRM by an admin: its Pipedrive link remains, so it is not added back (as in SF-117); notes, activities and files on it are skipped and listed ("Its deal was deleted in the CRM.").
- Pipedrive text such as `<a href="https://evil.example">Click</a>` in a deal title, note, activity subject or file name: shown exactly as text everywhere, never as a link or markup; a note's link address is shown as plain text, never made clickable by the import. A file name is downloaded under a safe name, as in SF-116.
- The importing user is deactivated, the token is removed or refused, or the import is stopped during a file copy: the progress screen shows the SF-117 message for that case, the file being copied is not in the record's "// FILES", and the records already imported stay (as in SF-117).
- A user who is not signed in or is deactivated sends an import request: refused; nothing is imported.
- Pipedrive asks the CRM to slow down every third or fourth call during an import with deals that have followers and other linked people: the import still moves on and finishes; every deal is imported once with its followers and other linked people.

## Requirements *(mandatory)*

### Functional Requirements

**Choosing**

- **FR-001**: The "1 CHOOSE" step MUST offer six checkboxes, all unticked: People, Organisations, Deals, Notes, Activities, Files, and MUST say that Pipedrive emails are not imported. The consent choice of SF-117 MUST show only while People is ticked.
- **FR-002**: Ticking Deals, Notes, Activities or Files MUST tick People and Organisations, which MUST stay ticked while one of those four is ticked (the server MUST enforce it too). Deals, notes, activities and files MUST be attached only to CRM records brought in by an import (imported or linked); one whose record could not be brought in is skipped and listed.
- **FR-003**: Ticking Files MUST NOT start an import while the file store is not set up or cannot be reached; the fixed message of SF-116 MUST be shown.

**Deals**

- **FR-004**: Each Pipedrive pipeline and stage MUST be matched to the CRM pipeline, and the stage within it, of the same name (ignoring case and surrounding spaces). Missing ones MUST be created (pipelines at the end of the list, stages at the end of their pipeline, in Pipedrive's order), by any importing user, admin or not (an exception to the SF-93 rule that only admins create pipelines and stages, recorded in `docs/DECISIONS.md`), and listed in the report. An import MUST NOT rename, reorder or delete a CRM pipeline or stage.
- **FR-005**: A Pipedrive deal MUST be imported with: title, value (GBP only; another currency left out with a warning), stage, owner (matched by email as in SF-117), main person, organisation, other linked people (its participants brought into the CRM), followers (active CRM users matched by email), labels (matched to deal labels still offered, never added; unmatched listed once with a count), expected close date, status (open, Won with Pipedrive's won date, Lost with Pipedrive's lost date and reason or "No reason given in Pipedrive."), Date added, archived or not, privacy, and matched deal custom fields under the SF-117 custom field rules.
- **FR-006**: A deal MUST NOT be imported when its Pipedrive main person or organisation was not brought into the CRM; the report MUST list it with the reason. A missing participant MUST only be left out with a warning.
- **FR-007**: A Pipedrive deal visible only to its owner MUST be private in the CRM with its CRM owner as creator (the importing user when the owner has no CRM user); every other deal MUST be shared with the importing user as creator. The report MUST count, not name, private deals the importing user cannot see.
- **FR-008**: An imported deal's stage time MUST start at Pipedrive's last stage change date (or its added date); earlier stage history MUST NOT be invented. Each imported deal MUST get the timeline entry "Imported from Pipedrive by <user's name>"; imported deals and their won / lost status MUST NOT add other timeline entries or notify followers.

**Notes**

- **FR-009**: Each Pipedrive note on a deal, person or organisation MUST be imported once as a note on exactly one CRM record: the deal when it has one, else the person, else the organisation; when that record was not brought into the CRM, the note MUST NOT be imported (never moved to another record) and MUST be listed with its reason.
- **FR-010**: An imported note MUST keep its Pipedrive added date and time, its author matched by email (else the importing user, counted in the owner lines), and its text as plain text without markup, keeping line breaks and link text; Pipedrive mentions MUST become plain text and MUST NOT notify anyone.

**Activities**

- **FR-011**: Each Pipedrive call, meeting and task MUST be imported with: type, subject, due date, due time (converted to UK time), duration, note (plain text), deal, person and organisation, assignee (matched by email, else the importing user), done or not with Pipedrive's done date and time. An activity of any other Pipedrive type MUST be imported as a task, and the report MUST count these per Pipedrive type.
- **FR-012**: An activity linked in Pipedrive to a deal, person or organisation not brought into the CRM MUST NOT be imported and MUST be listed; an activity linked to nothing MUST be imported unlinked.
- **FR-013**: A done imported call or meeting MUST raise its person's Last contacted by the SF-109 rule. An import MUST NOT create any notification (assignment or mention).

**Files**

- **FR-014**: Each Pipedrive file on a deal, person or organisation MUST be copied byte for byte into the CRM file store and listed once on one record, chosen as for notes (FR-009), with its Pipedrive name, upload date and uploader (matched by email, else the importing user) and a FILE timeline entry at its upload date.
- **FR-015**: A file over 25 MB, empty, with a name over 255 characters, no longer in Pipedrive, attached only to a Pipedrive email, a linked document rather than an uploaded file, or whose record was not brought into the CRM MUST NOT be imported and MUST be listed with its name, size when known, and reason. A skipped or failed file MUST leave nothing in the file store.

**Repeats, progress and report**

- **FR-016**: Each deal, note, activity and file imported MUST keep its Pipedrive company and ID; none may ever be added twice, whether imports are repeated, resumed or run by two users at once, and one imported before MUST be left as it is (even if changed or deleted in the CRM since) and counted as already imported.
- **FR-017**: Each deal, note, activity and file MUST be saved whole or not at all; a failed part MUST leave none half-saved. Each file up to 25 MB MUST be copied within a single part.
- **FR-018**: The import MUST run the kinds in the order Organisations, People, Deals, Notes, Activities, Files, and the progress screen MUST show "<done> of <total>" and a bar for each ticked kind in that order, with the SF-117 states (running, waiting for Pipedrive, paused, stopped, finished).
- **FR-019**: The report MUST add, for deals, notes, activities and files: counts imported, already imported and not imported; the pipelines and stages added; every record not imported with its Pipedrive name (a note by the start of its text) and reason; records on Pipedrive leads, projects and emails counted in one line per kind; warnings; and links to the Deals board and the Activities list.
- **FR-020**: Pipedrive emails (mail messages and their attachments) MUST NOT be imported.

**Access, messages and look**

- **FR-021**: Every message MUST be one of the app's fixed messages; Pipedrive values MUST appear only as quoted data, never as links or markup. The report and progress screen MUST name or link a CRM person or deal only if the importing user can see it.
- **FR-022**: The import page keeps the SF-117 design B layout and step bar; the new kinds add checkboxes, progress lines and report sections only, following `docs/DESIGN.md`.
- **FR-023**: The whole feature MUST work and be tested against the fake Pipedrive and the fake file store; no real Pipedrive account or token is used.

### Key Entities

- **Pipedrive link**: As in SF-117, now also for the kinds deal, note, activity and file: the Pipedrive company, kind and ID, and the CRM record it became, so none is ever imported twice.
- **Pipedrive import**: As in SF-117, plus what was ticked among Deals, Notes, Activities and Files, where it has got to and the totals for each, and their report lines (pipelines and stages added, records not imported with reasons, counts on leads, projects and emails).
- **Pipeline, Stage, Deal, Deal label, Follower, Note, Activity, File, Custom value, Timeline entry**: As in SF-93, SF-95, SF-102, SF-109, SF-115 and SF-116; imported ones carry their Pipedrive dates (added, stage change, won / lost, note added, done, file uploaded).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An account of 3,000 people, 800 organisations, 2,000 deals, 10,000 notes and 8,000 activities is fully imported in under 60 minutes with the progress screen open, every part finishing within the hosting's time limit for one request, even when the fake Pipedrive asks the CRM to slow down.
- **SC-002**: In automated tests, closing and resuming at any point, repeating an import, or two users importing the same company at once leaves exactly one CRM deal, note, activity and file per Pipedrive one.
- **SC-003**: In automated tests, 100% of the fake data's deal values (pipeline, stage, title, value, owner, people, organisation, labels, followers, expected close date, status, lost reason, privacy, custom fields), notes (record, text, author, time), activities (type, subject, due date and time, duration, done, assignee, links) and files (record, name, bytes, uploader, date) appear on the imported records, and every one left out appears in the report with its reason.
- **SC-004**: In automated tests, no note, activity or file is ever attached to a record other than the one it belongs to in Pipedrive, and no file over 25 MB is stored.
- **SC-005**: In automated tests, every owner-only Pipedrive deal is visible only to its CRM owner, its notes, activities and files only to those who see it, and no report or progress screen names a private person or deal the importing user cannot see.
- **SC-006**: After an import, a user can find any imported deal on its pipeline's board and any planned activity on the Activities list without further setup, and no imported activity or note has created a notification.

## Assumptions

- Deals have no natural match in the CRM (unlike people by email and organisations by name): a Pipedrive deal is always imported once, never linked to an existing CRM deal.
- Every active Pipedrive pipeline and stage is matched or created, including empty ones, so the team finds the same boards; Pipedrive stage probabilities and rotting settings are not imported (the CRM has neither).
- Earlier stage history, deal products, probability, activity participants beyond the main person, Pipedrive "busy / free" and location, note pinning, and "Referred by" are not read from Pipedrive. Deal followers are imported because the CRM uses them (kickoff: each ticked type comes with all the information the CRM uses).
- A note or file attached to several records goes on the most specific one (deal, then person, then organisation); the CRM already shows a deal's entries on its person's and organisation's timelines, and putting it elsewhere when the deal is missing could reveal a private deal's content.
- Pipedrive due times are read as Pipedrive gives them (UTC) and shown in UK time, as the CRM keeps activities.
- The import notifies nobody: imported mentions and assignments are history, not news.
- Files are copied through the app into the CRM file store (no Storage call inside a database transaction, as SF-116 requires); a file is fetched from Pipedrive only for this copy.
- Undoing an import, updating already imported records from Pipedrive, and importing Pipedrive emails, leads, projects and products are out of scope; emails come with the Gmail issues.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
