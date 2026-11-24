// SF-115: custom fields and values by direct inserts (setup without the code under test).
import { sql } from "@/server/db";
import type { CustomType, RecordKind } from "@/server/custom-fields/rules";

export async function makeField(f: { kind: RecordKind; name: string; type: CustomType; inList?: boolean; choices?: string[]; removed?: string[] }) {
  const [row] = await sql<{ id: number }[]>`
    insert into custom_fields (kind, name, type, position, in_list)
    values (${f.kind}, ${f.name}, ${f.type}, (select coalesce(max(position), 0) + 1 from custom_fields where kind = ${f.kind}), ${f.inList ?? false})
    returning id::int as id`;
  const choices: Record<string, number> = {};
  for (const [i, name] of (f.choices ?? []).entries()) {
    const [c] = await sql<{ id: number }[]>`
      insert into custom_field_choices (field_id, name, position, removed_at)
      values (${row.id}, ${name}, ${i + 1}, ${(f.removed ?? []).includes(name) ? new Date() : null}) returning id::int as id`;
    choices[name] = c.id;
  }
  return { id: row.id, choices };
}

type Target = { personId: number } | { organisationId: number } | { dealId: number };
type Column = "text_value" | "number_value" | "money_pence" | "date_value" | "choice_id" | "choice_ids" | "bool_value";

export async function setValue(fieldId: number, target: Target, column: Column, value: unknown) {
  const p = "personId" in target ? target.personId : null;
  const o = "organisationId" in target ? target.organisationId : null;
  const d = "dealId" in target ? target.dealId : null;
  await sql`insert into custom_values ${sql({ field_id: fieldId, person_id: p, organisation_id: o, deal_id: d, [column]: value } as Record<string, unknown>)}`;
}

export async function valueRows(fieldId?: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from custom_values ${fieldId === undefined ? sql`` : sql`where field_id = ${fieldId}`}`;
  return row.n;
}

export async function customEvents(target: Target) {
  const where = "personId" in target ? sql`person_id = ${target.personId}` : "organisationId" in target ? sql`organisation_id = ${target.organisationId}` : sql`deal_id = ${target.dealId}`;
  return [...(await sql<{ kind: string; field_name: string; old_value: string | null; new_value: string | null; actor_id: number | null }[]>`
    select kind, field_name, old_value, new_value, actor_id::int as actor_id from timeline_events
    where ${where} and kind like 'custom_%' order by id`)];
}
