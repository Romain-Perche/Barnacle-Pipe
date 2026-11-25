// User management (data-model.md, research.md §9). Every change: one transaction that locks the actor
// and the active admins, re-checks the actor is an active admin, applies the change, keeps at least one
// active admin, and writes a user_changes row.
import { isBarnacleEmail, normalizeEmail } from "@/server/auth/rules";
import { revokeAllSessions } from "@/server/auth/session";
import { sql, type Sql } from "@/server/db";
import { afterGmailForgotten, forgetGmailInTx, type Forgotten } from "@/server/gmail/connections";
import { deleteConnection } from "@/server/pipedrive/connection";

export type UserRow = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
  status: "active" | "deactivated";
  last_sign_in_at: Date | null;
  // Private people and private deals (archived included) they own (SF-92 FR-009, SF-97 FR-001); counted for
  // deactivated users only, 0 for active ones.
  private_people: number;
  private_deals: number;
};
export type ChangeCode = "forbidden" | "invalid_domain" | "duplicate" | "last_admin" | "self_deactivate";
export type ChangeResult = { ok: true } | { ok: false; code: ChangeCode };
type Action = "added" | "made_admin" | "admin_removed" | "deactivated" | "reactivated";

class Refused extends Error {
  constructor(readonly code: ChangeCode) {
    super(code);
  }
}

export async function listUsers(): Promise<UserRow[]> {
  return sql<UserRow[]>`
    select id::int as id, email, name, role, status, last_sign_in_at,
           case when status = 'deactivated'
                then (select count(*)::int from persons p where p.private and p.owner_id = users.id) else 0 end as private_people,
           case when status = 'deactivated'
                then (select count(*)::int from deals d where d.private and d.owner_id = users.id) else 0 end as private_deals
    from users
    order by status = 'active' desc, lower(name), email`;
}

async function asAdmin(actorId: number, change: (tx: Sql) => Promise<void>): Promise<ChangeResult> {
  try {
    await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      // Lock the actor and every active admin, in id order, so concurrent changes run one after another.
      const locked = await db<{ id: number; role: string; status: string }[]>`
        select id::int as id, role, status from users
        where id = ${actorId} or (role = 'admin' and status = 'active') order by id for update`;
      const actor = locked.find((u) => u.id === actorId);
      if (!actor || actor.role !== "admin" || actor.status !== "active") throw new Refused("forbidden");
      await change(db);
      const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from users where role = 'admin' and status = 'active'`;
      if (n < 1) throw new Refused("last_admin");
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, code: err.code };
    throw err;
  }
}

async function record(db: Sql, userId: number, actorId: number, action: Action) {
  await db`insert into user_changes (user_id, actor_id, action) values (${userId}, ${actorId}, ${action})`;
}

async function update(db: Sql, userId: number, set: { role?: string; status?: string }) {
  const rows = await db`update users set ${db(set)} where id = ${userId} returning id`;
  if (rows.length === 0) throw new Refused("forbidden");
}

export function addUser(actorId: number, rawEmail: string): Promise<ChangeResult> {
  const email = normalizeEmail(rawEmail);
  if (!isBarnacleEmail(email)) return Promise.resolve({ ok: false, code: "invalid_domain" });
  return asAdmin(actorId, async (db) => {
    const [row] = await db<{ id: number }[]>`
      insert into users (email, name, added_by) values (${email}, ${email.split("@")[0]}, ${actorId})
      on conflict (email) do nothing returning id::int as id`;
    if (!row) throw new Refused("duplicate");
    await record(db, row.id, actorId, "added");
  });
}

export function makeAdmin(actorId: number, userId: number): Promise<ChangeResult> {
  return asAdmin(actorId, async (db) => {
    await update(db, userId, { role: "admin" });
    await record(db, userId, actorId, "made_admin");
  });
}

export function removeAdmin(actorId: number, userId: number): Promise<ChangeResult> {
  return asAdmin(actorId, async (db) => {
    await update(db, userId, { role: "user" });
    await record(db, userId, actorId, "admin_removed");
  });
}

export async function deactivate(actorId: number, userId: number): Promise<ChangeResult> {
  let gmailKey: Forgotten | null = null;
  const result = await asAdmin(actorId, async (db) => {
    if (userId === actorId) throw new Refused("self_deactivate");
    await update(db, userId, { status: "deactivated" });
    await revokeAllSessions(userId, db);
    // SF-117 FR-003: users are never deleted, so their Pipedrive token is (nobody else may use it).
    await deleteConnection(db, userId);
    // SF-118 edge case "Deactivated user": their Gmail key is forgotten as on disconnect; copied emails stay. SF-124: their
    // calendar sync stops too; the events already in their calendar stay.
    gmailKey = await forgetGmailInTx(db, userId);
    await record(db, userId, actorId, "deactivated");
  });
  // After commit, best effort: stop Calendar's and Gmail's notices and cancel the key at Google (never inside the transaction).
  if (result.ok) await afterGmailForgotten(gmailKey);
  return result;
}

export function reactivate(actorId: number, userId: number): Promise<ChangeResult> {
  return asAdmin(actorId, async (db) => {
    await update(db, userId, { status: "active" });
    await record(db, userId, actorId, "reactivated");
  });
}
