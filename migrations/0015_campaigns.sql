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
  -- `is not distinct from`: with content_kind null, a plain `=` would make the whole check null, which Postgres accepts.
  constraint campaigns_content_check check (
    (content_kind is null and blocks is null and html is null)
    or (content_kind is not distinct from 'blocks' and blocks is not null and html is null)
    or (content_kind is not distinct from 'html' and html is not null and blocks is null))
);
alter table campaigns enable row level security;
create index campaigns_updated_idx on campaigns (updated_at desc, id desc);
