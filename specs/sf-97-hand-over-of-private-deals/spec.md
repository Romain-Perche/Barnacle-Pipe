# Feature Specification: Hand-over of private deals

**Feature Branch**: `factory/sf-97-hand-over-of-private-deals`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Hand-over of private deals. When an admin hands over a deactivated user's private people on the Users page, their private deals are handed over too, so a private deal never ends up visible to nobody."

## User Scenarios & Testing *(mandatory)*

Builds on SF-92 (an admin hands a deactivated user's private people to an active user from the Users page, design B panel) and SF-93 (a private deal is visible only to its creator and its current owner, admins included). Today, when both the creator and the owner of a private deal are deactivated, nobody sees the deal, and the existing hand-over leaves it behind.

### User Story 1 - The hand-over also hands over private deals (Priority: P1)

When someone leaves, an admin deactivates them and hands their private people to an active colleague. The deactivated user's private deals now go with them in the same single action: the colleague becomes the owner of each of those deals and can see and manage them on the board, without the admin ever seeing which deals they are.

**Why this priority**: This is the feature: without it, a private deal whose creator and owner are both deactivated is lost to the whole team.

**Independent Test**: Make Alan Fake create one private person and two private deals (one archived) and deactivate Alan; as an admin, hand Alan's private records to Margaret Fake from the Users page; as Margaret, confirm the open deal is on its board with the "Private" badge and Margaret as owner, its history shows the hand-over, and the archived one is Margaret's too; as another user and as the admin, confirm neither deal appears.

**Acceptance Scenarios**:

1. **Given** deactivated user Alan Fake owns 2 private people and 1 private deal, **When** an admin opens the Users page, **Then** Alan's row shows "2 private people · 1 private deal" and `[ HAND OVER ]`; the admin is not shown any name, title, value or other detail.
2. **Given** that row, **When** the admin presses `[ HAND OVER ]` and chooses Margaret Fake, **Then** the panel asks "Hand Alan Fake's 2 private people and 1 private deal to Margaret Fake?" and the explanation reads "They stay private. Margaret Fake becomes their owner and can see them. You will not see what they are."
3. **Given** that panel, **When** the admin confirms, **Then** the Users page shows "2 private people and 1 private deal handed to Margaret Fake." and Alan's row no longer shows a count or `[ HAND OVER ]`.
4. **Given** the hand-over is done, **When** Margaret opens the deal's board, **Then** the card is there with the "Private" badge, counts in its column's count and total, its drawer shows Margaret as owner, Alan Fake (deactivated) is still its creator, and "// HISTORY" shows "Handed to Margaret Fake by <admin's name>" with the date and time; Margaret can edit, move, archive it and untick "Private".
5. **Given** the hand-over is done, **When** user Linus Fake (neither creator nor owner) or the admin who handed it over views the board, **Then** the card is not shown and the column count and total do not include it.
6. **Given** the hand-over is done, **When** anyone opens the deal's drawer, **Then** the deal's stage, value, organisation, person and expected close date are the same as before, and the card is in the same place in its column.

---

### User Story 2 - A deactivated user with only private deals can be handed over (Priority: P1)

A deactivated user who owns private deals but no private people still needs a hand-over, otherwise those deals stay hidden from everyone.

**Why this priority**: Without it the rule "a private deal never ends up visible to nobody" breaks for users who only kept private deals.

**Independent Test**: Make Alan Fake own one private deal and no private people, deactivate Alan; as an admin, confirm Alan's row shows "1 private deal" and `[ HAND OVER ]`, hand over to Margaret Fake, and confirm the message and Margaret's board.

**Acceptance Scenarios**:

1. **Given** deactivated Alan Fake owns 1 private deal and no private people, **When** an admin opens the Users page, **Then** Alan's row shows "1 private deal" and `[ HAND OVER ]`.
2. **Given** that row, **When** the admin chooses Margaret Fake, **Then** the panel asks "Hand Alan Fake's 1 private deal to Margaret Fake?"; on confirming, the page shows "1 private deal handed to Margaret Fake.".
3. **Given** deactivated Alan owns private people but no private deals, **When** the admin hands over, **Then** the row, question and message mention only the people, exactly as in SF-92 ("2 private people", "Hand Alan Fake's 2 private people to Margaret Fake?", "2 private people handed to Margaret Fake.").

---

### Edge Cases

- A private deal created by deactivated Alan Fake and owned by active user B: Alan's row on the Users page does not count it; after the hand-over to Margaret Fake, B's board still shows the card and its drawer still shows B as owner.
- A private deal created by active user A and owned by deactivated Alan: Alan's row counts it ("1 private deal"); after the hand-over to Margaret, A's and Margaret's boards both show the card, and its drawer shows Margaret as owner.
- Alan owns one open and one archived private deal: Alan's row shows "2 private deals"; after the hand-over the message says "2 private deals handed to Margaret Fake.", Alan's row shows no count, and Margaret's board shows only the open one (the archived one stays off the board).
- A shared (not private) deal owned by Alan: Alan's row does not count it; after the hand-over its drawer still shows "Alan Fake (deactivated)" as owner, and every user still sees the card.
- Another admin hands over Alan's records between the first admin opening the panel and confirming: the first admin's confirmation shows "Alan Fake has no private people or deals to hand over." and Alan's row shows no count.
- An active creator turns "Private" off on Alan's only private deal after the panel opened, and Alan owns no private people: confirming shows "Alan Fake has no private people or deals to hand over."; the deal's drawer still shows Alan Fake (deactivated) as owner.
- The admin hands over to themselves: the message says "… handed to <admin's name>." and the admin's board shows the card with the "Private" badge and the admin as owner.
- The admin presses `[ CANCEL ]` in the panel: the panel closes, Alan's row still shows its counts and `[ HAND OVER ]`, and the deal's drawer (seen by its creator) still shows Alan Fake (deactivated) as owner.
- The admin presses `[ HAND OVER ]` in the panel without choosing a user, or the chosen user is deactivated meanwhile: the panel shows "Choose an active user." and Alan's row still shows the same counts.
- A signed-in user who is not an admin sends a hand-over request directly: they see "You don't have access to this page." and Alan's row (seen by an admin) still shows the same counts.
- A request to hand over an active user's records: refused with "Only a deactivated user's private records can be handed over."; that user's deals keep their owner.
- A handed-over deal's main person is private to someone other than Margaret: Margaret's drawer for the deal shows no person.
- Alan is reactivated after the hand-over: Alan's board shows the private deals Alan created, and their drawers show Margaret as owner; private deals Alan owned but did not create are not on Alan's board.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: "A deactivated user's private deals" MUST mean every private deal, archived or not, whose current owner is that user. Deals they created but someone else owns, and shared deals they own, are not included.
- **FR-002**: The Users page MUST show `[ HAND OVER ]` on the row of each deactivated user who owns at least one private person or at least one private deal, with the counts of each that is non-zero ("1 private person", "N private people", "1 private deal", "N private deals", joined by " · " when both apply). No other detail about those people or deals may be shown to the admin.
- **FR-003**: The hand-over panel MUST name both kinds of record in its question when both apply ("Hand <user>'s N private people and M private deals to <chosen user>?"), only the non-zero kind otherwise, and its explanation MUST not imply they are only people ("You will not see what they are.").
- **FR-004**: On confirming, every private person and every private deal the deactivated user owns at that moment MUST get the chosen user as owner, all in one action that either fully happens or does not happen at all. Each handed-over deal MUST stay private and keep its creator, stage, pipeline, value, links, dates, archived state and position on the board; it MUST NOT count as a stage move.
- **FR-005**: Each handed-over deal's history MUST show "Handed to <new owner> by <admin>" with the date and time, in the same form as on a handed-over person.
- **FR-006**: After the hand-over the Users page MUST show "<counts> handed to <name>." naming both kinds when both were handed over ("2 private people and 1 private deal handed to Margaret Fake."), only the non-zero kind otherwise; when there was nothing to hand over at confirmation time it MUST show "<user> has no private people or deals to hand over.".
- **FR-007**: The new owner MUST be able to see, count and manage each handed-over deal as any owner of a private deal can (SF-93 FR-015/FR-016), including turning "Private" off. Nobody else's sight of the deal changes, except that the previous owner (the deactivated user) loses it unless they are its creator.
- **FR-008**: All SF-92 refusals MUST apply unchanged to the combined hand-over, on every request and not only by hiding the button: non-admin ("You don't have access to this page."), recipient not active ("Choose an active user."), user not deactivated ("Only a deactivated user's private records can be handed over.", replacing SF-92's "Only a deactivated user's private people can be handed over.").
- **FR-009**: `docs/DECISIONS.md` MUST state that handing over a deactivated user's private people also hands over their private deals, so a private deal is never left visible to nobody.
- **FR-010**: The fake data command MUST add, without duplicates when run again, at least one private deal owned by the deactivated fake user (Alan Fake) and created by them, so the combined hand-over can be tried.

### Key Entities *(include if feature involves data)*

- **Deal** (from SF-93): its owner can now be changed by an admin's hand-over when the owner is deactivated and the deal is private; creator and private flag are unchanged.
- **Timeline event** (from SF-92/SF-93): the "handed to <user> by <admin>" kind, until now only on people, can also be on a deal and appears in its "// HISTORY".
- **User** (from SF-80): a deactivated user may own private deals that an admin hands over together with their private people.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any hand-over, no private deal is owned by the deactivated user it was handed from, in 100% of automated test runs.
- **SC-002**: An admin hands over all of a deactivated user's private people and private deals in under 30 seconds from opening the Users page, in a single action.
- **SC-003**: After a hand-over, the new owner finds every handed-over deal (open ones on their boards, with column counts and totals including them), and no other user (admins included) sees any of them, in 100% of automated test runs.
- **SC-004**: 100% of hand-over requests from non-admins, to inactive users or for active users leave every person and deal unchanged in automated tests, including direct requests that bypass the page.
- **SC-005**: At no point during or after a hand-over is the admin shown a handed-over deal's title, value, organisation, person or stage.

## Assumptions

- The hand-over stays one action for all of a user's private records (decided by the factory, to confirm): there is no separate "hand over deals" button and no choice of individual deals, so the user count of actions in SF-92 stays the same.
- Which deals count follows the SF-92 rule for people (decided by the factory, to confirm): private deals the deactivated user owns, archived ones included; their creator is kept, so an active creator keeps sight of the deal.
- The wording of the row, question, explanation and messages extends SF-92's wording to name both kinds of record (decided by the factory, to confirm); when the user owns only private people, the existing SF-92 wording is unchanged.
- Shared deals owned by a deactivated user are out of scope: everyone sees them and anyone can already change their owner.
- Handing over records other than people and deals (organisations, future emails and notes) is out of scope; emails and notes attached to a deal later will follow the deal's visibility.
- Design B from SF-92 is reused as is; no new page or panel.
