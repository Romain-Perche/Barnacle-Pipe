// The one visibility rule for people (SF-92 data-model.md): a private person is seen only by their creator and
// their current owner, admins included. Every query that reads `persons` uses this fragment.
import type { Sql } from "@/server/db";

export function visiblePerson(db: Sql, viewerId: number, alias = "p") {
  const p = db(alias);
  return db`(not ${p}.private or ${p}.created_by = ${viewerId} or ${p}.owner_id = ${viewerId})`;
}

// The one visibility rule for deals (FR-016, data-model.md § Visibility): a private deal is seen only by its
// creator and its current owner, admins included. Every query that reads `deals` for a viewer uses this fragment.
export function visibleDeal(db: Sql, viewerId: number, alias = "d") {
  return db`(not ${db(alias)}.private or ${db(alias)}.created_by = ${viewerId} or ${db(alias)}.owner_id = ${viewerId})`;
}
