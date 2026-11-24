---
type: feature
title: Campaigns (SF-119)
description: Team-shared campaign drafts at /campaigns - details, block layouts or pasted HTML, merge tags, a sandboxed live preview, the version check on save, duplicate and delete.
tags: [campaigns, merge-tags, preview, records]
sources:
  - id: sf119-src-campaigns
    resource: repo://src/server/campaigns/campaigns.ts
  - id: sf119-src-rules
    resource: repo://src/server/campaigns/rules.ts
  - id: sf119-src-content
    resource: repo://src/server/campaigns/content.ts
  - id: sf119-src-merge
    resource: repo://src/server/campaigns/merge.ts
  - id: sf119-src-preview
    resource: repo://src/server/campaigns/preview.ts
  - id: sf119-src-preview-ui
    resource: repo://src/app/(app)/campaigns/CampaignPreview.tsx
  - id: sf119-src-migration
    resource: repo://migrations/0012_campaigns.sql
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T17:34:42.245Z
generated: { by: "claude-code", at: "2026-11-24T17:34:42.245Z" }
---

# Campaigns (SF-119)

The **Campaigns** page (sidebar entry in `nav.ts`) lists drafts of marketing emails. A draft is only written, never
sent: its `status` is always `draft`. Drafts belong to the whole team, so there is no visibility rule; every page and
action still calls `requireUser()` first. Where the data lives and moves is in [the data flow](../../dataflow/DATAFLOW.md);
the table is in [Database schema](../data/database-schema.md#campaigns-migration-0012).

## Code layout

- `src/server/campaigns/rules.ts`, `content.ts`, `merge.ts` are pure and client-safe (the editor imports them): limits counted
  in code points, `validateDraft`, `stillEmpty`, `copyName`; blocks, `LAYOUTS`, `validateContent`, `blocksToHtml`,
  `frameDocument`; the merge tag grammar.
- `campaigns.ts` (list, open, create, save, duplicate, delete) and `preview.ts` (people picker search and a person's
  merge values) use the database.
- `src/app/(app)/campaigns/`: the list page, `[id]/` the edit page, `actions.ts`, and client parts `CampaignEditor.tsx`,
  `BlockList.tsx`, `MergeTagMenu.tsx`, `PreviewPersonPicker.tsx`, `CampaignPreview.tsx`.

## Content

A draft has a name, sender name, reply-to, subject and preview text, and content of one of two kinds: **blocks**
(heading, text, button, image, divider; 1 to 50 of them, started from the layouts Blank, Text, Text and button or
Newsletter) or pasted **HTML** (up to 500000 characters; `next.config.ts` raises the server action body limit to 4 MB for it).
Block addresses must use an allowed scheme.

## Merge tags

Tags are written `{{<name> | <if empty>}}`. There are 11 built-in merge fields, then the people custom fields as `cf:<id>`.
A name resolves link, then built-in, then custom, otherwise it is an unknown tag (shown as written). Values are
HTML-escaped when filled. `merge_links` stores the custom field tags of the draft with the field's name at the last save,
worked out on the server at save time; on open, tags follow a renamed field and a deleted field's tags read as unknown.
See [Custom fields](custom-fields.md).

## Preview

The live preview fills the tags with a person found through the picker, read through `visiblePerson` / `getPerson` (never
an archived person, never one the viewer cannot see). The email is shown only in `<iframe sandbox="allow-popups
allow-popups-to-escape-sandbox" srcDoc>`: no scripts, forms or same origin. `frameDocument` puts a Content-Security-Policy
(`default-src 'none'`, images and inline styles allowed) and `<base target="_blank">` first. `dangerouslySetInnerHTML` is
never used.

## Saving, copying, deleting

`saveCampaign` locks the row, refuses a draft that is gone (`campaign_gone`) or saved since the `version` the editor
opened (naming who saved it), then checks every field and the content and returns all errors at once. A save bumps
`version`. `duplicateCampaign` copies the stored row (not unsaved changes) as "Copy of <name>" cut to 100 characters.
`deleteCampaign` removes the draft and the next page shows the one-shot notice `campaign_deleted` (with the name from the
database) through the [flash](people-and-organisations.md) cookie; `?delete=` opens the confirmation.

## Fake data

`src/seed/campaigns.ts` adds clearly fake drafts, see [Migrations and seeding](../operations/migrations-and-seeding.md).
