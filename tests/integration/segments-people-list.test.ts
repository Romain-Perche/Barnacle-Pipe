// SF-120 US2 independent test: a segment's count equals the People list total with the same filters minus the people a
// segment leaves out (archived, unsubscribed, no email address); the People list's custom filters keep their results
// after customProbe was extracted from customListParts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { listFields } from "@/server/custom-fields/fields";
import { listPeople } from "@/server/records/people";
import { parsePeopleQuery } from "@/server/records/list-query";
import { countReach } from "@/server/segments/reach";
import { EVERYONE, type Condition } from "@/server/segments/rules";
import { leadSourceId, makeLabel, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeField, setValue } from "./custom-helpers";

let ada: TestUser;
let grace: TestUser;
let inbound: number;
let hot: number;
let diet: Awaited<ReturnType<typeof makeField>>;

beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai" });
  grace = await makeUser({ email: "grace@barnacle.ai" });
  inbound = await leadSourceId("Inbound");
  const event = await leadSourceId("Event");
  hot = await makeLabel("Hot");
  diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", inList: true, choices: ["Vegan", "None"] });
  // Every mix of: lead source, label, owner, private, archived, consent, email, Diet value.
  let i = 0;
  for (const source of [inbound, event]) for (const label of [true, false]) for (const owner of [ada, grace])
    for (const priv of [false, true]) for (const archived of [false, true]) for (const consent of ["subscribed", "unsubscribed"] as const)
      for (const email of [true, false]) {
        i++;
        const id = await makePerson({
          createdBy: owner.id, ownerId: owner.id, leadSourceId: source, labelIds: label ? [hot] : [], private: priv, archived, consent,
          emails: email ? [`p${i}@example.com`] : [],
        });
        if (i % 3 === 0) await setValue(diet.id, { personId: id }, "choice_id", diet.choices.Vegan);
        if (i % 3 === 1) await setValue(diet.id, { personId: id }, "choice_id", diet.choices.None);
      }
});
afterAll(closeDb);

// The People list's subscribed, non-archived total with these filters, minus those with no email address.
async function listReach(viewerId: number, params: Record<string, string>): Promise<number> {
  const fields = await listFields("person");
  const query = parsePeopleQuery({ ...params, consent: "subscribed" });
  const { total } = await listPeople(viewerId, query, fields);
  const noEmail = await listPeople(viewerId, { ...query, page: 1 }, fields).then(async (first) => {
    // Count the rows with no email over every page.
    let n = first.rows.filter((r) => r.email === null).length;
    for (let page = 2; page <= first.pages; page++) n += (await listPeople(viewerId, { ...query, page }, fields)).rows.filter((r) => r.email === null).length;
    return n;
  });
  return total - noEmail;
}

describe("segment count = People list with the same filters, minus left-out people", () => {
  // covers US2 independent test, SC-002
  it("Inbound, labelled Hot, owned by a user: the same for both viewers", async () => {
    for (const viewer of [ada, grace]) {
      const conditions: Condition[] = [
        { field: "lead_source", ids: [inbound] }, { field: "label", ids: [hot] }, { field: "owner", ids: [grace.id] },
      ];
      const reach = await countReach(viewer.id, { ...EVERYONE, conditions });
      const list = await listReach(viewer.id, { source: String(inbound), label: String(hot), owner: String(grace.id) });
      expect(reach.reaches).toBe(list);
      expect(reach.reaches).toBeGreaterThan(0);
    }
  });

  // covers US2 (custom filters unchanged after the customProbe extraction), research.md §4
  it("Diet = Vegan and Diet empty give the same people as the People list filters", async () => {
    for (const viewer of [ada, grace]) {
      const vegan = await countReach(viewer.id, { ...EVERYONE, conditions: [{ field: "custom", fieldId: diet.id, type: "single_choice", ids: [diet.choices.Vegan], empty: false }] });
      expect(vegan.reaches).toBe(await listReach(viewer.id, { [`cf${diet.id}`]: String(diet.choices.Vegan) }));
      const empty = await countReach(viewer.id, { ...EVERYONE, conditions: [{ field: "custom", fieldId: diet.id, type: "single_choice", ids: [], empty: true }] });
      expect(empty.reaches).toBe(await listReach(viewer.id, { [`cf${diet.id}`]: "empty" }));
      expect(vegan.reaches + empty.reaches).toBeGreaterThan(0);
    }
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from persons`;
    expect(n).toBe(128);
  });
});
