-- SF-115: custom fields on people, organisations and deals (specs/sf-115-step-7-custom-fields/data-model.md).
create table custom_fields (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('person', 'organisation', 'deal')),
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 60),
  type text not null check (type in ('text', 'long_text', 'number', 'money', 'date', 'single_choice', 'multiple_choice', 'yes_no')),
  position int not null,
  in_list boolean not null default false,
  created_by bigint null references users (id),
  created_at timestamptz not null default now()
);
alter table custom_fields enable row level security;
create unique index custom_fields_name_key on custom_fields (kind, lower(name));
create index custom_fields_kind_position_idx on custom_fields (kind, position);

create table custom_field_choices (
  id bigint generated always as identity primary key,
  field_id bigint not null references custom_fields (id) on delete cascade,
  name text not null check (name = btrim(name) and name <> '' and char_length(name) <= 60),
  position int not null,
  removed_at timestamptz null
);
alter table custom_field_choices enable row level security;
create unique index custom_field_choices_name_key on custom_field_choices (field_id, lower(name));
create index custom_field_choices_field_idx on custom_field_choices (field_id, position);

-- One row per (field, record) that has a value; an empty field has no row.
create table custom_values (
  id bigint generated always as identity primary key,
  field_id bigint not null references custom_fields (id) on delete cascade,
  person_id bigint null references persons (id) on delete cascade,
  organisation_id bigint null references organisations (id) on delete cascade,
  deal_id bigint null references deals (id) on delete cascade,
  text_value text null check (text_value <> '' and char_length(text_value) <= 10000),
  number_value numeric(17, 4) null check (number_value between -1000000000000 and 1000000000000),
  money_pence bigint null check (money_pence between 0 and 999999999999),
  date_value date null,
  choice_id bigint null references custom_field_choices (id),
  choice_ids bigint[] null check (cardinality(choice_ids) between 1 and 100),
  bool_value boolean null,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, deal_id) = 1),
  check (num_nonnulls(text_value, number_value, money_pence, date_value, choice_id, choice_ids, bool_value) = 1)
);
alter table custom_values enable row level security;
create unique index custom_values_person_key on custom_values (field_id, person_id) where person_id is not null;
create unique index custom_values_organisation_key on custom_values (field_id, organisation_id) where organisation_id is not null;
create unique index custom_values_deal_key on custom_values (field_id, deal_id) where deal_id is not null;
create index custom_values_person_idx on custom_values (person_id) where person_id is not null;
create index custom_values_organisation_idx on custom_values (organisation_id) where organisation_id is not null;
create index custom_values_deal_idx on custom_values (deal_id) where deal_id is not null;
create index custom_values_choice_idx on custom_values (choice_id) where choice_id is not null;
create index custom_values_choice_ids_idx on custom_values using gin (choice_ids) where choice_ids is not null;

-- Timeline: a custom value set, changed or cleared, with the field's name and the values as shown at the time.
alter table timeline_events add column field_name text null check (char_length(field_name) <= 60);
alter table timeline_events add column old_value text null check (char_length(old_value) <= 10000);
alter table timeline_events add column new_value text null check (char_length(new_value) <= 10000);
alter table timeline_events drop constraint timeline_events_kind_check;
-- 'file_added' and 'file_deleted' belong to SF-116 (Files), planned at the same time. Its migration 0011_files.sql
-- rewrites this same check and lists the three custom kinds too, so neither migration drops the other's kinds,
-- whichever is merged first.
alter table timeline_events add constraint timeline_events_kind_check
  check (kind in ('added', 'edited', 'archived', 'restored', 'person_linked', 'person_unlinked', 'handed_over', 'moved',
                  'won', 'lost', 'reopened', 'note', 'imported',
                  'ambassador_added', 'ambassador_removed', 'referrer_set', 'referrer_changed', 'referrer_cleared',
                  'custom_set', 'custom_changed', 'custom_cleared',
                  'file_added', 'file_deleted'));
alter table timeline_events add constraint timeline_events_custom_check
  check ((kind in ('custom_set', 'custom_changed', 'custom_cleared')) = (field_name is not null)
         and (kind in ('custom_set', 'custom_changed', 'custom_cleared') or (old_value is null and new_value is null)));
