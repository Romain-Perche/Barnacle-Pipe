// covers SC-002, SC-003: first list page under 2 s with 2,000 people and 500 organisations
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { ORGANISATION_SORTS, PEOPLE_SORTS, parseOrganisationsQuery, parsePeopleQuery } from "@/server/records/list-query";
import { listOrganisations, organisationFilterOptions } from "@/server/records/organisations";
import { listPeople, peopleFilterOptions } from "@/server/records/people";
import { leadSourceId, makeLabel, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let label: number;
let source: number;

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  label = await makeLabel("Hot");
  source = await leadSourceId("Referral");
  await sql`
    insert into organisations (name, website, sector, size, owner_id, created_by)
    select 'Perf Org ' || g, 'https://perf' || g || '.example', 'Sector ' || (g % 7), (array['1–10','11–50','51–200','201–1,000','1,000+'])[1 + g % 5],
           ${ada.id}, ${ada.id}
    from generate_series(1, 500) g`;
  await sql`
    insert into persons (first_name, last_name, organisation_id, lead_source_id, owner_id, created_by, private, consent, last_contacted_at)
    select 'Perf', 'Person ' || g, (select min(id) from organisations) + g % 500, case when g % 3 = 0 then ${source}::bigint end,
           ${ada.id}, ${ada.id}, g % 50 = 0, case when g % 4 = 0 then 'unsubscribed' else 'subscribed' end,
           case when g % 2 = 0 then now() - make_interval(days => g % 300) end
    from generate_series(1, 2000) g`;
  await sql`insert into person_emails (person_id, email, position) select id, 'perf' || id || '@example.com', 0 from persons`;
  await sql`insert into person_labels (person_id, label_id) select id, ${label} from persons where id % 5 = 0`;
  await sql`analyze`;
});
afterAll(closeDb);

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

describe("list speed", () => {
  it("People: every sort, with search and filters, under 2 s", async () => {
    const viewer = ada.id;
    for (const sort of PEOPLE_SORTS) {
      for (const params of [{ sort }, { sort, dir: "desc", q: "person 1" }, { sort, q: "example.com", label: String(label), source: String(source), consent: "subscribed" }]) {
        const ms = await timed(async () => {
          await listPeople(viewer, parsePeopleQuery(params));
          await peopleFilterOptions(viewer, null);
        });
        expect(ms, JSON.stringify(params)).toBeLessThan(2000);
      }
    }
  });

  it("Organisations: every sort, with search and filters, under 2 s", async () => {
    for (const sort of ORGANISATION_SORTS) {
      for (const params of [{ sort }, { sort, dir: "desc", q: "perf1" }, { sort, sector: "sector 3", size: "11–50", owner: String(ada.id) }]) {
        const ms = await timed(async () => {
          const r = await listOrganisations(ada.id, parseOrganisationsQuery(params));
          expect(r.rows.length).toBeLessThanOrEqual(50);
          await organisationFilterOptions();
        });
        expect(ms, JSON.stringify(params)).toBeLessThan(2000);
      }
    }
  });
});
