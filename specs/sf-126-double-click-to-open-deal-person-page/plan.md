# Implementation Plan: Double-click to open a deal, person or organisation page

**Branch**: `factory/sf-126-double-click-to-open-deal-person-page` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

## Summary

A double-click on a board card or a list row (deal list, People, Organisations) opens the record's own page. No server
change: each card/row gets a `data-page` attribute holding the page address (`/deals/<id>`, `/people/<id>`,
`/organisations/<id>`), and one small client component listens for `dblclick` and navigates there. The page route does
the access check as for any link (FR-007). The single click and drag are untouched.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 App Router, React 19
**Primary Dependencies**: none new (`next/navigation` `useRouter`)
**Storage**: N/A (no migration)
**Testing**: Vitest (`tests/unit` for the pure helper; `tests/integration` for the rendered pages' `data-page` values)
**Target Platform**: web browser (mouse)
**Project Type**: web application
**Performance Goals**: same time as following the name link (client navigation)
**Constraints**: no new text, no new focusable element, no visual change
**Scale/Scope**: 4 pages, 1 new client component, 1 pure helper

## Constitution Check

The constitution file is an unfilled template: no gates. Repo rules (`AGENTS.md`) checked: client component only where the
browser is needed (yes, one); no user-facing text; no URL-derived text; addresses are built from numeric ids on the
server, so no `isSafeNext` redirect is involved; pages still call `requireUser()`. Pass, before and after design.

## Design

1. **Pure helper** `src/server/records/double-click.ts` (client-safe, no server imports):
   `pageToOpen(target: { closest(sel: string): ... } | null): string | null` — structurally typed so it is unit-tested
   without a DOM. Rule: find the nearest `[data-page]` ancestor of the event target; if the target sits inside an `a`
   that is not a stretched `.cell-link` (i.e. a name, organisation or person link) and that link is inside the
   `[data-page]` element, return null (the link keeps its own behaviour: a double-click on it follows the link, which is
   the record's page for the name link and the linked record's page for org/person links); otherwise return the
   `data-page` value. Only addresses matching `^/(deals|people|organisations)/\d+$` are returned.
2. **Client component** `src/app/(app)/records/OpenOnDoubleClick.tsx` (`"use client"`, renders `null`): in a `useEffect`,
   add one `dblclick` listener on `document`; call `pageToOpen(event.target)`; if non-null, `router.push(address)`
   (same tab, adds a history entry, so Back returns to the list with its filters, sorting and page: FR-008). Remove the
   listener on cleanup. Ignore events with Ctrl/Cmd/Shift/Alt pressed (not covered by the spec). Text selection does
   not stop it.
3. **Mark cards and rows**:
   - `deals/Board.tsx`: add `data-page={`/deals/${card.id}`}` to each card `Link`. Column headers and the "+" link have
     none, so nothing opens. Render `<OpenOnDoubleClick />` once in `deals/page.tsx` next to the board (client import
     into a server page is fine).
   - `deals/list/page.tsx`: `data-page={`/deals/${r.id}`}` on each `<tr>`; render the component once.
   - `people/page.tsx`: `data-page={`/people/${r.id}`}` on each `<tr>`; component once.
   - `organisations/page.tsx`: `data-page={`/organisations/${r.id}`}` on each `<tr>`; component once.
4. **CSS**: none. `.cell-link` already covers the cell, so a double-click on a cell lands on the stretched link
   (ignored by rule 1) and bubbles to the row.
5. **Docs**: add a line to `AGENTS.md` layout under `records/` naming `OpenOnDoubleClick.tsx` and `double-click.ts`
   (SF-126), and a line in `docs/DECISIONS.md`: single click = drawer, double-click = page (SF-126).

### Behaviour notes (from the spec edge cases)

- First click of a double-click navigates to `?open=<id>`; the second `router.push` supersedes it, so the page shows
  and not the list with the drawer.
- A deleted or now-private record: `/deals/<id>` etc. render their existing not-found pages; nothing is read by the
  double-click itself.
- Drag: browsers fire no `dblclick` after a drag, so FR-005 holds.
- Keyboard and screen readers: no element added; links unchanged (FR-009).

## Project Structure

```text
specs/sf-126-double-click-to-open-deal-person-page/
├── plan.md, research.md, data-model.md, quickstart.md, contracts/ui.md, dependencies.json

src/server/records/double-click.ts                 # new, pure
src/app/(app)/records/OpenOnDoubleClick.tsx        # new, client
src/app/(app)/deals/Board.tsx, deals/page.tsx      # data-page, component
src/app/(app)/deals/list/page.tsx                  # data-page, component
src/app/(app)/people/page.tsx                      # data-page, component
src/app/(app)/organisations/page.tsx               # data-page, component
tests/unit/double-click.test.ts                    # new
tests/integration/double-click-markup.test.ts      # new (rendered pages carry the right data-page)
```

**Structure Decision**: one delegated listener rather than a handler per row, so the server-rendered tables stay
server components.

## Fix round 1

**Problem**: on the deals board, a double-click on a card stays on the board (`/deals?pipeline=1&open=41`) and never
opens `/deals/41` (FR-001, US1 scenario 1, edge case 3). The lists work.

**Cause**: a board card is itself the `<a data-page>`. In `pageToOpen`, `target.closest("a")` returns the card, and
`link.closest("[data-page]")` matches the card itself, so the card is taken for a name link inside a row and the
function returns null. The unit tests model only links strictly inside a row, never a row that is the link.

**Fix**: a link stops the double-click only when it lies strictly inside the `data-page` element: skip the check when
`link === row`. In `src/server/records/double-click.ts`:

```ts
if (link && link !== row && !link.classList.contains("cell-link")) return null;
```

(`link.closest("[data-page]")` is then redundant: `link` is an ancestor-or-self of the target and `row` is the closest
`data-page`, so a link other than `row` that is inside the row is the only case left; a link outside any row cannot
happen because `row` exists.) `Board.tsx` keeps the card as one `<a>`: single click, keyboard and drag stay unchanged.

**Files**: `src/server/records/double-click.ts`, `tests/unit/double-click.test.ts`.
