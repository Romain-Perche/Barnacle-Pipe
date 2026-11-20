// covers SF-95 SC-003: a deal list page of 2,000 deals with filters and sorting under 2 s
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { dealFilterOptions, listDeals } from "@/server/deals/list";
import { DEAL_SORTS, parseDealsQuery } from "@/server/records/list-query";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDealLabel, makePipeline } from "./deal-helpers";

let ada: TestUser;
let hot: number;
let sales: { id: number; stages: number[] };

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  sales = await makePipeline("Sales", ["Lead in", "Qualified", "Proposal", "Negotiation"]);
  await makePipeline("Partners", ["Intro", "Talking"]);
  hot = await makeDealLabel("Hot");
  await makeDealLabel("Warm");
  await sql`
    insert into organisations (name, owner_id, created_by)
    select 'Perf Org ' || g, ${ada.id}, ${ada.id} from generate_series(1, 300) g`;
  await sql`
    insert into persons (first_name, last_name, owner_id, created_by, private)
    select 'Perf', 'Person ' || g, ${ada.id}, ${ada.id}, g % 40 = 0 from generate_series(1, 1000) g`;
  await sql`
    insert into deals (title, value_pence, stage_id, organisation_id, person_id, owner_id, created_by, private, expected_close_on,
                       status, closed_at, lost_reason, archived_at, created_at)
    select 'Perf deal ' || g, case when g % 7 = 0 then null else g * 1000 end,
           (select id from stages order by id offset (g % 6) limit 1),
           case when g % 5 = 0 then null else (select min(id) from organisations) + g % 300 end,
           (select min(id) from persons) + g % 1000, ${ada.id}, ${ada.id}, g % 50 = 0,
           case when g % 3 = 0 then current_date + g % 90 end,
           case when g % 10 = 1 then 'won' when g % 10 = 2 then 'lost' else 'open' end,
           case when g % 10 in (1, 2) then now() end, case when g % 10 = 2 then 'Fake budget cut' end,
           case when g % 25 = 0 then now() end, now() - make_interval(hours => g)
    from generate_series(1, 2000) g`;
  await sql`insert into deal_label_links (deal_id, label_id) select id, ${hot} from deals where id % 4 = 0`;
  await sql`analyze`;
});
afterAll(closeDb);

async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

describe("deal list speed", () => {
  it("every sort, with search, filters, closed and archived deals, under 2 s (with count, total and filter options)", async () => {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from deals`;
    expect(n).toBe(2000);
    for (const sort of DEAL_SORTS) {
      for (const params of [
        { sort },
        { sort, dir: "asc", q: "deal 1" },
        { sort, pipeline: String(sales.id), stage: String(sales.stages[1]), owner: String(ada.id), label: String(hot), closed: "1", status: "won" },
        { sort, archived: "1", page: "2" },
      ]) {
        const ms = await timed(async () => {
          const r = await listDeals(ada.id, parseDealsQuery(params));
          expect(r.rows.length).toBeLessThanOrEqual(50);
          await dealFilterOptions(ada.id, sales.id);
        });
        expect(ms, JSON.stringify(params)).toBeLessThan(2000);
      }
    }
  });
});
