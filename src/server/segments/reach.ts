// SF-120 (research.md §3, §4): who a segment reaches, worked out at each read (never stored, FR-007). One `where` on
// `persons p`: the viewer's visibility (visiblePerson), the "Who" part through deals the viewer can see (visibleDeal,
// archived deals never) and every condition. Each person is one row of `persons`, so a person on several deals or with
// several addresses counts once (FR-009). The left-out numbers are counted among visible people only (FR-010).
import { sql, type Fragment, type Sql } from "@/server/db";
import { listFields } from "@/server/custom-fields/fields";
import type { CustomField } from "@/server/custom-fields/rules";
import { customProbe } from "@/server/custom-fields/values";
import { escapeLike } from "@/server/records/rules";
import { visibleDeal, visiblePerson } from "@/server/records/visibility";
import type { Condition, CustomCondition, Definition, Reach } from "@/server/segments/rules";

// The deals of the "Who" part that the viewer can see (`d` joined to its stage `s`).
function dealsWhere(db: Sql, viewerId: number, def: Definition): Fragment {
  return db`d.archived_at is null and ${visibleDeal(db, viewerId, "d")} and s.pipeline_id = ${def.pipelineId}
    ${def.who === "stage" ? db`and d.stage_id = ${def.stageId}` : db``}
    ${def.dealStatus && def.dealStatus !== "all" ? db`and d.status = ${def.dealStatus}` : db``}`;
}

// A person on such a deal: its main contact or one of its other linked people (FR-003). `in` with a union lets
// Postgres hash the deal side once instead of probing it for each person (SC-004).
function whoWhere(db: Sql, viewerId: number, def: Definition): Fragment {
  if (def.who === "everyone") return db`true`;
  if (def.pipelineId === null) return db`false`;
  return db`p.id in (
    select d.person_id from deals d join stages s on s.id = d.stage_id where d.person_id is not null and ${dealsWhere(db, viewerId, def)}
    union all
    select dp.person_id from deal_people dp join deals d on d.id = dp.deal_id join stages s on s.id = d.stage_id where ${dealsWhere(db, viewerId, def)})`;
}

function customWhere(db: Sql, c: CustomCondition, fields: CustomField[]): Fragment {
  // A field that is gone, no longer a person field or of another type matches nobody, even with "Empty" (FR-013).
  const field = fields.find((f) => f.id === c.fieldId && f.kind === "person" && f.type === c.type);
  if (!field) return db`false`;
  const probe = (test: Fragment) => customProbe(db, field, "p", test);
  const none = db`not ${probe(db`true`)}`;
  switch (c.type) {
    case "text":
    case "long_text":
      return probe(db`cv.text_value ilike ${`%${escapeLike(c.text)}%`}`);
    case "number":
    case "money":
    case "date": {
      const col = { number: db`cv.number_value`, money: db`cv.money_pence`, date: db`cv.date_value` }[c.type];
      const cast = { number: db`::numeric`, money: db`::bigint`, date: db`::date` }[c.type];
      return probe(db`${c.from === null ? db`true` : db`${col} >= ${c.from}${cast}`} and ${c.to === null ? db`true` : db`${col} <= ${c.to}${cast}`}`);
    }
    case "single_choice": {
      const any = c.ids.length > 0 ? probe(db`cv.choice_id = any(${c.ids}::bigint[])`) : db`false`;
      return c.empty ? db`(${any} or ${none})` : any;
    }
    case "multiple_choice":
      return probe(db`cv.choice_ids && ${c.ids}::bigint[]`);
    case "yes_no":
      return c.value === "empty" ? none : probe(db`cv.bool_value = ${c.value === "yes"}`);
  }
}

function conditionWhere(db: Sql, c: Condition, fields: CustomField[]): Fragment {
  switch (c.field) {
    case "lead_source":
      return db`p.lead_source_id = any(${c.ids}::bigint[])`;
    case "label":
      return db`exists (select 1 from person_labels pl where pl.person_id = p.id and pl.label_id = any(${c.ids}::bigint[]))`;
    case "organisation":
      return db`p.organisation_id = any(${c.ids}::bigint[])`;
    case "owner":
      return db`p.owner_id = any(${c.ids}::bigint[])`;
    case "role":
      return db`p.role ilike ${`%${escapeLike(c.text)}%`}`;
    case "custom":
      return customWhere(db, c, fields);
  }
}

// The people (`persons p`) the definition matches for the viewer, before the left-out reasons. `fields`: the person
// custom fields (listFields("person")).
export function reachWhere(db: Sql, viewerId: number, def: Definition, fields: CustomField[]): Fragment {
  return def.conditions.reduce(
    (acc, c) => db`${acc} and ${conditionWhere(db, c, fields)}`,
    db`${visiblePerson(db, viewerId, "p")} and ${whoWhere(db, viewerId, def)}`,
  );
}

const needsFields = (def: Definition) => def.conditions.some((c) => c.field === "custom");

// One query, four numbers; each person under the first reason that applies: archived → unsubscribed → no email address.
export async function countReach(viewerId: number, def: Definition, db: Sql = sql, fields?: CustomField[]): Promise<Reach> {
  const list = fields ?? (needsFields(def) ? await listFields("person", db) : []);
  const hasEmail = db`exists (select 1 from person_emails e where e.person_id = p.id)`;
  const [r] = await db<Reach[]>`
    select count(*) filter (where p.archived_at is not null)::int as archived,
           count(*) filter (where p.archived_at is null and p.consent = 'unsubscribed')::int as unsubscribed,
           count(*) filter (where p.archived_at is null and p.consent <> 'unsubscribed' and not ${hasEmail})::int as "noEmail",
           count(*) filter (where p.archived_at is null and p.consent <> 'unsubscribed' and ${hasEmail})::int as reaches
    from persons p where ${reachWhere(db, viewerId, def, list)}`;
  return { reaches: r.reaches, archived: r.archived, unsubscribed: r.unsubscribed, noEmail: r.noEmail };
}

// The reached people with their first email address (by position): what the later campaign issue sends to.
export async function reachedPeople(db: Sql, viewerId: number, def: Definition): Promise<{ personId: number; email: string }[]> {
  const fields = needsFields(def) ? await listFields("person", db) : [];
  return db<{ personId: number; email: string }[]>`
    select p.id::int as "personId", e.email
    from persons p
    join lateral (select e.email from person_emails e where e.person_id = p.id order by e.position limit 1) e on true
    where p.archived_at is null and p.consent <> 'unsubscribed' and ${reachWhere(db, viewerId, def, fields)}
    order by p.id`;
}
