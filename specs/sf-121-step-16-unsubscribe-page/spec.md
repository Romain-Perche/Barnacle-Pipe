# Feature Specification: Unsubscribe page

**Feature Branch**: `factory/sf-121-step-16-unsubscribe-page`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "Step 16 - Unsubscribe page. Unsubscribing from campaigns (`docs/PRODUCT.md` section 4, last line, needed for UK GDPR and PECR): a public page, with no sign-in, opened from a link unique to one person that cannot be guessed or changed. It shows an Unsubscribe button; pressing it marks the person Unsubscribed and adds a line to their timeline. Mail apps' one-click unsubscribe (the List-Unsubscribe and List-Unsubscribe-Post headers) does the same without the page. Unsubscribing twice is harmless; a link for a deleted person shows a neutral message. A server function makes the link and the headers for the campaign sending issue. Only a teammate can subscribe a person again, by changing their consent. Not in this issue: putting the link in campaigns (a later issue)."

## Clarifications

### Session 2026-11-24

- Q: Which design for the public unsubscribe page? → A: Design: A, a twin of the sign-in page: cream page, wordmark, "// EMAIL PREFERENCES" label, "Unsubscribe" heading, orange `[ UNSUBSCRIBE ]` button; the done message in the blue notice box, the link-not-valid message in the orange error box (see `design-options.html`).
- Q: When a contact unsubscribes, is anyone on the team told? → A: No (A): the person's Consent and the timeline line are the only record; no notification and no sidebar count.
- Q: How is a link made impossible to guess or forge: a random token kept for each person in the CRM, or a signed link that needs a new secret setting? → A: A random 64-character token per person, stored in the CRM, that never changes and never expires; no secret setting, so changing settings can never break links already sent; deleting the person removes it (decided by the factory, to confirm)
- Q: What line does a teammate's change of Consent on the edit form add to the timeline? → A: "Consent: Unsubscribed → Subscribed by <name>" (or the other way round), in place of today's "Edited by <name>: Consent", for every Consent change made on the form (decided by the factory, to confirm)
- Q: Who can open the development links page, which lists every person (private ones too) with their links? → A: Anyone, without signing in, but only where APP_ENV is development or test (like the fake Google login); everywhere else it answers "page not found" (decided by the factory, to confirm)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A contact unsubscribes from the unsubscribe page (Priority: P1)

A person in the CRM receives a campaign email and clicks its unsubscribe link. Their browser opens a public page of the CRM, with no sign-in, that says what the page does and shows an `[ UNSUBSCRIBE ]` button. They press it; the page confirms they will get no more campaign emails. In the CRM, the person's consent is now Unsubscribed and their timeline has a line saying they unsubscribed through the unsubscribe link.

**Why this priority**: An unsubscribe link in every campaign, honoured across all future campaigns, is a legal requirement (UK GDPR and PECR, PRODUCT §4); campaigns cannot be sent without it.

**Independent Test**: With the fake data loaded, take a subscribed person's unsubscribe link from the development links page, open it in a browser that is not signed in, press `[ UNSUBSCRIBE ]`; sign in as a teammate and confirm the person shows Unsubscribed and their timeline has the unsubscribe line.

**Acceptance Scenarios**:

1. **Given** the unsubscribe link of a subscribed person, **When** it is opened in a browser that is not signed in, **Then** the unsubscribe page is shown (never the sign-in page) with the heading "Unsubscribe", the line "Stop receiving campaign emails from Barnacle Labs." and an `[ UNSUBSCRIBE ]` button; the person's page in the CRM still shows Consent "Subscribed".
2. **Given** the unsubscribe page of a subscribed person, **When** `[ UNSUBSCRIBE ]` is pressed, **Then** the page shows "You're unsubscribed. You won't get any more campaign emails from us." in the blue notice box with no button, the person's page shows Consent "Unsubscribed", the owner's Notifications page and sidebar count are unchanged, and one CHANGE line "Unsubscribed from campaigns through the unsubscribe link" is added to their timeline with the time, and no teammate's name.
3. **Given** the unsubscribe link is opened (a GET) but the button is never pressed — for example by a mail app or a security scanner that opens every link in an email — **Then** the person's page still shows Consent "Subscribed" and their timeline has no unsubscribe line.
4. **Given** the unsubscribe page, **When** it is shown, **Then** it shows neither the person's name nor any of their email addresses nor any other CRM data, and has no link into the signed-in app.
5. **Given** a teammate who is signed in opens a person's unsubscribe link, **When** they press `[ UNSUBSCRIBE ]`, **Then** the page shows "You're unsubscribed. You won't get any more campaign emails from us.", the person of the link (not the teammate) shows Consent "Unsubscribed", and the timeline line names no teammate.

---

### User Story 2 - One-click unsubscribe from the mail app (Priority: P1)

The contact reads a campaign email in Gmail, Apple Mail or Outlook and uses the mail app's own "Unsubscribe" button next to the sender. The mail app tells the CRM directly, without opening any page; the person becomes Unsubscribed with the same timeline line, marked as coming from their mail app.

**Why this priority**: Gmail and Yahoo require one-click unsubscribe for bulk senders; without it campaign emails are more likely to land in spam. It must be ready before the campaign sending issue uses it.

**Independent Test**: Send the one-click unsubscribe request a mail app would send for a person's link (no sign-in, no cookies); confirm the person is Unsubscribed and has one timeline line; send it again and confirm nothing more changes.

**Acceptance Scenarios**:

1. **Given** the one-click unsubscribe address of a subscribed person, **When** a mail app sends the standard one-click unsubscribe request to it (no sign-in, no cookies), **Then** the person's consent becomes Unsubscribed, one CHANGE line "Unsubscribed from campaigns through their mail app" is added to their timeline, and the CRM answers with status 200.
2. **Given** a request to the one-click address that is not the standard one-click request (a POST without `List-Unsubscribe=One-Click` in its body), **When** it arrives, **Then** it is answered with status 400, and the person's page still shows Consent "Subscribed" with no new timeline line.
3. **Given** a one-click request for a link that is unknown, changed or for a deleted person, **When** it arrives, **Then** it is answered with status 404 in every one of these cases (the same answer for each), and no person's Consent changes.

---

### User Story 3 - Links that are unique, cannot be guessed or changed, and harmless to repeat (Priority: P1)

Each person has their own unsubscribe link. Nobody can work out another person's link from their own, change a link to unsubscribe someone else, or unsubscribe people by trying links at random. Opening or pressing the same link again does no harm. A link for a person who has since been deleted shows a neutral message.

**Why this priority**: The page has no sign-in, so the link is the only thing that decides who is unsubscribed; a guessable link would let anyone unsubscribe the whole CRM.

**Independent Test**: Make the links of two people; confirm they differ and neither contains the person's CRM number or email address in a readable form; change one character of a link and confirm the neutral message is shown and nobody is unsubscribed; unsubscribe a person twice and confirm one timeline line; delete a person and open their link.

**Acceptance Scenarios**:

1. **Given** two different people on the development links page, **When** their links are compared, **Then** the links differ and neither contains the person's CRM number, name or email address; **When** the page is reloaded, **Then** each person's link still unsubscribes that same person.
2. **Given** a link with any character changed, added or removed, **When** it is opened, **Then** the page shows no `[ UNSUBSCRIBE ]` button and shows the neutral message "This unsubscribe link isn't valid any more. If you still get emails from us, reply to one and ask to be removed." and no person's Consent changes.
3. **Given** a person already Unsubscribed, **When** their link is opened, **Then** the page shows "You're unsubscribed. You won't get any more campaign emails from us." and no `[ UNSUBSCRIBE ]` button; **When** the button is pressed anyway on a page opened before (or a second one-click request is sent), **Then** the page shows the same message (or status 200), the person's page still shows Consent "Unsubscribed" and the timeline shows one unsubscribe line, not two.
4. **Given** a person who was deleted for good after their link was made, **When** the link is opened or a one-click request is sent, **Then** the page shows exactly the same neutral message as for a changed link (and the one-click request gets the same status 404), with no name or other trace of the person.
5. **Given** a person who is archived or private, **When** their link is used, **Then** the page shows "You're unsubscribed. You won't get any more campaign emails from us."; the person's creator or owner sees Consent "Unsubscribed" and the unsubscribe line on the person's page, and for a private person another teammate still cannot open the person or see the line.

---

### User Story 4 - Only a teammate can subscribe a person again (Priority: P2)

Once unsubscribed, a person stays unsubscribed until a teammate changes their consent back to Subscribed on the person's edit form (for example after the person asks to be added back). The public page never offers to subscribe again.

**Why this priority**: Consent must not be given back by accident or by someone holding an old link; re-subscribing is a deliberate act the team records.

**Independent Test**: Unsubscribe a person through the link; confirm the page has no way back; as a teammate set their consent to Subscribed and confirm the usual consent change line on the timeline; use the same link again and confirm the person is unsubscribed again.

**Acceptance Scenarios**:

1. **Given** the unsubscribe page in each of its states (before, done, link not valid), **When** it is shown, **Then** it has no button or link to subscribe again.
2. **Given** an unsubscribed person, **When** a teammate who can see the person changes Consent to Subscribed on the edit form, **Then** the person's page shows Consent "Subscribed" and the timeline shows the change line "Consent: Unsubscribed → Subscribed" with the teammate's name.
3. **Given** a person subscribed again by a teammate, **When** their earlier unsubscribe link is used again, **Then** the page shows `[ UNSUBSCRIBE ]`; after it is pressed the person's page shows Consent "Unsubscribed" and the timeline has a second unsubscribe line.

---

### User Story 5 - The campaign sending issue gets the link and the headers from one place (Priority: P2)

A later issue (campaign sending) needs, for each recipient, the unsubscribe link to put in the email and the List-Unsubscribe and List-Unsubscribe-Post headers. This issue provides one server function that returns all three for a person, so campaign sending never builds links itself.

**Why this priority**: Not seen by users in this issue, but the later issue depends on it; building it here keeps the link rules in one place and testable now.

**Independent Test**: Call the function for a person (in a test, or through the development links page, which shows its result); confirm it returns the page link on the app's own address, a List-Unsubscribe header pointing to the one-click address, and the List-Unsubscribe-Post header "List-Unsubscribe=One-Click"; use each returned address and confirm it unsubscribes that person.

**Acceptance Scenarios**:

1. **Given** a person in the CRM, **When** the development links page is opened, **Then** each person's row shows what the function returns: the unsubscribe page link, the List-Unsubscribe header value and the List-Unsubscribe-Post header value `List-Unsubscribe=One-Click`, all on the app's own secure (https) address in production.
2. **Given** the returned link and header address, **When** each is used as in User Stories 1 and 2, **Then** that person's page shows Consent "Unsubscribed" and no other person's Consent changes.

---

### Edge Cases

- A link opened by a link scanner or preview (a plain page load, no button press): the person's page in the CRM still shows Consent "Subscribed" and their timeline has no unsubscribe line.
- `[ UNSUBSCRIBE ]` pressed twice quickly, or in two tabs of the same link: both tabs show "You're unsubscribed. You won't get any more campaign emails from us." and the person's timeline shows exactly one unsubscribe line.
- A teammate has the person's edit form open while the person unsubscribes, then saves it with Consent still set to Subscribed: the person's page shows Consent "Subscribed", and the timeline shows the unsubscribe line followed by the teammate's change line "Consent: Unsubscribed → Subscribed" with the teammate's name.
- A person with two email addresses unsubscribes: their page shows Consent "Unsubscribed" (consent is per person, so it covers both addresses).
- A link cut short or with extra characters (as some mail apps do): the page shows "This unsubscribe link isn't valid any more. If you still get emails from us, reply to one and ask to be removed." and no person's Consent changes.
- The address carries extra text (for example `?next=` or `?message=`): that text does not appear anywhere on the page.
- The database cannot be reached when `[ UNSUBSCRIBE ]` is pressed: the page shows "Something went wrong. Try again in a minute." and, once the database is back, the person's page still shows Consent "Subscribed"; a one-click request at that moment gets a failure answer (status 5xx), so the mail app can try again.
- The unsubscribe page and the one-click address are opened with a signed-in teammate's browser: the page looks the same as for anyone else, with no sidebar and no link into the app.
- Outside development and test (APP_ENV not "development" or "test"), the development links page answers "page not found".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST serve a public unsubscribe page, reachable without signing in, at an address made of the app's own address and a per-person link.
- **FR-002**: Each person's unsubscribe link MUST identify exactly one person, MUST NOT contain the person's CRM number, name or email address in readable form, and MUST NOT be guessable or forgeable: changing, adding or removing any part of it MUST NOT lead to another person.
- **FR-003**: The same person's link MUST keep working with no expiry for as long as the person exists, including after they are subscribed again.
- **FR-004**: Opening the page (a page load) MUST NOT change anything; only pressing `[ UNSUBSCRIBE ]` MUST unsubscribe.
- **FR-005**: Pressing `[ UNSUBSCRIBE ]` on a valid link MUST set the person's consent to Unsubscribed and, if they were Subscribed, add exactly one CHANGE timeline line "Unsubscribed from campaigns through the unsubscribe link" with no teammate as author.
- **FR-006**: The system MUST accept the standard one-click unsubscribe request (RFC 8058: a POST with `List-Unsubscribe=One-Click`) at the address given in the List-Unsubscribe header, with no sign-in and no cookies, and MUST then do the same as FR-005 with the line "Unsubscribed from campaigns through their mail app".
- **FR-007**: Unsubscribing a person who is already Unsubscribed MUST change nothing and add no timeline line, and MUST show (or answer) the same success as the first time.
- **FR-008**: A link that is invalid, changed, or for a person deleted for good MUST show the neutral message "This unsubscribe link isn't valid any more. If you still get emails from us, reply to one and ask to be removed." (or the same neutral answer to a one-click request), MUST change nothing, and MUST NOT reveal whether the person ever existed.
- **FR-009**: The page MUST NOT show the person's name, email addresses or any other CRM data, MUST NOT offer a way to subscribe again, and MUST NOT link into the signed-in app.
- **FR-010**: Archived and private people MUST be unsubscribable through their link; the timeline line MUST follow the person's existing visibility rules.
- **FR-011**: Only a teammate MUST be able to set a person back to Subscribed, through the existing Consent field of the person's edit form, which records the usual change line with the teammate's name.
- **FR-012**: The system MUST provide one server function that, for a person, returns their unsubscribe page link, the List-Unsubscribe header value (the one-click address) and the List-Unsubscribe-Post header value `List-Unsubscribe=One-Click`, all built on the app's own address.
- **FR-013**: All text on the page MUST come from the app's message list; nothing taken from the address is ever shown.
- **FR-014**: Any secret used to make links unforgeable MUST be a setting outside the repo, listed in `.env.example` and the README; tests and development MUST work with no real secret.
- **FR-015**: Two unsubscribes of the same person at the same moment MUST leave one timeline line.
- **FR-016**: The page MUST use design A: the sign-in page's layout (cream page, wordmark, "// EMAIL PREFERENCES" label, heading "Unsubscribe", orange `[ UNSUBSCRIBE ]` button), the done message in the blue notice box and the link-not-valid and error messages in the orange error box, with no signed-in sidebar.
- **FR-018**: Unsubscribing MUST NOT notify any teammate: no Notifications page entry and no change to the sidebar count.
- **FR-017**: In development and test only, a development page MUST list the people in the CRM with what FR-012's function returns for each (page link, List-Unsubscribe and List-Unsubscribe-Post values), so the page can be tried by hand; everywhere else that page MUST answer "page not found".

### Key Entities

- **Unsubscribe link**: The per-person address of the unsubscribe page and of the one-click address; identifies one person, cannot be guessed or forged, has no expiry.
- **Person consent**: The existing Subscribed / Unsubscribed status of a person; the link only ever moves it to Unsubscribed.
- **Unsubscribe timeline line**: A CHANGE entry on the person's timeline saying they unsubscribed and how (the page or their mail app), with no teammate as author.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contact can unsubscribe in one click on the page (or zero pages with their mail app's button), in under 10 seconds from opening the link.
- **SC-002**: 100% of tested changed, cut or made-up links unsubscribe nobody and show the neutral message.
- **SC-003**: Opening a link without pressing the button changes nobody's consent in 100% of tests.
- **SC-004**: Repeating an unsubscribe (page or one-click, in sequence or at the same moment) always leaves exactly one timeline line and the person Unsubscribed.
- **SC-005**: The page never reveals a person's name, email address or whether a deleted person existed.
- **SC-006**: The campaign sending issue can get each recipient's link and both headers from a single call, with no link-building of its own.

## Assumptions

- Unsubscribing stops campaign emails only; teammates can still write to the person one-to-one (consent is about mass email, PRODUCT §2 and §4). Unsubscribed people are already left out of campaigns by the campaign issues.
- The link is per person, not per email address or per campaign, because consent is stored per person.
- No teammate is notified when someone unsubscribes (Clarifications); the timeline line and the Consent value are the record.
- No mailto: List-Unsubscribe address: campaigns go out through the sender's Gmail and the CRM serves one-click unsubscribe itself (DECISIONS 2026-11-24); a web address is enough for RFC 8058.
- The page has no "why are you leaving" question and no preference choices; one button only.
- A person deleted for good loses their link; a person merged or re-imported is a new person with a new link.
- Putting the link and headers into campaign emails, and counting unsubscribes in campaign reports, belong to the later campaign issues.
- No rate limiting beyond what the hosting provides: links cannot be guessed, so trying many links gains nothing.
