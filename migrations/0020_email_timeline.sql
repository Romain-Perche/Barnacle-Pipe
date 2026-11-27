-- SF-127: email on the timeline (data-model.md § Migration). One conversation across mailboxes (each mailbox keeps
-- its own email_threads row, pointing at the conversation), the addresses met in its emails (automatic linking and
-- the privacy rule), and its links to people, organisations and deals (automatic or by hand; an unlink by hand is
-- remembered so automatic linking never adds it back). Nothing is backfilled here: emails copied before SF-127 keep
-- linked_at null and are processed by the next 15-minute Gmail check (catchUpEmails).
create table email_conversations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
alter table email_conversations enable row level security;

alter table email_threads add column conversation_id bigint null references email_conversations (id);
create index email_threads_conversation_idx on email_threads (conversation_id);

alter table email_messages
  add column linked_at timestamptz null,
  add column dedupe_key text generated always as (coalesce(rfc_message_id, 'g:' || connection_id::text || ':' || gmail_message_id)) stored;
create index email_messages_unlinked_idx on email_messages (id) where linked_at is null;
create index email_messages_dedupe_idx on email_messages (dedupe_key);

create table email_conversation_addresses (
  conversation_id bigint not null references email_conversations (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email <> '' and char_length(email) <= 254),
  primary key (conversation_id, email)
);
alter table email_conversation_addresses enable row level security;
create index email_conversation_addresses_email_idx on email_conversation_addresses (email);

create table email_links (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references email_conversations (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  deal_id bigint null references deals (id) on delete cascade,
  how text not null check (how in ('auto', 'manual')),
  removed boolean not null default false,
  changed_by bigint null references users (id),
  changed_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, deal_id) = 1)
);
alter table email_links enable row level security;
create unique index email_links_person_key on email_links (conversation_id, person_id) where person_id is not null;
create unique index email_links_organisation_key on email_links (conversation_id, organisation_id) where organisation_id is not null;
create unique index email_links_deal_key on email_links (conversation_id, deal_id) where deal_id is not null;
create index email_links_person_idx on email_links (person_id);
create index email_links_organisation_idx on email_links (organisation_id);
create index email_links_deal_idx on email_links (deal_id);
