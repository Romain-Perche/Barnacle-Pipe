// The Activities list (SF-109 research.md §10, contracts/routes.md § /activities): the viewer's planned activities by
// default; quick filters Overdue / Today / This week (UK Monday–Sunday) / Planned / Done, an assignee and a type.
// Overdue first, then by due date and time (untimed after timed); Done newest first. Only activities the viewer can see
// are listed or counted (visibleActivity). `now` is a parameter so tests fix the clock; "today" is the UK day of `now`.
import { ACTIVITY_COLUMNS, ACTIVITY_FROM, toView, type ActivityView } from "@/server/activities/activities";
import { activityState, type ActivityState } from "@/server/activities/rules";
import { sql } from "@/server/db";
import { ownerName, type Option } from "@/server/records/common";
import { PAGE_SIZE, type ActivitiesQuery } from "@/server/records/list-query";
import { visibleActivity } from "@/server/records/visibility";

export type ActivityListRow = ActivityView & { state: ActivityState };
export type ActivityList = { rows: ActivityListRow[]; count: number; page: number; pages: number };

export async function listActivities(viewerId: number, query: ActivitiesQuery, now: Date = new Date()): Promise<ActivityList> {
  const today = sql`(${now}::timestamptz at time zone 'Europe/London')::date`;
  // FR-009, the same rule as activityState(): before today, or today with a time (plus duration) already passed.
  const overdue = sql`(a.done_at is null and (a.due_on < ${today} or (a.due_on = ${today} and a.due_time is not null
    and ((a.due_on + a.due_time) at time zone 'Europe/London') + make_interval(mins => coalesce(a.duration_minutes, 0)) <= ${now}::timestamptz)))`;
  const when = {
    overdue,
    today: sql`a.done_at is null and a.due_on = ${today}`,
    week: sql`a.done_at is null and a.due_on between date_trunc('week', ${today})::date and date_trunc('week', ${today})::date + 6`,
    planned: sql`a.done_at is null`,
    done: sql`a.done_at is not null`,
  }[query.when];
  const assignee = query.assignee === "all" ? sql`` : sql`and a.assignee_id = ${query.assignee ?? viewerId}`;
  const type = query.type === null ? sql`` : sql`and a.type = ${query.type}`;
  const where = sql`${when} ${assignee} ${type} and ${visibleActivity(sql, viewerId)}`;
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from activities a where ${where}`;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const order = query.when === "done" ? sql`a.done_at desc, a.id desc` : sql`${overdue} desc, a.due_on, a.due_time nulls last, a.id`;
  const rows = await sql`
    select ${ACTIVITY_COLUMNS(sql)} from ${ACTIVITY_FROM(sql)}
    where ${where}
    order by ${order}
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  return {
    rows: rows.map((r) => {
      const view = toView(r as Parameters<typeof toView>[0]);
      return { ...view, state: activityState({ ...view, done: view.doneAt !== null }, now) };
    }),
    count,
    page,
    pages,
  };
}

// The Assignee filter: every user A–Z, active or deactivated (marked).
export async function activityFilterOptions(): Promise<Option[]> {
  const rows = await sql<{ id: number; name: string; active: boolean }[]>`
    select id::int as id, name, status = 'active' as active from users order by lower(name), id`;
  return rows.map((u) => ({ id: u.id, name: ownerName(u) }));
}
