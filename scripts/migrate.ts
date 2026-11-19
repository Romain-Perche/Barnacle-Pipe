// npm run db:migrate — applies pending migrations/*.sql in name order.
// Each file runs in its own transaction under pg_advisory_xact_lock: Postgres releases the lock at
// commit or rollback, so no lock outlives the command, even through Supabase's transaction pooler.
// Never a session-level pg_advisory_lock (research.md §8).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { closeDb, sql } from "@/server/db";

// Fixed key for "barnacle crm migrations".
const LOCK_KEY = 7_204_331_905_117n;
const DIR = path.join(process.cwd(), "migrations");

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    const text = await readFile(path.join(DIR, file), "utf8");
    const didApply = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY.toString()}::bigint)`;
      await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
      await tx`alter table schema_migrations enable row level security`;
      const done = await tx`select 1 from schema_migrations where name = ${file}`;
      if (done.length > 0) return false;
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
      return true;
    });
    if (didApply) {
      applied++;
      console.log(`Applied ${file}`);
    }
  }
  if (applied === 0) console.log("Database is up to date.");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
