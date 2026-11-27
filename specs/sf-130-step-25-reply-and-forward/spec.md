# Feature Specification: Reply and forward

**Feature Branch**: `factory/sf-130-step-25-reply-and-forward`

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Step 25 - Reply and forward. [ REPLY ], [ REPLY ALL ] and [ FORWARD ] on each email of a conversation (`docs/PRODUCT.md` section 3: "Compose, reply and forward from a deal or contact. Emails go from the user's own address and stay in the same thread"), on the conversation page of SF-127 and on each EMAIL entry of a timeline. They open SF-129's email box (the panel on the right), with everything that box already does: recipients named as the sender's CRM people, attachments up to 25 MB in total, the box kept after a refused Gmail key, a double press sending once. Reply: To holds the email's sender (for an email the user sent, its To); Subject "Re: <subject>" (never "Re: Re:"). Reply all: To and Cc also hold the email's other recipients, without the user's own address. Forward: To empty; Subject "Fwd: <subject>"; the email's attachments are included (fetched from Gmail as SF-127's downloads are) and can be removed. The earlier email is quoted below the text as plain text ("On <date>, <name> wrote:" then its lines starting with "> "; a forward with the usual "Forwarded message" block of From, Date, Subject and To). Sent from the user's own Gmail through SF-129's send, with the In-Reply-To and References headers, so recipients see it in the same conversation, even when the conversation was copied from a colleague's mailbox; when the user's own mailbox holds the conversation, it also stays in the same Gmail thread for them. In the CRM it is added to the same conversation at once, with its links (no new conversation), and shows as an EMAIL entry on every timeline the conversation is on. The buttons show only to users who can see the conversation (SF-127's rule) and have Gmail connected (otherwise the link to connect Gmail, as in SF-129). Gmail is faked in tests."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reply to an email from its conversation or its timeline entry (Priority: P1)

A team member reads an email from a contact, on the deal's timeline or on SF-127's conversation page. They press `[ REPLY ]` on that email. SF-129's email box opens on the right with To already holding the contact's address, the subject "Re: <subject>", an empty text area, and below it the earlier email quoted. They type their answer and press `[ SEND ]`. The reply leaves from their own Gmail address, the contact sees it in the same conversation as the email they sent, and in the CRM it is at once the newest email of the same conversation, on every timeline that conversation is on.

**Why this priority**: "Reply … from a deal or contact … stay in the same thread" is a Must have (PRODUCT §3), and answering a contact's email is the most frequent email action of the team.

**Independent Test**: With the fake Gmail, store a received email from Ana Fake on a deal's conversation, press `[ REPLY ]` on its EMAIL entry, check To, Subject and the quote, type two lines and send; confirm the fake mailbox's Sent mail holds one message to Ana Fake with "Re: <subject>", the two lines then the quote, In-Reply-To set to the received email's Message-ID, and that the deal's timeline and the conversation page show the reply in the same conversation.

**Acceptance Scenarios**:

1. **Given** a connected user on the page of a deal whose timeline shows a received email from "Ana Fake <ana@example.test>" with the subject "Pricing", **When** they press `[ REPLY ]` on that EMAIL entry, **Then** SF-129's email box opens as the panel on the right over the dimmed page, headed "// REPLY · Pricing", with "From <their address>", To holding "ana@example.test" only (shown as "Ana Fake" when she is a CRM person they can see), empty Cc and Bcc, Subject "Re: Pricing", an empty text area and, below it, the quote of the earlier email.
2. **Given** the same box, **When** they type "Thanks Ana,⏎⏎Agreed." and press `[ SEND ]`, **Then** one email is sent from their own Gmail to "ana@example.test" with the subject "Re: Pricing" and the text "Thanks Ana,⏎⏎Agreed." followed by a blank line, "On <date and time of the earlier email>, Ana Fake <ana@example.test> wrote:" and each line of the earlier email's text starting with "> "; the box closes, the deal page shows "Email sent to Ana Fake." once (SF-129's notice), and the deal's timeline shows the reply as its newest EMAIL entry.
3. **Given** a connected user on SF-127's conversation page, **When** they press `[ REPLY ]` on any email of the list and send, **Then** the box closes on the same conversation page, which now lists the reply as its newest email, and the conversation is the same one (same page address, same // LINKED TO).
4. **Given** an email the user themselves sent to "ana@example.test" (To) and "ben@example.test" (Cc), **When** they press `[ REPLY ]` on it, **Then** To holds "ana@example.test" only (the earlier email's To) and Cc is empty.
5. **Given** an email whose subject already starts with "Re:" (in any letter case, for example "RE: Pricing" or "Re: Re: Pricing"), **When** the user presses `[ REPLY ]`, **Then** the Subject is the earlier subject unchanged, never "Re: Re: …"; an email with no subject gives "Re: (no subject)".
6. **Given** a reply box filled in, **When** the user closes it with `[ CANCEL ]` or the close button, **Then** nothing is sent and no timeline gains an entry.
7. **Given** a reply sent, **When** the sent message is opened on the fake mailbox page, **Then** it shows In-Reply-To with the earlier email's Message-ID and References with the Message-IDs of the conversation's emails up to and including it, oldest first (what makes Ana Fake's mail app show it in the same conversation).

---

### User Story 2 - The reply stays in the same conversation, in the CRM and in Gmail (Priority: P1)

Whichever teammate's mailbox the conversation was copied from, the reply goes into the same CRM conversation at once, keeps that conversation's links and shows on every timeline the conversation is on. When the user's own mailbox holds the conversation, the reply also stays in the same Gmail thread in their Gmail.

**Why this priority**: "Emails … stay in the same thread" (PRODUCT §3) and the timeline as the team's shared history (PRODUCT §2) are the reason to reply from the CRM instead of from Gmail.

**Independent Test**: With two fake users, store a conversation in Ada Fake's mailbox only, linked to a deal and to Ana Fake; as Bob Fake (another connected user who can see it), reply; confirm the fake mailbox of Bob Fake has the reply in a new Gmail thread with the reply headers, the CRM shows it in the same conversation on the deal and on Ana Fake's page; then as Ada Fake reply again and confirm her reply is in the same Gmail thread as the conversation in her fake mailbox.

**Acceptance Scenarios**:

1. **Given** a conversation copied only from a colleague's mailbox, linked to the deal "Fake Deal Ltd renewal" and to Ana Fake, **When** the user replies to its newest email, **Then** the reply is sent from the user's own Gmail with the reply headers, and in the CRM it is in the same conversation (no new conversation is created), shown as an EMAIL entry on the deal's timeline and on Ana Fake's timeline, and listed on the same conversation page.
2. **Given** a conversation that the user's own Gmail mailbox holds, **When** they reply to any email of it, **Then** the fake mailbox page shows the reply in the same thread as the conversation's other emails.
3. **Given** a conversation linked by hand to an organisation and with one automatic link removed by hand (SF-127's unlink), **When** the user replies, **Then** after sending the conversation's links are the same as before: still linked to the organisation, the removed link still removed.
4. **Given** a reply that adds a CRM person not yet in the conversation (typed in Cc), **When** it is sent, **Then** that person is linked to the conversation by SF-127's automatic linking (with their organisation and their one open deal), and the conversation shows on their timeline.
5. **Given** a reply sent, **When** the Gmail sync (push notice or the 15-minute check) later copies it from the user's mailbox, **Then** it is still one email in the same conversation, shown once on each timeline, and the user's count of conversations copied (SF-128) does not grow.
6. **Given** a reply sent to Ana Fake, **When** her page is opened, **Then** her "Last contacted" is the send time, unless it was already later (SF-127's rule for every stored email).

---

### User Story 3 - Reply all (Priority: P2)

On an email with several recipients, `[ REPLY ALL ]` fills To and Cc with everybody in it except the user, so the whole group gets the answer.

**Why this priority**: Group emails are common with organisations (several contacts on one deal); a plain reply covers the main need first.

**Independent Test**: Store a received email from Ana Fake to the user and Ben Fake, with Cat Fake in Cc; press `[ REPLY ALL ]`, confirm To holds Ana Fake and Ben Fake, Cc holds Cat Fake, and the user's address is nowhere; send and confirm the fake Sent message has exactly those recipients.

**Acceptance Scenarios**:

1. **Given** a received email from "ana@example.test" to the user's address and "ben@example.test", with "cat@example.test" in Cc, **When** the user presses `[ REPLY ALL ]`, **Then** To holds "ana@example.test" then "ben@example.test", Cc holds "cat@example.test", Bcc is empty, and the user's own address is in none of them; the box is headed "// REPLY ALL · <subject>".
2. **Given** an email the user sent to "ana@example.test" with "ben@example.test" in Cc and "dan@example.test" in Bcc, **When** they press `[ REPLY ALL ]`, **Then** To holds "ana@example.test", Cc holds "ben@example.test", and "dan@example.test" is not filled in anywhere.
3. **Given** a received email where an address appears in both To and Cc, or where the user's address appears with different letter case ("Ada@Barnacle.ai"), **When** the user presses `[ REPLY ALL ]`, **Then** each address is filled once (the first place it appears kept) and the user's address is left out.
4. **Given** the reply all box, **When** the user removes "ben@example.test" and sends, **Then** the email goes to exactly the remaining addresses.

---

### User Story 4 - Forward an email with its attachments (Priority: P2)

A team member forwards a contact's email, with its attachments, to someone else (a colleague's contact, an accountant). `[ FORWARD ]` opens the box with To empty, "Fwd: <subject>", the earlier email's attachments already attached and removable, and below the text the usual "Forwarded message" block.

**Why this priority**: "Forward from a deal or contact" is a Must have (PRODUCT §3); it comes after reply because it is used less.

**Independent Test**: Store a received email with "quote.pdf" (2 MB) and "plan.png" (300 KB) in the fake mailbox; press `[ FORWARD ]`, confirm To empty, the subject, both attachments listed; remove "plan.png", add "ed@example.test" and send; confirm the fake Sent message has "quote.pdf" byte-for-byte equal to the earlier one, no "plan.png", the forwarded block, and the reply headers.

**Acceptance Scenarios**:

1. **Given** a received email from "Ana Fake <ana@example.test>" to the user, subject "Pricing", with the attachments "quote.pdf" (2 MB) and "plan.png" (300 KB), **When** the user presses `[ FORWARD ]`, **Then** the box is headed "// FORWARD · Pricing", To, Cc and Bcc are empty, the Subject is "Fwd: Pricing", the attachments list shows "quote.pdf" and "plan.png" with their sizes, each with a way to remove it, and the room shows "2.3 MB of 25 MB".
2. **Given** that box, **When** the user adds "ed@example.test" to To, types "See below." and sends, **Then** one email goes from the user's Gmail to "ed@example.test" with "Fwd: Pricing", the text "See below." then a blank line and the block "---------- Forwarded message ---------", "From: Ana Fake <ana@example.test>", "Date: <date and time of the earlier email>", "Subject: Pricing", "To: <the earlier email's To>", a blank line and the earlier email's text (not prefixed with "> "), and with both attachments, their names, types and contents equal to the earlier email's.
3. **Given** the forward box, **When** the user removes "plan.png" before sending, **Then** the sent email carries "quote.pdf" only.
4. **Given** the forward box, **When** the user also attaches a file of the record or of their computer (SF-129), **Then** it is sent with the forwarded attachments, all counted together within 25 MB.
5. **Given** an email whose subject already starts with "Fwd:" or "Fw:" (any letter case), **When** the user presses `[ FORWARD ]`, **Then** the subject is kept as it is, never "Fwd: Fwd: …".
6. **Given** an email whose attachments together are over 25 MB, **When** the user presses `[ FORWARD ]`, **Then** the attachments are listed, the box shows "Attachments can be 25 MB in total at most.", and `[ SEND ]` sends nothing until enough of them are removed.
7. **Given** a forward with an attachment that Gmail cannot give at send time (the fake Gmail set to fail, or the email no longer in any working mailbox), **When** the user presses `[ SEND ]`, **Then** nothing is sent, the box stays open with everything typed and attached, and shows "One of the forwarded attachments can't be fetched from Gmail right now. Remove it or try again later."
8. **Given** a forward sent to "ed@example.test", an address of no CRM person, **When** the conversation page is opened, **Then** the forward is listed in the same conversation and the conversation's links are unchanged.

---

### User Story 5 - Without a working Gmail connection, a link to connect it instead of the buttons (Priority: P3)

A user who can see the conversation but has no working Gmail connection does not get buttons that cannot work: in their place each email shows a short link to Settings to connect (or reconnect) Gmail.

**Why this priority**: Every user must understand why they cannot reply and how to fix it, but the sending flows come first.

**Independent Test**: As a fake user with no Gmail connection, open a deal's timeline and the conversation page; confirm no `[ REPLY ]`, `[ REPLY ALL ]` or `[ FORWARD ]` and the link to Settings on each email; mark a connection as needing reconnecting and confirm the reconnect link.

**Acceptance Scenarios**:

1. **Given** a user with no Gmail connection (never connected, or disconnected), **When** they open a timeline with EMAIL entries or a conversation page, **Then** each email shows "[ CONNECT GMAIL TO REPLY ]", a link to Settings, and no `[ REPLY ]`, `[ REPLY ALL ]` or `[ FORWARD ]`.
2. **Given** a user whose Gmail connection needs reconnecting, **When** they open the same pages, **Then** each email shows "[ RECONNECT GMAIL TO REPLY ]", a link to Settings, and no reply or forward buttons.
3. **Given** Gmail is not set up for the app (Gmail off), **When** any user opens these pages, **Then** neither the buttons nor the link are shown.
4. **Given** a connected user with a reply box filled in, **When** Google no longer accepts the key as they press `[ SEND ]`, **Then** nothing is sent, the box stays open with everything typed and attached and shows SF-129's reconnect message and link, and the sidebar's "Settings" link shows the orange "!" (SF-129 unchanged).
5. **Given** a user who opens a reply address directly while not connected, **When** the box opens, **Then** it shows SF-129's "Connect your Gmail in Settings to send email from the CRM." with `[ GO TO SETTINGS ]` and no `[ SEND ]`.

---

### Edge Cases

- **Who sees the buttons**: a user who cannot see the conversation (SF-127: a person in it or a linked person or deal they cannot see) sees neither the email nor any button; opening a reply address for it directly shows SF-127's "This conversation doesn't exist or you can't see it." and offers no `[ SEND ]`.
- **Conversation hidden or emptied while writing**: when, while the box is open, a teammate makes a person in the conversation private, or the email replied to is no longer stored (its mailbox was forgotten by a deactivation), `[ SEND ]` sends nothing and shows "This conversation doesn't exist or you can't see it.", keeping what was typed.
- **Archived records**: as with `[ WRITE EMAIL ]` (SF-129), the EMAIL entries on the timeline of an archived deal, person or organisation (and an archived deal's drawer) show no reply or forward buttons; the conversation page shows them whenever the user can see the conversation.
- **Record files offered**: from a deal's, person's or organisation's timeline (or the conversation page opened from it), the box offers that record's own files, as SF-129 does; from a conversation page opened from no record, only files from the computer.
- **No sender address**: `[ REPLY ]` on an email shown as "Unknown sender" opens the box with To empty (the user types one); `[ REPLY ALL ]` fills the other recipients.
- **Reply to an email the user sent only to themselves**: `[ REPLY ]` opens the box with the user's own address in To.
- **Reply all where only the user remains**: `[ REPLY ALL ]` on a received email sent to the user alone opens the box with only the sender in To and Cc empty; on an email the user sent to themselves alone, To and Cc are empty.
- **Email with no Message-ID**: the reply is sent without In-Reply-To (References with the earlier Message-IDs the conversation has, if any); the conversation page lists it as the newest email of the same conversation.
- **Quote of an HTML-only email**: the quote uses the same plain text SF-127 shows on the conversation page (the HTML turned into text); no HTML is sent or shown. An email with no text gives the "On … wrote:" line (or the forwarded block) with nothing below it.
- **Long quotes**: replying to an email of 150,000 characters with a short text sends; the fake mailbox's sent message holds the whole quote. The "The text can be 100,000 characters at most." message counts only what the user types.
- **Recipient names**: as SF-129: an address of a CRM person the sender can see is written in the headers and shown in the box as that person's name; any other address as itself. The quote's "On … wrote:" line and the forwarded block use the name and address written in the earlier email, not CRM names.
- **Characters**: an earlier email with "<b>prix</b> 🎉" in its text is quoted as "> <b>prix</b> 🎉", plain text; the conversation page shows it as those characters.
- **Double press**: pressing `[ SEND ]` twice quickly sends one reply and adds one EMAIL entry.
- **Gmail slow or failing (not the key)**: the box stays open with everything kept and shows "The email could not be sent. Try again in a minute."; nothing is added.
- **Sent but the CRM could not record it** (automated tests only): the user sees "Email sent to …", and after the next Gmail sync the reply is in the same conversation, once.
- **Forwarded attachments and the 25 MB limit**: counted on their stored sizes, together with record and computer files; adding a file that passes 25 MB is refused at once as in SF-129.
- **Reply on the board's drawer**: the box opens over the board and the drawer, and after sending the same drawer is open with the reply as its newest EMAIL entry.

## Requirements *(mandatory)*

### Functional Requirements

**Buttons**

- **FR-001**: Each email on SF-127's conversation page and each EMAIL entry on a timeline (deal page, deal drawer, person page, organisation page) MUST show `[ REPLY ]`, `[ REPLY ALL ]` and `[ FORWARD ]` to a signed-in active user who can see the conversation (SF-127's rule) and has a working Gmail connection, except on the timelines of archived records.
- **FR-002**: A user who can see the conversation but has no Gmail connection MUST see "[ CONNECT GMAIL TO REPLY ]" in place of the three buttons, and one whose connection needs reconnecting "[ RECONNECT GMAIL TO REPLY ]", each a link to Settings; when Gmail is off for the app, neither buttons nor link are shown.
- **FR-003**: Each button MUST open SF-129's email box (the right-side panel, design B) for that email, headed "// REPLY", "// REPLY ALL" or "// FORWARD" then "· <subject of the email>", and closing or sending MUST return to the same page (and the same open drawer).

**Filling the box**

- **FR-004**: Reply MUST fill To with the email's sender address; for an email sent from the user's own Gmail address, with the email's To addresses instead. Cc, Bcc and attachments start empty.
- **FR-005**: Reply all MUST fill To with what Reply fills followed by the email's other To addresses, and Cc with the email's Cc addresses, never its Bcc, leaving out the user's own Gmail address (any letter case) and keeping each address once, at its first place.
- **FR-006**: Forward MUST leave To, Cc and Bcc empty and attach every attachment of the email, each listed with its name and size and removable.
- **FR-007**: The subject MUST be "Re: <subject>" for Reply and Reply all and "Fwd: <subject>" for Forward, except that a subject already starting with "Re:" (for replies) or with "Fwd:" or "Fw:" (for forwards), in any letter case, is kept unchanged; an email with no subject gives "Re: (no subject)" or "Fwd: (no subject)". The user can change the subject.
- **FR-008**: The box MUST show, read-only below the text area, the quote that will be sent: for a reply "On <date and time>, <name> <address> wrote:" then every line of the earlier email's plain text starting with "> "; for a forward "---------- Forwarded message ---------" with the lines "From:", "Date:", "Subject:" and "To:" of the earlier email, a blank line and its plain text unchanged. The date and time are in UK time; the name is the one written in the earlier email (its address alone when it has none); the plain text is the one SF-127 shows on the conversation page.
- **FR-009**: Everything else in the box MUST be SF-129's unchanged: From not changeable, adding and removing addresses, recipients named as the sender's visible CRM people, attaching the record's own files and computer files, 25 MB in total across all attachments, the checks and fixed messages, the box kept with all input after any failure, and a double press sending once.

**Sending**

- **FR-010**: `[ SEND ]` MUST send through SF-129's send from the user's own Gmail, as plain text: the user's text, a blank line, then the quote of FR-008; with the attachments chosen; with In-Reply-To holding the replied or forwarded email's Message-ID and References holding the Message-IDs of the conversation's emails up to and including it, oldest first (each header left out when there is nothing to put in it).
- **FR-011**: When the user's own Gmail mailbox holds the conversation, the email MUST be sent in that Gmail thread; otherwise it starts a Gmail thread of its own in the user's mailbox, still carrying the headers of FR-010.
- **FR-012**: Forwarded attachments MUST be fetched from Gmail at send time the way SF-127's downloads are (from a working mailbox holding the email, the user's own first) and sent with their names, types and exact contents; when one cannot be fetched, nothing MUST be sent and the box MUST show "One of the forwarded attachments can't be fetched from Gmail right now. Remove it or try again later." with all input kept. Their contents MUST never be kept by the CRM.
- **FR-013**: At send time the CRM MUST check again that the user can see the conversation and that the email replied to or forwarded is still in it; otherwise nothing is sent and the box shows "This conversation doesn't exist or you can't see it."

**Recording and showing**

- **FR-014**: As soon as Gmail accepts it, the email MUST be stored as SF-129's sent emails are, and in the same conversation as the email replied to or forwarded, even when the conversation came only from a colleague's mailbox: no new conversation, and the email is listed on the conversation page and as an EMAIL entry on every timeline the conversation is on, before the page shows "Email sent to …".
- **FR-015**: The conversation's links MUST stay as they are (links by hand kept, links removed by hand still removed); SF-127's automatic linking MUST add the CRM people newly in the email (with their organisation and their one open deal). A reply or forward MUST NOT add a link by hand of its own.
- **FR-016**: When the Gmail sync later copies the same email, it MUST be recognised as the one already stored: no second entry, no second conversation, no new count in the user's conversations copied.
- **FR-017**: Visibility, "Last contacted", notifications and consent MUST follow SF-127 and SF-129 unchanged (sending notifies no one; an Unsubscribed person may be replied to without warning).

**Access, messages, fakes**

- **FR-018**: Every page and action MUST require a signed-in active user; the send action MUST re-check the user, the Gmail connection and the conversation's visibility at send time.
- **FR-019**: Every message shown MUST be one of the app's fixed messages; the quote, addresses and subjects MUST be shown as plain text, and nothing taken from the page address or from Google's answers may be shown.
- **FR-020**: The feature MUST be built, run locally and tested with the existing fake Gmail and fake Storage; the fake Gmail MUST keep the threading headers and the Gmail thread of each sent message, and the fake mailbox page MUST show them, so tests and the reviewer can read them, checked against Google's published description of the Gmail service like the existing fakes.
- **FR-021**: The fake data command SHOULD give the connected fake user at least one reply in a seeded conversation, so a conversation with a reply can be seen after seeding, without duplicates when run again.

### Key Entities

- **Email replied to or forwarded** (existing, SF-118/SF-127): a stored email of a conversation: sender, To, Cc, subject, date, plain text, Message-ID, attachments' names, types and sizes.
- **Reply or forward** (a sent email, SF-129): stored like SF-129's sent emails, in the conversation of the email it answers; its kind (reply, reply all, forward) only decides how the box was filled.
- **Send** (existing, SF-129): one press of `[ SEND ]`; for a reply or forward it also names the email answered, so the stored email joins its conversation even when storing happens later through the sync.
- **Forwarded attachment** (new, transient): an attachment of the earlier email chosen in the box, fetched from Gmail only while sending, never kept.
- **Conversation** (existing, SF-127) and **email links** (existing, SF-127): unchanged by a reply, except SF-127's automatic links for people newly in it.
- **Gmail connection** (existing, SF-118): decides whether the buttons or the link to Settings show, and which mailbox's thread a reply goes in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a timeline, a user can reply to a contact's email in under 1 minute, with no address or subject to type.
- **SC-002**: In automated tests, 100% of replies and forwards are in the fake Gmail's Sent mail exactly once, with the expected recipients, subject, text followed by the quote, threading headers, and forwarded attachments byte-for-byte equal to the earlier email's.
- **SC-003**: In 100% of test runs, a reply or forward is in the same CRM conversation as the email it answers, on every timeline that conversation is on, on the first page load after sending, and still exactly once after the Gmail sync.
- **SC-004**: In 100% of test runs where the user's mailbox holds the conversation, the reply is in the same Gmail thread of the fake mailbox.
- **SC-005**: In automated tests, 0 emails are sent by a user without a working Gmail connection or for a conversation they cannot see, and 0 reply or forward buttons are shown to them.
- **SC-006**: After any failed send, the user loses nothing typed or attached in 100% of cases.

## Assumptions

- The buttons sit on each email (the conversation page lists several, a timeline EMAIL entry is one email); their exact place and look follow `docs/DESIGN.md` and SF-127's design, and may be chosen in a design step (decided by the factory, to confirm).
- Without a working Gmail connection the three buttons are replaced by one link to Settings per email rather than opening a box that cannot send (reading of "otherwise the link to connect Gmail"; decided by the factory, to confirm).
- The quote is shown read-only below the text area and always sent; the user cannot edit or remove it in this issue (decided by the factory, to confirm). Its date reads like "27 Nov 2026 at 14:05" in UK time.
- The "reply to" address of an email is its sender (From); a Reply-To header is not stored by SF-118 and is not used (decided by the factory, to confirm).
- Forward includes all the earlier email's attachments, removable; the forwarded block lists From, Date, Subject and To only (as requested), not Cc.
- A forward also carries the threading headers and joins the same conversation, as the request says for everything sent from these buttons.
- The record files offered are those of the record whose timeline (or whose conversation page) the box was opened from, as in SF-129.
- Templates, drafts, editing the quote, formatted text, signatures, scheduled sending and tracking are not in this issue. SF-127's conversation page and EMAIL entry, SF-128's past emails and SF-129's box and send are on main and are reused.
- Technical choices already in `docs/DECISIONS.md` and `AGENTS.md` apply (no Google call inside a database transaction, fixed messages, fakes for outside services) and are not repeated here.
