# Feature Specification: Files

**Feature Branch**: `factory/sf-116-step-8-files`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 8 - Files. Files (`docs/PRODUCT.md` section 5): upload files to deals, people and organisations, list them on the record page, preview images and PDFs in the browser, and download any file. Up to 25 MB per file (Gmail's attachment limit, so a file can later be attached to an email). Adding or deleting a file shows on the record's timeline. Files follow the record's private rules, also for direct download links. Files are stored in Supabase Storage, with a fake in tests like every other outside service. Attaching files to emails comes with the email issues."

## Clarifications

### Session 2026-11-24

- Q: Which design? → A: Design: A, a "// FILES" table above the timeline (name, kind, size, added by, date, `[ PREVIEW ]` / `[ DOWNLOAD ]` / `[ DELETE ]`, `[ ADD FILE ]` in the section heading), the image preview in a box over the page with `[ DOWNLOAD ]` and `[ CLOSE ]`, FILE entries on the timeline (see `design-options.html`).
- Q: Who can delete a file? → A: Anyone who can see the record, as with notes (SF-102).
- Q: Which files does a person or organisation page list under "// FILES"? → A: Only the files added to that person or organisation; their deals' files show only as FILE entries on the timeline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload a file to a deal, person or organisation (Priority: P1)

A team member opens a deal, a person or an organisation and presses `[ ADD FILE ]`. They pick one or more files from their computer (a proposal PDF, a signed contract, a screenshot). Each file is uploaded, then listed in the record's "// FILES" section with its name, size, who added it and when.

**Why this priority**: Files on deals, people and organisations are asked for by name (PRODUCT §5, "Files and attachments on deals and emails", Should have); every other story (listing, preview, download, timeline, privacy) needs files to exist.

**Independent Test**: With the fake data loaded, upload a 2 MB PDF to a deal, a PNG to a person and a spreadsheet to an organisation; confirm each shows in its record's "// FILES" with name, size, uploader and date after a reload; try a 26 MB file and an empty file and confirm both are refused with nothing saved.

**Acceptance Scenarios**:

1. **Given** a deal, person or organisation the user can see and that is not archived, **When** they press `[ ADD FILE ]`, pick "proposal.pdf" (2.1 MB) and the upload finishes, **Then** "proposal.pdf · 2.1 MB · <uploader name> · <date>" is listed first in the record's "// FILES" and "File added." is shown.
2. **Given** the user picks several files at once, **When** they are uploaded, **Then** each file is checked and saved on its own: the accepted ones are listed, and each refused one is named with its reason; one refused file never stops the others.
3. **Given** a file larger than 25 MB, **When** the user picks it, **Then** "<file name> is over 25 MB, the most a file can be." is shown and nothing of it is saved; a file of exactly 25 MB is accepted.
4. **Given** an empty file (0 bytes), **When** the user picks it, **Then** "<file name> is empty." is shown and nothing is saved.
5. **Given** an upload in progress, **When** it is shown, **Then** the file's row reads "Uploading <file name>… <n>%" until it is done; if the connection drops, "<file name> couldn't be uploaded. Try again." is shown, and after a reload "// FILES" does not list the file.
6. **Given** a file with the same name as one already on the record, **When** it is uploaded, **Then** both are kept and listed; neither replaces the other.

---

### User Story 2 - See, preview and download a record's files (Priority: P1)

On a deal page, deal drawer, person page or organisation page, the team member sees the record's "// FILES": every file on it, newest first. Clicking an image or a PDF opens it in the browser to look at it without downloading; any file can be downloaded with its original name.

**Why this priority**: Files are only useful if the team can find and open them from the record (PRODUCT §5: "preview and download them").

**Independent Test**: On a deal with a PNG, a PDF and a .docx, open the deal page; confirm all three are listed newest first; open the PNG and the PDF in the browser preview; download the .docx and confirm the downloaded file has the original name and the exact same content as the uploaded one.

**Acceptance Scenarios**:

1. **Given** a record the user can see, **When** its page or the deal drawer is shown, **Then** "// FILES (<n>)" is shown between "// NEXT ACTIVITIES" and "// TIMELINE" with `[ ADD FILE ]` in its heading, and a table lists every file on the record, newest first, with the columns Name, Kind, Size, Added by and Added, and on each row `[ PREVIEW ]` (images and PDFs only), `[ DOWNLOAD ]` and `[ DELETE ]`; with no files it shows "No files yet." and `[ ADD FILE ]`.
2. **Given** a file that is a JPEG, PNG, GIF or WebP image, **When** the user clicks its name or `[ PREVIEW ]`, **Then** a box opens over the page showing the image scaled to fit, its name and size, `[ DOWNLOAD ]` and `[ CLOSE ]`; `[ CLOSE ]` closes the box and the record page is shown again.
3. **Given** a PDF file, **When** the user clicks its name or `[ PREVIEW ]`, **Then** the PDF opens in the browser's own PDF viewer, where the user can scroll its pages.
4. **Given** any other kind of file (Word, Excel, CSV, ZIP, SVG, HTML, text…), **When** the user clicks its name, **Then** it is downloaded, never opened inside the app; there is no `[ PREVIEW ]` for it.
5. **Given** any file, **When** the user presses `[ DOWNLOAD ]`, **Then** the browser saves it under its original name with exactly the bytes that were uploaded.
6. **Given** a deal drawer on the board, **When** it is opened, **Then** it shows the deal's "// FILES" the same way as the deal page, with `[ ADD FILE ]`.

---

### User Story 3 - Files follow the record's private rules, also for direct links (Priority: P1)

A file on a private person or a private deal is seen, previewed and downloaded only by the users who can see that record (its creator and owner, SF-92, SF-93), admins included in the hidden group. A download or preview address copied out of the app and sent to someone else gives them nothing unless they are signed in and can see the record.

**Why this priority**: The team decision is that a private contact or deal is hidden from everyone but those allowed; files (contracts, CVs, proposals) are often more sensitive than notes. A leak through a copied link would break that rule.

**Independent Test**: As Ada Fake, make a deal private and upload "contract.pdf" to it; copy its download and preview addresses. As Bob Fake (an admin), open both addresses, the deal's organisation and person pages, and confirm the file appears nowhere and both addresses answer "This file doesn't exist or you can't see it."; signed out, confirm both addresses go to sign-in; then make the deal shared and confirm Bob can download it.

**Acceptance Scenarios**:

1. **Given** a file on a record hidden from a user, **When** that user opens any page, list or timeline, **Then** the file and its timeline entries are not shown and not counted.
2. **Given** a download or preview address of a file on a record hidden from the user, **When** they open it, **Then** "This file doesn't exist or you can't see it." is shown and no byte of the file is sent; the answer is the same as for a file that never existed.
3. **Given** a download or preview address, **When** it is opened by someone not signed in, **Then** they are sent to sign-in and, after signing in, only get the file if they can see its record.
4. **Given** a record that becomes private after a teammate copied one of its file addresses, **When** the teammate opens the address, **Then** they get nothing, from that moment on.
5. **Given** the file's contents are held by the outside storage service, **When** the app hands the browser any address that reaches the storage directly, **Then** that address works for that one file only and stops working within 5 minutes; storage holds no file that can be reached without the app.
6. **Given** a direct request to upload to, or delete a file from, a record the user cannot see, **When** it is sent, **Then** "This file doesn't exist or you can't see it." (or "This record doesn't exist or you can't see it." for uploads) is shown and nothing changes.
7. **Given** a deactivated user's private people and deals are handed over (SF-92, SF-97), **When** the new owner opens them, **Then** they see, preview and download their files.

---

### User Story 4 - Adding or deleting a file shows on the timeline (Priority: P2)

Every file added or deleted is written on the record's timeline, so the team can see what was shared and when, next to notes, activities and stage changes.

**Why this priority**: PRODUCT §1 lists files among the things a deal's timeline shows; it depends on uploads existing (US1).

**Independent Test**: Upload "proposal.pdf" to a deal, then delete it; confirm the deal's timeline shows "Ada Fake added proposal.pdf" and "Ada Fake deleted proposal.pdf" with a FILE tag and their times, and that the deal's person and organisation timelines show the same entries as they show the deal's other entries.

**Acceptance Scenarios**:

1. **Given** a file was added to a record, **When** its timeline is shown, **Then** an entry tagged FILE reads "<name> added <file name> (<size>)" at the time it was added; while the file still exists, the file name is a link that previews or downloads it as in US2.
2. **Given** a file was deleted from a record, **When** its timeline is shown, **Then** an entry tagged FILE reads "<name> deleted <file name>" at the time it was deleted, and the earlier "added" entry stays but its file name is no longer a link.
3. **Given** a person's or organisation's timeline that also shows their linked deals' entries (SF-102), **When** a file is added to or deleted from one of those deals, **Then** the entries show there too, under the same rules as the deal's other entries.
4. **Given** the timeline is shown to a user who cannot see the record the file is on, **When** it is built, **Then** none of that file's entries are included.

---

### User Story 5 - Delete a file (Priority: P2)

A team member removes a file uploaded by mistake or out of date. It disappears from the record and cannot be downloaded any more.

**Why this priority**: Needed to correct mistakes and to remove a file that should not be kept; it comes after upload and download.

**Independent Test**: Delete a file from a person page, confirm the question, and check that it is gone from "// FILES", its download address answers "This file doesn't exist any more." and the timeline shows the "deleted" entry.

**Acceptance Scenarios**:

1. **Given** a file on a record the user can see and that is not archived, **When** they press `[ DELETE ]` and confirm "Delete <file name>? This can't be undone.", **Then** the file is removed from the record and from storage, "File deleted." is shown, and its download and preview addresses no longer give the file.
2. **Given** a file someone else deleted after the page was loaded, **When** the user presses `[ DELETE ]` or `[ DOWNLOAD ]`, **Then** "This file doesn't exist any more." is shown and nothing changes.
3. **Given** the confirmation, **When** the user presses `[ CANCEL ]`, **Then** nothing changes.

---

### Edge Cases

- An archived deal, person or organisation still lists its files, which can be previewed and downloaded, but has no `[ ADD FILE ]` and no `[ DELETE ]`; a direct request answers "Restore this record before changing its files."
- When a deal, person or organisation is deleted for good (admins only), its files are deleted with it, from storage too, and their old download addresses answer "This file doesn't exist or you can't see it.". Their entries on the timelines of other records (a deal's file shown on its person's timeline) go with the deal's other entries.
- A won or lost deal that is not archived still lists its files and shows `[ ADD FILE ]` and `[ DELETE ]`.
- File names are kept as given (up to 255 characters, any language), shown as plain text, never as markup or a link to anything but the file; characters that cannot be part of a saved file name (such as `/`, `\`, control characters) are replaced when downloading, never letting a name pick where the file is saved. A name longer than 255 characters is refused with "<shortened file name> has a name over 255 characters.".
- The kind of file is decided from its content and name together: a text file renamed "fake.png" is listed with no `[ PREVIEW ]` and is downloaded when clicked. An SVG or HTML file is listed with no `[ PREVIEW ]` and is downloaded when clicked, never shown inside the app.
- Two users upload at the same moment to the same record: after a reload "// FILES" lists both files and the timeline shows two "added" entries.
- Two users delete the same file at the same moment: it is deleted once and the timeline shows one "deleted" entry; the second user sees "This file doesn't exist any more.".
- If the storage service is unreachable, uploading, previewing or downloading shows "Files can't be reached right now. Try again in a minute." and the rest of the record page still works; a file is never listed unless its contents were stored.
- If removing a file's contents from storage fails after it was deleted in the app, the user still sees "File deleted.", the file is no longer listed, and its old download address answers "This file doesn't exist any more."; the leftover contents are removed later.
- A deactivated uploader: files added by a user later deactivated stay listed, with "<name> (deactivated)" as who added them.
- A file on a person who is a deal's main person is not listed on the deal, and a deal's file is not listed in the person's "// FILES": each record lists only its own files (the timeline rule of US4 scenario 3 still applies).

## Requirements *(mandatory)*

### Functional Requirements

**Files**

- **FR-001**: Signed-in users MUST be able to add one or more files to any deal, person or organisation they can see that is not archived, from the record page and from the deal drawer. Each file MUST be between 1 byte and 25 MB (25 × 1,024 × 1,024 bytes) and have a name of at most 255 characters; each file of a multiple upload MUST be accepted or refused on its own, with a reason naming the file.
- **FR-002**: For each file, the app MUST keep its original name, its kind, its size, the record it is on, who added it and when. A file MUST only be listed once its full contents are stored; nothing half-uploaded is ever listed or downloadable.
- **FR-003**: Each deal page, deal drawer, person page and organisation page MUST show "// FILES (<n>)" with the record's own files, newest first, each with name, kind, size, uploader and date, and actions as in US2.
- **FR-004**: Users MUST be able to preview JPEG, PNG, GIF and WebP images and PDF files in the browser; every other kind of file MUST only be downloaded, and no file MUST ever be shown as a page or run as code inside the app.
- **FR-005**: Users MUST be able to download any file they can see, under its original name (unsafe characters replaced) and with exactly the bytes uploaded.
- **FR-006**: Users MUST be able to delete a file on a record they can see that is not archived, after a confirmation; its contents MUST be removed from storage and its addresses MUST stop giving the file at once.

**Timeline**

- **FR-007**: Adding a file and deleting a file MUST each add an entry tagged FILE to the record's timeline, with who did it, the file name, the size (when added) and the time, as in US4; the "added" entry links to the file only while it exists. Entries MUST follow the existing timeline rules, including showing a deal's entries on its people's and organisation's timelines (SF-102).

**Access, privacy, archive, messages, look**

- **FR-008**: Every page, address and action MUST require a signed-in, active user; nothing here is admin-only. Any user who can see a record can add files to it and delete its files, whoever added them (as for notes, SF-102).
- **FR-009**: A file and its timeline entries MUST be visible only to users who can see its record (private person rule SF-92, private deal rule SF-93), on every page, list, count, timeline and direct request, including every download and preview address; the check MUST be made each time the file is asked for, never once when a link is made.
- **FR-010**: A file's contents MUST never be reachable without going through the app: any address that reaches the storage service directly MUST be for one file, made only after the check of FR-009, and MUST stop working within 5 minutes.
- **FR-011**: Files on an archived record MUST stay listed, previewable and downloadable; adding and deleting MUST be refused until the record is restored.
- **FR-012**: When a deal, person or organisation is deleted for good, its files MUST be deleted with it, contents included.
- **FR-013**: Every message shown MUST be one of the app's fixed messages (built only from a file name or a user name where a message names one); text from the page address MUST never be shown; file names are shown as plain text only.
- **FR-014**: "// FILES", the upload, the preview and the delete confirmation MUST follow design A in `design-options.html` (a "// FILES" table between "// NEXT ACTIVITIES" and "// TIMELINE" on record pages and the deal drawer, the image preview in a box over the page) and `docs/DESIGN.md`; the FILE timeline entry MUST follow the timeline's design B (SF-102).

**Storage and fake**

- **FR-015**: File contents MUST be kept in the team's file storage service (Supabase Storage), reached through settings, never in the app's database; the storage MUST not be public. Local runs and tests MUST use a fake storage with the same behaviour, so the whole feature is built and tested without a real account (team decision, kickoff).
- **FR-016**: The fake data command MUST add, without duplicates when run again, files of several kinds (images, PDFs, other documents) on fake deals, people and organisations, with their timeline entries, including at least one on a private deal and one on a private person, and one on an archived record.

### Key Entities

- **File**: a file on one deal, person or organisation: original name, kind, size, who added it and when, and where its contents are kept in storage. Exactly one record per file.
- **Timeline entry** (from SF-90/SF-102): now also "file added" and "file deleted", tagged FILE, keeping the file name and size so the entry still reads after the file is deleted.
- **Deal, Person, Organisation, User** (existing): what files are on, and who added them; a record's private rule decides who sees its files.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a file to a deal, person or organisation in under 30 seconds, not counting the transfer time of the file.
- **SC-002**: A 25 MB file uploads successfully on a normal office connection (20 Mbit/s up) in under 30 seconds, and a downloaded file is byte-for-byte the same as the uploaded one in 100% of automated checks.
- **SC-003**: An image or PDF opens in preview in under 3 seconds for files up to 10 MB.
- **SC-004**: In automated tests, a file on a private deal or private person is never listed, counted, shown on a timeline, previewed or downloaded by anyone the privacy rules hide it from, through any page or any direct address.
- **SC-005**: In automated tests, files over 25 MB and empty files are always refused, and no refused or interrupted upload ever leaves a file listed on a record.
- **SC-006**: In automated tests, every file added or deleted gives exactly one timeline entry on its record.

## Assumptions

- Attaching files to emails, and files received as email attachments, come with the email issues (user request); the 25 MB limit is chosen now so any file can later be attached to a Gmail email.
- Importing files from Pipedrive is part of the Pipedrive import issue, not this one.
- Files are not renamed, replaced or versioned in this issue: a new version is uploaded as a new file and the old one deleted if wanted.
- Each record lists only its own files; a person or organisation page does not list its deals' files (their timeline shows the deals' FILE entries, as for notes).
- Previews are only for common images (JPEG, PNG, GIF, WebP) and PDFs, as asked; Word, Excel and other documents are downloaded. SVG is not previewed because it can carry code.
- Files are not scanned for viruses in this issue; files are never run or shown as pages inside the app, and downloads are saved, not opened, by the browser.
- There is no limit on the number of files per record or on total storage in this issue; the storage plan's size is watched by the team.
- Deleting a file is final (no bin), like deleting a note; deleting a record for good stays admin-only, archiving keeps its files.
- No notification is sent when a file is added; teammates see it on the timeline.
- The Supabase project and its storage are set up before go-live with the other real accounts; developing and testing need no Supabase account (team decision, kickoff).
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
