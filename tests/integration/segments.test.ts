// SF-120: saved segments (src/server/segments/segments.ts) on the real database: create, list, count, edit by another
// user, concurrent edits, delete, deleted references.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import {
  countDefinition, createSegment, deleteSegment, getSegment, listSegments, segmentFormOptions, updateSegment,
} from "@/server/segments/segments";
import type { SegmentFormValues } from "@/server/segments/rules";
import { leadSourceId, makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeField } from "./custom-helpers";

beforeEach(resetDb);
afterAll(closeDb);

const form = (over: Partial<SegmentFormValues> = {}): SegmentFormValues => ({
  name: "Everyone", who: "everyone", pipelineId: "", stageId: "", dealStatus: "", conditions: [], ...over,
});
const created = async (actor: TestUser, over: Partial<SegmentFormValues> = {}) => {
  const r = await createSegment(actor.id, form(over));
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.id;
};
const segmentRows = () => sql`select name, who, pipeline_id::int as pipeline_id, stage_id::int as stage_id, deal_status, conditions,
  created_by::int as created_by, updated_by::int as updated_by, version from segments order by id`;

describe("create, count and list", () => {
  // covers US1 scenarios 1–4, FR-001, FR-005, FR-007
  it("saves the name, the choice and the conditions (never people), with open first and version 1", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
    const sales = await makePipeline("Sales", ["Lead in", "Proposal"]);
    const inbound = await leadSourceId("Inbound");
    await created(ada, { name: "  Sales — Proposal ", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[1]),
      conditions: [{ field: "lead_source", values: [String(inbound)], from: "", to: "" }] });
    expect(await segmentRows()).toEqual([{
      name: "Sales — Proposal", who: "stage", pipeline_id: sales.id, stage_id: sales.stages[1], deal_status: "open",
      conditions: [{ field: "lead_source", ids: [inbound] }], created_by: ada.id, updated_by: ada.id, version: 1,
    }]);
  });

  // covers US1 scenario 5, FR-005
  it("refuses a name another segment has, ignoring case and outer spaces, also under a race", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    await created(ada, { name: "Exec Dinner — all" });
    expect(await createSegment(ada.id, form({ name: "  exec dinner — ALL " }))).toEqual({
      ok: false, errors: { name: "There is already a segment called exec dinner — ALL." },
    });
    const both = await Promise.all([createSegment(ada.id, form({ name: "Race" })), createSegment(ada.id, form({ name: "RACE" }))]);
    expect(both.filter((r) => r.ok).length).toBe(1);
    expect(both.find((r) => !r.ok)).toMatchObject({ ok: false, errors: { name: expect.stringContaining("There is already a segment called") } });
  });

  // covers US1 scenario 6
  it("asks for a pipeline or stage that exists", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const sales = await makePipeline("Sales", ["Lead in"]);
    expect(await createSegment(ada.id, form({ who: "pipeline", pipelineId: "999" }))).toEqual({ ok: false, errors: { pipelineId: "Choose a pipeline." } });
    expect(await createSegment(ada.id, form({ who: "stage", pipelineId: String(sales.id), stageId: "999" }))).toEqual({ ok: false, errors: { stageId: "Choose a stage." } });
    expect((await segmentRows()).length).toBe(0);
  });

  // covers US1 scenario 3, FR-007
  it("counts a form that is not saved without writing anything", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    await makePerson({ createdBy: ada.id, emails: ["a@example.com"] });
    await makePerson({ createdBy: ada.id, consent: "unsubscribed" });
    expect(await countDefinition(ada.id, form({ name: "" }))).toEqual({ ok: true, reach: { reaches: 1, archived: 0, unsubscribed: 1, noEmail: 0 } });
    expect(await countDefinition(ada.id, form({ who: "pipeline" }))).toEqual({ ok: false, errors: { pipelineId: "Choose a pipeline." } });
    expect((await segmentRows()).length).toBe(0);
  });

  // covers US1 scenario 4, FR-001, FR-008, spec Edge "Nobody reached", "Unsafe input"
  it("lists every segment by name with its summary, count now and who last changed it", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
    const grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake" });
    const sales = await makePipeline("Sales", ["Lead in", "Proposal"]);
    const dinner = await makePipeline("Exec Dinner", ["Invited"]);
    const p = await makePerson({ createdBy: ada.id, emails: ["a@example.com"], role: "CEO" });
    await makeDeal({ title: "D", stageId: dinner.stages[0], createdBy: ada.id, personId: p });
    const inbound = await leadSourceId("Inbound");
    const cond = (field: string, values: string[]) => ({ field, values, from: "", to: "" });
    await created(grace, { name: "Exec Dinner — all", who: "pipeline", pipelineId: String(dinner.id), dealStatus: "all" });
    await created(ada, { name: "Sales — Proposal", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[1]),
      conditions: [cond("lead_source", [String(inbound)]), cond("owner", [String(ada.id)]), cond("role", ["ceo"])] });
    await created(ada, { name: "everyone" });
    await created(ada, { name: "<b>Test</b>" });
    const rows = await listSegments(ada.id);
    expect(rows.map((r) => [r.name, r.summary, r.reaches, r.updatedBy, r.broken])).toEqual([
      ["<b>Test</b>", "Everyone in the CRM", 1, "Ada Fake", false],
      ["everyone", "Everyone in the CRM", 1, "Ada Fake", false],
      ["Exec Dinner — all", "People on all deals of Exec Dinner", 1, "Grace Fake", false],
      ["Sales — Proposal", "People on open deals of Sales · Proposal + 3 conditions", 0, "Ada Fake", false],
    ]);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
    const page = await getSegment(ada.id, rows[3].id);
    expect(page?.description.who).toEqual([{ label: "Deals", value: "Open deals" }, { label: "Pipeline · stage", value: "Sales · Proposal" }]);
    expect(page?.description.conditions.map((c) => c.label)).toEqual(["Lead source", "Owner", "Role"]);
    expect(page?.reach).toEqual({ reaches: 0, archived: 0, unsubscribed: 0, noEmail: 0 });
    expect(await getSegment(ada.id, 999999)).toBeNull();
  });
});

describe("edit and delete", () => {
  // covers US3 scenario 1, FR-006, SC-005
  it("lets another user rename and change any segment; updated_by and version follow", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
    const grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake" });
    const sales = await makePipeline("Sales", ["Lead in", "Proposal"]);
    const id = await created(ada, { name: "Sales", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[0]) });
    const r = await updateSegment(grace.id, id, 1, form({ name: "Sales — Proposal", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[1]), dealStatus: "won" }));
    expect(r).toEqual({ ok: true, id });
    expect(await segmentRows()).toMatchObject([{ name: "Sales — Proposal", stage_id: sales.stages[1], deal_status: "won", created_by: ada.id, updated_by: grace.id, version: 2 }]);
    const [row] = await listSegments(ada.id);
    expect(row).toMatchObject({ name: "Sales — Proposal", summary: "People on won deals of Sales · Proposal", updatedBy: "Grace Fake" });
    // Its own name, in other case, is not "another segment's".
    expect(await updateSegment(ada.id, id, 2, form({ name: "SALES — PROPOSAL" }))).toEqual({ ok: true, id });
    await created(ada, { name: "Other" });
    expect(await updateSegment(ada.id, id, 3, form({ name: "other" }))).toEqual({ ok: false, errors: { name: "There is already a segment called other." } });
  });

  // covers US3 scenarios 2 and 4, FR-012
  it("refuses a save over a newer version or of a deleted segment, saving nothing", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const grace = await makeUser({ email: "grace@barnacle.ai" });
    const id = await created(ada, { name: "One" });
    expect(await updateSegment(grace.id, id, 1, form({ name: "Two" }))).toEqual({ ok: true, id });
    expect(await updateSegment(ada.id, id, 1, form({ name: "Three" }))).toEqual({ ok: false, code: "segment_changed" });
    expect((await segmentRows())[0]).toMatchObject({ name: "Two", version: 2 });
    expect(await deleteSegment(grace.id, id)).toEqual({ ok: true, name: "Two" });
    expect(await updateSegment(ada.id, id, 2, form({ name: "Four" }))).toEqual({ ok: false, code: "segment_not_found" });
    expect(await deleteSegment(ada.id, id)).toEqual({ ok: false, code: "segment_not_found" });
    expect(await countDefinition(ada.id, { ...form(), id })).toEqual({ ok: false, code: "segment_not_found" });
    expect((await segmentRows()).length).toBe(0);
  });

  // covers US3 (deleted references), FR-013, spec Edge "Removed things"
  it("keeps a segment whose pipeline, stage, organisation or field was deleted: listed, (deleted), broken, nobody through it, still savable", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai" });
    const sales = await makePipeline("Sales", ["Lead in", "Proposal"]);
    const org = await makeOrganisation({ name: "Fakeco", ownerId: ada.id });
    const diet = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Vegan"] });
    const p = await makePerson({ createdBy: ada.id, emails: ["a@example.com"], organisationId: org });
    await makeDeal({ title: "D", stageId: sales.stages[1], createdBy: ada.id, personId: p });
    const stageId = await created(ada, { name: "Stage", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[1]) });
    const orgId = await created(ada, { name: "Org", conditions: [{ field: "organisation", values: [String(org)], from: "", to: "" }] });
    const fieldId = await created(ada, { name: "Field", conditions: [{ field: `cf${diet.id}`, values: ["empty"], from: "", to: "" }] });
    expect((await listSegments(ada.id)).map((r) => [r.name, r.reaches, r.broken])).toEqual([["Field", 1, false], ["Org", 1, false], ["Stage", 1, false]]);

    await sql`delete from deals`;
    await sql`delete from stages where id = ${sales.stages[1]}`;
    await sql`update persons set organisation_id = null`;
    await sql`delete from organisations where id = ${org}`;
    await sql`delete from custom_fields where id = ${diet.id}`;
    const rows = await listSegments(ada.id);
    expect(rows.map((r) => [r.name, r.summary, r.reaches, r.broken])).toEqual([
      ["Field", "Everyone in the CRM + 1 condition", 0, true],
      ["Org", "Everyone in the CRM + 1 condition", 0, true],
      ["Stage", "People on open deals of Sales · (deleted)", 0, true],
    ]);
    expect((await getSegment(ada.id, orgId))?.description.conditions).toEqual([{ label: "Organisation", value: "(deleted)" }]);
    expect((await getSegment(ada.id, fieldId))?.description.conditions).toEqual([{ label: "(deleted)", value: "(deleted)" }]);

    // Still savable keeping the stored ids (offered as "(deleted)"), after another change; a new deleted id is refused.
    const options = await segmentFormOptions((await getSegment(ada.id, stageId))!.definition);
    expect(options.pipelines.find((x) => x.id === sales.id)?.stages).toContainEqual({ id: sales.stages[1], name: "(deleted)" });
    expect(await updateSegment(ada.id, stageId, 1, form({ name: "Stage 2", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[1]) }))).toEqual({ ok: true, id: stageId });
    expect(await updateSegment(ada.id, orgId, 1, form({ name: "Org 2", conditions: [{ field: "organisation", values: [String(org)], from: "", to: "" }] }))).toEqual({ ok: true, id: orgId });
    expect(await updateSegment(ada.id, fieldId, 1, form({ name: "Field 2", conditions: [{ field: `cf${diet.id}`, values: ["empty"], from: "", to: "" }] }))).toEqual({ ok: true, id: fieldId });
    expect((await listSegments(ada.id)).every((r) => r.broken)).toBe(true);
    expect(await createSegment(ada.id, form({ name: "New", who: "stage", pipelineId: String(sales.id), stageId: String(sales.stages[1]) }))).toEqual({
      ok: false, errors: { stageId: "Choose a stage." },
    });
  });

  // covers US2 scenario 4, research.md §8
  it("offers current lead sources and labels plus removed ones in the segment, all organisations and users with their marks", async () => {
    const ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
    await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
    await makeOrganisation({ name: "Old Co", ownerId: ada.id, archived: true });
    const event = await leadSourceId("Event");
    const referral = await leadSourceId("Referral");
    await sql`update lead_sources set removed_at = now() where id in (${event}, ${referral})`;
    const fresh = await segmentFormOptions(null);
    expect(fresh.leadSources.map((o) => o.name)).not.toContain("Event (removed)");
    expect(fresh.organisations.map((o) => o.name)).toEqual(["Old Co (archived)"]);
    expect(fresh.owners.map((o) => o.name)).toEqual(["Ada Fake", "Alan Fake (deactivated)"]);
    const kept = await segmentFormOptions({ who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions: [{ field: "lead_source", ids: [event] }] });
    expect(kept.leadSources.map((o) => o.name)).toContain("Event (removed)");
    expect(kept.leadSources.map((o) => o.name)).not.toContain("Referral (removed)");
  });
});
