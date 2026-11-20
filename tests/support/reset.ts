// Empties every app table and puts the six starting lead sources back (as the migration left them).
// Shared by the integration tests and the browser tests; .factory/run/reset-db.sh does the same in SQL.
import type postgres from "postgres";

export const STARTING_LEAD_SOURCES = ["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"];

export async function resetAppTables(db: postgres.Sql) {
  await db`truncate deal_followers, deal_people, deal_label_links, deal_labels, deal_stage_periods, deals, stages, pipelines, timeline_events, person_labels, person_emails, person_phones, persons, organisations,
           labels, lead_sources, user_changes, sessions, users restart identity cascade`;
  for (const name of STARTING_LEAD_SOURCES) await db`insert into lead_sources (name) values (${name})`;
}
