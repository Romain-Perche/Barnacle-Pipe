// Custom values on records (SF-115, data-model.md § Record saves, § Lists). A value is only reached through its record:
// reads check visiblePerson / visibleDeal in the same query (organisations are never private), list filters and sorts
// run inside the list's own visible `where`, and saves run inside the record's save transaction after it is locked.
import { sql, type Fragment, type Sql } from "@/server/db";
import { listFields } from "@/server/custom-fields/fields";
import {
  SORTABLE_TYPES, parseNumber, customEvent, formatValue, listText, valuesDiffer, validateCustomValues, canonicalNumber,
  type CustomField, type CustomValue, type CustomValues, type RecordKind,
} from "@/server/custom-fields/rules";
import { refuse } from "@/server/records/common";
import { parseDate, parseMoney } from "@/server/deals/rules";
import { escapeLike, type CustomForm } from "@/server/records/rules";
import { recordEvent, type Target } from "@/server/records/timeline";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";

export type CustomDetail = { field: CustomField; value: CustomValue; text: string };
// A field as the add / edit form shows it: offered choices plus the removed ones the record has; `value` as the inputs hold it.
export type FormField = { id: number; name: string; type: CustomField["type"]; choices: { id: number; name: string }[]; value: string[] };

const TARGET_COLUMN = { person: "person_id", organisation: "organisation_id", deal: "deal_id" } as const;

export function kindOf(target: Target): RecordKind {
  return "personId" in target ? "person" : "organisationId" in target ? "organisation" : "deal";
}
function targetId(target: Target): number {
  return "personId" in target ? target.personId : "organisationId" in target ? target.organisationId : target.dealId;
}

type ValueRow = {
  field_id: number; text_value: string | null; number_value: string | null; money_pence: string | null; date_value: string | null;
  choice_id: number | null; choice_ids: number[] | null; bool_value: boolean | null;
};
// Every typed column as the app reads it: numbers as text (never a float), dates as YYYY-MM-DD.
const VALUE_COLUMNS = (db: Sql, alias: string) => {
  const a = db(alias);
  return db`${a}.field_id::int as field_id, ${a}.text_value, ${a}.number_value::text as number_value, ${a}.money_pence::text as money_pence,
    to_char(${a}.date_value, 'YYYY-MM-DD') as date_value, ${a}.choice_id::int as choice_id, ${a}.choice_ids::int[] as choice_ids, ${a}.bool_value`;
};

function valueOf(r: ValueRow): CustomValue {
  if (r.text_value !== null) return r.text_value;
  if (r.number_value !== null) return canonicalNumber(r.number_value);
  if (r.money_pence !== null) return Number(r.money_pence);
  if (r.date_value !== null) return r.date_value;
  if (r.choice_id !== null) return r.choice_id;
  if (r.choice_ids !== null) return r.choice_ids;
  if (r.bool_value !== null) return r.bool_value;
  return null;
}

// The record's visibility for the viewer, as one SQL condition on the record id.
function visibleRecord(db: Sql, viewerId: number, target: Target): Fragment {
  const id = targetId(target);
  if ("personId" in target) return db`exists (select 1 from persons p where p.id = ${id} and ${visiblePerson(db, viewerId)})`;
  if ("dealId" in target) return db`exists (select 1 from deals d where d.id = ${id} and ${visibleDeal(db, viewerId)})`;
  return db`exists (select 1 from organisations o where o.id = ${id})`;
}

// Every field of the record's kind in order with its value (record page, drawer, edit form). Nothing for a record the
// viewer cannot see: the visibility is checked in the same query as the values (US6-3).
export async function readCustomValues(db: Sql, viewerId: number, target: Target): Promise<CustomDetail[]> {
  const fields = await listFields(kindOf(target), db);
  if (fields.length === 0) return [];
  const col = TARGET_COLUMN[kindOf(target)];
  const rows = await db<(ValueRow & { visible: boolean })[]>`
    select v.visible, ${VALUE_COLUMNS(db, "cv")}
    from (select ${visibleRecord(db, viewerId, target)} as visible) v
    left join custom_values cv on v.visible and cv.${db(col)} = ${targetId(target)}`;
  if (!rows[0]?.visible) return [];
  const values = new Map(rows.filter((r) => r.field_id !== null).map((r) => [r.field_id, valueOf(r)]));
  return fields.map((field) => {
    const value = values.get(field.id) ?? null;
    return { field, value, text: formatValue(field, value) };
  });
}

// The stored values of a record (no visibility: the caller has locked a record the actor may change).
async function storedValues(db: Sql, target: Target): Promise<CustomValues> {
  const rows = await db<ValueRow[]>`
    select ${VALUE_COLUMNS(db, "cv")} from custom_values cv where cv.${db(TARGET_COLUMN[kindOf(target)])} = ${targetId(target)}`;
  return Object.fromEntries(rows.map((r) => [r.field_id, valueOf(r)]));
}

// A value as the form's inputs hold it.
export function rawOf(field: Pick<CustomField, "type">, value: CustomValue): string[] {
  if (value === null) return [];
  switch (field.type) {
    case "money": {
      const pence = Number(value);
      return [pence % 100 === 0 ? String(pence / 100) : `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, "0")}`];
    }
    case "multiple_choice":
      return (value as number[]).map(String);
    case "yes_no":
      return [value ? "yes" : "no"];
    default:
      return [String(value)];
  }
}

// The fields of the add / edit form, in order: offered choices plus the removed ones the record has (US2-6).
export function formFields(details: CustomDetail[]): FormField[] {
  return details.map(({ field, value }) => {
    const has = (id: number) => value === id || (Array.isArray(value) && value.includes(id));
    return {
      id: field.id,
      name: field.name,
      type: field.type,
      choices: field.choices.filter((c) => !c.removed || has(c.id)).map((c) => ({ id: c.id, name: c.name })),
      value: rawOf(field, value),
    };
  });
}

// The form's starting values: every field the form shows (`cfShown`) and the record's values as the inputs hold them.
export function customToForm(details: CustomDetail[]): CustomForm {
  return { shown: details.map((d) => d.field.id), values: Object.fromEntries(details.map((d) => [d.field.id, rawOf(d.field, d.value)])) };
}

// The fields of a new record's form (no values).
export async function newFormFields(kind: RecordKind): Promise<FormField[]> {
  return formFields((await listFields(kind)).map((field) => ({ field, value: null, text: "—" })));
}

async function writeValue(db: Sql, target: Target, field: CustomField, value: CustomValue) {
  const col = TARGET_COLUMN[kindOf(target)];
  const id = targetId(target);
  if (value === null) {
    await db`delete from custom_values where field_id = ${field.id} and ${db(col)} = ${id}`;
    return;
  }
  const v = (type: CustomField["type"][]) => (type.includes(field.type) ? value : null);
  const text = v(["text", "long_text"]) as string | null;
  const number = v(["number"]) as string | null;
  const money = v(["money"]) as number | null;
  const date = v(["date"]) as string | null;
  const choice = v(["single_choice"]) as number | null;
  const choices = v(["multiple_choice"]) as number[] | null;
  const bool = v(["yes_no"]) as boolean | null;
  await db`
    insert into custom_values (field_id, ${db(col)}, text_value, number_value, money_pence, date_value, choice_id, choice_ids, bool_value)
    values (${field.id}, ${id}, ${text}, ${number}::numeric, ${money}, ${date}::date, ${choice}, ${choices}::bigint[], ${bool})
    on conflict (field_id, ${db(col)}) where ${db(col)} is not null do update
    set text_value = excluded.text_value, number_value = excluded.number_value, money_pence = excluded.money_pence,
        date_value = excluded.date_value, choice_id = excluded.choice_id, choice_ids = excluded.choice_ids,
        bool_value = excluded.bool_value, updated_at = now()`;
}

// Saves the custom values a form sent, inside the record's save transaction, after the record is locked (data-model.md
// § Record saves). Only fields the form showed (`cfShown`) and that still exist count; any invalid value refuses the
// whole save; an archived record refuses a change; each change writes one timeline row with the text of the time.
export async function saveCustomValues(db: Sql, actorId: number, target: Target, form: CustomForm | undefined, opts: { archived: boolean }) {
  if (!form || form.shown.length === 0) return;
  const shown = new Set(form.shown);
  const fields = (await listFields(kindOf(target), db, true)).filter((f) => shown.has(f.id));
  if (fields.length === 0) return;
  const current = await storedValues(db, target);
  const checked = validateCustomValues(fields, form.values, current);
  if (!checked.ok) refuse(checked.errors);
  const changed = fields.filter((f) => valuesDiffer(current[f.id], checked.values[f.id]));
  if (changed.length === 0) return;
  if (opts.archived) refuse({ form: { code: "custom_record_archived" } });
  for (const field of changed) {
    await writeValue(db, target, field, checked.values[field.id]);
    const event = customEvent(field, current[field.id], checked.values[field.id]);
    if (event) await recordEvent(db, { ...target, kind: event.kind, actorId, fieldName: event.fieldName, oldValue: event.oldValue, newValue: event.newValue });
  }
}

// ---------------------------------------------------------------- lists

export type ListParts = { where: Fragment; join: Fragment; order: Fragment | null };

const ID = /^[1-9][0-9]{0,15}$/;
const number = (raw: string) => { const n = parseNumber(raw); return n.ok ? n.value : null; };
const pence = (raw: string) => { const m = parseMoney(raw); return m.ok ? m.pence : null; };
const day = (raw: string) => { const d = parseDate(raw); return d.ok ? d.date : null; };

// The list's custom filters (already checked by knownCustomQuery) and custom sort, for the list's record alias. Filters are
// `exists` probes inside the list's `where`, after its visibility condition, so hidden records never match (US6-1).
export function customListParts(
  db: Sql,
  kind: RecordKind,
  alias: string,
  fields: CustomField[],
  query: { custom: Record<string, string>; sort: string; dir: "asc" | "desc" },
): ListParts {
  const col = TARGET_COLUMN[kind];
  const rec = db(alias);
  const conditions: Fragment[] = [];
  for (const field of fields) {
    const raw = query.custom[`cf${field.id}`];
    const from = query.custom[`cf${field.id}_from`];
    const to = query.custom[`cf${field.id}_to`];
    const probe = (cond: Fragment) =>
      db`exists (select 1 from custom_values cv where cv.field_id = ${field.id} and cv.${db(col)} = ${rec}.id and ${cond})`;
    if (raw === "empty") {
      conditions.push(db`not exists (select 1 from custom_values cv where cv.field_id = ${field.id} and cv.${db(col)} = ${rec}.id)`);
      continue;
    }
    switch (field.type) {
      case "text":
      case "long_text":
        if (raw) conditions.push(probe(db`cv.text_value ilike ${`%${escapeLike(raw)}%`}`));
        break;
      case "number": {
        const [lo, hi] = [from, to].map((v) => (v ? number(v) : null));
        if (lo !== null) conditions.push(probe(db`cv.number_value >= ${lo}::numeric`));
        if (hi !== null) conditions.push(probe(db`cv.number_value <= ${hi}::numeric`));
        break;
      }
      case "money": {
        const [lo, hi] = [from, to].map((v) => (v ? pence(v) : null));
        if (lo !== null) conditions.push(probe(db`cv.money_pence >= ${lo}`));
        if (hi !== null) conditions.push(probe(db`cv.money_pence <= ${hi}`));
        break;
      }
      case "date":
        if (from && !day(from)) break;
        if (to && !day(to)) break;
        if (from) conditions.push(probe(db`cv.date_value >= ${from}::date`));
        if (to) conditions.push(probe(db`cv.date_value <= ${to}::date`));
        break;
      case "single_choice":
        if (raw && ID.test(raw)) conditions.push(probe(db`cv.choice_id = ${Number(raw)}`));
        break;
      case "multiple_choice":
        if (raw && ID.test(raw)) conditions.push(probe(db`cv.choice_ids @> array[${Number(raw)}]::bigint[]`));
        break;
      case "yes_no":
        if (raw === "yes" || raw === "no") conditions.push(probe(db`cv.bool_value = ${raw === "yes"}`));
        break;
    }
  }
  const where = conditions.reduce((acc, c) => db`${acc} and ${c}`, db``);
  const sortField = /^cf([1-9][0-9]{0,15})$/.exec(query.sort) ? fields.find((f) => `cf${f.id}` === query.sort) : undefined;
  if (!sortField || !SORTABLE_TYPES.includes(sortField.type)) return { where, join: db``, order: null };
  const dir = query.dir === "desc" ? db`desc` : db`asc`;
  const join = db`left join custom_values cs on cs.field_id = ${sortField.id} and cs.${db(col)} = ${rec}.id
    ${sortField.type === "single_choice" ? db`left join custom_field_choices cc on cc.id = cs.choice_id` : db``}`;
  const column = {
    text: db`lower(cs.text_value)`,
    long_text: db`lower(cs.text_value)`,
    number: db`cs.number_value`,
    money: db`cs.money_pence`,
    date: db`cs.date_value`,
    single_choice: db`cc.position`,
    multiple_choice: db`null`,
    yes_no: db`cs.bool_value`,
  }[sortField.type];
  return { where, join, order: db`${column} ${dir} nulls last` };
}

// The list cells of the shown fields for the page's rows (already visible), in one query: id → field id → text.
export async function customColumns(kind: RecordKind, fields: CustomField[], ids: number[], db: Sql = sql): Promise<Map<number, Record<number, string>>> {
  const cells = new Map<number, Record<number, string>>(ids.map((id) => [id, {}]));
  if (fields.length === 0 || ids.length === 0) return cells;
  const col = TARGET_COLUMN[kind];
  const rows = await db<(ValueRow & { rid: number })[]>`
    select cv.${db(col)}::int as rid, ${VALUE_COLUMNS(db, "cv")} from custom_values cv
    where cv.field_id in ${db(fields.map((f) => f.id))} and cv.${db(col)} in ${db(ids)}`;
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const r of rows) cells.get(r.rid)![r.field_id] = listText(byId.get(r.field_id)!, valueOf(r));
  return cells;
}

// The choices a list filter offers: the field's offered choices, plus a removed one only while a record the viewer can
// see still has it (research.md §12). Field id → options in choice order.
export async function customFilterOptions(viewerId: number, kind: RecordKind, fields: CustomField[], db: Sql = sql): Promise<Record<number, { id: number; name: string }[]>> {
  const options: Record<number, { id: number; name: string }[]> = {};
  const removed = fields.flatMap((f) => f.choices.filter((c) => c.removed).map((c) => ({ field: f, choice: c })));
  const kept = new Set<number>();
  if (removed.length > 0) {
    const col = TARGET_COLUMN[kind];
    const visible =
      kind === "person" ? db`exists (select 1 from persons p where p.id = cv.person_id and ${visiblePerson(db, viewerId)})`
        : kind === "deal" ? db`exists (select 1 from deals d where d.id = cv.deal_id and ${visibleDeal(db, viewerId)})`
          : db`cv.organisation_id is not null`;
    const ids = removed.map((r) => r.choice.id);
    const rows = await db<{ id: number }[]>`
      select c.id::int as id from custom_field_choices c
      where c.id in ${db(ids)} and exists (
        select 1 from custom_values cv where cv.field_id = c.field_id and cv.${db(col)} is not null
          and (cv.choice_id = c.id or cv.choice_ids @> array[c.id]) and ${visible})`;
    for (const r of rows) kept.add(r.id);
  }
  for (const f of fields) {
    options[f.id] = f.choices.filter((c) => !c.removed || kept.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
  }
  return options;
}
