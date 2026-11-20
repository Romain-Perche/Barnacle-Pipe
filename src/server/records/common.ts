// Shared by people.ts, organisations.ts and choices.ts.
import type postgres from "postgres";
import type { Sql } from "@/server/db";
import type { FieldErrors } from "@/server/records/rules";

export type Fragment = postgres.PendingQuery<postgres.Row[]>;
// "saved" with visible false: the actor's own change hid the person from them (SF-92 FR-003); `name` comes from the database.
export type SaveResult = { status: "saved"; id: number; visible?: false; name?: string } | { status: "invalid"; errors: FieldErrors } | { status: "not_found" };
export type DeleteResult = { status: "deleted"; name: string } | { status: "forbidden" } | { status: "not_found" };
export type Option = { id: number; name: string };
export type UserRef = { id: number; name: string; active: boolean };

// Thrown inside a transaction to roll it back and answer with a refusal.
export class Refused extends Error {
  constructor(readonly result: { status: "invalid"; errors: FieldErrors } | { status: "not_found" } | { status: "forbidden" }) {
    super(result.status);
  }
}

export function refuse(errors: FieldErrors): never {
  throw new Refused({ status: "invalid", errors });
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" && e.constraint_name === constraint;
}

// The actor is an active admin, read inside the change's transaction (research.md §11, §12).
export async function isActiveAdmin(db: Sql, actorId: number): Promise<boolean> {
  const rows = await db`select 1 from users where id = ${actorId} and role = 'admin' and status = 'active'`;
  return rows.length === 1;
}

// A new owner must be an active user; the current owner is kept even once deactivated. Anything else falls back.
export async function resolveOwner(db: Sql, requested: number | null, fallback: number, current: number | null): Promise<number> {
  if (requested === null) return fallback;
  if (requested === current) return requested;
  const rows = await db`select 1 from users where id = ${requested} and status = 'active'`;
  return rows.length === 1 ? requested : fallback;
}

export function ownerName(u: { name: string; active: boolean }): string {
  return u.active ? u.name : `${u.name} (deactivated)`;
}

// Active users plus the given ones (current owner, owners in use), deactivated ones marked.
export async function ownerOptions(db: Sql, extra: Fragment | null): Promise<Option[]> {
  const rows = await db<{ id: number; name: string; active: boolean }[]>`
    select u.id::int as id, u.name, u.status = 'active' as active from users u
    where u.status = 'active' ${extra ? db`or ${extra}` : db``}
    order by lower(u.name), u.id`;
  return rows.map((r) => ({ id: r.id, name: ownerName(r) }));
}

export function direction(db: Sql, dir: "asc" | "desc") {
  return dir === "desc" ? db`desc` : db`asc`;
}
