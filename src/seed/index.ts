// REGISTRY of fake data, run in this order by `npm run db:seed` and by the browser tests.
// Later features append their seeder here (pipelines, deals, contacts…). Each one must be re-runnable.
import type { Sql } from "@/server/db";
import { seedPeople } from "@/seed/people";
import { seedUsers } from "@/seed/users";

export const seeders: { name: string; run: (sql: Sql) => Promise<string[]> }[] = [
  { name: "users", run: seedUsers },
  { name: "people", run: seedPeople },
];

export async function runSeeders(sql: Sql): Promise<string[]> {
  const lines: string[] = [];
  for (const seeder of seeders) lines.push(...(await seeder.run(sql)));
  return lines;
}
