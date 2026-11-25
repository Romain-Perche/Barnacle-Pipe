---
type: feature
title: Campaigns (SF-119)
description: Team-shared campaign drafts - details, block or pasted-HTML content, merge tags, the live sandboxed preview, the save version check, duplicate and delete.
tags: [campaigns, merge-tags, preview, editor]
sources:
  - id: sf119-src-campaigns
    resource: repo://src/server/campaigns/campaigns.ts
  - id: sf119-src-content
    resource: repo://src/server/campaigns/content.ts
  - id: sf119-src-merge
    resource: repo://src/server/campaigns/merge.ts
  - id: sf119-src-preview
    resource: repo://src/server/campaigns/preview.ts
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T18:25:19.853Z
generated: { by: "claude-code", at: "2026-11-24T18:25:19.853Z" }
---

# Campaigns (SF-119)

A campaign is a draft email shared by the whole team: there is no private rule, every signed-in user sees every draft.
Only drafts exist so far (`status` is `draft`); sending and recipients come later, and
[Segments](segments.md) are the planned recipient choice. For how campaign data moves, see
[the data flow](../../dataflow/DATAFLOW.md).

## Pages

- `/campaigns` (`src/app/(app)/campaigns/page.tsx`): the table of drafts; `?new=1` opens `NewCampaignBox`, `?delete=<id>`
  opens `CampaignDeleteConfirm`.
- `/campaigns/[id]`: the editor (`CampaignEditor.tsx`, client), with `not-found.tsx` for a gone draft.
- All writes are server actions in `actions.ts`. The sidebar link sits before Segments in `mainNav`
  (see [Signed-in layout](signed-in-layout-and-pages.md)).

## Server code (`src/server/campaigns/`)

- `rules.ts` (pure, client-safe): limits counted in code points, `validateDraft` (name, sender name, reply-to, subject,
  preview text), `stillEmpty`, `copyName`.
- `content.ts` (pure, client-safe): the block types (heading, text, button, image, divider), the starting layouts,
  `validateContent` (at most 50 blocks) and `blocksToHtml`; `frameDocument` wraps the email for the preview with a CSP
  and `<base target="_blank">` first.
- `merge.ts` (pure, client-safe): the tag grammar `{{<name> | <if empty>}}`, the built-in merge fields then people custom
  fields, tag resolution and filling with values HTML-escaped.
- `campaigns.ts`: list, open, create, save, duplicate, delete.
- `preview.ts`: the preview person picker and one person's merge values, read through `visiblePerson` and never for
  archived people, so a hidden private person never reaches the preview.

The pure files never import the database: the editor imports them.

## Saving

`saveCampaign` runs in one transaction that locks the row. It refuses a draft that is gone, or one saved since the
`version` the form was opened with (naming who saved it). It then checks every field and the content and returns all
errors at once. `merge_links` is worked out on the server from the texts, never taken from the browser. A save raises
`version` by one. `createCampaign` takes the creator's name as the default sender; `duplicateCampaign` copies the stored
row (never unsaved edits) as "Copy of <name>".

## Content and merge tags

A draft has no content, `blocks`, or pasted `html`; the table allows only one at a time (see
[Database schema](../data/database-schema.md#campaigns-migration-0015)). Custom field tags are kept in
`merge_links` with the field's name at the last save, so when a [custom field](custom-fields.md) is renamed the tags
follow it; a deleted field's tags read as unknown.

## Preview

`CampaignPreview.tsx` shows the email only inside an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox"
srcDoc>`; it never uses `dangerouslySetInnerHTML`. Merge values come from the person chosen in
`PreviewPersonPicker.tsx`; nothing about that person is stored on the draft. `next.config.ts` raises the server action
body limit to 4 MB for pasted HTML.
