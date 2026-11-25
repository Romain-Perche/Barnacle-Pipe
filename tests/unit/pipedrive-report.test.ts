// covers SF-122 FR-019, data-model.md § Counts and report: an SF-117 report still reads; pages sum the new counters;
// lines come in their fixed order
import { describe, expect, it } from "vitest";
import { emptyCounts, emptyReport, itemText, mergeReport, pipelineLines, readCounts, readReport, reportLines, type PageReport } from "@/server/pipedrive/report";

const page = (o: Partial<PageReport>): PageReport => ({
  kind: "note", imported: 0, already: 0, notImported: [], linked: [], owners: {}, lists: [], fields: [], choices: [], warnings: [], unsubscribed: [],
  privateOthers: 0, ownerOnly: 0, ...o,
});
const names = { people: new Map([[5, "Ada Fake"]]), organisations: new Map([[6, "Fakeco"]]), deals: new Map([[7, "Fakeco renewal"]]) };

describe("the SF-122 report", () => {
  it("reads an SF-117 report and counts with zeros for the new parts", () => {
    const r = readReport({ notImported: [], owners: {}, privateOthers: 2 });
    expect(r).toMatchObject({ privateOthers: 2, privateDeals: 0, privateOn: { notes: 0, activities: 0, files: 0 }, activityTypes: [], elsewhere: [], pipelinesAdded: [] });
    const c = readCounts({ people: { imported: 3, linked: 1, already: 0, notImported: 0 } });
    expect(c.people.imported).toBe(3);
    expect(c.deals).toEqual({ imported: 0, linked: 0, already: 0, notImported: 0 });
    expect(c.files).toEqual({ imported: 0, linked: 0, already: 0, notImported: 0 });
  });
  it("sums the type, elsewhere, private and per-kind counters of two pages", () => {
    const report = emptyReport();
    const counts = emptyCounts();
    mergeReport(report, counts, page({ kind: "activity", imported: 3, activityTypes: [{ type: "deadline", name: "deadline", records: 2 }], elsewhere: [{ kind: "activity", on: "lead", records: 1 }], privateOn: { activities: 1 } }));
    mergeReport(report, counts, page({ kind: "activity", imported: 2, already: 1, activityTypes: [{ type: "deadline", name: "deadline", records: 4 }, { type: "lunch", name: "lunch", records: 1 }], elsewhere: [{ kind: "activity", on: "lead", records: 2 }], notImported: [{ kind: "activity", pipedriveId: 9, label: "x", code: "pipedrive_no_due_date" }] }));
    mergeReport(report, counts, page({ kind: "deal", imported: 1, privateDeals: 2 }));
    expect(counts.activities).toEqual({ imported: 5, linked: 0, already: 1, notImported: 1 });
    expect(counts.deals.imported).toBe(1);
    expect(report.activityTypes).toEqual([{ type: "deadline", name: "deadline", records: 6 }, { type: "lunch", name: "lunch", records: 1 }]);
    expect(report.elsewhere).toEqual([{ kind: "activity", on: "lead", records: 3 }]);
    expect(report.privateOn.activities).toBe(1);
    expect(report.privateDeals).toBe(2);
  });
  it("names the record a reason is about only when visible", () => {
    expect(itemText({ code: "pipedrive_note_empty", args: { onDeal: 7 } }, names)).toBe("Empty once its formatting is removed. (on Fakeco renewal)");
    expect(itemText({ code: "pipedrive_note_empty", args: { onDeal: 8 } }, names)).toBe("Empty once its formatting is removed. (on a private deal)");
    expect(itemText({ code: "pipedrive_no_due_date", args: { onPerson: 9 } }, names)).toBe("No due date. (on a private person)");
    expect(itemText({ code: "pipedrive_target_deleted", args: { kind: "deal" } }, names)).toBe("Its deal was deleted in the CRM.");
    expect(itemText({ code: "pipedrive_person_not_imported", args: { name: "No Name Fake" } }, names)).toBe("Its person 'No Name Fake' was not imported.");
  });
  it("lists pipelines and the lines in their fixed order", () => {
    const r = emptyReport();
    r.pipelinesAdded.push({ name: "Fake Partners", stages: 5 });
    r.stagesAdded.push({ pipeline: "Sales", stage: "Proposal" });
    r.merged.push({ kind: "pipeline", a: "Sales", b: "sales " });
    r.notCreated.push({ kind: "stage", name: "s" });
    expect(pipelineLines(r).map((l) => l.text)).toEqual([
      "Pipeline 'Fake Partners' added with 5 stages.",
      "Stage 'Proposal' added to the pipeline Sales.",
      "Pipedrive pipelines 'Sales' and 'sales ' were imported into one pipeline.",
      "Stage name 's' is longer than 100 characters: not created.",
    ]);
    r.owners["3"] = { name: "Jane Fake", email: "jane@fake.example", records: 2 };
    r.privateDeals = 2;
    r.privateOn.notes = 4;
    r.activityTypes.push({ type: "deadline", name: "deadline", records: 14 });
    r.elsewhere.push({ kind: "file", on: "email", records: 1 }, { kind: "note", on: "lead", records: 14 });
    r.lists.push({ list: "deal_label", value: "VIP", records: 1 });
    expect(reportLines(r, names).map((l) => l.text)).toEqual([
      "Owner 'Jane Fake' (jane@fake.example) has no CRM user: 2 records given to you.",
      "2 private deals of other owners imported.",
      "4 notes on private records of other owners imported.",
      "Deal label not on the list: 'VIP' (1 deal)",
      "14 'deadline' activities imported as tasks.",
      "14 notes on Pipedrive leads: not imported.",
      "1 file on Pipedrive emails: not imported.",
    ]);
  });
});
