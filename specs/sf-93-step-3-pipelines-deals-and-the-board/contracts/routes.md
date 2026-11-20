# Contract: pages, actions and messages

All paths are inside the design B shell (`src/app/(app)/`). "Signed in" = `requireUser()`; "admin" =
`requireAdmin()` for pages (a non-admin sees the Forbidden page, HTTP 403), `assertAdminForAction()` for
actions (a non-admin is sent to `/admin/users`, which shows "You don't have access to this page.", nothing
changes). Ids in the address are read with `parseId` (`src/server/records/list-query.ts`); anything else is
ignored. Text from the address is never shown; `?error=` takes a code from the allow-list of that page.

## Pages

| Path | Access | Behaviour |
|---|---|---|
| `/deals` | signed in | Head: `// DEALS`, the pipeline name as `h1`, picker "Pipeline: <name>" (a GET form with a `<select name="pipeline">` in pipeline order, auto-submitted with the existing `AutoSubmit`, `[ GO ]` without JS), `[ ADD DEAL ]` → `/deals/new?pipeline=<id>`. Query: `pipeline` (unknown/missing → first pipeline), `open` (deal id → drawer), `confirm=delete` (admin, with `open`), `error` (allow-list: `deal_changed`, `deal_move_failed`). Board: one column per stage in order; header stage name, `+` (→ `/deals/new?pipeline=<p>&stage=<s>`), "<n> deals · £total" (`1 deal`); cards (title, organisation, person, value; "Private" badge on private deals, which only their creator and owner see), each a link to `?pipeline=<p>&open=<id>`; empty column "No deals in this stage.". No pipelines: "No pipelines yet." (+ `[ ADD PIPELINE ]` → `/admin/pipelines` for admins). Pipeline with no stages: "This pipeline has no stages yet.". Flash `deal_deleted` shown as a notice. |
| drawer (`open`) | signed in, deal visible, not archived, in this pipeline | `// DEAL`, title, "Private" badge (when private; only the creator and owner can see it), Pipeline · Stage, Value, Organisation (link `/organisations/<id>`, "Archived" badge), Person (link `/people/<id>` only when visible; "Archived" badge), Owner (· "(deactivated)"), Expected close ("15 Dec 2026" or "—"), Date added. "Move to" form: `<select name="toStageId">` grouped by pipeline (`<optgroup>`), `[ MOVE ]`. `[ EDIT ]` → `/deals/<id>/edit`, `[ ARCHIVE ]` (form), `[ DELETE ]` (admins → `&confirm=delete`), `[ CLOSE ]`. Confirm block: "Delete <title> for good? This can't be undone." with `[ DELETE FOR GOOD ]` / `[ CANCEL ]`. `// HISTORY` newest first (`readTimeline({ dealId })`). |
| `/deals/new` | signed in | `DealForm` empty: pipeline and stage from `?pipeline=`/`?stage=` when valid (else the first pipeline, its first stage); owner = user; Private unticked. Pipeline `<select>` + stage `<select>` (stages of every pipeline embedded; the stage list follows the chosen pipeline). No pipeline with a stage → "No pipelines yet." |
| `/deals/[id]/edit` | signed in, deal visible, not archived | `DealForm` filled (no pipeline/stage fields; moves are done from the board), hidden `id`, `version`; "Private" only for the creator and the current owner; a hidden main person shows as empty. Not visible / archived / missing → `notFound()`. |
| `/admin/pipelines` | admin | `// ADMIN`, "Pipelines". Add field + `[ ADD PIPELINE ]`; one row per pipeline in order: name (link to its stages), rename field + `[ RENAME ]`, `[ ↑ ]`, `[ ↓ ]`, `[ DELETE ]`. `?delete=<id>`: confirm block — no deals: "Delete <name>? This can't be undone." + `[ DELETE FOR GOOD ]`; with deals: "<name> has <n> deals. Move them to:" + `<select name="targetStageId">` (stages of other pipelines, grouped) + `[ MOVE DEALS AND DELETE ]`. `?error=` allow-list: `pipeline_name_required`, `pipeline_name_exists`, `pipeline_delete_no_target`, `pipeline_target_invalid`. |
| `/admin/pipelines/[id]` | admin | `// ADMIN · PIPELINES`, pipeline name. Add stage field + `[ ADD STAGE ]`; one row per stage: rename + `[ RENAME ]`, `[ ↑ ]`, `[ ↓ ]`, `[ DELETE ]`, deal count. `?delete=<stageId>`: no deals → plain confirmation; with deals → "<name> has <n> deals. Move them to:" + `<select>` of the other stages of this pipeline + `[ MOVE DEALS AND DELETE ]`. `?error=` allow-list: as above plus `stage_last_with_deals`, `stage_target_invalid`. Missing pipeline → `notFound()`. |

Sidebar (`nav.ts`): main `Home`, `Deals` (`/deals`), `People`, `Organisations`; admin `Users`,
`Lead sources and labels`, `Pipelines` (`/admin/pipelines`).

## Server actions

Every action: `requireUser()` (or `assertAdminForAction()`) first; the domain function re-checks visibility,
rights (`isActiveAdmin`) and versions inside one transaction; `revalidatePath("/deals")` (+
`/admin/pipelines` for pipeline changes).

### `src/app/(app)/deals/actions.ts`

| Action | Input | Success | Refusal |
|---|---|---|---|
| `createDeal(prev, form)` | title, value, pipelineId, stageId, organisationId or newOrganisationName, personId, ownerId, expectedClose (`YYYY-MM-DD`), private | redirect `/deals?pipeline=<p>&open=<id>` | `{ errors, values }`: `deal_title_required`, `deal_title_too_long`, `deal_value_invalid`, `deal_stage_required`, `deal_close_date_invalid`, `organisation_exists` (+ `{name, href}`) |
| `updateDeal(prev, form)` | as create without pipeline/stage, + `id`, `version` | redirect `/deals?pipeline=<p>&open=<id>` | as create + `deal_edit_conflict`; not visible / archived / missing → redirect `/deals`; private and the actor is no longer creator or owner → redirect `/deals?pipeline=<p>` with the `deal_no_longer_visible` flash (title from the database) |
| `moveDealFromBoard({ dealId, version, fromStageId, toStageId })` | called by `Board.tsx` (not a form) | returns `{ status: "moved", version }` | returns `{ status: "stale" }` (changed, archived, deleted, not visible, unknown target stage); an exception → client shows `deal_move_failed` |
| `moveDeal(form)` | `id`, `version`, `toStageId` (drawer "Move to") | redirect `/deals?pipeline=<new p>&open=<id>` | stale → redirect `/deals?pipeline=<p>&error=deal_changed` |
| `archiveDeal(form)` | `id` | redirect `/deals?pipeline=<p>` | not visible → redirect `/deals` |
| `deleteDeal(form)` | `id` | `assertAdminForAction()`; flash `{code: "deal_deleted", name: title}`; redirect `/deals?pipeline=<p>` | non-admin → forbidden page, nothing deleted; not visible → redirect `/deals` |

Domain (`src/server/deals/deals.ts`): `getBoard(viewerId, pipelineId|null)`, `getDeal(viewerId, id)`,
`dealFormChoices(viewerId, current)`, `createDeal`, `updateDeal`, `moveDeal(actorId, {dealId, version,
fromStageId|null, toStageId})` (→ `moved` / `same` / `stale`), `archiveDeal`, `deleteDeal`.

### `src/app/(app)/admin/pipelines/actions.ts` (all `assertAdminForAction()`)

| Action | Input | Success → redirect | Refusal → redirect with `?error=` |
|---|---|---|---|
| `addPipeline` | name | `/admin/pipelines` (added last) | `pipeline_name_required`, `pipeline_name_exists` |
| `renamePipeline` | id, name | `/admin/pipelines` | same |
| `movePipeline` | id, direction (`up`/`down`) | `/admin/pipelines` | — (first up / last down: no change) |
| `deletePipeline` | id, targetStageId (required when it has deals) | `/admin/pipelines` | `pipeline_delete_no_target`, `pipeline_target_invalid` (missing or same pipeline) |
| `addStage` | pipelineId, name | `/admin/pipelines/<p>` (added last) | `pipeline_name_required`, `pipeline_name_exists` |
| `renameStage` | id, name | `/admin/pipelines/<p>` | same |
| `moveStage` | id, direction | `/admin/pipelines/<p>` | — |
| `deleteStage` | id, targetStageId (required when it has deals) | `/admin/pipelines/<p>` | `stage_last_with_deals`, `stage_target_invalid` |

Domain (`src/server/deals/pipelines.ts`): `listPipelines()`, `getPipelineWithStages(id)`, and one function
per action above, each re-checking `isActiveAdmin` in its transaction and returning `{ status: "ok" } |
{ status: "invalid", code } | { status: "forbidden" } | { status: "not_found" }`.

## Messages (add to `src/server/messages.ts`)

| Code | Text |
|---|---|
| `deal_title_required` | Enter a deal title. |
| `deal_title_too_long` | Keep the title under 200 characters. |
| `deal_value_invalid` | Enter a value in pounds, for example 4000 or 4000.50. |
| `deal_stage_required` | Choose a pipeline and stage. |
| `deal_close_date_invalid` | Enter a valid date. |
| `deal_edit_conflict` | Someone else changed this deal while you were editing. Reload to see their changes. |
| `deal_no_longer_visible` (template, title from the database) | You can no longer see <title>: only its creator and owner can. |
| `deal_changed` | This deal changed since you loaded the board. The board has been refreshed. |
| `deal_move_failed` | The deal could not be moved. Try again. |
| `no_pipelines_yet` | No pipelines yet. |
| `no_stages_yet` | This pipeline has no stages yet. |
| `no_deals_in_stage` | No deals in this stage. |
| `pipeline_name_required` | Enter a name. |
| `pipeline_name_exists` | This name is already used. |
| `stage_last_with_deals` | A pipeline with deals needs at least one stage. |
| `stage_target_invalid` | Choose another stage of this pipeline to move the deals to. |
| `pipeline_target_invalid` | Choose a stage in another pipeline to move the deals to. |
| `pipeline_delete_no_target` | Add a stage to another pipeline first, so its deals have somewhere to go. |

Templates (name always read from the database): `deal_deleted(title)` "<title> was deleted." (also added to
`flash.ts` `CODES`); `deal_count(n)` "1 deal" / "<n> deals"; `pipeline_has_deals(name, n)` "<name> has <n>
deals. Move them to:"; `pipeline_delete_confirm(name)` "Delete <name>? This can't be undone."; the deal delete
confirmation reuses `delete_confirm(title)`.

History lines (`Timeline.tsx`, heading `// HISTORY` on deals): "Added by <name>", "Edited by <name>: Value,
Owner", "Moved from <from> to <to> by <name>" (+ " (stage deleted)" / " (pipeline deleted)"),
"Archived by <name>", each with "19 Nov 2026, 10:42".
