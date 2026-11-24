# Contracts: Campaigns: writing the content (SF-119)

## Pages

| Path | Who | What |
|---|---|---|
| `/campaigns` | `requireUser()` | Table (design A): Name (link to the draft), Subject, Status `DRAFT`, Created by, Last edited (who · when), and `[ DUPLICATE ]` `[ DELETE ]` per row; `[ NEW CAMPAIGN ]` in the header. Empty: "No campaigns yet." Flash notices `campaign_deleted`, `campaign_gone`. |
| `/campaigns?new=1` | same | The page with the "New campaign" box over it: Name input, `[ CREATE ]`, `[ CANCEL ]` (link to `/campaigns`). |
| `/campaigns?delete=<id>` | same | The page with the delete confirmation box naming the draft (`templates.campaign_delete_confirm`); unknown id → no box. |
| `/campaigns/[id]` | `requireUser()` | Edit page (design A): header `CAMPAIGN · DRAFT`, name, "Last edited by <name> · <date time>", `[ SAVE ]` `[ DUPLICATE ]` `[ DELETE ]`; left `// DETAILS` and `// CONTENT · LAYOUT / PASTE HTML`; right `// PREVIEW FOR`. Missing id → `not-found.tsx` "This campaign no longer exists." |
| `/campaigns/[id]?delete=1` | same | The edit page with the delete confirmation box. |

Query parameters are read only as `1` or a positive integer; anything else is ignored and never shown.

Sidebar: `mainNav` gets `{ href: "/campaigns", label: "Campaigns" }` right after Activities.

## Server actions (`src/app/(app)/campaigns/actions.ts`, each starts with `requireUser()`)

| Action | Input (FormData unless said) | Result |
|---|---|---|
| `createCampaignAction` | `name` | refused → back to the box with the error and the typed name (`useActionState`); ok → `redirect("/campaigns/<id>")` |
| `saveCampaignAction(prev, fd)` | `id`, `version`, `name`, `senderName`, `replyTo`, `subject`, `previewText`, `contentKind` (`none`/`blocks`/`html`), `blocks` (JSON, when blocks), `html` (when html), `previewPersonId` (optional) | `{ ok: true, version, lastEdited, links, preview }` with message "Draft saved." or `{ ok: false, errors: { field → text }, message? }` (nothing saved; client keeps its state). `preview` = the person's values or `null` (research.md §6). |
| `duplicateCampaignAction` | `id` | ok → `redirect("/campaigns/<new id>")`; gone → flash `campaign_gone`, `redirect("/campaigns")` |
| `deleteCampaignAction` | `id` | flash `campaign_deleted` (name from the database) or `campaign_gone`; `redirect("/campaigns")` |
| `findPreviewPeople(query: string)` | string | `{ id, name, detail }[]` ≤ 20 (research.md §7); `[]` for a blank or > 100-character query |
| `previewPerson(personId: number)` | number | `PreviewValues | null` |

Server action body limit: `next.config.ts` `experimental.serverActions.bodySizeLimit: "4mb"` (research.md §11).

## Domain functions

`src/server/campaigns/merge.ts` (pure, client-safe):
- `BUILT_IN_MERGE_FIELDS: { key, name }[]` (11, FR-008 order); `type MergeField = { key: string; name: string }`
- `mergeFields(custom: Pick<CustomField, "id" | "name">[]): MergeField[]` — built-ins then `cf:<id>`
- `parseTags(text): Segment[]`; `tagsIn(texts: string[]): Tag[]`
- `type Link = { field: number; name: string; live: boolean }`; `shownLinks(stored, custom): Link[]`
- `rewriteNames(text, stored, custom): string` (research.md §4)
- `resolveTag(name, links, fields): MergeField | "unknown"` (dead link → `"unknown"`)
- `unknownTags(texts, links, fields): string[]` — raw tags, first-seen order, no repeats ("Unknown merge tags: …")
- `linksToStore(texts, links, fields): { field; name }[]`
- `fillText(text, ctx): string`; `fillHtml(html, ctx): string` (values HTML-escaped; fallback tint flag)
- `escapeHtml(s)`; `insertTag(field, fallback)` → `{{<name>}}` / `{{<name> | <fallback>}}`
- `type PreviewValues = Record<string, string | null>`

`src/server/campaigns/content.ts` (pure, client-safe):
- `type Block`, `type Content`, `LAYOUTS` (`blank`, `text`, `text_button`, `newsletter` with labels), `BLOCK_LABELS`
- `newBlock(type)`, `layoutBlocks(layout)`
- `validateContent(kind, blocksJson, html)` → `{ ok, content } | { ok: false, errors }`
- `isEmptyContent(content)`; `blocksToHtml(blocks, fill)`; `linkify(escapedText)`
- `frameDocument(contentHtml, unsubscribeHtml)` (research.md §5)

`src/server/campaigns/rules.ts` (pure): `CAMPAIGN_LIMITS`, `validateDraft(form, fields, links)` → errors by field,
`stillEmpty(draft)` → `("Sender name" | "Subject" | "Content")[]`, `copyName(name)`, `codePoints(s)`.

`src/server/campaigns/campaigns.ts` (database): `listCampaigns()`, `getCampaignById(id)` (→ editor view: rewritten
texts, shown links, last edited), `createCampaign(actor, name)`, `saveCampaign(actor, id, version, form)`,
`duplicateCampaign(actor, id)`, `deleteCampaign(actor, id)` → `{ ok, name } | { ok: false, code }`.

`src/server/campaigns/preview.ts` (database): `searchPreviewPeople(viewerId, query)`, `previewValues(viewerId, personId)`.

## Client components (`src/app/(app)/campaigns/`)

- `CampaignEditor.tsx` — the form state (details, content, blocks), the header `[ SAVE ]` (`useActionState`), field
  errors, "Draft saved.", "Still empty: …", "Unknown merge tags: …", the layout chooser and the switch confirmations
  (in-page box, no `window.confirm`).
- `MergeTagMenu.tsx` — `[ INSERT MERGE TAG ]`: the fields list and "If empty, show" (maxLength 100); inserts at the
  cursor of the last focused text input / textarea.
- `BlockList.tsx` — blocks with ↑ ↓ `[ REMOVE ]`, `[ + ADD BLOCK ]` (disabled at 50).
- `PreviewPersonPicker.tsx` — search box (research.md §7).
- `CampaignPreview.tsx` — From / Reply-to / subject / preview text as text nodes; the sandboxed frame
  (research.md §5), `openLinksInNewTab`.

Server: `page.tsx`, `NewCampaignBox.tsx`, `CampaignDeleteConfirm.tsx`, `[id]/page.tsx`, `[id]/not-found.tsx`.

## Messages (`src/server/messages.ts`)

`messages`:
- `campaigns_empty`: "No campaigns yet."
- `campaign_saved`: "Draft saved."
- `campaign_gone`: "This campaign no longer exists."
- `campaign_name_required`: "Give the campaign a name."
- `campaign_name_too_long`: "A campaign name can be at most 100 characters."
- `campaign_sender_too_long`: "Sender name: at most 100 characters."
- `campaign_reply_to_invalid`: "Reply-to: enter one valid email address."
- `campaign_subject_too_long`: "Subject: at most 255 characters."
- `campaign_preview_text_too_long`: "Preview text: at most 255 characters."
- `campaign_fallback_too_long`: "If empty, show: at most 100 characters."
- `campaign_html_too_long`: "The HTML can be at most 500,000 characters."
- `campaign_blocks_limit`: "A campaign can have at most 50 blocks."
- `campaign_content_invalid`: "The content couldn't be read. Reload and try again."
- `campaign_still_empty`: "Still empty: "
- `campaign_unknown_tags`: "Unknown merge tags: "
- `campaign_preview_choose`: "Choose a person to preview."
- `campaign_unsubscribe_line`: "Don't want these emails?" · `campaign_unsubscribe`: "Unsubscribe"
- `campaign_switch_to_html`: "Switch to Paste HTML? The HTML box will start with this content as HTML."
- `campaign_switch_to_layout`: "Switch to a layout? The pasted HTML will be replaced by the layout's blocks."
- labels: `campaign_new`, `campaign_save`, `campaign_duplicate`, `campaign_delete`, `campaign_insert_tag`,
  `campaign_if_empty`, `campaign_add_block`, the column headings, layout and block names.

`templates`:
- `campaign_deleted(name)`: `Campaign "${name}" deleted.`
- `campaign_delete_confirm(name)`: `Delete the campaign "${name}" for good? This can't be undone.`
- `campaign_edit_conflict(name)`: `${name} changed this campaign since you opened it. Reload to see their changes.`
- `campaign_block_too_long(block, max)`: `${block}: at most ${max} characters.` (block label, a number)
- `campaign_button_url` / `campaign_image_url` (block label): `${block}: enter a web address starting with https://.`
- `campaign_copy_name(name)`: `Copy of ${name}` (then cut to 100)

Flash codes (`records/flash.ts`): `campaign_deleted` (name), `campaign_gone`.
