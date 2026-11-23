// The one visibility rule for people (SF-92 data-model.md): a private person is seen only by their creator and
// their current owner, admins included. Every query that reads `persons` uses this fragment.
// `viewer` is a user id, or (SF-102 research.md §5) a SQL fragment such as sql`u.id` to ask which users can see a record.
import type { Fragment, Sql } from "@/server/db";

export type Viewer = number | Fragment;

export function visiblePerson(db: Sql, viewer: Viewer, alias = "p") {
  const p = db(alias);
  return db`(not ${p}.private or ${p}.created_by = ${viewer} or ${p}.owner_id = ${viewer})`;
}

// The one visibility rule for deals (FR-016, data-model.md § Visibility): a private deal is seen only by its
// creator and its current owner, admins included. Every query that reads `deals` for a viewer uses this fragment.
export function visibleDeal(db: Sql, viewer: Viewer, alias = "d") {
  return db`(not ${db(alias)}.private or ${db(alias)}.created_by = ${viewer} or ${db(alias)}.owner_id = ${viewer})`;
}

// SF-114 research.md §7: a visible person has an ambassador page for the viewer when they are an ambassador or
// referred a person or deal the viewer can see (so a page never reveals that hidden records exist). The caller
// checks visiblePerson on `alias` itself.
export function hasAmbassadorPage(db: Sql, viewer: Viewer, alias = "p") {
  const a = db(alias);
  return db`(${a}.is_ambassador
    or exists (select 1 from persons rr where rr.referred_by_id = ${a}.id and ${visiblePerson(db, viewer, "rr")})
    or exists (select 1 from deals rd where rd.referred_by_id = ${a}.id and ${visibleDeal(db, viewer, "rd")}))`;
}
