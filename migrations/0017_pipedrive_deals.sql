-- SF-122: the Pipedrive import also brings deals, notes, activities and files
-- (specs/sf-122-step-11b-12-pipedrive-import-deals-notes/data-model.md). Statements allowed in a transaction only. No
-- new table. The timeline kind check is unchanged: imported deals use 'pipedrive_imported', notes 'note', files
-- 'file_added'.

alter table pipedrive_imports add column want_deals boolean not null default false;
alter table pipedrive_imports add column want_notes boolean not null default false;
alter table pipedrive_imports add column want_activities boolean not null default false;
alter table pipedrive_imports add column want_files boolean not null default false;
alter table pipedrive_imports add column deals_total int null;
alter table pipedrive_imports add column notes_total int null;
alter table pipedrive_imports add column activities_total int null;
alter table pipedrive_imports add column files_total int null;
alter table pipedrive_imports add column deals_done int not null default 0;
alter table pipedrive_imports add column notes_done int not null default 0;
alter table pipedrive_imports add column activities_done int not null default 0;
alter table pipedrive_imports add column files_done int not null default 0;
-- FR-002: deals, notes, activities and files come only with people and organisations.
alter table pipedrive_imports add constraint pipedrive_imports_records_check
  check (not (want_deals or want_notes or want_activities or want_files) or (want_people and want_organisations));
alter table pipedrive_imports drop constraint pipedrive_imports_step_check;
alter table pipedrive_imports add constraint pipedrive_imports_step_check
  check (step in ('prepare', 'count_organisations', 'count_people', 'count_deals', 'count_archived_deals', 'count_notes',
                  'count_activities', 'count_files', 'organisations', 'people', 'pipelines', 'deals', 'archived_deals',
                  'notes', 'activities', 'files', 'done'));
alter table pipedrive_imports drop constraint pipedrive_imports_pause_reason_check;
alter table pipedrive_imports add constraint pipedrive_imports_pause_reason_check
  check (pause_reason in ('unreachable', 'token_refused', 'other_company', 'files_unreachable'));

-- Links for the new kinds. A link whose CRM record was deleted keeps its row (the id goes null), as in SF-117.
alter table pipedrive_links add column deal_id bigint null references deals (id) on delete set null;
alter table pipedrive_links add column note_id bigint null references timeline_events (id) on delete set null;
alter table pipedrive_links add column activity_id bigint null references activities (id) on delete set null;
alter table pipedrive_links add column file_id bigint null references files (id) on delete set null;
alter table pipedrive_links drop constraint pipedrive_links_kind_check;
alter table pipedrive_links add constraint pipedrive_links_kind_check
  check (kind in ('person', 'organisation', 'deal', 'note', 'activity', 'file'));
alter table pipedrive_links add constraint pipedrive_links_target_check
  check ((kind = 'deal' or deal_id is null) and (kind = 'note' or note_id is null)
         and (kind = 'activity' or activity_id is null) and (kind = 'file' or file_id is null)
         and (kind in ('person', 'organisation') or how = 'imported'));
create index pipedrive_links_deal_idx on pipedrive_links (deal_id) where deal_id is not null;
create index pipedrive_links_note_idx on pipedrive_links (note_id) where note_id is not null;
create index pipedrive_links_activity_idx on pipedrive_links (activity_id) where activity_id is not null;
create index pipedrive_links_file_idx on pipedrive_links (file_id) where file_id is not null;
