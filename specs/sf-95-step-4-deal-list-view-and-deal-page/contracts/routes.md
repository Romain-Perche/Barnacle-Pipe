# Contract: pages, actions and messages (SF-95)

Same conventions as SF-93 (`specs/sf-93-step-3-pipelines-deals-and-the-board/contracts/routes.md`): "signed in" =
`requireUser()`; admin pages `requireAdmin()`; admin actions `assertAdminForAction()`; ids read with `parseId`;
text from the address never shown; `?error=` only from the page's allow-list; redirects to fixed paths built from
numeric ids.

## Pages

| Path | Access | Behaviour |
|---|---|---|
| `/deals` (board, changed) | signed in | As SF-93, plus: head has the "Board / List" switch (`[ BOARD ]` current, `[ LIST ]` → `/deals/list`); only `status = 'open'` deals are shown and counted; the drawer gets `[ OPEN DEAL PAGE ]` → `/deals/<id>`. |
| `/deals/list` | signed in | Head: `// DEALS`, `h1` "Deals", Board/List switch (`[ LIST ]` current), `[ ADD DEAL ]`, and "<n> deals · £<total>" (mono; "1 deal"). Filter row (GET form, `AutoSubmit`): search "Search deals" (`q`), Pipeline (any + pipelines), Stage (only when a pipeline is chosen: its stages), Owner, Label (non-removed deal labels, plus removed ones a visible deal has), Status (only when closed or archived shown: Any / Open / Won / Lost), Sort, Order, checkboxes "Show closed deals" (`closed=1`) and "Show archived deals" (`archived=1`), `[ APPLY ]`, `[ CLEAR ]` (→ `/deals/list`, shown when anything is set). Table: Title (link `/deals/<id>`; badges "Won"/"Lost"/"Archived"/"Private"; deal labels under the title), Value, Organisation (link), Main person (link, visible only), Pipeline · Stage, Owner, Expected close, Date added; sortable headers for title, value, organisation, stage, owner, expected close, date added. Rows open the drawer (`open=<id>`, `Cell`/`PreviewLink` as on People). 50 per page, `Pager`. Empty: "No deals match these filters." + `[ CLEAR FILTERS ]` (with filters) or "No deals yet." (without). Flash notices: `deal_deleted`, `deal_no_longer_visible`. |
| drawer on the list (`open`) | deal visible (any status, archived included) | `DealDrawer` with list links. Open deal: as the board drawer (Move to, EDIT, ARCHIVE, DELETE for admins, OPEN DEAL PAGE, CLOSE). Closed: "Won · <date>" / "Lost · <date>" badge, no "Move to". Archived: "Archived" badge, only `[ OPEN DEAL PAGE ]` and `[ CLOSE ]`. |
| `/deals/[id]` | signed in, deal visible | Design C. `← <pipeline> board` (→ `/deals?pipeline=<p>`). Header `// DEAL`, title, "Private" badge; right: open → solid green `[ WON ]` (form) and solid red `[ LOST ]` (link `?confirm=lost`); closed → `[ REOPEN ]` (form); archived → none. Stage bar (arrows, `clip-path`): every stage of the current pipeline in order, name + "<n> days" (done/now) or nothing (next); current stage marked (`aria-current="step"`); on an open, non-archived deal each other stage is a submit button of the stage-bar form (moves the deal), otherwise plain text. Strip: Value, Owner, Expected close, Status ("Open" / "Won · 19 Nov 2026" / "Lost · 19 Nov 2026"; "Archived · <date>" when archived). Lost reason under the strip when lost ("Lost because: <reason>", plain text). Actions row: not archived → `[ EDIT ]` (→ `/deals/<id>/edit?back=page`), `[ ARCHIVE ]`, `[ DELETE ]` (admins → `?confirm=delete`), `[ FOLLOW ]`/`[ UNFOLLOW ]`; archived → `[ RESTORE ]` and `[ DELETE ]` (admins). `// DETAILS` (two columns): Pipeline · Stage, Organisation (link, "Archived" badge), Main person (link, "Archived"), Other people (each link + "Archived" badge + `[ UNLINK ]`; then `PersonPicker` + `[ LINK PERSON ]` unless archived), Labels, Followers ("<name> (deactivated)"), Date added. `// HISTORY` newest first. `?confirm=lost` (open, non-archived): overlay box over the page "Why was this deal lost?", textarea `reason` (`maxLength` 500), `[ MARK AS LOST ]`, `[ CANCEL ]` (→ `/deals/<id>`). `?confirm=delete` (admins): `DeleteConfirm`, form carries `back=list`. `?error=` allow-list: `deal_edit_conflict`, `lost_reason_required` (shown inside the Lost box), `lost_reason_too_long` (inside the box), `deal_person_already_linked`. |
| `/deals/[id]` not visible / missing / deleted | — | `notFound()` → `src/app/(app)/deals/[id]/not-found.tsx`: "This deal doesn't exist or you can't see it." (HTTP 404), nothing about the deal. |
| `/deals/[id]/edit` (changed) | signed in, visible, not archived | As SF-93 + label checkboxes (non-removed deal labels plus the ones the deal has, removed or not; the deal's labels ticked); `?back=page` → hidden `back=page`, `[ CANCEL ]` → `/deals/<id>`; otherwise back to the board drawer as today. Works for closed deals. |
| `/admin/lead-sources-and-labels` (changed) | admin | Third list "Deal labels" (`ChoiceList` with `addDealLabel`, `renameDealLabel`, `removeDealLabel`) after the existing "Lead sources" and "Labels" lists, which stay as they are. `?error=` allow-list + `deal_label_exists`. |

## Server actions (`src/app/(app)/deals/actions.ts`)

Each starts with `requireUser()` (delete: `assertAdminForAction()`), then the domain function re-checks visibility,
state and version inside its transaction. `revalidatePath("/deals")`, `revalidatePath("/deals/list")`,
`revalidatePath("/deals/<id>")`.

| Action | Input | Success → redirect | Refusal → redirect |
|---|---|---|---|
| `markWon(form)` | id, version | `/deals/<id>` | conflict → `/deals/<id>?error=deal_edit_conflict`; not found → `/deals/list` |
| `markLost(form)` | id, version, reason | `/deals/<id>` | invalid → `/deals/<id>?confirm=lost&error=lost_reason_required` (or `lost_reason_too_long`); conflict / not found as above |
| `reopenDeal(form)` | id, version | `/deals/<id>` | as `markWon` |
| `restoreDeal(form)` | id | `/deals/<id>` | not found → `/deals/list` |
| `moveDealFromPage(form)` | id, version, fromStageId, toStageId (the stage-bar button's value) | `/deals/<id>` | stale → `/deals/<id>?error=deal_edit_conflict` |
| `linkPerson(form)` | id, personId | `/deals/<id>` | already linked → `?error=deal_person_already_linked`; person not allowed / deal archived → `/deals/<id>` (nothing said); deal not found → `/deals/list` |
| `unlinkPerson(form)` | id, personId | `/deals/<id>` | not linked / not visible → `/deals/<id>` |
| `followDeal(form)` / `unfollowDeal(form)` | id | `/deals/<id>` | not found → `/deals/list` |
| `updateDeal(prev, form)` (changed) | + `labelIds[]`, `back` | `back=page` → `/deals/<id>`; else as SF-93 | `no_longer_visible` with `back=page` → `/deals/list` + flash |
| `archiveDeal(form)` (changed) | + `back` | `back=page` → `/deals/<id>`; else as SF-93 | — |
| `deleteDeal(form)` (changed) | + `back` | `back=list` → `/deals/list` + flash `deal_deleted`; else as SF-93 | as SF-93 |

`back` is read through an allow-list (`page`, `list`); anything else means the board.

### Admin actions (`src/app/(app)/admin/lead-sources-and-labels/actions.ts`)

`addDealLabel`, `renameDealLabel`, `removeDealLabel`: `assertAdminForAction()`, then `choices.*Choice(user.id,
"deal_label", …)`. Refusals redirect with `?error=deal_label_exists | choice_removed_exists | choice_name_required`.

## Domain functions

`src/server/deals/deals.ts` (changed/added):
`getDeal` (+ status, closedAt, lostReason, labels, otherPeople, followers, followedByViewer), `getStageSeconds(dealId,
pipelineId)`, `markWon(actorId, id, version)`, `markLost(actorId, id, version, reason)`, `reopenDeal(actorId, id,
version)`, `restoreDeal(actorId, id)` → `{ status: "ok" } | { status: "conflict" } | { status: "invalid"; code } |
{ status: "not_found" }`; `getBoard` (+ open only); `moveDeal` (+ open only); `transferDeal` (closed → closed period);
`updateDeal` (+ labels, main person leaves `deal_people`); `dealFormChoices` (+ `labels`).

`src/server/deals/links.ts` (new): `linkPerson(actorId, dealId, personId)` → `ok | already_linked | not_allowed |
not_found`; `unlinkPerson`; `followDeal(actorId, dealId)`, `unfollowDeal` → `ok | not_found`.

`src/server/deals/list.ts` (new): `listDeals(viewerId, query) → { rows, total, totalPence, page, pages }`,
`dealFilterOptions(viewerId, pipelineId) → { pipelines, stages, owners, labels }`.

## Messages (`src/server/messages.ts`)

`messages` (fixed):

| code | text |
|---|---|
| `deal_not_found` | This deal doesn't exist or you can't see it. |
| `lost_question` | Why was this deal lost? |
| `lost_reason_required` | Enter why this deal was lost. |
| `lost_reason_too_long` | Keep the reason under 500 characters. |
| `deal_person_already_linked` | This person is already linked to this deal. |
| `deal_label_exists` | This name is already used. |
| `no_deals_match` | No deals match these filters. |
| `no_deals_yet` | No deals yet. |

Reused: `deal_edit_conflict` ("Someone else changed this deal while you were editing. Reload to see their changes."),
`deal_deleted`, `deal_no_longer_visible`, `delete_confirm`, `deal_count`.

`templates` (built from database values): `deal_list_count(n, totalPence)` → "<n> deals · £<total>"; history lines
`deal_won_event(actor)`, `deal_lost_event(actor, reason)`, `deal_reopened_event(actor)` are built in `Timeline.tsx`
from fixed words + database values (reason rendered as a text node, never HTML or a link).
