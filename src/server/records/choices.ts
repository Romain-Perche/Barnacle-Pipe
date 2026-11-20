// Lead sources, labels and deal labels (SF-95), kept by admins (research.md §11). Remove = hide from new choices; the
// people and deals that have it keep it.
// Every change re-checks, in its transaction, that the actor is an active admin.
import { sql, type Sql } from "@/server/db";
import { isActiveAdmin, isUniqueViolation, type Option } from "@/server/records/common";
import { validateChoiceName } from "@/server/records/rules";

export type ChoiceKind = "lead_source" | "label" | "deal_label";
export type ChoiceResult =
  | { ok: true }
  | { ok: false; code: "forbidden" | "choice_exists" | "deal_label_exists" | "choice_removed_exists" | "choice_name_required" | "not_found" };

const TABLES: Record<ChoiceKind, string> = { lead_source: "lead_sources", label: "labels", deal_label: "deal_labels" };
const KEYS: Record<ChoiceKind, string> = { lead_source: "lead_sources_name_key", label: "labels_name_key", deal_label: "deal_labels_name_key" };
// Deal labels answer "This name is already used." (SF-95 spec US5 scenario 4); the others keep their message.
const EXISTS = (kind: ChoiceKind) => (kind === "deal_label" ? ("deal_label_exists" as const) : ("choice_exists" as const));

class Stop extends Error {
  constructor(readonly result: ChoiceResult) {
    super("stop");
  }
}

// Lead sources in the order they were added (the six starting ones first); labels A–Z.
export async function listChoices(kind: ChoiceKind): Promise<Option[]> {
  const order = kind === "lead_source" ? sql`id` : sql`lower(name), id`;
  return [...(await sql<Option[]>`
    select id::int as id, name from ${sql(TABLES[kind])} where removed_at is null order by ${order}`)];
}

async function asAdmin(actorId: number, kind: ChoiceKind, change: (db: Sql, table: string) => Promise<ChoiceResult>): Promise<ChoiceResult> {
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      if (!(await isActiveAdmin(db, actorId))) return { ok: false as const, code: "forbidden" as const };
      const result = await change(db, TABLES[kind]);
      if (!result.ok) throw new Stop(result);
      return result;
    });
  } catch (err) {
    if (err instanceof Stop) return err.result;
    if (isUniqueViolation(err, KEYS[kind])) return { ok: false, code: EXISTS(kind) };
    throw err;
  }
}

// A name matching a removed entry brings that entry back (spec Clarifications).
export function addChoice(actorId: number, kind: ChoiceKind, raw: string): Promise<ChoiceResult> {
  const v = validateChoiceName(raw);
  if (!v.ok) return Promise.resolve({ ok: false, code: v.code });
  return asAdmin(actorId, kind, async (db, table) => {
    const [same] = await db<{ id: number; removed: boolean }[]>`
      select id::int as id, removed_at is not null as removed from ${db(table)} where lower(name) = lower(${v.name}) for update`;
    if (same && !same.removed) return { ok: false, code: EXISTS(kind) };
    if (same) await db`update ${db(table)} set removed_at = null where id = ${same.id}`;
    else await db`insert into ${db(table)} (name) values (${v.name})`;
    return { ok: true };
  });
}

export function renameChoice(actorId: number, kind: ChoiceKind, id: number, raw: string): Promise<ChoiceResult> {
  const v = validateChoiceName(raw);
  if (!v.ok) return Promise.resolve({ ok: false, code: v.code });
  return asAdmin(actorId, kind, async (db, table) => {
    const [other] = await db<{ removed: boolean }[]>`
      select removed_at is not null as removed from ${db(table)} where lower(name) = lower(${v.name}) and id <> ${id}`;
    // A removed entry keeps its name: adding that name again brings it back (clarification Q4).
    if (other) return { ok: false, code: other.removed ? "choice_removed_exists" : EXISTS(kind) };
    const rows = await db`update ${db(table)} set name = ${v.name} where id = ${id} returning id`;
    return rows.length === 1 ? { ok: true } : { ok: false, code: "not_found" };
  });
}

export function removeChoice(actorId: number, kind: ChoiceKind, id: number): Promise<ChoiceResult> {
  return asAdmin(actorId, kind, async (db, table) => {
    const rows = await db`update ${db(table)} set removed_at = coalesce(removed_at, now()) where id = ${id} returning id`;
    return rows.length === 1 ? { ok: true } : { ok: false, code: "not_found" };
  });
}
