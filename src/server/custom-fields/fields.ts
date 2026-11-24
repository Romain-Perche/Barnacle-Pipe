// Custom fields and their choices (SF-115, data-model.md § Admin changes): read for everyone, changed by admins only.
// Every change runs in one transaction that first re-checks that the actor is an active admin (FR-014), then locks the
// kind's fields (or the one field) before counting or renumbering, as pipelines.ts does.
import { sql, type Sql } from "@/server/db";
import {
  MAX_CHOICES, MAX_FIELDS, MAX_IN_LIST, RECORD_KINDS, isChoiceType, validateChoiceName, validateFieldForm, validateFieldName,
  type CustomField, type CustomType, type FieldFormInput, type RecordKind,
} from "@/server/custom-fields/rules";
import { isActiveAdmin, isUniqueViolation } from "@/server/records/common";
import type { FieldErrors } from "@/server/records/rules";

// `errors`: the add / edit box's errors by input (name, type, choices, inList, form); `name`: the name a template needs.
export type FieldResult =
  | { ok: true; id: number; name: string; kind: RecordKind }
  | { ok: false; code: string; name?: string; errors?: FieldErrors };
export type Direction = "up" | "down";

class Stop extends Error {
  constructor(readonly result: FieldResult) {
    super("stop");
  }
}
const fail = (code: string, input?: string, name?: string): never => {
  throw new Stop({ ok: false, code, name, errors: input ? { [input]: name === undefined ? { code } : { code, name } } : undefined });
};

type FieldRow = { id: number; kind: RecordKind; name: string; type: CustomType; position: number; in_list: boolean };
type ChoiceRow = { id: number; field_id: number; name: string; position: number; removed: boolean };

function assemble(fields: FieldRow[], choices: ChoiceRow[]): CustomField[] {
  const byField = new Map<number, CustomField["choices"]>();
  for (const c of choices) {
    if (!byField.has(c.field_id)) byField.set(c.field_id, []);
    byField.get(c.field_id)!.push({ id: c.id, name: c.name, position: c.position, removed: c.removed });
  }
  return fields.map((f) => ({ id: f.id, kind: f.kind, name: f.name, type: f.type, position: f.position, inList: f.in_list, choices: byField.get(f.id) ?? [] }));
}

// The kind's fields in the admin's order, each with its choices in order (removed ones flagged). `lock`: `for share`
// inside a record save or an import, so a field cannot be deleted half way (data-model.md § Record saves).
export async function listFields(kind: RecordKind, db: Sql = sql, lock = false): Promise<CustomField[]> {
  const fields = await db<FieldRow[]>`
    select id::int as id, kind, name, type, position, in_list from custom_fields where kind = ${kind}
    order by position, id ${lock ? db`for share` : db``}`;
  if (fields.length === 0) return [];
  const choices = await db<ChoiceRow[]>`
    select id::int as id, field_id::int as field_id, name, position, removed_at is not null as removed
    from custom_field_choices where field_id in ${db(fields.map((f) => f.id))} order by position, id`;
  return assemble([...fields], [...choices]);
}

// The fields shown as list columns and filters (at most 8).
export async function listShownFields(kind: RecordKind, db: Sql = sql): Promise<CustomField[]> {
  return (await listFields(kind, db)).filter((f) => f.inList);
}

export async function getField(id: number, db: Sql = sql): Promise<CustomField | null> {
  const fields = await db<FieldRow[]>`select id::int as id, kind, name, type, position, in_list from custom_fields where id = ${id}`;
  if (fields.length === 0) return null;
  const choices = await db<ChoiceRow[]>`
    select id::int as id, field_id::int as field_id, name, position, removed_at is not null as removed
    from custom_field_choices where field_id = ${id} order by position, id`;
  return assemble([...fields], [...choices])[0];
}

// The number of fields of each kind (the tabs' numbers).
export async function fieldCounts(): Promise<Record<RecordKind, number>> {
  const rows = await sql<{ kind: RecordKind; n: number }[]>`select kind, count(*)::int as n from custom_fields group by kind`;
  const counts = Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as Record<RecordKind, number>;
  for (const r of rows) counts[r.kind] = r.n;
  return counts;
}

// How many records have a value in the field: every record, private and archived included (FR-004). Only the number
// leaves this function.
export async function countValues(id: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from custom_values where field_id = ${id}`;
  return row.n;
}

async function asAdmin(actorId: number, change: (db: Sql) => Promise<FieldResult>): Promise<FieldResult> {
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      if (!(await isActiveAdmin(db, actorId))) return { ok: false as const, code: "forbidden" };
      return change(db);
    });
  } catch (err) {
    if (err instanceof Stop) return err.result;
    if (isUniqueViolation(err, "custom_fields_name_key")) return { ok: false, code: "custom_field_exists", errors: { name: { code: "custom_field_exists" } } };
    if (isUniqueViolation(err, "custom_field_choices_name_key")) return { ok: false, code: "custom_choice_exists" };
    throw err;
  }
}

// The kind's fields, locked, in order. A transaction-level lock on the kind first, so two adds to a kind with no field
// yet still take turns.
async function lockKind(db: Sql, kind: RecordKind): Promise<{ id: number; key: string; in_list: boolean }[]> {
  await db`select pg_advisory_xact_lock(hashtext(${`custom_fields:${kind}`}))`;
  return [...(await db<{ id: number; key: string; in_list: boolean }[]>`
    select id::int as id, lower(name) as key, in_list from custom_fields where kind = ${kind} order by position, id for update`)];
}

async function renumber(db: Sql, table: "custom_fields" | "custom_field_choices", ids: number[]) {
  for (const [i, id] of ids.entries()) await db`update ${db(table)} set position = ${i + 1} where id = ${id} and position <> ${i + 1}`;
}

async function fieldRow(db: Sql, id: number): Promise<FieldRow> {
  const [row] = await db<FieldRow[]>`select id::int as id, kind, name, type, position, in_list from custom_fields where id = ${id}`;
  return row ?? fail("not_found");
}

const done = (f: { id: number; name: string; kind: RecordKind }): FieldResult => ({ ok: true, id: f.id, name: f.name, kind: f.kind });

export async function addField(actorId: number, kind: RecordKind, form: FieldFormInput): Promise<FieldResult> {
  const v = validateFieldForm(kind, form);
  if (!v.ok) return { ok: false, code: Object.values(v.errors)[0].code, errors: v.errors };
  const { name, type, choices, inList } = v.value;
  return asAdmin(actorId, async (db) => {
    const rows = await lockKind(db, kind);
    if (rows.length >= MAX_FIELDS) fail("custom_fields_limit", "form");
    if (rows.some((r) => r.key === name.toLowerCase())) fail("custom_field_exists", "name", name);
    if (inList && rows.filter((r) => r.in_list).length >= MAX_IN_LIST) fail("custom_list_limit", "inList");
    const [f] = await db<{ id: number }[]>`
      insert into custom_fields (kind, name, type, position, in_list, created_by)
      values (${kind}, ${name}, ${type}, ${rows.length + 1}, ${inList}, ${actorId}) returning id::int as id`;
    for (const [i, choice] of choices.entries()) {
      await db`insert into custom_field_choices (field_id, name, position) values (${f.id}, ${choice}, ${i + 1})`;
    }
    return done({ id: f.id, name, kind });
  });
}

// Name and "Show in list" only: the type never changes (FR-002).
export async function updateField(actorId: number, id: number, form: { name: string; inList: boolean }): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const field = await fieldRow(db, id);
    const v = validateFieldName(field.kind, form.name);
    if (!v.ok) fail(v.error.code, "name", v.error.name);
    const name = (v as { name: string }).name;
    const rows = await lockKind(db, field.kind);
    if (rows.some((r) => r.id !== id && r.key === name.toLowerCase())) fail("custom_field_exists", "name", name);
    if (form.inList && !field.in_list && rows.filter((r) => r.in_list && r.id !== id).length >= MAX_IN_LIST) fail("custom_list_limit", "inList");
    await db`update custom_fields set name = ${name}, in_list = ${form.inList} where id = ${id}`;
    return done({ id, name, kind: field.kind });
  });
}

function swap(ids: number[], i: number, j: number): number[] | null {
  if (i < 0 || j < 0 || j >= ids.length || i >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export async function moveField(actorId: number, id: number, dir: Direction): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const field = await fieldRow(db, id);
    const ids = (await lockKind(db, field.kind)).map((r) => r.id);
    const i = ids.indexOf(id);
    const next = swap(ids, i, dir === "up" ? i - 1 : i + 1);
    if (next) await renumber(db, "custom_fields", next);
    return done(field);
  });
}

// Deletes the field; its choices and values go by cascade. No timeline row: earlier entries keep their text (FR-009).
export async function deleteField(actorId: number, id: number): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const field = await fieldRow(db, id);
    const ids = (await lockKind(db, field.kind)).map((r) => r.id);
    await db`delete from custom_fields where id = ${id}`;
    // Campaign drafts keep the field's last name for its tags (SF-119 FR-009a); not an edit of the draft.
    if (field.kind === "person") {
      await db`
        update campaigns set merge_links = (
          select jsonb_agg(case when e->>'field' = ${String(id)} then e || jsonb_build_object('last', ${field.name}::text) else e end)
          from jsonb_array_elements(merge_links) e)
        where merge_links @> jsonb_build_array(jsonb_build_object('field', ${id}::int))`;
    }
    await renumber(db, "custom_fields", ids.filter((x) => x !== id));
    return done(field);
  });
}

// ---------------------------------------------------------------- choices (as labels, SF-95, within one field)

async function lockChoiceField(db: Sql, fieldId: number): Promise<FieldRow & { choices: ChoiceRow[] }> {
  const [field] = await db<FieldRow[]>`
    select id::int as id, kind, name, type, position, in_list from custom_fields where id = ${fieldId} for update`;
  if (!field || !isChoiceType(field.type)) return fail("not_found");
  const choices = await db<ChoiceRow[]>`
    select id::int as id, field_id::int as field_id, name, position, removed_at is not null as removed
    from custom_field_choices where field_id = ${fieldId} order by position, id for update`;
  return { ...field, choices: [...choices] };
}

async function fieldOfChoice(db: Sql, choiceId: number): Promise<number> {
  const [row] = await db<{ field_id: number }[]>`select field_id::int as field_id from custom_field_choices where id = ${choiceId}`;
  return row?.field_id ?? fail("not_found");
}

const checkedChoice = (raw: string): string => {
  const v = validateChoiceName(raw);
  return v.ok ? v.name : fail(v.code);
};

// A name matching a removed choice brings it back, at the end.
export async function addFieldChoice(actorId: number, fieldId: number, raw: string): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const name = checkedChoice(raw);
    const field = await lockChoiceField(db, fieldId);
    const same = field.choices.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (same && !same.removed) fail("custom_choice_exists", undefined, name);
    const last = field.choices.reduce((n, c) => Math.max(n, c.position), 0) + 1;
    if (same) {
      await db`update custom_field_choices set removed_at = null, position = ${last} where id = ${same.id}`;
    } else {
      if (field.choices.length >= MAX_CHOICES) fail("custom_choices_limit");
      await db`insert into custom_field_choices (field_id, name, position) values (${fieldId}, ${name}, ${last})`;
    }
    return done(field);
  });
}

export async function renameFieldChoice(actorId: number, choiceId: number, raw: string): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const name = checkedChoice(raw);
    const field = await lockChoiceField(db, await fieldOfChoice(db, choiceId));
    const other = field.choices.find((c) => c.id !== choiceId && c.name.toLowerCase() === name.toLowerCase());
    if (other) fail(other.removed ? "custom_choice_removed_exists" : "custom_choice_exists", undefined, name);
    await db`update custom_field_choices set name = ${name} where id = ${choiceId}`;
    return done(field);
  });
}

// Swaps the choice with the next offered one above or below; positions stay 1..n (removed choices keep their place).
export async function moveFieldChoice(actorId: number, choiceId: number, dir: Direction): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const field = await lockChoiceField(db, await fieldOfChoice(db, choiceId));
    const ids = field.choices.map((c) => c.id);
    const offered = field.choices.filter((c) => !c.removed).map((c) => c.id);
    const k = offered.indexOf(choiceId);
    const other = k < 0 ? undefined : offered[dir === "up" ? k - 1 : k + 1];
    const next = other === undefined ? null : swap(ids, ids.indexOf(choiceId), ids.indexOf(other));
    if (next) await renumber(db, "custom_field_choices", next);
    return done(field);
  });
}

// The choice stays on the records that have it; at least one choice stays offered.
export async function removeFieldChoice(actorId: number, choiceId: number): Promise<FieldResult> {
  return asAdmin(actorId, async (db) => {
    const field = await lockChoiceField(db, await fieldOfChoice(db, choiceId));
    const choice = field.choices.find((c) => c.id === choiceId)!;
    if (!choice.removed) {
      if (field.choices.filter((c) => !c.removed).length <= 1) fail("custom_choice_last");
      await db`update custom_field_choices set removed_at = now() where id = ${choiceId}`;
    }
    return done(field);
  });
}
