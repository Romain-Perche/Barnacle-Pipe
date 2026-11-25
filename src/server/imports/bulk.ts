// Bulk inserts shared by the CSV import (SF-103) and the Pipedrive import (SF-117): ids taken from the table's sequence
// first, then one insert per chunk of 1,000 rows through `unnest` arrays (one bind parameter per column).
import type { Sql } from "@/server/db";
import type { CustomField, CustomValue } from "@/server/custom-fields/rules";

// Inserts go in chunks of this many rows (one array parameter per column, SF-103 research.md §8).
const CHUNK = 1000;

export async function newIds(db: Sql, table: "persons" | "organisations" | "deals" | "timeline_events" | "activities", n: number): Promise<number[]> {
  if (n === 0) return [];
  const rows = await db<{ id: number }[]>`
    select nextval(pg_get_serial_sequence(${table}, 'id'))::int as id from generate_series(1, ${n})`;
  return rows.map((r) => r.id);
}

export async function inChunks<T>(items: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += CHUNK) await insert(items.slice(i, i + CHUNK));
}

export const col = <T, V>(items: T[], f: (t: T) => V) => items.map(f);


// SF-115: the custom values of the imported records, in bulk (one array per column); multiple choice as text '{1,2}'.
// No timeline entry per value: the record has its "imported" entry (spec Clarifications).
// SF-122: kind "deals" (the Pipedrive import's deals) writes deal_id.
export async function insertCustomValues(db: Sql, kind: "people" | "organisations" | "deals", fields: CustomField[], records: { id: number; custom: { fieldId: number; value: CustomValue }[] }[]) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const rows = records.flatMap((r) => r.custom.filter((c) => byId.has(c.fieldId)).map((c) => ({ id: r.id, field: byId.get(c.fieldId)!, value: c.value })));
  const of = (row: (typeof rows)[number], types: CustomField["type"][]) => (types.includes(row.field.type) ? row.value : null);
  const target = kind === "people" ? db`person_id` : kind === "deals" ? db`deal_id` : db`organisation_id`;
  await inChunks(rows, (c) => db`
    insert into custom_values (field_id, ${target}, text_value, number_value, money_pence, date_value, choice_id, choice_ids, bool_value)
    select field_id, target, text_value, number_value::numeric, money_pence, date_value::date, choice_id, choice_ids::bigint[], bool_value
    from unnest(${col(c, (r) => r.field.id)}::bigint[], ${col(c, (r) => r.id)}::bigint[], ${col(c, (r) => of(r, ["text", "long_text"]) as string | null)}::text[],
                ${col(c, (r) => of(r, ["number"]) as string | null)}::text[], ${col(c, (r) => of(r, ["money"]) as number | null)}::bigint[],
                ${col(c, (r) => of(r, ["date"]) as string | null)}::text[], ${col(c, (r) => of(r, ["single_choice"]) as number | null)}::bigint[],
                ${col(c, (r) => { const v = of(r, ["multiple_choice"]) as number[] | null; return v === null ? null : `{${v.join(",")}}`; })}::text[],
                ${col(c, (r) => of(r, ["yes_no"]) as boolean | null)}::boolean[])
         as t(field_id, target, text_value, number_value, money_pence, date_value, choice_id, choice_ids, bool_value)`);
}

