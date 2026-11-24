# Feature Specification: Campaigns: writing the content

**Feature Branch**: `factory/sf-119-step-14-campaigns-writing-the-content`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 14 - Campaigns: writing the content. A Campaigns page where users write campaign drafts (`docs/PRODUCT.md` section 4, "Writing the email"): a name, the sender name, a reply-to address, the subject and preview text with merge tags (first name, last name, organisation and the other person fields, custom fields included), and the content, built from blank with a few simple layouts or pasted as HTML. A preview shows the email for a chosen person in the CRM, with what a merge tag shows when the person's field is empty. Drafts can be edited, duplicated and deleted. Pasted HTML is shown safely in the app. Not in this issue: recipients, the sender address, test send and sending (a later issue), starting from a saved template (a later issue)."

## Clarifications

### Session 2026-11-24

- Q: Which design? → A: Design: A, one edit page with the draft (// DETAILS, // CONTENT) on the left and a live preview for a chosen person on the right; the Campaigns page is a table (see `design-options.html`).
- Q: Who can edit and delete a campaign draft? → A: Everyone on the team can edit, duplicate and delete every draft.
- Q: When an admin renames a people custom field, what happens to merge tags that use it? → A: The tags follow the rename and show the new name, in the subject, the preview text, layout blocks and pasted HTML; a tag typed by hand is matched to its field when the draft is saved.

### Plan 2026-11-24

- Q: When pasted HTML names remote images, stylesheets or fonts, may the preview load them from their own web addresses in the user's browser? → A: Yes, images, stylesheets and fonts only (sent with no referrer); nothing else in the HTML can load or connect: no scripts, frames, forms or other requests (decided by the factory, to confirm)
- Q: What happens to a hand-typed "If empty, show" text longer than 100 characters? → A: For a tag that names a merge field the save is refused with "If empty, show: at most 100 characters."; a `{{…}}` that names no merge field is only listed as an unknown merge tag, never refused (decided by the factory, to confirm)
- Q: Does `[ DUPLICATE ]` on the edit page copy unsaved changes? → A: No, it copies the draft as last saved; unsaved changes in the open page stay only in that page (decided by the factory, to confirm)
- Q: What does the preview show for a chosen person who is archived after being chosen? → A: The same as for a person the user can no longer see: "Choose a person to preview." and none of their values; archived people are never offered in the picker (decided by the factory, to confirm)
- Q: Can a link in pasted HTML that names its own target (for example `target="_self"`) open inside the preview? → A: No, every link in the preview opens in a new browser tab, whatever target the HTML gives it (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start and save a campaign draft (Priority: P1)

A team member opens "Campaigns" in the sidebar and sees the team's campaign drafts. `[ NEW CAMPAIGN ]` asks for a name and creates a draft, which opens on its edit page. There they fill in the sender name, the reply-to address, the subject and the preview text, and press `[ SAVE ]`.

**Why this priority**: Every other part of this feature lives inside a draft; without the list and the draft there is nothing to write into.

**Independent Test**: Create the draft "Exec dinner – March (fake)", give it a sender name, reply-to address, subject and preview text, save, reload, and confirm every value is kept and the draft is listed on the Campaigns page with who last edited it and when.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they open the Campaigns page, **Then** it lists every campaign draft of the team, most recently edited first, with Name, Subject (or "—"), Status "Draft", Created by, and Last edited (who and when), and `[ NEW CAMPAIGN ]` in the page header; with no draft it says "No campaigns yet."
2. **Given** the Campaigns page, **When** the user presses `[ NEW CAMPAIGN ]` and gives a name, **Then** a draft is created with that name, the sender name set to the user's name and every other field empty, and its edit page opens.
3. **Given** a draft's edit page, **When** the user saves a name (1–100 characters), a sender name (at most 100 characters), a reply-to address (empty or one valid email address), a subject (at most 255 characters) and a preview text (at most 255 characters), **Then** the values are kept and the page says "Draft saved."
4. **Given** a draft's edit page, **When** the name is empty or too long, the sender name or subject or preview text is too long, or the reply-to address is not a valid email address, **Then** nothing is saved, the form keeps what was typed, and the message names the problem ("Give the campaign a name.", "A campaign name can be at most 100 characters.", "Reply-to: enter one valid email address.", "Subject: at most 255 characters.", and so on).
5. **Given** a draft with an empty subject or sender name, **When** it is saved, **Then** it is saved (a draft may be incomplete); the edit page shows "Still empty: " followed by those of Sender name, Subject and Content that are empty (e.g. "Still empty: Subject, Content").

---

### User Story 2 - Personalise with merge tags (Priority: P1)

While writing the subject, the preview text or the content, the user inserts merge tags such as `{{First name}}` or `{{Organisation}}` from an "Insert merge tag" list that offers the person fields and the people custom fields. For each tag they can say what to show when the person's field is empty, e.g. `{{First name | there}}` so "Hi {{First name | there}}" becomes "Hi there".

**Why this priority**: PRODUCT section 4 asks for merge tags in the subject and preview text; personalised campaigns are the reason the team writes them in the CRM.

**Independent Test**: In a draft, insert `{{First name | there}}` in the subject and `{{Diet}}` (a people custom field) in the content, save, and confirm both are kept; type `{{Favourite colour}}` (no such field) and confirm the draft is saved and warns about the unknown tag.

**Acceptance Scenarios**:

1. **Given** the subject, the preview text or a content text, **When** the user opens "Insert merge tag", **Then** it lists First name, Last name, Full name, Email, Phone, Organisation, Role, Lead source, LinkedIn, Owner and Labels, then every people custom field by its current name in the admin's order, and inserts the chosen tag at the cursor as `{{<field name>}}`.
2. **Given** an inserted tag, **When** the user fills in "If empty, show" (at most 100 characters), **Then** the tag becomes `{{<field name> | <text>}}`; the same can be typed by hand, including in pasted HTML.
3. **Given** a tag typed by hand, **When** its field name matches a merge field ignoring case and spaces at either end, **Then** it is recognised; **When** it matches none, **Then** the draft is still saved and the edit page and the preview list it under "Unknown merge tags: {{Favourite colour}}".
4. **Given** a saved draft using the tag `{{Diet | none given}}` in its subject, a text block and its pasted HTML, **When** an admin renames the custom field "Diet" to "Dietary needs" and the user reopens the draft, **Then** every one of those tags shows as `{{Dietary needs | none given}}` and the preview still shows the person's value.
5. **Given** a saved draft using a custom field tag, **When** an admin deletes that custom field, **Then** the tag shows with the field's last name and is listed under "Unknown merge tags" until the user changes it.

---

### User Story 3 - Build the content from a simple layout (Priority: P1)

A user who is not writing HTML picks one of a few simple layouts and fills in its blocks: headings, text, a button, an image, a divider. They can add, remove and reorder blocks.

**Why this priority**: Most campaigns are a short message with a link; the team must be able to write one without knowing HTML.

**Independent Test**: In an empty draft, choose the "Text with a button" layout, write a heading, two paragraphs with a merge tag and a button "Book a seat" linking to a fake web address, move the button above the second paragraph, save, and confirm the preview shows the blocks in that order.

**Acceptance Scenarios**:

1. **Given** a draft with no content, **When** the user opens its content, **Then** they choose between a layout — "Blank" (one text block), "Text" (heading and text), "Text with a button" (heading, text, button) and "Newsletter" (image, heading, text, button, divider, text) — or "Paste HTML".
2. **Given** a layout, **When** it is chosen, **Then** its blocks are shown in order, each editable: Heading (one line, at most 200 characters), Text (at most 10,000 characters; line breaks kept; web addresses become links), Button (label at most 60 characters and a link), Image (a web address of the image, alternative text at most 200 characters, and an optional link), Divider.
3. **Given** the blocks, **When** the user adds a block of any type, removes one, or moves one up or down, and saves, **Then** the content is kept in the new order; a draft holds at most 50 blocks.
4. **Given** a Button link or Image link, **When** it is not an `https://`, `http://` or `mailto:` address, **Then** nothing is saved and the message says "<Block>: enter a web address starting with https://." (images: `https://` only).
5. **Given** heading, text or button labels with `<b>` or other markup typed in, **When** the draft is previewed, **Then** the markup is shown as plain text, not applied.

---

### User Story 4 - Paste HTML content, shown safely (Priority: P1)

A user who has an email designed elsewhere chooses "Paste HTML", pastes it, saves, and sees it in the preview. Whatever the HTML contains, it cannot run anything in the app or reach the user's account.

**Why this priority**: PRODUCT section 4 asks for pasted HTML, and showing untrusted HTML inside a signed-in app is the main risk of this feature.

**Independent Test**: Paste a fake email whose HTML includes a script that would change the page, a form, an `onerror` handler and a link; save and preview, and confirm the email's text and styles show, the script and handler do nothing, the form cannot be sent, and clicking the link does not leave or change the app page.

**Acceptance Scenarios**:

1. **Given** "Paste HTML", **When** the user pastes HTML (at most 500,000 characters) and saves, **Then** after reloading, the HTML box shows it exactly as pasted, and the preview shows the email's text, images and colours with merge tags filled in.
2. **Given** pasted HTML containing scripts, event handlers, forms, frames or links, **When** it is shown anywhere in the app, **Then** a script or handler that would show an alert, change the page title or rewrite the page does nothing (no alert appears; the app's title, sidebar and header stay as they were); pressing a button of a form in it sends nothing and the page stays on the draft; and a link in it opens in a new browser tab while the app's tab stays on the draft.
3. **Given** HTML over 500,000 characters, **When** it is saved, **Then** nothing is saved and the message says "The HTML can be at most 500,000 characters."
4. **Given** a draft built from a layout, **When** the user switches to "Paste HTML", **Then** after a confirmation the HTML box starts with the HTML of the layout's content; **Given** pasted HTML, **When** the user switches to a layout, **Then** after a confirmation saying the HTML will be replaced, the chosen layout's blocks replace it.

---

### User Story 5 - Preview the email for a person (Priority: P1)

On the right of the draft's edit page, the user chooses a person from the CRM. The preview shows the email as that person would receive it: the sender name, the subject and preview text and the content with the person's values in the merge tags, and the "If empty, show" text — or nothing — where the person's field is empty.

**Why this priority**: The preview is how the user checks merge tags and content before a test send or sending exist; the description makes it part of this issue.

**Independent Test**: With the fake person "Fakey McFake" (no organisation) and a draft whose subject is "{{First name}}, news for {{Organisation | your team}}", preview for that person and confirm the subject reads "Fakey, news for your team"; choose another fake person with an organisation and confirm their organisation's name shows.

**Acceptance Scenarios**:

1. **Given** a draft's edit page, **When** no person is chosen, **Then** the "// PREVIEW FOR" picker is empty and each merge tag in the preview shows as its field name in brackets, e.g. "[First name]".
2. **Given** a chosen person, **When** the user types in the subject, the preview text or a block, or changes the content, without saving, **Then** the preview shows the new text with the person's values within 2 seconds.
3. **Given** the person picker, **When** the user types part of a name or email address, **Then** it offers only people they can see (private people follow SF-92), not archived, at most 20 at a time.
4. **Given** a chosen person, **When** the preview is shown, **Then** it shows "From: <sender name>", "Reply-to: <address>" (when set), the subject, the preview text and the content, with each tag replaced by the person's value, formatted as on the person page (custom values as in SF-115; Labels joined by commas; Email and Phone the first of each; Full name first and last name); a tag whose field is empty shows its "If empty, show" text, or nothing when it has none.
5. **Given** the preview, **When** it is shown, **Then** under the content it shows the unsubscribe line every campaign email will end with (PRODUCT section 4), with a link that does nothing in the preview.
6. **Given** person values containing markup such as "<b>Fake</b>", **When** they fill a tag, **Then** they show as plain text, in layout and pasted HTML content alike.
7. **Given** the chosen person, **When** the draft is saved or another user opens it, **Then** the chosen person is not stored on the draft; each user chooses their own.

---

### User Story 6 - Duplicate and delete drafts (Priority: P2)

From the Campaigns page or a draft's edit page, the user duplicates a draft to start a similar campaign, or deletes a draft they no longer need.

**Why this priority**: Useful for repeat campaigns (monthly dinners) and keeping the list tidy, but writing and previewing come first.

**Independent Test**: Duplicate "Exec dinner – March (fake)", confirm "Copy of Exec dinner – March (fake)" opens with the same fields and content; delete the copy after the confirmation and confirm it is gone from the list.

**Acceptance Scenarios**:

1. **Given** a draft, **When** the user presses `[ DUPLICATE ]`, **Then** a new draft named "Copy of <name>" (cut to 100 characters) is created with the same sender name, reply-to address, subject, preview text and content, created by the user, and its edit page opens; the original is unchanged.
2. **Given** a draft, **When** the user presses `[ DELETE ]`, **Then** a confirmation in a box over the page names the draft; confirming deletes it for good and the Campaigns page says "Campaign "<name>" deleted."; cancelling changes nothing.
3. **Given** a draft deleted by another user, **When** someone opens its address or saves its edit page, **Then** they see "This campaign no longer exists." and nothing is saved.

### Edge Cases

- Two users edit the same draft from pages opened at the same time: the second save is refused with "<Name> changed this campaign since you opened it. Reload to see their changes.", the form keeps what was typed, and after reloading the page shows the values of the first save.
- A tag with an empty field name `{{}}`, an unclosed `{{First name`, or `{{ First name|  }}` (empty fallback): `{{}}` is listed as an unknown merge tag; `{{First name` is not a tag and is shown as typed; the last is the First name tag with no "If empty, show" text.
- The same text with `{{` that is not meant as a tag, e.g. in pasted HTML from another tool using `{{...}}`: listed as an unknown merge tag, so the user sees it before sending.
- A preview for a person the user can no longer see (made private by someone else after being chosen): the preview shows "Choose a person to preview." and none of that person's values.
- A preview for a person with no first name, no organisation and no custom values: every tag shows its "If empty, show" text or nothing; no "[First name]" or "undefined" appears.
- A custom field with a multiple choice value, a date, money or Yes/No "No": shown as on the person page ("Vegan, Halal", "24 Nov 2026", "£1,200", "No"); only an empty value uses the fallback.
- Pasted HTML that is not valid HTML (unclosed tags, plain text): after saving and reloading, the HTML box shows it as pasted, and the preview shows its text.
- Pasted HTML with remote images or styles (e.g. a style making every page element red): the images show in the preview, and the sidebar, page header and draft form keep their usual look.
- A draft name, sender name, subject or fallback with markup such as "<script>": kept as typed and shown as plain text on every page.
- Duplicating a draft whose name is 100 characters: the copy's name is cut to 100 characters.
- An empty draft (only a name): it saves with "Draft saved.", its preview shows an empty subject and no content above the unsubscribe line, and duplicating it makes "Copy of <name>".
- A user deactivated after creating drafts: the Campaigns page still lists their drafts, with their name under Created by.

## Requirements *(mandatory)*

### Functional Requirements

**Campaigns page and drafts**

- **FR-001**: The sidebar MUST show "Campaigns" to every signed-in user, opening a page that lists all campaign drafts of the team with Name, Subject, Status, Created by and Last edited, most recently edited first.
- **FR-002**: Users MUST be able to create a draft by giving a name; the sender name starts as the user's name and every other field empty.
- **FR-003**: A draft MUST hold a name (1–100 characters), a sender name (at most 100), a reply-to address (empty or one valid email address), a subject (at most 255), a preview text (at most 255) and content; only the name is required to save.
- **FR-004**: Every save MUST check those limits and refuse with a message naming the field and nothing saved, keeping what was typed; a save based on an older version of the draft than the one stored MUST be refused with the message of the Edge Cases.
- **FR-005**: Any signed-in user MUST be able to open, edit, duplicate and delete any draft; deleting asks for confirmation and is permanent.
- **FR-006**: Duplicating MUST create "Copy of <name>" (at most 100 characters) with every field and the content copied, created by the duplicating user.

**Merge tags**

- **FR-007**: The subject, the preview text, every text-bearing layout block (heading, text, button label, image alternative text) and pasted HTML MUST accept merge tags written `{{<field name>}}` or `{{<field name> | <if empty>}}`, matched by field name ignoring case and outer spaces.
- **FR-008**: The merge fields MUST be First name, Last name, Full name, Email, Phone, Organisation, Role, Lead source, LinkedIn, Owner, Labels and every people custom field by its current name; an "Insert merge tag" list MUST offer them in that order with an optional "If empty, show" text of at most 100 characters.
- **FR-009**: Tags matching no merge field MUST NOT stop a save; the edit page and the preview MUST list them as "Unknown merge tags".
- **FR-009a**: A saved tag naming a people custom field MUST stay linked to that field: after a rename it shows the field's new name everywhere in the draft (subject, preview text, blocks, pasted HTML); after the field is deleted it shows its last name and is an unknown merge tag.

**Content**

- **FR-010**: Content MUST be either layout blocks or pasted HTML. Layouts offered: Blank, Text, Text with a button, Newsletter (blocks as in User Story 3). Block types: Heading, Text, Button, Image, Divider, with the limits of User Story 3 and at most 50 blocks; links only `https://`, `http://` or `mailto:` (image addresses `https://`).
- **FR-011**: Text typed into layout blocks MUST be shown as plain text (markup not applied); line breaks kept and web addresses turned into links.
- **FR-012**: Pasted HTML (at most 500,000 characters) MUST be kept exactly as pasted, except that custom field tags in it follow renames (FR-009a).
- **FR-013**: Switching from layout to HTML MUST start the HTML box with the HTML of the layout content; switching from HTML to a layout MUST ask for confirmation first; both are only kept on save.

**Preview and safety**

- **FR-014**: The edit page MUST show, beside the draft, a preview that follows what is typed without saving and shows the draft as received by a chosen person: sender name, reply-to, subject, preview text, content and the unsubscribe line, with merge tags filled in as in User Story 5; with no person chosen it shows "[<field name>]" for each tag.
- **FR-015**: The person picker MUST offer only people the user can see and who are not archived; a person's values MUST never be shown to a user who cannot see that person; the chosen person MUST NOT be stored on the draft.
- **FR-016**: Person values put into the content MUST be inserted as plain text, never as markup.
- **FR-017**: Pasted HTML and the content built from it MUST be shown in the app so that no script, event handler, form, frame or link inside it can run code in the app, read or change the app's page, cookies, session or data, send a form or navigate the app page; links open in a new browser tab.

**Access, messages, look, fake data**

- **FR-018**: Every Campaigns page MUST require a signed-in user and every campaign action MUST check the signed-in user first, on every request.
- **FR-019**: Every message shown MUST be one of the app's fixed messages (with draft, field and user names from the database as the only inserted text); text from the page address MUST never be shown.
- **FR-020**: The Campaigns page and the draft edit page MUST follow `docs/DESIGN.md` and the existing signed-in pages (design B sidebar layout, "// " section labels, `[ ... ]` bracket buttons, the delete confirmation in a box over the page like other confirmations) and design A of `design-options.html`: "Campaigns" after "Activities" in the sidebar; the Campaigns page a table with `[ NEW CAMPAIGN ]` in the header; the edit page with `[ SAVE ]`, `[ DUPLICATE ]` and `[ DELETE ]` in the header, "// DETAILS" and "// CONTENT" (with a Layout / Paste HTML switch) on the left and "// PREVIEW FOR" with the person picker and the email on the right.
- **FR-021**: The fake data command MUST add, without duplicates when run again, a few clearly fake drafts: one per layout using merge tags with and without "If empty, show" text (one using a people custom field), and one with pasted HTML that contains a harmless script, to show it does nothing.

### Key Entities

- **Campaign**: a draft email written by the team; has a name, a sender name, a reply-to address, a subject, a preview text, content, a status (only "Draft" in this issue), who created it and when, and who last edited it and when. Shared by the whole team. Recipients, sender address and sending come in a later issue.
- **Content**: either an ordered list of blocks (Heading, Text, Button, Image, Divider with their texts and links) or one piece of pasted HTML.
- **Merge tag**: a placeholder `{{<field name> | <if empty>}}` in the subject, preview text or content, filled in from a person's field when the email is previewed (and later sent); once saved, a custom field tag is linked to its field and follows renames.
- **Merge field**: a person field or people custom field a tag can name (see FR-008).
- **Person** (from SF-90/SF-92/SF-115): the source of merge values, under the existing private rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a draft from the "Text with a button" layout with a personalised subject and preview it for a person in under 5 minutes, without writing HTML.
- **SC-002**: The preview for a chosen person appears in under 2 seconds for a draft with 50 blocks or 500,000 characters of pasted HTML.
- **SC-003**: In automated tests, 100% of merge fields, built-in and custom, fill in with the person's value, and 100% of empty ones show their "If empty, show" text or nothing.
- **SC-004**: In automated tests, pasted HTML with scripts, event handlers, forms and links never runs code, sends a form or changes the app page, and person values with markup always show as plain text.
- **SC-005**: In automated tests, a private person's values never appear in a preview, and the person never appears in the picker, for a user the private rules hide them from.
- **SC-006**: In automated tests, 100% of saves breaking a limit, and 100% of saves of an outdated version of a draft, are refused with nothing saved.

## Assumptions

- Campaign drafts are shared by the whole team (clarified 2026-11-24), like email templates and segments: everyone sees, edits, duplicates and deletes every draft. A draft is not a CRM record, so the admin-only delete rule for records does not apply.
- Merge tags are written with the field's shown name so they can be typed in pasted HTML; on save they are linked to the field so they follow renames (clarified 2026-11-24). Organisation and deal custom fields, and organisation fields other than the name, are not merge fields in this issue.
- A draft may be incomplete; the checks that a campaign is ready to send (sender name, subject, content, no unknown tags, sender address, recipients) come with sending in a later issue.
- The unsubscribe line in the preview is a stand-in; the real link, the plain-text version of the email and how pasted HTML is sent come with sending.
- Images are linked by web address; uploading images for campaigns is not part of this issue.
- Text blocks have no rich formatting (bold, italics, colours) beyond line breaks and automatic links; richer formatting can be pasted as HTML.
- There is no automatic saving: the user presses `[ SAVE ]`.
- Recipients, the sender address, test send, sending, scheduling, tracking and starting from a saved template are out of scope (later issues).
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply and are not repeated here.
