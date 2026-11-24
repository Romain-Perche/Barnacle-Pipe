# Data model: Campaigns: writing the content (SF-119)

## Migration `migrations/0012_campaigns.sql`

Only statements allowed in a transaction; RLS on after the `create table` (no policies). No timeline change.

```sql
-- SF-119: campaign drafts, shared by the whole team (specs/sf-119-step-14-campaigns-writing-the-content/data-model.md).
create table campaigns (
  id bigint generated always as identity primary key,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  sender_name text not null default '' check (char_length(sender_name) <= 100),
  reply_to text not null default '' check (char_length(reply_to) <= 254),
  subject text not null default '' check (char_length(subject) <= 255),
  preview_text text not null default '' check (char_length(preview_text) <= 255),
  content_kind text null check (content_kind in ('blocks', 'html')),
  blocks jsonb null check (blocks is null or (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) between 1 and 50)),
  html text null check (char_length(html) <= 500000),
  -- Custom field tags of the draft: [{"field": <custom_fields.id>, "name": "<name at the last save>"}] (research.md §4).
  -- No foreign key: a deleted field's entry stays so its tags read as unknown.
  merge_links jsonb not null default '[]' check (jsonb_typeof(merge_links) = 'array'),
  status text not null default 'draft' check (status in ('draft')),
  created_by bigint not null references users (id),
  created_at timestamptz not null default now(),
  updated_by bigint not null references users (id),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  constraint campaigns_content_check check (
    (content_kind is null and blocks is null and html is null)
    or (content_kind = 'blocks' and blocks is not null and html is null)
    or (content_kind = 'html' and html is not null and blocks is null))
);
alter table campaigns enable row level security;
create index campaigns_updated_idx on campaigns (updated_at desc, id desc);
```

`tests/support/reset.ts` adds `campaigns` to its `truncate` list.

## Entities

### Campaign (table `campaigns`)

| Field | Rule (pure check in `campaigns/rules.ts`, message code) |
|---|---|
| `name` | trimmed, 1–100 (`campaign_name_required`, `campaign_name_too_long`) |
| `sender_name` | trimmed, ≤ 100 (`campaign_sender_too_long`); starts as the creating user's name |
| `reply_to` | trimmed; empty or `isValidEmail(normaliseEmail(x))` from `records/rules.ts`, stored normalised (`campaign_reply_to_invalid`) |
| `subject` | trimmed, ≤ 255 (`campaign_subject_too_long`) |
| `preview_text` | trimmed, ≤ 255 (`campaign_preview_text_too_long`) |
| content | see Content; empty → all three content columns null |
| `merge_links` | written by the save from the tags (research.md §4), never posted by the browser |
| `status` | always `draft` here; shown "Draft" |
| `created_by` / `created_at` | the creating (or duplicating) user; never changes |
| `updated_by` / `updated_at` | set on create, save; "Last edited" (who · when, `formatDateTime`) |
| `version` | starts 1, +1 on every save; the save's conflict check |

Lengths count code points (research.md §10). Markup in any field is kept as typed and only ever shown as text.

### Content

`null` | `{ kind: "blocks", blocks: Block[] }` (1–50) | `{ kind: "html", html: string }` (non-blank, ≤ 500,000).

| Block | Fields and limits |
|---|---|
| `heading` | `text` ≤ 200, one line (line breaks become spaces) |
| `text` | `text` ≤ 10,000; line breaks kept; web addresses become links when shown |
| `button` | `label` ≤ 60; `url` ≤ 2,000, empty or `https:` / `http:` / `mailto:` |
| `image` | `src` ≤ 2,000, empty or `https:`; `alt` ≤ 200; `url` as button |
| `divider` | — |

Unknown block types or extra keys are refused as `campaign_content_invalid` (only a tampered post can send them).
Merge tags are read in heading text, text, button label, image alt, and the HTML — not in addresses.

### Merge tag and merge field (not stored on their own)

- Tag: `{{<name>}}` or `{{<name> | <fallback>}}` in the subject, preview text, the text-bearing block fields and the
  HTML (research.md §3). Fallback ≤ 100 for a tag that names a merge field (`campaign_fallback_too_long`).
- Merge field: the 11 built-ins (keys `first_name` … `labels`) then people custom fields `cf:<id>` (research.md §3).
- Link: `{ field, name }` in `merge_links` (research.md §4); shown to the editor as `{ name, field, live }`.

### Person (read only)

Through `getPerson` (visibility rule inside), not archived; turned into the merge values map (research.md §6). Never
stored on the draft.

## State changes

```text
(none) --create(name)--> draft v1
draft vN --save(vN, valid)--> draft vN+1
draft vN --save(vM≠N)--> refused (campaign_edit_conflict, names updated_by)
draft --duplicate--> new draft v1 "Copy of <name>" (row copied, merge_links included; created_by/updated_by = actor)
draft --delete (confirmed)--> gone; open/save/duplicate/delete → campaign_gone
```

## Lists and reads

- Campaigns page: `select c.*, cu.name as created_by_name, uu.name as updated_by_name from campaigns c join users cu …
  join users uu … order by c.updated_at desc, c.id desc` — all drafts, deactivated users included. Subject shown after
  `rewriteNames` with the current fields, cut to 60 characters with "…", "—" when empty.
- Edit page: the same row by id, after `rewriteNames`; plus `mergeFields()` (built-ins + `listFields("person")`).

## Fake data (`src/seed/campaigns.ts`)

Research.md §13. Re-runnable: each draft inserted only when no campaign has that name. The "Diet (fake)" link is
looked up by name in `custom_fields` (kind `person`); the draft is skipped when the field is missing.
