// npm run db:seed — loads fake data. Only when APP_ENV is exactly development or test, and never on
// a Vercel production or preview deployment (FR-026). Refused before any database connection.
import { messages } from "@/server/messages";
import { isFakeAllowed } from "@/server/env";

async function main() {
  if (!isFakeAllowed()) {
    console.log(messages.seed_refused);
    process.exit(1);
  }
  const { closeDb, sql } = await import("@/server/db");
  const { runSeeders } = await import("@/seed");
  try {
    for (const line of await runSeeders(sql)) console.log(line);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
