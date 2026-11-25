// covers SF-122 FR-004, US1 scenarios 2–3, edge cases (two names differing in case, a name over 100 characters)
import { describe, expect, it } from "vitest";
import type { PdPipeline, PdStage } from "@/server/pipedrive/api";
import { planPipelines } from "@/server/pipedrive/records-page";

let next = 1;
const pl = (name: string, o: Partial<PdPipeline> = {}): PdPipeline => ({ id: next++, name, order: next, deleted: false, ...o });
const st = (pipelineId: number, name: string, order: number, o: Partial<PdStage> = {}): PdStage => ({ id: next++, pipelineId, name, order, deleted: false, ...o });
const crm = {
  pipelines: [{ id: 1, name: "Sales", position: 1 }, { id: 2, name: "Exec Dinner", position: 2 }],
  stages: [
    { id: 11, pipelineId: 1, name: "Lead", position: 1 },
    { id: 12, pipelineId: 1, name: "Won", position: 2 },
    { id: 21, pipelineId: 2, name: "Invited", position: 1 },
  ],
};

describe("planPipelines", () => {
  it("matches pipelines and stages ignoring case and spaces; adds missing stages at the end in Pipedrive's order", () => {
    const sales = pl("Sales");
    const dinner = pl("exec dinner ");
    const stages = [st(sales.id, "Proposal", 3), st(sales.id, " lead", 1), st(sales.id, "Negotiation", 4), st(dinner.id, "INVITED", 1)];
    const plan = planPipelines([sales, dinner], stages, crm);
    expect(plan.newPipelines).toEqual([]);
    expect(plan.newStages).toEqual([
      { pipelineId: 1, name: "Proposal", position: 3 },
      { pipelineId: 1, name: "Negotiation", position: 4 },
    ]);
    expect(plan.stageMap[stages[1].id]).toEqual({ stageId: 11 });
    expect(plan.stageMap[stages[3].id]).toEqual({ stageId: 21 });
    expect(plan.stageMap[stages[0].id]).toEqual({ newStage: 0 });
    expect(plan.report.stagesAdded).toEqual([{ pipeline: "Sales", stage: "Proposal" }, { pipeline: "Sales", stage: "Negotiation" }]);
  });
  it("creates a missing pipeline with all its stages in order at the end, empty ones too; ignores deleted ones", () => {
    const partners = pl("Fake Partners", { order: 9 });
    const empty = pl("Fake Empty", { order: 10 });
    const gone = pl("Gone Fake", { deleted: true });
    const stages = [5, 3, 1, 4, 2].map((o) => st(partners.id, `Step ${o}`, o));
    stages.push(st(partners.id, "Deleted step", 6, { deleted: true }), st(gone.id, "x", 1));
    const plan = planPipelines([partners, empty, gone], stages, crm);
    expect(plan.newPipelines).toEqual([
      { name: "Fake Partners", position: 3, stages: ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"] },
      { name: "Fake Empty", position: 4, stages: [] },
    ]);
    expect(plan.stageMap[stages[0].id]).toEqual({ newPipeline: 0, stage: 4 });
    expect(plan.stageMap[stages[5].id]).toBeUndefined();
    expect(plan.report.pipelinesAdded).toEqual([{ name: "Fake Partners", stages: 5 }, { name: "Fake Empty", stages: 0 }]);
  });
  it("puts two Pipedrive pipelines (or stages) with one name into one, with one warning", () => {
    const a = pl("Fake Pipe");
    const b = pl("fake pipe ");
    const s1 = st(a.id, "Lead", 1);
    const s2 = st(b.id, "lead", 1);
    const s3 = st(a.id, "LEAD ", 2);
    const plan = planPipelines([a, b], [s1, s2, s3], crm);
    expect(plan.newPipelines).toEqual([{ name: "Fake Pipe", position: 3, stages: ["Lead"] }]);
    expect(plan.stageMap[s2.id]).toEqual(plan.stageMap[s1.id]);
    expect(plan.stageMap[s3.id]).toEqual(plan.stageMap[s1.id]);
    expect(plan.report.merged).toEqual([
      { kind: "stage", a: "Lead", b: "LEAD " },
      { kind: "pipeline", a: "Fake Pipe", b: "fake pipe " },
    ]);
  });
  it("does not create a name over 100 characters; its deals' stages explain why", () => {
    const long = pl("p".repeat(101));
    const s = st(long.id, "Lead", 1);
    const sales = pl("Sales");
    const longStage = st(sales.id, "s".repeat(101), 1);
    const plan = planPipelines([long, sales], [s, longStage], crm);
    expect(plan.newPipelines).toEqual([]);
    expect(plan.newStages).toEqual([]);
    expect(plan.stageMap[s.id]).toEqual({ problem: { code: "pipedrive_pipeline_not_created", args: { name: "p".repeat(101) } } });
    expect(plan.stageMap[longStage.id]).toEqual({ problem: { code: "pipedrive_stage_not_created", args: { name: "s".repeat(101) } } });
    expect(plan.report.notCreated).toEqual([{ kind: "pipeline", name: "p".repeat(101) }, { kind: "stage", name: "s".repeat(101) }]);
  });
});
