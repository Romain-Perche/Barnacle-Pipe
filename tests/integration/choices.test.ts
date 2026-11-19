// covers FR-020, FR-021, FR-022, SC-006, US6 scenarios 1–5, clarification "adding a removed name brings it back"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { addChoice, listChoices, removeChoice, renameChoice } from "@/server/records/choices";
import { parsePeopleQuery } from "@/server/records/list-query";
import { getPerson, listPeople, peopleFilterOptions, personFormChoices } from "@/server/records/people";
import { count, leadSourceId, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

const names = async (kind: "lead_source" | "label") => (await listChoices(kind)).map((c) => c.name);

describe("lead sources and labels", () => {
  it("start with the six lead sources and no labels (US6 scenario 1, FR-021)", async () => {
    expect(await names("lead_source")).toEqual(["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"]);
    expect(await names("label")).toEqual([]);
  });

  it("adds trimmed names; refuses empty and existing ones ignoring case and spaces (US6 scenario 4)", async () => {
    expect(await addChoice(ada.id, "label", "  Hot ")).toEqual({ ok: true });
    expect(await names("label")).toEqual(["Hot"]);
    expect(await addChoice(ada.id, "label", " hot ")).toEqual({ ok: false, code: "choice_exists" });
    expect(await addChoice(ada.id, "lead_source", " event ")).toEqual({ ok: false, code: "choice_exists" });
    expect(await addChoice(ada.id, "lead_source", "EVENT")).toEqual({ ok: false, code: "choice_exists" });
    expect(await addChoice(ada.id, "label", "   ")).toEqual({ ok: false, code: "choice_name_required" });
    expect(await count("labels")).toBe(1);
    expect(await count("lead_sources")).toBe(6);
  });

  it("renames everywhere it is used (US6 scenario 2)", async () => {
    const event = await leadSourceId("Event");
    const p = await makePerson({ createdBy: ada.id, leadSourceId: event });
    expect(await renameChoice(ada.id, "lead_source", event, " Events ")).toEqual({ ok: true });
    expect((await getPerson(ada.id, p))!.leadSource).toEqual({ id: event, name: "Events" });
    expect(await renameChoice(ada.id, "lead_source", event, "referral")).toEqual({ ok: false, code: "choice_exists" });
    expect(await renameChoice(ada.id, "lead_source", event, "")).toEqual({ ok: false, code: "choice_name_required" });
    expect(await renameChoice(ada.id, "lead_source", event, "EVENTS")).toEqual({ ok: true });
  });

  it("removing stops it being offered; people keep it; filters offer it while used (US6 scenario 3)", async () => {
    const inbound = await leadSourceId("Inbound");
    const p = await makePerson({ createdBy: ada.id, leadSourceId: inbound });
    expect(await removeChoice(ada.id, "lead_source", inbound)).toEqual({ ok: true });
    expect(await names("lead_source")).not.toContain("Inbound");
    expect((await personFormChoices(linus.id, null)).leadSources.map((s) => s.name)).not.toContain("Inbound");
    expect((await getPerson(linus.id, p))!.leadSource).toEqual({ id: inbound, name: "Inbound" });
    expect((await peopleFilterOptions(linus.id, null)).sources.map((s) => s.name)).toContain("Inbound");
    expect((await listPeople(linus.id, parsePeopleQuery({ source: String(inbound) }))).total).toBe(1);
  });

  it("adding the name of a removed entry brings that entry back", async () => {
    const inbound = await leadSourceId("Inbound");
    await removeChoice(ada.id, "lead_source", inbound);
    expect(await addChoice(ada.id, "lead_source", "inbound")).toEqual({ ok: true });
    expect(await names("lead_source")).toContain("Inbound");
    expect(await leadSourceId("Inbound")).toBe(inbound);
    expect(await count("lead_sources")).toBe(6);
  });

  it("refuses renaming to a removed entry's name with its own message; nothing changes (Fix round 1, clarification Q4)", async () => {
    // covers FR-022, Fix round 1
    const inbound = await leadSourceId("Inbound");
    const event = await leadSourceId("Event");
    await removeChoice(ada.id, "lead_source", inbound);
    expect(await renameChoice(ada.id, "lead_source", event, " inbound ")).toEqual({ ok: false, code: "choice_removed_exists" });
    expect(await addChoice(ada.id, "label", "Hot")).toEqual({ ok: true });
    expect(await addChoice(ada.id, "label", "Cold")).toEqual({ ok: true });
    const labels = await listChoices("label");
    const hot = labels.find((c) => c.name === "Hot")!.id;
    const cold = labels.find((c) => c.name === "Cold")!.id;
    await removeChoice(ada.id, "label", cold);
    expect(await renameChoice(ada.id, "label", hot, "COLD")).toEqual({ ok: false, code: "choice_removed_exists" });
    expect(await names("lead_source")).toContain("Event");
    expect(await names("label")).toEqual(["Hot"]);
  });

  it("refuses every change from a non-admin or a deactivated admin; nothing changes (US6 scenario 5, SC-006)", async () => {
    const grace = await makeUser({ email: "grace@barnacle.ai", role: "admin", status: "deactivated" });
    const event = await leadSourceId("Event");
    for (const actor of [linus.id, grace.id]) {
      expect(await addChoice(actor, "label", "Hot")).toEqual({ ok: false, code: "forbidden" });
      expect(await renameChoice(actor, "lead_source", event, "Events")).toEqual({ ok: false, code: "forbidden" });
      expect(await removeChoice(actor, "lead_source", event)).toEqual({ ok: false, code: "forbidden" });
    }
    expect(await names("label")).toEqual([]);
    expect(await names("lead_source")).toContain("Event");
  });
});
