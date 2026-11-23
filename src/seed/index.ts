// REGISTRY of fake data, run in this order by `npm run db:seed` and by the browser tests.
// Later features append their seeder here (pipelines, deals, contacts…). Each one must be re-runnable.
import type { Sql } from "@/server/db";
import { seedDeals } from "@/seed/deals";
import { seedNotes } from "@/seed/notes";
import { seedPeople } from "@/seed/people";
import { seedUsers } from "@/seed/users";

export const seeders: { name: string; run: (sql: Sql) => Promise<string[]> }[] = [
  { name: "users", run: seedUsers },
  { name: "people", run: seedPeople },
  { name: "deals", run: seedDeals },
  // SF-102: notes, mentions and notifications (after the records they are on).
  { name: "notes", run: seedNotes },
];

export async function runSeeders(sql: Sql): Promise<string[]> {
  const lines: string[] = [];
  for (const seeder of seeders) lines.push(...(await seeder.run(sql)));
  return lines;
}
