# Feature Specification: Private and deleted people: follow-ups

**Feature Branch**: `factory/sf-92-private-and-deleted-people-follow-ups`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Private and deleted people: follow-ups. Needs SF-90 merged first. Changes to the people rules from SF-90: a private person is also visible to their owner, not only their creator. Deleting a person keeps the events about them on other records, without their name (for example "A deleted person was linked by Linus Fake"). An admin can hand a deactivated user's private people to another user, who becomes their owner. This also frees the email addresses those people hold."

## Clarifications

### Session 2026-11-19

- Q: Which design for handing over a deactivated user's private people on the Users page? → A: Design: B, `[ HAND OVER ]` opens a panel above the Users table with the user choice and the question "Hand Alan Fake's 2 private people to Margaret Fake?" (see `design-options.html`).
- Q: Who can turn "Private" on or off for a person? → A: The creator and the current owner.
- Q: What does "frees the email addresses" mean after a hand-over? → A: The new owner sees the people and their addresses and can remove an address or make the person shared; nothing is removed automatically.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The owner of a private person sees them (Priority: P1)

A team member adds a contact, marks them private and makes a colleague their owner (for example because the colleague will follow them up). The owner can now see and work on that person just like the creator can; everyone else still cannot.

**Why this priority**: Today a private person's owner cannot even see the person they are responsible for. This is the rule the other two stories depend on: a handed-over private person is only useful if their new owner can see them.

**Independent Test**: As user A, add a person, mark them private and choose user B as owner; as B, find them in the People list, search and their organisation's page and open their page; as user C and as an admin, confirm they are still invisible.

**Acceptance Scenarios**:

1. **Given** user A adds "Ada Example", ticks "Private" and chooses B as owner, **When** B opens the People list, searches "Ada", opens the person's organisation page, opens the preview drawer or opens Ada's page address, **Then** Ada appears everywhere A would see her, with the "Private" badge, and the organisation's people count includes her.
2. **Given** the same private person, **When** user C or an admin (neither creator nor owner) opens any list, search, organisation page, drawer or Ada's page address, **Then** Ada does not appear, the organisation's people count excludes her and her page address shows "Page not found." (unchanged from SF-90).
3. **Given** B owns private Ada (created by A), **When** B edits her role and saves, **Then** the page shows the new role and the timeline shows "Edited by <B's name>: Role".
4. **Given** B owns private Ada, **When** B opens the edit form, **Then** the "Private" option is offered to B as it is to A; when B unticks it and saves, Ada becomes visible to the whole team and the timeline shows "Edited by <B's name>: Private".
5. **Given** B owns private Ada, **When** B adds another person with Ada's email address, **Then** the form shows "Ada Example already has this email address." with a link to Ada's page (B can see her); C doing the same still sees "Another person already has this email address." with no name or link.
6. **Given** B owns private Ada (created by A), **When** B changes her owner to C and saves, **Then** B is taken to the People list showing "You can no longer see Ada Example: only their creator and owner can." and Ada no longer appears for B, while A and C see her.

---

### User Story 2 - Deleting a person keeps the history on other records (Priority: P2)

An admin deletes a person for good. The organisation they were linked to keeps its history: its timeline still shows that a person was linked or unlinked, by whom and when, but no longer says who the person was.

**Why this priority**: An organisation's timeline should not lose events, and gaps in history confuse the team; but deleted means deleted, so the person's name must go.

**Independent Test**: Link "Ada Example" to "Fakeco Ltd" as Linus Fake, then as an admin delete Ada; open Fakeco Ltd's page and confirm its timeline shows "A deleted person was linked by Linus Fake" with the original date and time, and Ada's name appears nowhere on the page.

**Acceptance Scenarios**:

1. **Given** Linus Fake linked Ada Example to Fakeco Ltd, **When** an admin deletes Ada and anyone then opens Fakeco Ltd's page, **Then** the timeline shows "A deleted person was linked by Linus Fake" with the date and time of the original event, as plain text with no link.
2. **Given** Ada was linked to and later unlinked from Fakeco Ltd, **When** an admin deletes Ada, **Then** Fakeco Ltd's timeline shows both "A deleted person was linked by …" and "A deleted person was unlinked by …" in their original order.
3. **Given** an admin deletes Ada, **When** anyone opens Ada's old page address, **Then** it shows "Page not found." and Ada's own timeline, email addresses, phone numbers and labels are gone (unchanged from SF-90).
4. **Given** Ada was private when an admin deleted her, **When** anyone (including her former creator and owner) opens an organisation she had been linked to, **Then** no event about her is shown, deleted or not.

---

### User Story 3 - An admin hands a deactivated user's private people to someone else (Priority: P2)

When someone leaves, an admin deactivates them. Their private people are then seen by nobody active, and the email addresses those people hold block anyone else from adding the same contacts. From the Users page, the admin hands all of the deactivated user's private people to an active colleague, who becomes their owner and can see and manage them, without the admin ever seeing who they are.

**Why this priority**: Without it, contacts a departed team member kept private are lost to the team for good and their email addresses can never be added again.

**Independent Test**: Make Alan Fake create two private people (one with `secret@example.com`) and deactivate Alan; as an admin, hand Alan's private people to Margaret Fake from the Users page; as Margaret, confirm both people appear with Margaret as owner and that adding another person with `secret@example.com` names and links the existing one.

**Acceptance Scenarios**:

1. **Given** deactivated user Alan Fake owns 2 private people, **When** an admin opens the Users page, **Then** Alan's row shows "2 private people" and `[ HAND OVER ]`; the admin is not shown their names or any other detail.
2. **Given** that row, **When** the admin presses `[ HAND OVER ]`, **Then** a panel opens above the Users table with a choice of active users (Alan Fake not offered), `[ HAND OVER ]`, `[ CANCEL ]` and the line "They stay private. <chosen user> becomes their owner and can see them. You will not see who they are."; after choosing Margaret Fake it asks "Hand Alan Fake's 2 private people to Margaret Fake?".
3. **Given** that panel with Margaret Fake chosen, **When** the admin presses `[ HAND OVER ]` in the panel, **Then** the Users page shows "2 private people handed to Margaret Fake." and Alan's row no longer shows a count or `[ HAND OVER ]`.
4. **Given** the handover is done, **When** Margaret opens the People list, filters by owner "Margaret Fake" or opens one of those people, **Then** both people appear, stay private, show Margaret as owner and their timelines show "Handed to Margaret Fake by <admin's name>".
5. **Given** the handover is done and one of the people holds `secret@example.com`, **When** Margaret adds a person with that address, **Then** the form shows "<name> already has this email address." with a link to the existing person; after Margaret removes `secret@example.com` from that person and saves, Linus Fake adds a new person with `secret@example.com` and it saves and opens the new person's page.
6. **Given** an active user, or a deactivated user who owns no private people, **When** an admin views the Users page, **Then** their row has no `[ HAND OVER ]`.
7. **Given** a signed-in user who is not an admin, **When** they send a handover request directly, **Then** they see "You don't have access to this page." and nothing changes.

---

### Edge Cases

- A private person whose creator is deactivated but whose owner is active: the owner still sees and manages them; they are not counted as the deactivated user's private people and are not handed over.
- A private person created by active user A and owned by deactivated user Alan: counted as Alan's and handed over; A still sees them afterwards as their creator.
- The admin presses `[ CANCEL ]` in the hand-over panel: the panel closes, Alan's row still shows "2 private people" and `[ HAND OVER ]`, and nobody's people change.
- The admin presses `[ HAND OVER ]` in the panel without choosing a user: the panel stays open with "Choose an active user." and nothing is handed over.
- An admin hands over to themselves: allowed (they are an active user); the admin then sees those people as their owner.
- The chosen recipient is deactivated between opening the form and confirming: nothing is handed over and the form shows "Choose an active user.".
- A request to hand over an active user's private people, or to hand them to the deactivated user themselves: refused with "Choose an active user." or "Only a deactivated user's private people can be handed over.", nothing changes.
- Alan's private people change between the admin opening the form and confirming (another admin already handed them over): all private people Alan owns at the moment of confirming are handed over and the message gives that number; if there are none, it shows "Alan Fake has no private people to hand over.".
- Alan is reactivated after the handover: Alan sees the people Alan created (as their creator) but no longer owns them.
- Deleting a person who was never linked to an organisation: nothing on other records changes.
- Two events about different deleted people on the same organisation both read "A deleted person …"; they are not told apart.
- Deleting a person still linked to an organisation: the organisation's existing "linked" event is kept anonymously; no new "unlinked" event is added.
- A creator makes a private person's owner someone else, then the owner changes the owner again: the person is visible only to the creator and the current owner; former owners lose sight of them.

## Requirements *(mandatory)*

### Functional Requirements

**Private people**

- **FR-001**: A private person MUST be visible to their creator and to their current owner, and to nobody else (admins included), in every place SF-90 FR-015, FR-019 and FR-028 cover: lists, search, counts, filters, organisation pages, preview drawers, timelines, duplicate email messages and direct page addresses.
- **FR-002**: The creator or the current owner of a person MUST be able to mark them private or not private; nobody else may change it. This replaces SF-90 FR-018.
- **FR-003**: A user who saves a private person so that they are no longer the creator or the owner MUST be taken to the People list with "You can no longer see <name>: only their creator and owner can.", and the person MUST no longer appear to them.
- **FR-004**: Duplicate email address messages MUST name and link the existing person when the user is their creator or owner, and name nobody otherwise (SF-90 FR-004 with the new visibility rule).

**Deleting a person**

- **FR-005**: When an admin deletes a person, events about them on other records (today: an organisation's "linked" and "unlinked" events) MUST be kept with their original user, date and time, and shown as "A deleted person was linked by <user>" / "A deleted person was unlinked by <user>", with no name or link. The person's own record and timeline are still removed for good (SF-90).
- **FR-006**: Nothing that identifies a deleted person (name, email address, phone number, page address) MUST remain on any page or be recoverable from the kept events.
- **FR-007**: Events about a person who was private when deleted MUST NOT be shown to anyone.
- **FR-008**: Later features that add events about a person to other records (deals, notes, emails) MUST follow the same rule; this is a standing rule for those features, not new work here.

**Handing over a deactivated user's private people**

- **FR-009**: The Users page MUST show, on the row of each deactivated user who owns at least one private person, the number of those people ("1 private person", "N private people") and `[ HAND OVER ]`. No other detail about those people may be shown to the admin.
- **FR-010**: `[ HAND OVER ]` MUST open a panel above the Users table (design B, like the delete confirmation on a record page) where the admin chooses one active user and confirms "Hand <deactivated user>'s N private people to <chosen user>?"; on confirming, every private person the deactivated user owns at that moment MUST get the chosen user as owner, stay private and keep their creator, all at once (either all are handed over or none).
- **FR-011**: Each handed-over person's timeline MUST show "Handed to <new owner> by <admin>" with the date and time; the Users page MUST show "N private people handed to <name>.".
- **FR-012**: Only admins MAY hand over; the app MUST refuse handover requests from non-admins ("You don't have access to this page."), to a user who is not active ("Choose an active user."), or for a user who is not deactivated ("Only a deactivated user's private people can be handed over."), on every request, not only by hiding the button.
- **FR-013**: After a handover the new owner MUST be able to see and manage those people, including their email addresses and private status, so the addresses they hold no longer block the team without anyone able to act on them.

**Docs and fake data**

- **FR-014**: `docs/DECISIONS.md` MUST state the new rules: a private person is visible to their creator and owner, deleted people's events on other records are kept without their name, and admins hand a deactivated user's private people to an active user.
- **FR-015**: The fake data command MUST add, without duplicates when run again, at least one private person owned by someone other than their creator, and at least one private person owned by the deactivated fake user (Alan Fake) so the handover can be tried.
- **FR-016**: All new user-facing text MUST come from the app's single list of messages, and new screens MUST follow `docs/DESIGN.md` and the existing Users page.

### Key Entities *(include if feature involves data)*

- **Person** (from SF-90): unchanged fields; "who can see a private person" now depends on both creator and owner.
- **Timeline event** (from SF-90): an event on an organisation about a person may now refer to a person who no longer exists; it then shows as "A deleted person". New kind on a person: "handed to <user> by <admin>".
- **User** (from SF-80): a deactivated user may own private people that an admin hands over.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated tests, a private person appears to their creator and their owner on every list, search, organisation page, count, drawer and direct address, and to no other user (admins included).
- **SC-002**: In automated tests, 100% of organisation events about deleted non-private people remain, in their original order with their user and time, and none shows the deleted person's name or a link.
- **SC-003**: An admin hands over all of a deactivated user's private people in under 30 seconds from opening the Users page, in a single action.
- **SC-004**: After a handover, the new owner can find every handed-over person, and adding a person with one of their email addresses names and links the existing person, in 100% of automated test runs.
- **SC-005**: 100% of handover requests from non-admins, to inactive users or for active users are refused in automated tests, including direct requests that bypass the page.

## Assumptions

- Builds on SF-90 (merged): every SF-90 rule not changed here stays as it is.
- "A deactivated user's private people" means the private people they own. People they created but someone active owns are already visible to that owner and need no handover; people owned by them but created by an active user are handed over too (their creator keeps sight of them).
- "Frees the email addresses" means: once an active user owns those people, the addresses are no longer held by contacts nobody can see. The new owner is named in duplicate messages and can remove the address or make the person not private. The addresses are not removed automatically, and other users still see the anonymous duplicate message while the person stays private (Clarifications).
- The owner, as well as the creator, can change "Private". Otherwise handed-over people could never be made shared again. This widens the DECISIONS line "the person who created a contact … can set it to private" (Clarifications; FR-014 updates DECISIONS).
- Events about a person who was private when deleted are hidden from everyone: DECISIONS says a private contact is hidden from everyone but its creator, and even an anonymous event would show that one existed.
- The admin sees only how many private people a deactivated user owns, never who they are, so DECISIONS ("hidden from everyone … admins included") still holds.
- Handover is all at once; choosing some of a user's private people, or handing over their shared people or organisations, is out of scope (shared records can already be reassigned by anyone).
- Private deals arrive with the deals feature and are out of scope here.
