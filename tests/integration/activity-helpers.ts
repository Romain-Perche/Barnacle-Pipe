// SF-109: the activity form as ActivityBox posts it, a direct insert for setting up a test without the code under
// test, and a row reader.
import type { ActivityForm } from "@/server/activities/rules";
import { sql } from "@/server/db";

export function activityForm(over: Partial<ActivityForm> = {}): ActivityForm {
  return {
    type: "call", subject: "Call Ada about the proposal", dueOn: "2026-11-25", dueTime: "", duration: "", assigneeId: "", note: "",
    dealId: "", personId: "", organisationId: "", ...over,
  };
}

export async function makeActivity(a: {
  by: number; assignee?: number; type?: "call" | "meeting" | "task"; subject?: string; dueOn?: string; dueTime?: string | null;
  durationMinutes?: number | null; dealId?: number | null; personId?: number | null; organisationId?: number | null;
  doneAt?: Date | null; doneBy?: number | null; note?: string | null; assignedBy?: number;
}): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into activities (type, subject, due_on, due_time, duration_minutes, note, deal_id, person_id, organisation_id, assignee_id,
                            done_at, done_by, created_by, assigned_by)
    values (${a.type ?? "call"}, ${a.subject ?? "Fake call"}, ${a.dueOn ?? "2026-11-25"}, ${a.dueTime ?? null}, ${a.durationMinutes ?? null},
            ${a.note ?? null}, ${a.dealId ?? null}, ${a.personId ?? null}, ${a.organisationId ?? null}, ${a.assignee ?? a.by},
            ${a.doneAt ?? null}, ${a.doneAt ? (a.doneBy ?? a.by) : null}, ${a.by}, ${a.assignedBy ?? a.by})
    returning id::int as id`;
  return row.id;
}

export async function activityRow(id: number) {
  const [row] = await sql<
    { type: string; subject: string; due_on: string; due_time: string | null; duration_minutes: number | null; note: string | null;
      deal_id: number | null; person_id: number | null; organisation_id: number | null; assignee_id: number; done_at: Date | null;
      done_by: number | null; created_by: number; version: number; assigned_by: number; assigned_at: Date; assignment_read_at: Date | null }[]
  >`
    select type, subject, to_char(due_on, 'YYYY-MM-DD') as due_on, to_char(due_time, 'HH24:MI') as due_time, duration_minutes, note,
           deal_id::int as deal_id, person_id::int as person_id, organisation_id::int as organisation_id, assignee_id::int as assignee_id,
           done_at, done_by::int as done_by, created_by::int as created_by, version, assigned_by::int as assigned_by, assigned_at,
           assignment_read_at
    from activities where id = ${id}`;
  return row;
}

export async function activityCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from activities`;
  return row.n;
}

export function okId(result: { status: string; id?: number }): number {
  if (result.status !== "ok" || result.id === undefined) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.id;
}
