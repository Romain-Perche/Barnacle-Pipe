// SF-120: who a segment reaches (src/server/segments/reach.ts) on the real database: the "Who" part through deals,
// the left-out reasons and their order, once per person, conditions of every kind, privacy.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { countReach, reachedPeople } from "@/server/segments/reach";
import { EVERYONE, type Condition, type Definition } from "@/server/segments/rules";
import { leadSourceId, makeLabel, makeOrganisation, makePerson, makeUser, resetDb } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeField, setValue } from "./custom-helpers";

beforeEach(resetDb);
afterAll(closeDb);

let n = 0;
const mail = () => [`p${++n}@example.com`];
const linkPerson = (dealId: number, personId: number) => sql`insert into deal_people (deal_id, person_id) values (${dealId}, ${personId})`;
const close = (dealId: number, status: "won" | "lost") =>
  sql`update deals set status = ${status}, closed_at = now(), lost_reason = ${status === "lost" ? "Too dear" : null} where id = ${dealId}`;
const stage = (pipelineId: number, stageId: number, dealStatus: Definition["dealStatus"] = "open"): Definition =>
  ({ who: "stage", pipelineId, stageId, dealStatus, conditions: [] });
const pipeline = (pipelineId: number, dealStatus: Definition["dealStatus"] = "open"): Definition =>
  ({ who: "pipeline", pipelineId, stageId: null, dealStatus, conditions: [] });
const everyone = (...conditions: Condition[]): Definition => ({ ...EVERYONE, conditions });

describe("the Who part", () => {
  // covers US1 scenario 2, FR-002, FR-003
  it("counts the main contact and other linked people of open deals in the stage; All adds closed deals; archived deals never", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const sales = await makePipeline("Sales", ["Lead in", "Proposal"]);
    const proposal = sales.stages[1];
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push(await makePerson({ createdBy: ada.id, emails: mail() }));
    const [a, b, c, d, e, f] = ids;
    const d1 = await makeDeal({ title: "D1", stageId: proposal, createdBy: ada.id, personId: a });
    await linkPerson(d1, b);
    await makeDeal({ title: "D2", stageId: proposal, createdBy: ada.id, personId: c });
    const won = await makeDeal({ title: "Won", stageId: proposal, createdBy: ada.id, personId: d });
    await close(won, "won");
    await makeDeal({ title: "Archived", stageId: proposal, createdBy: ada.id, personId: e, archived: true });
    await makeDeal({ title: "Other stage", stageId: sales.stages[0], createdBy: ada.id, personId: f });

    expect(await countReach(ada.id, stage(sales.id, proposal))).toEqual({ reaches: 3, archived: 0, unsubscribed: 0, noEmail: 0 });
    expect((await countReach(ada.id, stage(sales.id, proposal, "all"))).reaches).toBe(4);
    expect((await countReach(ada.id, stage(sales.id, proposal, "won"))).reaches).toBe(1);
    expect((await countReach(ada.id, stage(sales.id, proposal, "lost"))).reaches).toBe(0);
    // The pipeline adds the other stage's person; the archived deal's person is still never reached.
    expect((await countReach(ada.id, pipeline(sales.id))).reaches).toBe(4);
    expect((await countReach(ada.id, pipeline(sales.id, "all"))).reaches).toBe(5);
    const people = await reachedPeople(sql, ada.id, pipeline(sales.id, "all"));
    expect(people.map((p) => p.personId).sort((x, y) => x - y)).toEqual([a, b, c, d, f]);
  });

  // covers US1 scenario 7, FR-009
  it("counts a person on two deals and with two addresses once, at their first address", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const sales = await makePipeline("Sales", ["Lead in"]);
    const p = await makePerson({ createdBy: ada.id, emails: ["first@example.com", "second@example.com"] });
    await sql`update person_emails set position = 5 where email = 'first@example.com'`;
    await sql`update person_emails set position = 1 where email = 'second@example.com'`;
    const d1 = await makeDeal({ title: "D1", stageId: sales.stages[0], createdBy: ada.id, personId: p });
    const d2 = await makeDeal({ title: "D2", stageId: sales.stages[0], createdBy: ada.id });
    await linkPerson(d2, p);
    expect(d1).not.toBe(d2);
    expect((await countReach(ada.id, pipeline(sales.id))).reaches).toBe(1);
    expect(await reachedPeople(sql, ada.id, pipeline(sales.id))).toEqual([{ personId: p, email: "second@example.com" }]);
  });

  // covers spec Edge "Left-out reasons", FR-008, "Nobody reached"
  it("counts each left-out person under one reason: archived, then unsubscribed, then no email address", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    expect(await countReach(ada.id, EVERYONE)).toEqual({ reaches: 0, archived: 0, unsubscribed: 0, noEmail: 0 });
    await makePerson({ createdBy: ada.id, archived: true, consent: "unsubscribed" });
    await makePerson({ createdBy: ada.id, consent: "unsubscribed" });
    await makePerson({ createdBy: ada.id, consent: "unsubscribed", emails: mail() });
    await makePerson({ createdBy: ada.id });
    await makePerson({ createdBy: ada.id, emails: mail() });
    expect(await countReach(ada.id, EVERYONE)).toEqual({ reaches: 1, archived: 1, unsubscribed: 2, noEmail: 1 });
    expect((await reachedPeople(sql, ada.id, EVERYONE)).length).toBe(1);
  });

  // covers spec Edge "Stage moves"
  it("follows a deal moved to another stage on the next count", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const sales = await makePipeline("Sales", ["Lead in", "Proposal"]);
    const p = await makePerson({ createdBy: ada.id, emails: mail() });
    const deal = await makeDeal({ title: "D", stageId: sales.stages[1], createdBy: ada.id, personId: p });
    expect((await countReach(ada.id, stage(sales.id, sales.stages[1]))).reaches).toBe(1);
    await sql`update deals set stage_id = ${sales.stages[0]} where id = ${deal}`;
    expect((await countReach(ada.id, stage(sales.id, sales.stages[1]))).reaches).toBe(0);
  });

  it("reaches nobody through a deleted pipeline or stage", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    await makePerson({ createdBy: ada.id, emails: mail() });
    expect(await countReach(ada.id, stage(9999, 9998, "all"))).toEqual({ reaches: 0, archived: 0, unsubscribed: 0, noEmail: 0 });
    expect((await countReach(ada.id, pipeline(9999, "all"))).reaches).toBe(0);
  });

  // covers FR-010, SC-003, spec Edge "Private people and deals"
  it("counts only people and deals the viewer can see, with no trace of hidden ones", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const grace = await makeUser({ email: "grace@barnacle.ai" });
    await makePerson({ createdBy: ada.id, emails: mail() });
    await makePerson({ createdBy: grace.id, private: true, emails: mail() });
    await makePerson({ createdBy: grace.id, private: true, archived: true });
    expect(await countReach(grace.id, EVERYONE)).toEqual({ reaches: 2, archived: 1, unsubscribed: 0, noEmail: 0 });
    expect(await countReach(ada.id, EVERYONE)).toEqual({ reaches: 1, archived: 0, unsubscribed: 0, noEmail: 0 });

    const sales = await makePipeline("Sales", ["Lead in"]);
    const shared = await makePerson({ createdBy: ada.id, emails: mail() });
    const deal = await makeDeal({ title: "Private", stageId: sales.stages[0], createdBy: grace.id, private: true, personId: shared });
    await linkPerson(deal, await makePerson({ createdBy: ada.id, emails: mail() }));
    expect((await countReach(ada.id, pipeline(sales.id))).reaches).toBe(0);
    expect((await countReach(grace.id, pipeline(sales.id))).reaches).toBe(2);
  });
});

describe("conditions", () => {
  // covers US2 scenarios 1–2, FR-004, spec Edge "Removed things", "Archived organisations"
  it("matches lead source, label, organisation, owner and role, all together; removed ones still match", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const alan = await makeUser({ email: "alan@barnacle.ai", status: "deactivated" });
    const inbound = await leadSourceId("Inbound");
    const event = await leadSourceId("Event");
    await sql`update lead_sources set removed_at = now() where id = ${event}`;
    const hot = await makeLabel("Hot");
    const old = await makeLabel("Old", true);
    const archivedOrg = await makeOrganisation({ name: "Gone Ltd", ownerId: ada.id, archived: true });
    const p1 = await makePerson({ createdBy: ada.id, emails: mail(), leadSourceId: inbound, labelIds: [hot], organisationId: archivedOrg, role: "Chief 50%_Officer" });
    const p2 = await makePerson({ createdBy: ada.id, ownerId: alan.id, emails: mail(), leadSourceId: event, labelIds: [old] });
    await makePerson({ createdBy: ada.id, emails: mail() });
    const count = async (...c: Condition[]) => (await countReach(ada.id, everyone(...c))).reaches;
    expect(await count({ field: "lead_source", ids: [inbound] })).toBe(1);
    expect(await count({ field: "lead_source", ids: [inbound, event] })).toBe(2);
    expect(await count({ field: "label", ids: [old] })).toBe(1);
    expect(await count({ field: "label", ids: [hot, old] })).toBe(2);
    expect(await count({ field: "organisation", ids: [archivedOrg] })).toBe(1);
    expect(await count({ field: "organisation", ids: [99999] })).toBe(0);
    expect(await count({ field: "owner", ids: [alan.id] })).toBe(1);
    expect(await count({ field: "role", text: "chief 50%_" })).toBe(1);
    expect(await count({ field: "role", text: "50%x" })).toBe(0);
    expect(await count({ field: "lead_source", ids: [inbound, event] }, { field: "owner", ids: [ada.id] })).toBe(1);
    expect(await count({ field: "lead_source", ids: [event] }, { field: "label", ids: [hot] })).toBe(0);
    expect([p1, p2].length).toBe(2);
  });

  // covers US2 scenario 1 (custom fields: the People list filter tests), FR-013
  it("matches people custom fields of every type; a deleted or non-person field matches nobody, even Empty", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const text = await makeField({ kind: "person", name: "Nickname", type: "text" });
    const num = await makeField({ kind: "person", name: "Head count", type: "number" });
    const money = await makeField({ kind: "person", name: "Budget", type: "money" });
    const date = await makeField({ kind: "person", name: "Birthday", type: "date" });
    const single = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Vegan", "None", "Fish"], removed: ["Fish"] });
    const multi = await makeField({ kind: "person", name: "Topics", type: "multiple_choice", choices: ["AI", "Events"] });
    const yes = await makeField({ kind: "person", name: "VIP", type: "yes_no" });
    const orgField = await makeField({ kind: "organisation", name: "Code", type: "text" });
    const a = await makePerson({ createdBy: ada.id, emails: mail() });
    const b = await makePerson({ createdBy: ada.id, emails: mail() });
    await makePerson({ createdBy: ada.id, emails: mail() });
    await setValue(text.id, { personId: a }, "text_value", "Big Kim");
    await setValue(num.id, { personId: a }, "number_value", "10.5");
    await setValue(num.id, { personId: b }, "number_value", "20");
    await setValue(money.id, { personId: a }, "money_pence", 400050);
    await setValue(date.id, { personId: a }, "date_value", "2026-03-01");
    await setValue(single.id, { personId: a }, "choice_id", single.choices.Vegan);
    await setValue(single.id, { personId: b }, "choice_id", single.choices.Fish);
    await setValue(multi.id, { personId: a }, "choice_ids", [multi.choices.AI, multi.choices.Events]);
    await setValue(yes.id, { personId: a }, "bool_value", true);
    await setValue(yes.id, { personId: b }, "bool_value", false);
    const count = async (c: Condition) => (await countReach(ada.id, everyone(c))).reaches;
    const cf = (fieldId: number) => ({ field: "custom" as const, fieldId });
    expect(await count({ ...cf(text.id), type: "text", text: "kim" })).toBe(1);
    expect(await count({ ...cf(num.id), type: "number", from: "10.5", to: null })).toBe(2);
    expect(await count({ ...cf(num.id), type: "number", from: null, to: "15" })).toBe(1);
    expect(await count({ ...cf(num.id), type: "number", from: "11", to: "19" })).toBe(0);
    expect(await count({ ...cf(money.id), type: "money", from: "400050", to: "400050" })).toBe(1);
    expect(await count({ ...cf(date.id), type: "date", from: "2026-01-01", to: "2026-02-28" })).toBe(0);
    expect(await count({ ...cf(date.id), type: "date", from: null, to: "2026-03-01" })).toBe(1);
    expect(await count({ ...cf(single.id), type: "single_choice", ids: [single.choices.Vegan], empty: false })).toBe(1);
    expect(await count({ ...cf(single.id), type: "single_choice", ids: [single.choices.Fish], empty: false })).toBe(1);
    expect(await count({ ...cf(single.id), type: "single_choice", ids: [], empty: true })).toBe(1);
    expect(await count({ ...cf(single.id), type: "single_choice", ids: [single.choices.Vegan], empty: true })).toBe(2);
    expect(await count({ ...cf(multi.id), type: "multiple_choice", ids: [multi.choices.Events] })).toBe(1);
    expect(await count({ ...cf(yes.id), type: "yes_no", value: "yes" })).toBe(1);
    expect(await count({ ...cf(yes.id), type: "yes_no", value: "no" })).toBe(1);
    expect(await count({ ...cf(yes.id), type: "yes_no", value: "empty" })).toBe(1);
    // Another type than the field's, a field of organisations, or a deleted field: nobody.
    expect(await count({ ...cf(num.id), type: "text", text: "1" })).toBe(0);
    expect(await count({ ...cf(orgField.id), type: "text", text: "a" })).toBe(0);
    expect(await count({ ...cf(99999), type: "yes_no", value: "empty" })).toBe(0);
    await sql`delete from custom_fields where id = ${yes.id}`;
    expect(await count({ ...cf(yes.id), type: "yes_no", value: "empty" })).toBe(0);
  });
});
