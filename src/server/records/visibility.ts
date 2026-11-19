// The one visibility rule for people (research.md §2, data-model.md § Visibility): a private person is seen
// only by their creator, admins included. Every query that reads `persons` uses this fragment.
import type { Sql } from "@/server/db";

export function visiblePerson(db: Sql, viewerId: number, alias = "p") {
  return db`(not ${db(alias)}.private or ${db(alias)}.created_by = ${viewerId})`;
}
