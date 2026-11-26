# Feature Specification: Double-click to open a deal, person or organisation page

**Feature Branch**: `factory/sf-126-double-click-to-open-deal-person-page`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "I'd like that when a user double-clicks on a deal card/row in the deals tab or on a person row in the people tab, the corresponding deal/person page opens."

## Context

Today a single click on a deal card (deals board), a deal row (deal list), a person row (People list) or an
organisation row (Organisations list) opens the preview drawer beside the list. Reaching the full page means clicking the record's name or a link inside the drawer.
This feature adds a quicker way: a double-click anywhere on the card or row opens the record's own page. The
single click keeps opening the drawer.

## Clarifications

### Session 2026-11-26

- Q: Must a double-click on a row of the Organisations list also open the organisation page? → A: Yes. The Organisations list is included (same table and drawer as the People list).
- Q: On a double-click, the first click opens the drawer before the page opens. Is that acceptable? → A: Yes. The single click stays immediate; the drawer can show for a moment before the page opens.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Double-click a deal on the board (Priority: P1)

A user looking at the deals board double-clicks a deal card and lands on that deal's page.

**Why this priority**: The board is the main way the team works through deals; it is where the shortcut saves the most clicks.

**Independent Test**: Open the board, double-click any card, check that the deal page of that deal is shown.

**Acceptance Scenarios**:

1. **Given** the deals board with a card "Fake Deal A", **When** the user double-clicks the card, **Then** the deal page of "Fake Deal A" opens.
2. **Given** the deals board, **When** the user single-clicks a card, **Then** the deal drawer opens as today and the user stays on the board.
3. **Given** the deals board, **When** the user drags a card to another stage, **Then** the deal moves as today and no page opens.

---

### User Story 2 - Double-click a deal row in the deal list (Priority: P2)

A user on the deal list (the List view of the deals tab) double-clicks a row and lands on that deal's page.

**Why this priority**: Same shortcut for the other view of the same tab; less used than the board.

**Independent Test**: Open the deal list, double-click a row outside its links, check that the deal page opens.

**Acceptance Scenarios**:

1. **Given** the deal list, **When** the user double-clicks any part of a row that is not a link (for example the value, owner or a date), **Then** the deal page of that row opens.
2. **Given** the deal list, **When** the user single-clicks a row, **Then** the deal drawer opens as today.
3. **Given** the deal list with filters, sorting or a page number in the address, **When** the user double-clicks a row and then goes back, **Then** the list shows the same filters, sorting and page.

---

### User Story 3 - Double-click a person row in the People list (Priority: P2)

A user on the People list double-clicks a row and lands on that person's page.

**Why this priority**: The People list is the second most visited list; same shortcut, same value.

**Independent Test**: Open the People list, double-click a row outside its links, check that the person page opens.

**Acceptance Scenarios**:

1. **Given** the People list, **When** the user double-clicks any part of a row that is not a link (for example the role, owner, labels or a custom field), **Then** the person page of that row opens.
2. **Given** the People list, **When** the user single-clicks a row, **Then** the person preview drawer opens as today.

---

### User Story 4 - Double-click an organisation row in the Organisations list (Priority: P3)

A user on the Organisations list double-clicks a row and lands on that organisation's page.

**Why this priority**: Added at clarification so the Organisations list works like the People list; least visited of the four.

**Independent Test**: Open the Organisations list, double-click a row outside its links, check that the organisation page opens.

**Acceptance Scenarios**:

1. **Given** the Organisations list, **When** the user double-clicks any part of a row that is not a link, **Then** the organisation page of that row opens.
2. **Given** the Organisations list, **When** the user single-clicks a row, **Then** the organisation preview drawer opens as today.

---

### Edge Cases

- **Double-click on the record's name** in a row: the record's page opens (the name already links to it).
- **Double-click on a linked organisation or person** inside a row or card: that organisation's or person's page opens, not the row's record page.
- **The first click of the double-click** opens the drawer: after the double-click the browser shows the record's page, not the list with the drawer open.
- **Deal, person or organisation no longer visible or deleted** after the list loaded (deleted, or made private by someone else): the double-click shows the same "not found" page as opening that record's address directly (for a deal: the deal-not-found message and [ DEAL LIST ]). No name, value or other detail of the record shows.
- **Archived record** shown in the list ("Show archived" ticked, row tagged Archived): the double-click opens its page, which shows it as archived.
- **Keyboard**: Tab through a row: the focusable links are the same as before this feature (name link, "Preview <name>" link, organisation/person links); Enter on the name link opens the page, Enter on "Preview" opens the drawer.
- **The "+" add-deal control and the column headers** of the board: a double-click on them opens no deal page.
- **Text selection**: a double-click that selects a word in the row still opens the record's page.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Double-clicking a deal card on the deals board MUST open that deal's page (the same page the deal's name links to).
- **FR-002**: Double-clicking a deal row in the deal list MUST open that deal's page.
- **FR-003**: Double-clicking a person row in the People list MUST open that person's page.
- **FR-003a**: Double-clicking an organisation row in the Organisations list MUST open that organisation's page.
- **FR-004**: A single click on a card or row MUST keep opening the preview drawer exactly as today, with no added delay. The drawer may show for a moment during a double-click before the page opens.
- **FR-005**: Dragging a deal card between stages MUST keep working as today and MUST NOT open the deal page.
- **FR-006**: Links inside a row or card (record name, linked organisation, linked person) MUST keep their current behaviour.
- **FR-007**: Opening a page by double-click MUST go through the same access checks as opening it by its link: a record the user cannot see shows the existing "not found" result, never its details.
- **FR-008**: The browser's Back action after a double-click MUST return to the list or board as it was (same pipeline, filters, sorting, page).
- **FR-009**: Existing keyboard and screen-reader paths to the page and the drawer MUST stay unchanged; the double-click adds no new focusable element and no new text.

### Key Entities

- **Deal**: shown as a card on the board and a row on the deal list; has its own page.
- **Person**: shown as a row on the People list; has its own page.
- **Organisation**: shown as a row on the Organisations list; has its own page.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the board, the deal list, the People list or the Organisations list, a user reaches a record's page in one double-click, with no other click.
- **SC-002**: In 100% of tested cases a single click still opens the drawer and a drag still moves the deal, with no page opened by mistake.
- **SC-003**: The record's page appears within the same time as following the record's name link today.
- **SC-004**: No record the user cannot see is ever shown through a double-click.

## Assumptions

- "Deals tab" means both views of the deals tab: the board (cards) and the List view (rows). "People tab" means the People list.
- The Activities list, the Ambassadors page and other lists are out of scope; they keep their current behaviour.
- The single click keeps opening the drawer at once (product decision SF-90 / SF-93: preview drawer on row/card selection); the double-click is an addition, not a replacement.
- The page opens in the same browser tab. Ctrl/Cmd/Shift + double-click and double tap on touch screens are not covered: no behaviour is promised for them.
- No new user-facing text is needed.
- Design B pages and design A board keep their look; no visual change (no new hint or icon) is required.
