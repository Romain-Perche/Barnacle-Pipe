---
type: feature
title: Campaigns (SF-119)
description: Shared campaign drafts with merge tags, block or HTML content, a sandboxed live preview for a chosen person, and a version check on save. Drafts only; nothing is sent.
tags: [campaigns, merge-tags, preview, custom-fields]
sources:
  - id: sf119-src-campaigns
    resource: repo://src/server/campaigns/campaigns.ts
  - id: sf119-src-merge
    resource: repo://src/server/campaigns/merge.ts
  - id: sf119-src-content
    resource: repo://src/server/campaigns/content.ts
  - id: sf119-src-preview
    resource: repo://src/server/campaigns/preview.ts
  - id: sf119-src-actions
    resource: repo://src/app/(app)/campaigns/actions.ts
  - id: sf119-src-migration
    resource: repo://migrations/0014_campaigns.sql
  - id: openwiki-source-22a20f27ed35504de4be1d03
    resource: repo://src/app/(app)/campaigns/CampaignPreview.tsx
verified:
  - by: openwiki/0.9.0
    at: 2026-11-24T17:53:35.777Z
generated: { by: "claude-code", at: "2026-11-24T17:53:35.777Z" }
---

# Campaigns (SF-119)

The team writes email campaign drafts here. A draft belongs to the whole team: there is no private rule and no
`visiblePerson()` style filter on `campaigns`. Status is always `draft`; sending is not part of this step.

## Server (`src/server/campaigns/`)

- `merge.ts` (pure, client-safe): the tag grammar `{{<name> | <if empty>}}`, the 11 built-in merge fields, then people
  custom fields as `cf:<id>`. `resolveTag` tries link, built-in, custom, then unknown. `rewriteNames` makes custom field
  tags follow renames through the `merge_links` column. Filled values are HTML-escaped.
- `content.ts` (pure, client-safe): blocks, layouts, `validateContent`, `blocksToHtml`, and `frameDocument`, which puts
  the preview's CSP and `<base target="_blank">` first.
- `rules.ts` (pure, client-safe): limits in code points, `validateDraft`, `copyName`.
- `campaigns.ts`: list, open (with renamed tags), create, save with the `version` check, duplicate, delete.
- `preview.ts`: the person picker search and a person's merge values, read through `visiblePerson` / `getPerson`, never
  archived people.

The pure files never import `@/server/db`; the editor imports them.

## UI (`src/app/(app)/campaigns/`)

The Campaigns page lists drafts (`?new=1` opens the new-draft box, `?delete=<id>` the confirmation); `[id]/` is the edit
page. `CampaignEditor.tsx` holds the details, content and live filling; `CampaignPreview.tsx` shows the email only inside
a sandboxed `<iframe srcDoc>`, never `dangerouslySetInnerHTML`. Server actions in `actions.ts` cover create, save,
duplicate, delete, the picker search and the preview values. `next.config.ts` raises the server action body limit to 4 MB
for pasted HTML. The sidebar links the page from `nav.ts`.

## Data

Table `campaigns` (migration 0014, see [Database schema](../data/database-schema.md)). Custom field definitions come
from [Custom fields](custom-fields.md). For how data moves between these parts see
[dataflow/DATAFLOW.md](../../dataflow/DATAFLOW.md). Dev data comes from `src/seed/campaigns.ts`.
