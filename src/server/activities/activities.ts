// Activities: calls, meetings and tasks (SF-109 data-model.md § State changes, research.md §5–§8). Every read goes
// through visibleActivity() (visibility.ts), so an activity linked to a record hidden from the viewer does not exist for
// them. Each change is one transaction: the activity row is locked `for update` through the same rule, then its linked
// rows and the newly picked ones (through visiblePerson / visibleDeal); any archived one refuses the change.
// Anyone who can see an activity can change it. A done call or meeting raises its person's "Last contacted".
// SF-124: edits, ticks and unticks set updated_at (the later change wins against Google Calendar).
import { sql, type Sql } from "@/server/db";
import { ukInstant, validateActivity, type ActivityForm, type ActivityType, type ActivityValue } from "@/server/activities/rules";
import { ownerName, type Fragment, type Option, type UserRef } from "@/server/records/common";
import type { FieldErrors } from "@/server/records/rules";
import type { Target } from "@/server/records/timeline";
import { visibleActivity, visibleDeal, visiblePerson, type Viewer } from "@/server/records/visibility";

export type ActivityTarget = Target;
export type Links = { dealId: number | null; personId: number | null; organisationId: number | null };
export type LinkRef = { id: number; name: string; archived: boolean };

export type ActivityView = {
  id: number;
  type: ActivityType;
  subject: string;
  dueOn: string;
  dueTime: string | null;
  durationMinutes: number | null;
  note: string | null;
  doneAt: Date | null;
  doneBy: UserRef | null;
  assignee: UserRef;
  deal: LinkRef | null;
  person: LinkRef | null;
  organisation: LinkRef | null;
  // A linked record is archived: shown, but nothing can be changed (FR-013).
  archived: boolean;
  version: number;
};

export type SaveResult =
  | { status: "ok"; id: number }
  | { status: "invalid"; errors: FieldErrors }
  | { status: "assignee_cannot_see"; name: string }
  | { status: "archived" }
  | { status: "link_not_found" }
  | { status: "not_found" }
  | { status: "gone" }
  | { status: "conflict" };
export type TickResult = { status: "ok" | "archived" | "not_found" };
export type DeleteResult = { status: "ok" | "archived" | "not_found" | "gone" | "conflict" };

type Row = {
  id: number; type: ActivityType; subject: string; due_on: string; due_time: string | null; duration_minutes: number | null;
  note: string | null; done_at: Date | null; done_by_id: number | null; done_by_name: string | null; done_by_active: boolean | null;
  assignee_id: number; assignee_name: string; assignee_active: boolean; deal_id: number | null; deal_title: string | null;
  deal_archived: boolean | null; person_id: number | null; person_name: string | null; person_archived: boolean | null;
  org_id: number | null; org_name: string | null; org_archived: boolean | null; version: number;
};

// The columns of ActivityView; needs `a` (activities). Shared with list.ts.
export const ACTIVITY_COLUMNS = (db: Sql) => db`
  a.id::int as id, a.type, a.subject, to_char(a.due_on, 'YYYY-MM-DD') as due_on, to_char(a.due_time, 'HH24:MI') as due_time,
  a.duration_minutes, a.note, a.done_at, du.id::int as done_by_id, du.name as done_by_name, du.status = 'active' as done_by_active,
  au.id::int as assignee_id, au.name as assignee_name, au.status = 'active' as assignee_active,
  ad.id::int as deal_id, ad.title as deal_title, ad.archived_at is not null as deal_archived,
  ap.id::int as person_id, btrim(ap.first_name || ' ' || ap.last_name) as person_name, ap.archived_at is not null as person_archived,
  ao.id::int as org_id, ao.name as org_name, ao.archived_at is not null as org_archived, a.version`;

export const ACTIVITY_FROM = (db: Sql) => db`
  activities a
  join users au on au.id = a.assignee_id
  left join users du on du.id = a.done_by
  left join deals ad on ad.id = a.deal_id
  left join persons ap on ap.id = a.person_id
  left join organisations ao on ao.id = a.organisation_id`;

export function toView(r: Row): ActivityView {
  const deal = r.deal_id === null ? null : { id: r.deal_id, name: r.deal_title ?? "", archived: r.deal_archived === true };
  const person = r.person_id === null ? null : { id: r.person_id, name: r.person_name ?? "", archived: r.person_archived === true };
  const organisation = r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "", archived: r.org_archived === true };
  return {
    id: r.id,
    type: r.type,
    subject: r.subject,
    dueOn: r.due_on,
    dueTime: r.due_time,
    durationMinutes: r.duration_minutes,
    note: r.note,
    doneAt: r.done_at,
    doneBy: r.done_by_id === null ? null : { id: r.done_by_id, name: r.done_by_name ?? "", active: r.done_by_active ?? true },
    assignee: { id: r.assignee_id, name: r.assignee_name, active: r.assignee_active },
    deal,
    person,
    organisation,
    archived: [deal, person, organisation].some((l) => l?.archived === true),
    version: r.version,
  };
}

// The activities linked to a record: its own column.
function linkedTo(db: Sql, target: ActivityTarget) {
  if ("dealId" in target) return db`a.deal_id = ${target.dealId}`;
  if ("personId" in target) return db`a.person_id = ${target.personId}`;
  return db`a.organisation_id = ${target.organisationId}`;
}

async function readViews(db: Sql, viewerId: number, where: Fragment, order: Fragment = db`a.due_on, a.due_time nulls last, a.id`) {
  const rows = await db<Row[]>`
    select ${ACTIVITY_COLUMNS(db)} from ${ACTIVITY_FROM(db)}
    where ${visibleActivity(db, viewerId)} and ${where}
    order by ${order}`;
  return rows.map(toView);
}

export async function getActivity(viewerId: number, id: number): Promise<ActivityView | null> {
  const [view] = await readViews(sql, viewerId, sql`a.id = ${id}`);
  return view ?? null;
}

// "// NEXT ACTIVITIES" of a record (FR-003): its planned activities, earliest first.
export async function nextActivities(viewerId: number, target: ActivityTarget): Promise<ActivityView[]> {
  return readViews(sql, viewerId, sql`a.done_at is null and ${linkedTo(sql, target)}`);
}

// The activity named by `activity`, `followup` or `delete-activity` in a page address: only one the viewer can see and,
// on a record page, linked to that record (target null: the Activities list). Anything else is ignored (null).
export async function pageActivity(viewerId: number, raw: string | number | null | undefined, target: ActivityTarget | null): Promise<ActivityView | null> {
  const id = typeof raw === "number" ? raw : /^[1-9][0-9]{0,15}$/.test(raw ?? "") ? Number(raw) : null;
  if (id === null || !Number.isSafeInteger(id)) return null;
  const [view] = await readViews(sql, viewerId, target === null ? sql`a.id = ${id}` : sql`a.id = ${id} and ${linkedTo(sql, target)}`);
  return view ?? null;
}

// US1 scenarios 2–3: a deal gives itself, its main person (when visible) and its organisation; a person themselves and
// their organisation; an organisation itself; the Activities list nothing. Archived links are left out.
export async function prefillLinks(viewerId: number, target: ActivityTarget | null): Promise<Links> {
  const none: Links = { dealId: null, personId: null, organisationId: null };
  if (target === null) return none;
  if ("dealId" in target) {
    const [r] = await sql<{ person_id: number | null; org_id: number | null }[]>`
      select p.id::int as person_id, o.id::int as org_id from deals d
      left join persons p on p.id = d.person_id and p.archived_at is null and ${visiblePerson(sql, viewerId)}
      left join organisations o on o.id = d.organisation_id and o.archived_at is null
      where d.id = ${target.dealId} and ${visibleDeal(sql, viewerId)}`;
    return r ? { dealId: target.dealId, personId: r.person_id, organisationId: r.org_id } : none;
  }
  if ("personId" in target) {
    const [r] = await sql<{ org_id: number | null }[]>`
      select o.id::int as org_id from persons p left join organisations o on o.id = p.organisation_id and o.archived_at is null
      where p.id = ${target.personId} and ${visiblePerson(sql, viewerId)}`;
    return r ? { dealId: null, personId: target.personId, organisationId: r.org_id } : none;
  }
  return { ...none, organisationId: target.organisationId };
}

// "Schedule a follow-up?" (FR-005): the ticked activity's links, assignee and type; no subject, no date.
export function followupPrefill(a: ActivityView): ActivityForm {
  return {
    type: a.type, subject: "", dueOn: "", dueTime: "", duration: "", assigneeId: String(a.assignee.id), note: "",
    dealId: a.deal ? String(a.deal.id) : "", personId: a.person ? String(a.person.id) : "", organisationId: a.organisation ? String(a.organisation.id) : "",
  };
}

export function activityToForm(a: ActivityView): ActivityForm {
  return {
    ...followupPrefill(a),
    subject: a.subject, dueOn: a.dueOn, dueTime: a.dueTime ?? "", duration: a.durationMinutes === null ? "" : String(a.durationMinutes), note: a.note ?? "",
  };
}

// Whether `viewer` (an id or sql`u.id`) can see every record of `links`.
function seesLinks(db: Sql, viewer: Viewer, links: Links) {
  return db`(${links.personId}::bigint is null or exists (select 1 from persons p where p.id = ${links.personId} and ${visiblePerson(db, viewer)}))
    and (${links.dealId}::bigint is null or exists (select 1 from deals d where d.id = ${links.dealId} and ${visibleDeal(db, viewer)}))`;
}

export type FormChoices = { assignees: Option[]; deals: LinkRef[]; people: LinkRef[]; organisations: LinkRef[] };

// What the activity box offers (research.md §5): active users who can see the links (plus the current assignee),
// open non-archived visible deals, visible non-archived people, non-archived organisations — plus what is already linked.
export async function activityFormChoices(viewerId: number, links: Links, current: number | null = null): Promise<FormChoices> {
  const [assignees, deals, people, organisations] = await Promise.all([
    sql<{ id: number; name: string; active: boolean }[]>`
      select u.id::int as id, u.name, u.status = 'active' as active from users u
      where (u.status = 'active' and ${seesLinks(sql, sql`u.id`, links)}) or u.id = ${current ?? 0}
      order by lower(u.name), u.id`,
    sql<LinkRef[]>`
      select d.id::int as id, d.title as name, d.archived_at is not null as archived from deals d
      where ((d.status = 'open' and d.archived_at is null) or d.id = ${links.dealId ?? 0}) and ${visibleDeal(sql, viewerId)}
      order by lower(d.title), d.id`,
    sql<LinkRef[]>`
      select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name, p.archived_at is not null as archived from persons p
      where (p.archived_at is null or p.id = ${links.personId ?? 0}) and ${visiblePerson(sql, viewerId)}
      order by lower(btrim(p.first_name || ' ' || p.last_name)), p.id`,
    sql<LinkRef[]>`
      select o.id::int as id, o.name, o.archived_at is not null as archived from organisations o
      where o.archived_at is null or o.id = ${links.organisationId ?? 0}
      order by lower(o.name), o.id`,
  ]);
  return { assignees: assignees.map((u) => ({ id: u.id, name: ownerName(u) })), deals: [...deals], people: [...people], organisations: [...organisations] };
}

// --- Changes ---------------------------------------------------------------------------------------------------

class Stop extends Error {
  constructor(readonly result: SaveResult) {
    super(result.status);
  }
}

type LinkState = { status: "ok" } | { status: "archived" } | { status: "link_not_found" };

// Locks the linked rows the actor can see. `fresh`: a newly picked record (must exist, be visible and, for a deal, be
// open); a current link is only checked for being archived (a won or lost deal already linked stays).
async function lockLinks(db: Sql, actorId: number, links: Links, fresh: { deal: boolean; person: boolean; organisation: boolean }): Promise<LinkState> {
  let archived = false;
  if (links.dealId !== null) {
    const [d] = await db<{ archived: boolean; open: boolean }[]>`
      select d.archived_at is not null as archived, d.status = 'open' as open from deals d
      where d.id = ${links.dealId} and ${visibleDeal(db, actorId)} for update`;
    if (!d || (fresh.deal && !d.open && !d.archived)) return { status: "link_not_found" };
    archived ||= d.archived;
  }
  if (links.personId !== null) {
    const [p] = await db<{ archived: boolean }[]>`
      select p.archived_at is not null as archived from persons p where p.id = ${links.personId} and ${visiblePerson(db, actorId)} for update`;
    if (!p) return { status: "link_not_found" };
    archived ||= p.archived;
  }
  if (links.organisationId !== null) {
    const [o] = await db<{ archived: boolean }[]>`
      select o.archived_at is not null as archived from organisations o where o.id = ${links.organisationId} for update`;
    if (!o) return { status: "link_not_found" };
    archived ||= o.archived;
  }
  return archived ? { status: "archived" } : { status: "ok" };
}

// The assignee: an active user (unless unchanged) who can see every linked record.
async function checkAssignee(db: Sql, assigneeId: number, links: Links, mustBeActive: boolean): Promise<void> {
  const [u] = await db<{ name: string; active: boolean; sees: boolean }[]>`
    select u.name, u.status = 'active' as active, ${seesLinks(db, sql`u.id`, links)} as sees from users u where u.id = ${assigneeId}`;
  if (!u || (mustBeActive && !u.active)) throw new Stop({ status: "invalid", errors: { assigneeId: { code: "activity_assignee_invalid" } } });
  if (!u.sees) throw new Stop({ status: "assignee_cannot_see", name: u.name });
}

const linksOf = (v: ActivityValue): Links => ({ dealId: v.dealId, personId: v.personId, organisationId: v.organisationId });

async function run(change: (db: Sql) => Promise<SaveResult>): Promise<SaveResult> {
  try {
    return await sql.begin((tx) => change(tx as unknown as Sql));
  } catch (err) {
    if (err instanceof Stop) return err.result;
    throw err;
  }
}

export async function scheduleActivity(actorId: number, form: ActivityForm): Promise<SaveResult> {
  const v = validateActivity(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  return run(async (db) => {
    const links = linksOf(value);
    const state = await lockLinks(db, actorId, links, { deal: true, person: true, organisation: true });
    if (state.status !== "ok") return state;
    const assignee = value.assigneeId ?? actorId;
    await checkAssignee(db, assignee, links, true);
    const [row] = await db<{ id: number }[]>`
      insert into activities (type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id,
                              assignee_id, created_by, assigned_by)
      values (${value.type}, ${value.subject}, ${value.dueOn}, ${value.dueTime}, ${value.durationMinutes}, ${value.note},
              ${value.dealId}, ${value.personId}, ${value.organisationId}, ${assignee}, ${actorId}, ${actorId})
      returning id::int as id`;
    return { status: "ok", id: row.id };
  });
}

type Locked = { deal_id: number | null; person_id: number | null; organisation_id: number | null; assignee_id: number; version: number };

// The activity, locked, when the actor can see it; else whether it still exists (not_found) or not (gone).
async function lockActivity(db: Sql, actorId: number, id: number): Promise<Locked | "not_found" | "gone"> {
  const [row] = await db<Locked[]>`
    select a.deal_id::int as deal_id, a.person_id::int as person_id, a.organisation_id::int as organisation_id,
           a.assignee_id::int as assignee_id, a.version
    from activities a where a.id = ${id} and ${visibleActivity(db, actorId)} for update`;
  if (row) return row;
  const [other] = await db`select 1 from activities where id = ${id}`;
  return other ? "not_found" : "gone";
}

const currentLinks = (a: Locked): Links => ({ dealId: a.deal_id, personId: a.person_id, organisationId: a.organisation_id });
const NONE_FRESH = { deal: false, person: false, organisation: false };

export async function editActivity(actorId: number, id: number, version: number, form: ActivityForm): Promise<SaveResult> {
  const v = validateActivity(form);
  return run(async (db) => {
    const cur = await lockActivity(db, actorId, id);
    if (cur === "gone") return { status: "gone" };
    if (cur === "not_found") return { status: "not_found" };
    if (cur.version !== version) return { status: "conflict" };
    const before = await lockLinks(db, actorId, currentLinks(cur), NONE_FRESH);
    if (before.status !== "ok") return before;
    if (!v.ok) return { status: "invalid", errors: v.errors };
    const value = v.value;
    const links = linksOf(value);
    const fresh = { deal: links.dealId !== cur.deal_id, person: links.personId !== cur.person_id, organisation: links.organisationId !== cur.organisation_id };
    const state = await lockLinks(db, actorId, links, fresh);
    if (state.status !== "ok") return state;
    const assignee = value.assigneeId ?? cur.assignee_id;
    const reassigned = assignee !== cur.assignee_id;
    if (reassigned || fresh.deal || fresh.person) await checkAssignee(db, assignee, links, reassigned);
    await db`
      update activities set type = ${value.type}, subject = ${value.subject}, due_on = ${value.dueOn}, due_time = ${value.dueTime},
             duration_minutes = ${value.durationMinutes}, note = ${value.note}, deal_id = ${value.dealId}, person_id = ${value.personId},
             organisation_id = ${value.organisationId}, assignee_id = ${assignee}, version = version + 1, updated_at = now()
             ${reassigned ? db`, assigned_by = ${actorId}, assigned_at = now(), assignment_read_at = null` : db``}
      where id = ${id}`;
    return { status: "ok", id };
  });
}

// Its assignment notification goes with the row.
export async function deleteActivity(actorId: number, id: number, version: number): Promise<DeleteResult> {
  return sql.begin(async (tx): Promise<DeleteResult> => {
    const db = tx as unknown as Sql;
    const cur = await lockActivity(db, actorId, id);
    if (cur === "gone" || cur === "not_found") return { status: cur };
    if (cur.version !== version) return { status: "conflict" };
    const links = await lockLinks(db, actorId, currentLinks(cur), NONE_FRESH);
    if (links.status === "archived") return { status: "archived" };
    if (links.status !== "ok") return { status: "not_found" };
    await db`delete from activities where id = ${id}`;
    return { status: "ok" };
  });
}

async function lockForTick(db: Sql, actorId: number, id: number): Promise<TickResult> {
  const cur = await lockActivity(db, actorId, id);
  if (cur === "gone" || cur === "not_found") return { status: "not_found" };
  const links = await lockLinks(db, actorId, currentLinks(cur), NONE_FRESH);
  if (links.status === "archived") return { status: "archived" };
  return links.status === "ok" ? { status: "ok" } : { status: "not_found" };
}

// Marks it done (who and when). Already done: nothing changes, so two ticks at once give one "done", by the first.
// A call or meeting raises its person's "Last contacted" to its due moment, or to now when that is earlier
// (never a future date, never lower than it was); no version bump and no event on the person (research.md §8).
export async function tickActivity(actorId: number, id: number): Promise<TickResult> {
  return sql.begin(async (tx): Promise<TickResult> => {
    const db = tx as unknown as Sql;
    const locked = await lockForTick(db, actorId, id);
    if (locked.status !== "ok") return locked;
    const [done] = await db<{ type: ActivityType; person_id: number | null; due_on: string; due_time: string | null; done_at: Date }[]>`
      update activities set done_at = now(), done_by = ${actorId}, version = version + 1, updated_at = now()
      where id = ${id} and done_at is null
      returning type, person_id::int as person_id, to_char(due_on, 'YYYY-MM-DD') as due_on, to_char(due_time, 'HH24:MI') as due_time, done_at`;
    if (done && done.type !== "task" && done.person_id !== null) {
      const due = ukInstant(done.due_on, done.due_time);
      const at = due.getTime() < done.done_at.getTime() ? due : done.done_at;
      await db`
        update persons set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), ${at}::timestamptz)
        where id = ${done.person_id}`;
    }
    return { status: "ok" };
  });
}

// Planned again, with its due date; "Last contacted" is left as it is.
export async function untickActivity(actorId: number, id: number): Promise<TickResult> {
  return sql.begin(async (tx): Promise<TickResult> => {
    const db = tx as unknown as Sql;
    const locked = await lockForTick(db, actorId, id);
    if (locked.status !== "ok") return locked;
    await db`update activities set done_at = null, done_by = null, version = version + 1, updated_at = now() where id = ${id} and done_at is not null`;
    return { status: "ok" };
  });
}
