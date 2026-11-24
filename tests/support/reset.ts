// Empties every app table and puts the six starting lead sources back (as the migration left them).
// Used by the integration tests; .factory/run/reset-db.sh does the same in SQL.
import type postgres from "postgres";

export const STARTING_LEAD_SOURCES = ["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"];

export async function resetAppTables(db: postgres.Sql) {
  await db`truncate campaigns, email_attachments, email_messages, email_threads, gmail_connections, pipedrive_links, pipedrive_imports, pipedrive_connections, files, file_uploads, file_cleanup, activities, note_mentions, deal_followers, deal_people, deal_label_links, deal_labels, deal_stage_periods, deals, stages, pipelines, timeline_events, person_labels, person_emails, person_phones, persons, organisations,
           labels, lead_sources, csv_imports, user_changes, sessions, users, custom_values, custom_field_choices, custom_fields, segments restart identity cascade`;
  for (const name of STARTING_LEAD_SOURCES) await db`insert into lead_sources (name) values (${name})`;
}
