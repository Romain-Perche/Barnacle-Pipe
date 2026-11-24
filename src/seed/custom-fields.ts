// Fake custom fields (SF-115 data-model.md § Fake data, FR-018): nine "(fake)" fields of every type across people,
// organisations and deals (some shown in lists, "Pescatarian" removed but kept on one person), values on a few fake
// people, organisations and deals, including a private person and a private deal, and a timeline entry per value.
// Idempotent: fields by (kind, lower(name)), choices by (field, lower(name)), values by their unique indexes; a timeline
// entry only when the value was added.
import type { Sql } from "@/server/db";
import { customEvent, type CustomField, type CustomType, type CustomValue, type RecordKind } from "@/server/custom-fields/rules";

type FieldSeed = { kind: RecordKind; name: string; type: CustomType; inList: boolean; choices?: string[]; removed?: string[] };
const FIELDS: FieldSeed[] = [
  { kind: "person", name: "Diet (fake)", type: "single_choice", inList: true, choices: ["None", "Vegetarian", "Vegan", "Pescatarian"], removed: ["Pescatarian"] },
  { kind: "person", name: "Birthday (fake)", type: "date", inList: false },
  { kind: "person", name: "Newsletter topics (fake)", type: "multiple_choice", inList: true, choices: ["AI", "Events", "Hiring"] },
  { kind: "person", name: "Head count met (fake)", type: "number", inList: false },
  { kind: "person", name: "Notes (fake)", type: "long_text", inList: false },
  { kind: "organisation", name: "Account code (fake)", type: "text", inList: true },
  { kind: "organisation", name: "Annual budget (fake)", type: "money", inList: true },
  { kind: "deal", name: "Contract end (fake)", type: "date", inList: true },
  { kind: "deal", name: "Signed NDA (fake)", type: "yes_no", inList: true },
];

// Records by email (people), by name (organisations) or by title (deals), as the other seeders create them. A value is
// a column value, or choice names for the choice types.
type ValueSeed = { field: string; person?: string; organisation?: string; deal?: string; value: string | number | boolean | string[] };
const VALUES: ValueSeed[] = [
  { field: "Diet (fake)", person: "cara.ambassador@example.com", value: ["Vegan"] },
  { field: "Diet (fake)", person: "dora.ambassador@example.com", value: ["Vegetarian"] }, // private (Linus Fake's)
  { field: "Diet (fake)", person: "ben.referredfake@example.com", value: ["Pescatarian"] }, // a removed choice kept
  { field: "Birthday (fake)", person: "cara.ambassador@example.com", value: "1990-11-24" },
  { field: "Newsletter topics (fake)", person: "cara.ambassador@example.com", value: ["AI", "Events"] },
  { field: "Newsletter topics (fake)", person: "dee.referredfake@example.com", value: ["Hiring"] },
  { field: "Head count met (fake)", person: "ben.referredfake@example.com", value: "12" },
  { field: "Notes (fake)", person: "cara.ambassador@example.com", value: "Fake note: prefers calls on Fridays.\nFake note: no meetings in August." },
  { field: "Account code (fake)", organisation: "Sample Studios Fake", value: "FAKE-001" },
  { field: "Annual budget (fake)", organisation: "Sample Studios Fake", value: 2500000 },
  { field: "Contract end (fake)", deal: "Fake referral · website", value: "2027-03-31" },
  { field: "Signed NDA (fake)", deal: "Fake referral · website", value: true },
  { field: "Contract end (fake)", deal: "Fake referral · audit", value: "2027-01-15" }, // private (Linus Fake's)
  { field: "Signed NDA (fake)", deal: "Fake referral · audit", value: false },
];

const COLUMN: Record<CustomType, string> = {
  text: "text_value", long_text: "text_value", number: "number_value", money: "money_pence", date: "date_value",
  single_choice: "choice_id", multiple_choice: "choice_ids", yes_no: "bool_value",
};

export async function seedCustomFields(sql: Sql): Promise<string[]> {
  let fieldsAdded = 0;
  let valuesAdded = 0;
  const fields = new Map<string, CustomField>();
  for (const f of FIELDS) {
    const added = await sql`
      insert into custom_fields (kind, name, type, position, in_list)
      values (${f.kind}, ${f.name}, ${f.type}, (select coalesce(max(position), 0) + 1 from custom_fields where kind = ${f.kind}), ${f.inList})
      on conflict (kind, lower(name)) do nothing returning id`;
    fieldsAdded += added.length;
    const [row] = await sql<{ id: number; position: number; in_list: boolean }[]>`
      select id::int as id, position, in_list from custom_fields where kind = ${f.kind} and lower(name) = lower(${f.name})`;
    for (const [i, name] of (f.choices ?? []).entries()) {
      await sql`
        insert into custom_field_choices (field_id, name, position, removed_at)
        values (${row.id}, ${name}, ${i + 1}, ${(f.removed ?? []).includes(name) ? sql`now()` : null})
        on conflict (field_id, lower(name)) do nothing`;
    }
    const choices = await sql<{ id: number; name: string; position: number; removed: boolean }[]>`
      select id::int as id, name, position, removed_at is not null as removed from custom_field_choices where field_id = ${row.id} order by position, id`;
    fields.set(f.name, { id: row.id, kind: f.kind, name: f.name, type: f.type, position: row.position, inList: row.in_list, choices: [...choices] });
  }

  for (const v of VALUES) {
    const field = fields.get(v.field)!;
    const [rec] = v.person
      ? await sql<{ id: number; creator: number }[]>`
          select p.id::int as id, p.created_by::int as creator from persons p join person_emails e on e.person_id = p.id where e.email = ${v.person} limit 1`
      : v.organisation
        ? await sql<{ id: number; creator: number }[]>`select id::int as id, created_by::int as creator from organisations where name = ${v.organisation} limit 1`
        : await sql<{ id: number; creator: number }[]>`select id::int as id, created_by::int as creator from deals where title = ${v.deal!} limit 1`;
    if (!rec) continue;
    const target = v.person ? "person_id" : v.organisation ? "organisation_id" : "deal_id";
    const ids = Array.isArray(v.value) ? field.choices.filter((c) => (v.value as string[]).includes(c.name)).map((c) => c.id) : [];
    const value: CustomValue = field.type === "single_choice" ? ids[0] : field.type === "multiple_choice" ? ids : (v.value as CustomValue);
    const stored = field.type === "multiple_choice" ? sql`${ids}::bigint[]` : sql`${value as string}`;
    const added = await sql`
      insert into custom_values (field_id, ${sql(target)}, ${sql(COLUMN[field.type])})
      values (${field.id}, ${rec.id}, ${stored})
      on conflict (field_id, ${sql(target)}) where ${sql(target)} is not null do nothing returning id`;
    if (added.length === 0) continue;
    valuesAdded++;
    const event = customEvent(field, null, value)!;
    await sql`
      insert into timeline_events (${sql(target)}, kind, actor_id, field_name, old_value, new_value)
      values (${rec.id}, ${event.kind}, ${rec.creator}, ${event.fieldName}, ${event.oldValue}, ${event.newValue})`;
  }
  return [fieldsAdded + valuesAdded === 0 ? "already there custom fields" : `added ${fieldsAdded} fake custom fields, ${valuesAdded} values`];
}
