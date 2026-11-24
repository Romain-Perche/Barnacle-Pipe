// covers SC-003: the People list of 5,000 people with 8 custom columns, a custom filter and a custom sort: first page under 2 s
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { listShownFields } from "@/server/custom-fields/fields";
import { customColumns, customFilterOptions } from "@/server/custom-fields/values";
import { knownCustomQuery, parsePeopleQuery } from "@/server/records/list-query";
import { listPeople } from "@/server/records/people";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeField } from "./custom-helpers";

let ada: TestUser;
const ids: Record<string, number> = {};
let vegan = 0;

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", inList: true, choices: ["None", "Vegetarian", "Vegan"] });
  vegan = diet.choices.Vegan;
  ids.diet = diet.id;
  ids.topics = (await makeField({ kind: "person", name: "Topics", type: "multiple_choice", inList: true, choices: ["AI", "Events"] })).id;
  for (const [name, type] of [["Nick", "text"], ["Notes", "long_text"], ["Count", "number"], ["Budget", "money"], ["Birthday", "date"], ["NDA", "yes_no"]] as const) {
    ids[name] = (await makeField({ kind: "person", name, type, inList: true })).id;
  }
  await sql`
    insert into persons (first_name, last_name, owner_id, created_by, private)
    select 'Perf', 'Person ' || g, ${ada.id}, ${ada.id}, g % 50 = 0 from generate_series(1, 5000) g`;
  const choices = await sql<{ id: number; name: string }[]>`select id::int as id, name from custom_field_choices where field_id = ${diet.id} order by position`;
  await sql`insert into custom_values (field_id, person_id, choice_id) select ${diet.id}, id, (${choices.map((c) => c.id)}::bigint[])[1 + id % 3] from persons`;
  await sql`insert into custom_values (field_id, person_id, text_value) select ${ids.Nick}, id, 'Nick ' || id from persons`;
  await sql`insert into custom_values (field_id, person_id, text_value) select ${ids.Notes}, id, repeat('note ', 40) || id from persons where id % 2 = 0`;
  await sql`insert into custom_values (field_id, person_id, number_value) select ${ids.Count}, id, id % 97 from persons`;
  await sql`insert into custom_values (field_id, person_id, money_pence) select ${ids.Budget}, id, id * 100 from persons`;
  await sql`insert into custom_values (field_id, person_id, date_value) select ${ids.Birthday}, id, date '2000-01-01' + (id % 3000)::int from persons`;
  await sql`insert into custom_values (field_id, person_id, bool_value) select ${ids.NDA}, id, id % 2 = 0 from persons`;
  await sql`insert into custom_values (field_id, person_id, choice_ids) select ${ids.topics}, p.id, array[c.id] from persons p
            join custom_field_choices c on c.field_id = ${ids.topics} and c.position = 1 + p.id % 2`;
  await sql`analyze`;
});
afterAll(closeDb);

describe("custom columns speed", () => {
  it("lists the first page with 8 custom columns, a custom filter and a custom sort under 2 s", async () => {
    for (const params of [
      { [`cf${ids.diet}`]: String(vegan), sort: `cf${ids.Budget}`, dir: "desc" },
      { [`cf${ids.Nick}`]: "nick 4", sort: `cf${ids.Birthday}` },
      { [`cf${ids.Count}_from`]: "10", [`cf${ids.Count}_to`]: "50", sort: `cf${ids.Nick}` },
    ]) {
      const start = performance.now();
      const shown = await listShownFields("person");
      const query = knownCustomQuery(parsePeopleQuery(params), shown);
      const list = await listPeople(ada.id, query, shown);
      const cells = await customColumns("person", shown, list.rows.map((r) => r.id));
      await customFilterOptions(ada.id, "person", shown);
      const ms = performance.now() - start;
      expect(shown).toHaveLength(8);
      expect(list.rows.length).toBe(50);
      expect(Object.keys(cells.get(list.rows[0].id)!).length).toBeGreaterThanOrEqual(6);
      expect(ms, JSON.stringify(params)).toBeLessThan(2000);
    }
  });
});
