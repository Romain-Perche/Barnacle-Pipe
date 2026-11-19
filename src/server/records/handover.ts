// Handing a deactivated user's private people to an active user (SF-92 data-model.md § Handover, FR-009–FR-013).
// The admin only ever learns how many people there are and who receives them: nothing here returns a
// person's id or name.
import { sql, type Sql } from "@/server/db";
import { recordEvent } from "@/server/records/timeline";

export type HandOverResult =
  | { status: "handed"; count: number; toName: string }
  | { status: "none"; fromName: string }
  | { status: "forbidden" }
  | { status: "not_deactivated" }
  | { status: "choose_user" };

// All or nothing, in one transaction; every rule is re-checked on the locked user rows.
export async function handOverPrivatePeople(actorId: number, fromUserId: number, toUserId: number): Promise<HandOverResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const users = await db<{ id: number; role: string; status: string; name: string }[]>`
      select id::int as id, role, status, name from users where id in ${db([actorId, fromUserId, toUserId])} order by id for update`;
    const actor = users.find((u) => u.id === actorId);
    const from = users.find((u) => u.id === fromUserId);
    const to = users.find((u) => u.id === toUserId);
    if (!actor || actor.role !== "admin" || actor.status !== "active") return { status: "forbidden" as const };
    if (!from || from.status !== "deactivated") return { status: "not_deactivated" as const };
    if (!to || to.status !== "active" || to.id === from.id) return { status: "choose_user" as const };
    const moved = await db<{ id: number }[]>`
      update persons set owner_id = ${to.id}, version = version + 1 where private and owner_id = ${from.id} returning id::int as id`;
    if (moved.length === 0) return { status: "none" as const, fromName: from.name };
    for (const { id } of moved) await recordEvent(db, { personId: id, kind: "handed_over", actorId, relatedUserId: to.id });
    return { status: "handed" as const, count: moved.length, toName: to.name };
  });
}
