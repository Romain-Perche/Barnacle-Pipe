# Contracts: Campaigns — segments (SF-120)

Everything is inside the signed-in app (`src/app/(app)/`). Every page calls `requireUser()` first; every action calls
`requireUser()` first (a deactivated user's session is refused there, nothing is saved). Segments are shared: no
admin check, no owner check.

## Pages

| Address | File | Shows |
|---|---|---|
| `/segments` | `src/app/(app)/segments/page.tsx` | "// CAMPAIGNS" + "Segments", `[ NEW SEGMENT ]`, table Name (link) · Who (summary; broken: + `segment_broken`) · Reaches now · Last changed ("<user> · <d Mon>"), ordered by `lower(name), id`; none: `segments_none`. Flash notice (deleted / not found). |
| `/segments/new` | `segments/new/page.tsx` | "New segment", `SegmentForm` empty (who = everyone, status open), count of "Everyone in the CRM" |
| `/segments/[id]` | `segments/[id]/page.tsx` | "SEGMENT" + name, "Last changed by <user> · <d Mon yyyy HH:mm>" (UK time), `[ EDIT ]` `[ DELETE ]`; broken: `segment_broken`; count strip Reaches now · Archived · Unsubscribed · No email address; `segment_count_note`; "// WHO" (Everyone in the CRM, or Deals: <Open deals…> and Pipeline · stage: <Sales · Proposal> / Pipeline: <Sales>); "// CONDITIONS" (field name · values joined " or ", ranges "from … to …"; none: `segment_no_conditions`). `?confirm=delete` → `SegmentDeleteConfirm` |
| `/segments/[id]/edit` | `segments/[id]/edit/page.tsx` | "Edit segment", `SegmentForm` filled, count of the stored definition |
| unknown id | `segments/[id]/not-found.tsx` | `segment_not_found` and a link back to `/segments` |

`[id]` goes through `parseId`; not a number or no row → `notFound()`. Only `confirm=delete` is read from the
query string; nothing else from the address is used or shown. The sidebar: `nav.ts` `mainNav` gets
`{ href: "/segments", label: "Segments" }` after Activities (before Notifications).

## Form fields (`SegmentForm.tsx`, client, `useActionState(saveSegmentAction)`)

| Name | Value |
|---|---|
| `id`, `version` | hidden, edit only |
| `intent` | `save` \| `count` (the two submit buttons) |
| `name` | text, `maxLength` not set (server checks, message shown) |
| `who` | radio `everyone` \| `pipeline` \| `stage` |
| `pipelineId`, `stageId` | selects (stage list filtered by the chosen pipeline in the browser; server re-checks) |
| `dealStatus` | select `open` (first) \| `won` \| `lost` \| `all` |
| `c.<n>.field` | `lead_source` \| `label` \| `organisation` \| `owner` \| `role` \| `cf<id>` (`<n>` = row index, rows renumbered on remove) |
| `c.<n>.value` | repeated: ids (choice-like; `empty` allowed for single choice), or one text (role, text), or `yes`/`no`/`empty` |
| `c.<n>.from`, `c.<n>.to` | number, money, date |

Buttons: `[ SAVE ]`, `[ COUNT AGAIN ]`, `[ CANCEL ]` (link to the segment page, or `/segments` for a new one).
`[ ADD CONDITION ]` adds a row (field select first); `[ REMOVE ]` removes it. Inputs per field type: multi-picker of
options (`MultiPicker.tsx`, client, filters by typed text, chosen values as removable chips) for lead source, label,
organisation, owner, single and multiple choice; text input for role and text fields; two inputs for ranges
(`type="date"` for dates); a select Yes / No / Empty for yes/no. Removed / archived / deactivated / deleted options
carry their mark (research.md §8).

Below the inputs, the count block: "Reaches <n> people now" (`templates.segment_reaches(n)`, "1 person"),
"Left out: <a> archived · <b> unsubscribed · <c> with no email address" (`templates.segment_left_out`), and
`segment_count_note`. Errors: a list at the top (`role="alert"`) and each next to its input.

## Actions (`src/app/(app)/segments/actions.ts`, `"use server"`)

| Action | Does | Returns / redirects |
|---|---|---|
| `saveSegmentAction(prev, formData)` | `requireUser()`; `readSegmentForm(formData)`; `intent=count` → `countDefinition` (no write); `intent=save` → `createSegment` / `updateSegment` | count: `{ values, errors?, reach? }`; save ok: `redirect("/segments/<id>")`; refused: `{ values, errors }`; `segment_not_found`: flash + `redirect("/segments")` |
| `deleteSegmentAction(formData)` | `requireUser()`; `deleteSegment(actor, id)` | flash `segment_deleted` (name from the deleted row) or `segment_not_found`; `redirect("/segments")` |

Redirects are fixed paths (no `next` parameter). `revalidatePath("/segments")` after a write.

## Domain functions (`src/server/segments/`)

`rules.ts` (pure, no database):
- `SEGMENT_WHO`, `DEAL_STATUS_CHOICES`, `MAX_NAME = 100`, `MAX_CONDITIONS = 20`, `MAX_VALUES = 100`, `MAX_TEXT = 200`.
- `readSegmentForm(fd: FormData) → SegmentFormInput` (lives in `form-data.ts` beside the others if preferred).
- `validateSegmentForm(input, options: FormOptions, stored?: Definition) → { ok, name, definition } | { ok: false, errors }`.
- `readConditions(json: unknown) → Condition[]`.
- `describeSegment(def, names: Names) → { summary: string; who: {label, value}[]; conditions: {label, value}[]; broken: boolean }`
  (summary e.g. "Everyone in the CRM", "People on all deals of Exec Dinner", "People on open deals of Sales · Proposal + 3 conditions", "(deleted)" for a missing name).
- `formToValues(def) → SegmentFormValues` (what the client form starts from).

`reach.ts`:
- `reachWhere(db, viewerId, def, fields: CustomField[]) → Fragment` (on `persons p`, visibility included).
- `countReach(viewerId, def, db = sql) → Reach`.
- `reachedPeople(db, viewerId, def) → Fragment` — `select p.id, first email …` for the later sending issue (no caller yet beyond a test).

`segments.ts`:
- `listSegments(viewerId) → { id, name, summary, broken, reaches, updatedBy, updatedAt }[]`.
- `getSegment(viewerId, id) → SegmentView | null` (definition, names, description, reach with reasons, version, updated by/at).
- `segmentFormOptions(def | null) → FormOptions` (pipelines + stages, lead sources, labels, organisations, owners, person custom fields + choices).
- `createSegment(actorId, input) → { ok: true, id } | { ok: false, errors }`.
- `updateSegment(actorId, id, version, input) → { ok: true, id } | { ok: false, errors } | { ok: false, code: "segment_changed" | "segment_not_found" }`.
- `deleteSegment(actorId, id) → { ok: true, name } | { ok: false, code: "segment_not_found" }`.
- `countDefinition(viewerId, input) → { ok: true, reach } | { ok: false, errors }`.

`src/server/custom-fields/values.ts`: `customProbe(db, field, alias, test)` extracted from `customListParts`
(research.md §4); `customListParts` calls it, behaviour unchanged.

`src/server/records/flash.ts`: codes `segment_deleted`, `segment_not_found`.

## Messages (`src/server/messages.ts`)

`messages`:
- `segments_title`: "Segments"; `segments_heading`: "// CAMPAIGNS"; `segments_none`: "No segments yet."
- `segment_new`: "New segment"; `segment_edit`: "Edit segment"
- `segment_name_required`: "Give the segment a name."
- `segment_name_too_long`: "A segment name can be at most 100 characters."
- `segment_pipeline_required`: "Choose a pipeline."; `segment_stage_required`: "Choose a stage."
- `segment_conditions_limit`: "A segment can have at most 20 conditions."
- `segment_changed`: "Someone else changed this segment. Open it again to see their changes."
- `segment_not_found`: "This segment no longer exists."
- `segment_count_note`: "Recipients are worked out when the campaign is sent, so this number can change."
- `segment_broken`: "This segment refers to something that was deleted. Edit it before using it."
- `segment_no_conditions`: "No conditions."
- `segment_who_everyone`: "Everyone in the CRM"; `segment_who_pipeline`: "People on the deals of a pipeline";
  `segment_who_stage`: "People on the deals of a stage"
- `segment_status_open` / `_won` / `_lost` / `_all`: "Open deals" / "Won deals" / "Lost deals" / "All deals"
- `segment_deleted_mark`: "(deleted)"; labels for the fields: "Lead source", "Label", "Organisation", "Owner", "Role"
- `segment_strip_reaches` / `_archived` / `_unsubscribed` / `_no_email`: "Reaches now" / "Archived" / "Unsubscribed" / "No email address"

`templates`:
- `segment_name_exists(name)`: "There is already a segment called <name>."
- `segment_deleted(name)`: "Segment <name> deleted."
- `segment_delete_confirm(name)`: "Delete the segment <name>? It is deleted for the whole team."
- `segment_reaches(n)`: "Reaches <n> people now" / "Reaches 1 person now"
- `segment_left_out(a, b, c)`: "Left out: <a> archived · <b> unsubscribed · <c> with no email address"
- `segment_summary_deals(status, place)`: "People on <open|won|lost|all> deals of <place>"
- `segment_more_conditions(n)`: "+ 1 condition" / "+ <n> conditions"
- `segment_last_changed(user, when)`: "Last changed by <user> · <when>"
- `segment_condition_required(field, kind)`: "<field>: choose at least one." / "<field>: type the text to look for." / "<field>: give a from or a to." / "<field>: choose Yes, No or Empty."
- `segment_condition_too_many(field)`: "<field>: choose at most 100."
- `segment_condition_too_long(field)`: "<field>: at most 200 characters."
- `segment_condition_invalid(field, message)`: "<field>: <message>"
- `segment_condition_range(field)`: "<field>: the from must not be after the to."

Names (segment, field, choice, organisation, user) are always rendered as React text nodes.
