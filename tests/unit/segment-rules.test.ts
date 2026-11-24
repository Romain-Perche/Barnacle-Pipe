// SF-120 segments, the pure core: reading and checking the form, stored conditions read back, the description.
import { describe, expect, it } from "vitest";
import { messages } from "@/server/messages";
import {
  describeSegment, formToValues, readConditions, readSegmentForm, validateSegmentForm,
  type Definition, type FormOptions, type Names, type SegmentFormValues,
} from "@/server/segments/rules";

const options: FormOptions = {
  pipelines: [
    { id: 1, name: "Sales", stages: [{ id: 11, name: "Lead in" }, { id: 12, name: "Proposal" }] },
    { id: 2, name: "Exec Dinner", stages: [{ id: 21, name: "Invited" }] },
  ],
  leadSources: [{ id: 4, name: "Inbound" }, { id: 5, name: "Event" }],
  labels: [{ id: 7, name: "Hot" }],
  organisations: [{ id: 30, name: "Fakeco (archived)" }],
  owners: [{ id: 40, name: "Ada Fake" }],
  fields: [
    { id: 100, name: "Diet", type: "single_choice", choices: [{ id: 101, name: "Vegan" }, { id: 102, name: "None" }] },
    { id: 110, name: "Topics", type: "multiple_choice", choices: [{ id: 111, name: "AI" }] },
    { id: 120, name: "Head count", type: "number", choices: [] },
    { id: 130, name: "Budget", type: "money", choices: [] },
    { id: 140, name: "Birthday", type: "date", choices: [] },
    { id: 150, name: "Nickname", type: "text", choices: [] },
    { id: 160, name: "VIP", type: "yes_no", choices: [] },
  ],
};

const form = (over: Partial<SegmentFormValues> = {}): SegmentFormValues => ({
  name: "Sales — Proposal", who: "everyone", pipelineId: "", stageId: "", dealStatus: "", conditions: [], ...over,
});
const row = (field: string, values: string[] = [], from = "", to = "") => ({ field, values, from, to });
const errorsOf = (v: ReturnType<typeof validateSegmentForm>) => (v.ok ? {} : v.errors);

describe("readSegmentForm", () => {
  it("reads the fields of contracts/routes.md § Form fields, rows in index order with repeated values", () => {
    const fd = new FormData();
    fd.set("id", "9"); fd.set("version", "3"); fd.set("intent", "count");
    fd.set("name", " X "); fd.set("who", "stage"); fd.set("pipelineId", "1"); fd.set("stageId", "12"); fd.set("dealStatus", "won");
    fd.set("c.1.field", "cf120"); fd.set("c.1.from", "1"); fd.set("c.1.to", "5");
    fd.set("c.0.field", "lead_source"); fd.append("c.0.value", "4"); fd.append("c.0.value", "5");
    const input = readSegmentForm(fd);
    expect(input).toMatchObject({ id: 9, version: 3, intent: "count", name: " X ", who: "stage", pipelineId: "1", stageId: "12", dealStatus: "won" });
    expect(input.conditions).toEqual([row("lead_source", ["4", "5"]), row("cf120", [], "1", "5")]);
    expect(readSegmentForm(new FormData()).intent).toBe("save");
  });
});

// covers US1 scenarios 5 and 6, FR-005, FR-002
describe("validateSegmentForm: name and who", () => {
  it("trims the name and refuses an empty or a 101-character name", () => {
    const ok = validateSegmentForm(form({ name: "  Everyone  " }), options);
    expect(ok.ok && ok.name).toBe("Everyone");
    expect(errorsOf(validateSegmentForm(form({ name: "   " }), options)).name).toBe("Give the segment a name.");
    expect(errorsOf(validateSegmentForm(form({ name: "x".repeat(101) }), options)).name).toBe("A segment name can be at most 100 characters.");
    expect(validateSegmentForm(form({ name: "x".repeat(100) }), options).ok).toBe(true);
  });

  it("treats an unknown who as everyone, drops pipeline, stage and status for everyone, defaults the status to open", () => {
    const a = validateSegmentForm(form({ who: "hack", pipelineId: "1", stageId: "12", dealStatus: "won" }), options);
    expect(a.ok && a.definition).toEqual({ who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions: [] });
    const b = validateSegmentForm(form({ who: "pipeline", pipelineId: "1", stageId: "12", dealStatus: "nope" }), options);
    expect(b.ok && b.definition).toEqual({ who: "pipeline", pipelineId: 1, stageId: null, dealStatus: "open", conditions: [] });
    const c = validateSegmentForm(form({ who: "stage", pipelineId: "1", stageId: "12", dealStatus: "all" }), options);
    expect(c.ok && c.definition).toMatchObject({ who: "stage", pipelineId: 1, stageId: 12, dealStatus: "all" });
  });

  it("asks for a pipeline and a stage; a stage of another pipeline or a made-up id is no stage", () => {
    expect(errorsOf(validateSegmentForm(form({ who: "pipeline" }), options))).toEqual({ pipelineId: "Choose a pipeline." });
    expect(errorsOf(validateSegmentForm(form({ who: "pipeline", pipelineId: "999" }), options))).toEqual({ pipelineId: "Choose a pipeline." });
    expect(errorsOf(validateSegmentForm(form({ who: "stage", pipelineId: "1" }), options))).toEqual({ stageId: "Choose a stage." });
    expect(errorsOf(validateSegmentForm(form({ who: "stage", pipelineId: "1", stageId: "21" }), options))).toEqual({ stageId: "Choose a stage." });
  });
});

// covers US2 scenarios 3–4, spec Edge "Unsafe input"
describe("validateSegmentForm: conditions", () => {
  const one = (r: ReturnType<typeof row>) => validateSegmentForm(form({ conditions: [r] }), options);

  it("keeps each condition type as data-model.md § Condition", () => {
    const v = validateSegmentForm(form({ conditions: [
      row("lead_source", ["4", "5", "4"]), row("label", ["7"]), row("organisation", ["30"]), row("owner", ["40"]),
      row("role", ["  Director "]), row("cf150", ["kim"]), row("cf120", [], "1,000.50", ""), row("cf130", [], "", "4,000.5"),
      row("cf140", [], "2026-01-01", "2026-12-31"), row("cf100", ["101", "empty"]), row("cf110", ["111"]), row("cf160", ["no"]),
      row(""),
    ] }), options);
    expect(v.ok && v.definition.conditions).toEqual([
      { field: "lead_source", ids: [4, 5] }, { field: "label", ids: [7] }, { field: "organisation", ids: [30] }, { field: "owner", ids: [40] },
      { field: "role", text: "Director" },
      { field: "custom", fieldId: 150, type: "text", text: "kim" },
      { field: "custom", fieldId: 120, type: "number", from: "1000.5", to: null },
      { field: "custom", fieldId: 130, type: "money", from: null, to: "400050" },
      { field: "custom", fieldId: 140, type: "date", from: "2026-01-01", to: "2026-12-31" },
      { field: "custom", fieldId: 100, type: "single_choice", ids: [101], empty: true },
      { field: "custom", fieldId: 110, type: "multiple_choice", ids: [111] },
      { field: "custom", fieldId: 160, type: "yes_no", value: "no" },
    ]);
  });

  it("names the field when a value is missing", () => {
    expect(errorsOf(one(row("lead_source")))).toEqual({ "c.0": "Lead source: choose at least one." });
    expect(errorsOf(one(row("role", [" "])))).toEqual({ "c.0": "Role: type the text to look for." });
    expect(errorsOf(one(row("cf150")))).toEqual({ "c.0": "Nickname: type the text to look for." });
    expect(errorsOf(one(row("cf120")))).toEqual({ "c.0": "Head count: give a from or a to." });
    expect(errorsOf(one(row("cf160", ["maybe"])))).toEqual({ "c.0": "VIP: choose Yes, No or Empty." });
    expect(errorsOf(one(row("cf110")))).toEqual({ "c.0": "Topics: choose at least one." });
  });

  it("refuses more than 100 values, text over 200 characters, values of the wrong type and a from after the to", () => {
    expect(errorsOf(one(row("label", Array.from({ length: 101 }, (_, i) => String(i + 1)))))).toEqual({ "c.0": "Label: choose at most 100." });
    expect(errorsOf(one(row("role", ["x".repeat(201)])))).toEqual({ "c.0": "Role: at most 200 characters." });
    expect(one(row("role", ["x".repeat(200)])).ok).toBe(true);
    expect(errorsOf(one(row("cf120", [], "ten")))).toEqual({ "c.0": "Head count: enter a number." });
    expect(errorsOf(one(row("cf130", [], "£x")))).toEqual({ "c.0": "Budget: enter an amount in pounds, for example 4000 or 4000.50." });
    expect(errorsOf(one(row("cf140", [], "2026-02-30")))).toEqual({ "c.0": "Birthday: enter a real date." });
    expect(errorsOf(one(row("cf120", [], "10", "9.5")))).toEqual({ "c.0": "Head count: the from must not be after the to." });
    expect(errorsOf(one(row("cf140", [], "2026-02-02", "2026-02-01")))).toEqual({ "c.0": "Birthday: the from must not be after the to." });
    expect(one(row("cf120", [], "-10", "-9.5")).ok).toBe(true);
  });

  it("refuses more than 20 conditions", () => {
    const rows = Array.from({ length: 21 }, () => row("lead_source", ["4"]));
    expect(errorsOf(validateSegmentForm(form({ conditions: rows }), options))).toEqual({ conditions: "A segment can have at most 20 conditions." });
    expect(validateSegmentForm(form({ conditions: rows.slice(1) }), options).ok).toBe(true);
  });

  it("drops a made-up id or field, never showing it back; a row left with no value is refused as empty", () => {
    const v = validateSegmentForm(form({ conditions: [row("lead_source", ["4", "999", "<b>x</b>"]), row("cf999", ["1"]), row("hack", ["1"])] }), options);
    expect(v.ok && v.definition.conditions).toEqual([{ field: "lead_source", ids: [4] }]);
    const w = validateSegmentForm(form({ conditions: [row("owner", ["999"])] }), options);
    expect(errorsOf(w)).toEqual({ "c.0": "Owner: choose at least one." });
    expect(JSON.stringify(w)).not.toContain("999");
  });
});

describe("readConditions", () => {
  it("keeps the elements that fit a Condition and drops the rest", () => {
    const good = [
      { field: "owner", ids: [1, 2] },
      { field: "role", text: "CEO" },
      { field: "custom", fieldId: 3, type: "number", from: "1.50", to: null },
      { field: "custom", fieldId: 4, type: "single_choice", ids: [], empty: true },
      { field: "custom", fieldId: 5, type: "yes_no", value: "empty" },
    ];
    const bad = [
      null, 3, "x", { field: "owner", ids: [] }, { field: "owner", ids: ["1"] }, { field: "role", text: "" },
      { field: "custom", fieldId: -1, type: "text", text: "a" }, { field: "custom", fieldId: 3, type: "number", from: null, to: null },
      { field: "custom", fieldId: 3, type: "date", from: "2026-13-01", to: null }, { field: "custom", fieldId: 4, type: "single_choice", ids: [], empty: false },
      { field: "custom", fieldId: 5, type: "yes_no", value: "maybe" }, { field: "nope" },
    ];
    expect(readConditions([...good, ...bad])).toEqual([
      good[0], good[1], { field: "custom", fieldId: 3, type: "number", from: "1.5", to: null }, good[3], good[4],
    ]);
    expect(readConditions({})).toEqual([]);
  });
});

const names: Names = {
  pipelines: { 1: { name: "Sales" }, 2: { name: "Exec Dinner" } },
  stages: { 12: { name: "Proposal", pipelineId: 1 } },
  leadSources: { 4: { name: "Inbound", removed: false }, 5: { name: "Event", removed: true } },
  labels: { 7: { name: "Hot", removed: false } },
  organisations: { 30: { name: "Fakeco", archived: true } },
  users: { 40: { name: "Ada Fake", active: true }, 41: { name: "Alan Fake", active: false } },
  fields: {
    100: { name: "Diet", type: "single_choice", choices: { 101: { name: "Vegan", removed: false }, 103: { name: "Pescatarian", removed: true } } },
    120: { name: "Head count", type: "number", choices: {} },
    130: { name: "Budget", type: "money", choices: {} },
  },
};
const def = (over: Partial<Definition>): Definition => ({ who: "everyone", pipelineId: null, stageId: null, dealStatus: null, conditions: [], ...over });

// covers US1 scenario 4, FR-013, spec Edge "Removed things"
describe("describeSegment", () => {
  it("summarises everyone, a pipeline and a stage with its status and the number of conditions", () => {
    expect(describeSegment(def({}), names)).toEqual({
      summary: "Everyone in the CRM", who: [{ label: "Who", value: "Everyone in the CRM" }], conditions: [], broken: false,
    });
    const p = describeSegment(def({ who: "pipeline", pipelineId: 2, dealStatus: "all" }), names);
    expect(p.summary).toBe("People on all deals of Exec Dinner");
    expect(p.who).toEqual([{ label: "Deals", value: "All deals" }, { label: "Pipeline", value: "Exec Dinner" }]);
    const conditions = [{ field: "lead_source" as const, ids: [4] }, { field: "owner" as const, ids: [40] }, { field: "role" as const, text: "CEO" }];
    const s = describeSegment(def({ who: "stage", pipelineId: 1, stageId: 12, dealStatus: "open", conditions }), names);
    expect(s.summary).toBe("People on open deals of Sales · Proposal + 3 conditions");
    expect(s.who).toEqual([{ label: "Deals", value: "Open deals" }, { label: "Pipeline · stage", value: "Sales · Proposal" }]);
    expect(describeSegment(def({ conditions: conditions.slice(0, 1) }), names).summary).toBe("Everyone in the CRM + 1 condition");
  });

  it("lists each condition with its values joined by or, ranges and marks", () => {
    const d = describeSegment(def({ conditions: [
      { field: "lead_source", ids: [4, 5] }, { field: "organisation", ids: [30] }, { field: "owner", ids: [41] }, { field: "role", text: "CEO" },
      { field: "custom", fieldId: 100, type: "single_choice", ids: [101, 103], empty: true },
      { field: "custom", fieldId: 120, type: "number", from: "1000", to: null },
      { field: "custom", fieldId: 130, type: "money", from: "400050", to: "500000" },
    ] }), names);
    expect(d.conditions).toEqual([
      { label: "Lead source", value: "Inbound or Event (removed)" },
      { label: "Organisation", value: "Fakeco (archived)" },
      { label: "Owner", value: "Alan Fake (deactivated)" },
      { label: "Role", value: 'contains "CEO"' },
      { label: "Diet", value: "Vegan or Pescatarian (removed) or Empty" },
      { label: "Head count", value: "from 1,000" },
      { label: "Budget", value: "from £4,000.50 to £5,000" },
    ]);
    expect(d.broken).toBe(false);
  });

  it("shows a deleted pipeline, stage, organisation or field as (deleted) and the segment as broken", () => {
    const pipe = describeSegment(def({ who: "pipeline", pipelineId: 9, dealStatus: "open" }), names);
    expect(pipe).toMatchObject({ summary: "People on open deals of (deleted)", broken: true });
    const stage = describeSegment(def({ who: "stage", pipelineId: 1, stageId: 99, dealStatus: "won" }), names);
    expect(stage).toMatchObject({ summary: "People on won deals of Sales · (deleted)", broken: true });
    const org = describeSegment(def({ conditions: [{ field: "organisation", ids: [30, 31] }] }), names);
    expect(org).toMatchObject({ conditions: [{ label: "Organisation", value: "Fakeco (archived) or (deleted)" }], broken: true });
    const field = describeSegment(def({ conditions: [{ field: "custom", fieldId: 999, type: "text", text: "a" }] }), names);
    expect(field).toMatchObject({ conditions: [{ label: "(deleted)", value: "(deleted)" }], broken: true });
    // A field id that now has another type counts as deleted too.
    expect(describeSegment(def({ conditions: [{ field: "custom", fieldId: 120, type: "text", text: "a" }] }), names).broken).toBe(true);
    expect(messages.segment_broken).toBe("This segment refers to something that was deleted. Edit it before using it.");
  });
});

describe("formToValues", () => {
  it("gives the form's starting values back from a definition, money in pounds", () => {
    const d = def({ who: "stage", pipelineId: 1, stageId: 12, dealStatus: "won", conditions: [
      { field: "label", ids: [7] }, { field: "custom", fieldId: 130, type: "money", from: "400050", to: null },
      { field: "custom", fieldId: 100, type: "single_choice", ids: [101], empty: true },
    ] });
    const v = formToValues(d, "Name");
    expect(v).toEqual({
      name: "Name", who: "stage", pipelineId: "1", stageId: "12", dealStatus: "won",
      conditions: [row("label", ["7"]), row("cf130", [], "4000.50", ""), row("cf100", ["101", "empty"])],
    });
    const again = validateSegmentForm(v, options);
    expect(again.ok && again.definition).toEqual(d);
  });
});
