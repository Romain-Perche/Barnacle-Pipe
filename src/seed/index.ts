// REGISTRY of fake data, run in this order by `npm run db:seed` and by the tests.
// Later features append their seeder here (pipelines, deals, contacts…). Each one must be re-runnable.
// SF-117: the fake Pipedrive needs no seeding: fakePipedrive() (src/server/pipedrive/fake-pipedrive.ts) builds its own
// data, and its owners' emails are those of the fake users (ada@ and margaret@barnacle.ai) so owners match by hand.
import type { Sql } from "@/server/db";
import { seedActivities } from "@/seed/activities";
import { seedAmbassadors } from "@/seed/ambassadors";
import { seedCalendar } from "@/seed/calendar";
import { seedCampaigns } from "@/seed/campaigns";
import { seedCustomFields } from "@/seed/custom-fields";
import { seedDeals } from "@/seed/deals";
import { seedFiles } from "@/seed/files";
import { seedGmail } from "@/seed/gmail";
import { seedNotes } from "@/seed/notes";
import { seedPeople } from "@/seed/people";
import { seedSegments } from "@/seed/segments";
import { seedSentEmails } from "@/seed/sent-emails";
import { seedUsers } from "@/seed/users";

export const seeders: { name: string; run: (sql: Sql) => Promise<string[]> }[] = [
  { name: "users", run: seedUsers },
  { name: "people", run: seedPeople },
  { name: "deals", run: seedDeals },
  // SF-118: Ada Fake's fake Gmail connection and three copied conversations with fake people (fake Gmail only).
  { name: "gmail", run: seedGmail },
  // SF-102: notes, mentions and notifications (after the records they are on).
  { name: "notes", run: seedNotes },
  // SF-109: calls, meetings and tasks, with assignment notifications (after the records they are on).
  { name: "activities", run: seedActivities },
  // SF-124: Ada Fake's fake Google Calendar: her planned activities and one meeting from Google with a fake person
  // (after gmail and activities; fake Gmail and CALENDAR_SYNC=on only).
  { name: "calendar", run: seedCalendar },
  // SF-114: ambassadors, referred people and deals (after the users, organisations and pipelines they use).
  { name: "ambassadors", run: seedAmbassadors },
  // SF-116: files on deals, people and organisations, through the (fake) file storage, with their FILE entries.
  { name: "files", run: seedFiles },
  // SF-129: one email Ada Fake wrote from a fake deal to its main person, through her fake Gmail (after gmail and files).
  { name: "sent-emails", run: seedSentEmails },
  // SF-115: custom fields of every type and values on fake records (after the people, organisations and deals).
  { name: "custom-fields", run: seedCustomFields },
  // SF-119: campaign drafts, one per layout and one pasted HTML email (after the custom fields: one links "Diet (fake)").
  { name: "campaigns", run: seedCampaigns },
  // SF-120: saved segments of each kind (after the pipelines, lead sources, users and custom fields they refer to).
  { name: "segments", run: seedSegments },
];

export async function runSeeders(sql: Sql): Promise<string[]> {
  const lines: string[] = [];
  for (const seeder of seeders) lines.push(...(await seeder.run(sql)));
  return lines;
}
