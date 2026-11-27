// The one visibility rule for people (SF-92 data-model.md): a private person is seen only by their creator and
// their current owner, admins included. Every query that reads `persons` uses this fragment.
// `viewer` is a user id, or (SF-102 research.md §5) a SQL fragment such as sql`u.id` to ask which users can see a record.
// SF-109: `visibleActivity()` below it: every `activities` read uses it.
// SF-116: `visibleFile()`: every `files` read uses it.
// SF-127: `visibleConversation()` at the end: every read of the email tables for a viewer uses it.
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

// SF-109 (research.md §5): an activity is seen by those who can see every record it is linked to (its person through
// visiblePerson, its deal through visibleDeal; organisations are never private). Every query that reads `activities`
// for a viewer uses this fragment, so a hidden activity does not exist for them: pages, lists, counts, cards,
// timelines, notifications and actions. `viewer` may be sql`u.id` to ask which users may be its assignee.
export function visibleActivity(db: Sql, viewer: Viewer, alias = "a") {
  const a = db(alias);
  return db`((${a}.person_id is null or exists (select 1 from persons vp where vp.id = ${a}.person_id and ${visiblePerson(db, viewer, "vp")}))
    and (${a}.deal_id is null or exists (select 1 from deals vd where vd.id = ${a}.deal_id and ${visibleDeal(db, viewer, "vd")})))`;
}

// SF-116 (research.md §6): a file is seen by those who can see its record (its deal through visibleDeal, its person
// through visiblePerson; organisations are never private). Every query that reads `files` for a viewer uses this
// fragment, so a hidden file does not exist for them: lists, counts, boxes, timelines, routes and actions.
export function visibleFile(db: Sql, viewer: Viewer, alias = "f") {
  const f = db(alias);
  return db`((${f}.deal_id is null or exists (select 1 from deals vfd where vfd.id = ${f}.deal_id and ${visibleDeal(db, viewer, "vfd")}))
    and (${f}.person_id is null or exists (select 1 from persons vfp where vfp.id = ${f}.person_id and ${visiblePerson(db, viewer, "vfp")})))`;
}

// SF-127 (research.md §6): a copied email conversation is seen by those who can see every person in its emails (any
// From / To / Cc / Bcc address of email_conversation_addresses that belongs to a person) and every person and deal it
// is linked to (links not removed); organisations are never private. Every read of email_conversations,
// email_threads, email_messages, email_attachments and email_links for a viewer uses this fragment on the
// conversation row `alias`, so a hidden conversation does not exist for them: timelines, the conversation page,
// attachment downloads and link actions all answer as for a missing one.
export function visibleConversation(db: Sql, viewer: Viewer, alias = "c") {
  const c = db(alias);
  return db`(not exists (select 1 from email_conversation_addresses vca
                         join person_emails vpe on vpe.email = vca.email
                         join persons vcp on vcp.id = vpe.person_id
                         where vca.conversation_id = ${c}.id and not ${visiblePerson(db, viewer, "vcp")})
    and not exists (select 1 from email_links vl join persons vlp on vlp.id = vl.person_id
                    where vl.conversation_id = ${c}.id and not vl.removed and not ${visiblePerson(db, viewer, "vlp")})
    and not exists (select 1 from email_links vl join deals vld on vld.id = vl.deal_id
                    where vl.conversation_id = ${c}.id and not vl.removed and not ${visibleDeal(db, viewer, "vld")}))`;
}
