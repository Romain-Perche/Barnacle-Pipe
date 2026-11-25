// covers SF-122 FR-005, FR-007, FR-008, US1 scenarios 4, 6, 8, 9, 11, edge cases (title, value, close date, lost reason)
import { describe, expect, it } from "vitest";
import type { PdDeal } from "@/server/pipedrive/api";
import { dealFromPipedrive, type DealCtx } from "@/server/pipedrive/deal-rules";
import { planFields } from "@/server/pipedrive/rules";

const NOW = new Date("2026-11-24T12:00:00Z");
const deal = (d: Partial<PdDeal> = {}): PdDeal => ({
  id: 7, title: "Fakeco renewal", ownerId: 1, personId: null, orgId: null, stageId: 10, value: null, currency: "GBP", addTime: "2025-01-02 03:04:05",
  updateTime: "2025-06-01 00:00:00", stageChangeTime: "", status: "open", lostReason: "", visibleTo: 3, wonTime: "", lostTime: "", closeTime: "",
  expectedCloseDate: "", labelIds: [], archived: false, deleted: false, followersCount: 0, participantsCount: 0, custom: {}, ...d,
});
const ctx = (over: Partial<DealCtx> = {}): DealCtx => ({
  importerId: 100,
  users: new Map([["linus@barnacle.ai", 101], ["margaret@barnacle.ai", 102]]),
  pdUsers: { "1": { name: "Fake Person", email: "linus@barnacle.ai" }, "2": { name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" }, "3": { name: "Jane Fake", email: "jane@fake.example" } },
  owners: {},
  stageMap: { "10": 500 },
  labels: new Map([["hot", 1], ["vip", 2]]),
  fields: planFields("deal", [{ code: "label", name: "Label", type: "set", custom: false, options: [{ id: 1, label: " HOT " }, { id: 2, label: "Cold" }] }], []),
  now: NOW,
  ...over,
});
const ok = (d: PdDeal, c = ctx()) => {
  const r = dealFromPipedrive(d, c);
  if (!r.ok) throw new Error(r.problem.code);
  return r;
};

describe("dealFromPipedrive", () => {
  it("trims the title and refuses an empty or too long one with the form's messages", () => {
    expect(ok(deal({ title: "  Fakeco renewal " })).deal.title).toBe("Fakeco renewal");
    expect(dealFromPipedrive(deal({ title: "  " }), ctx())).toMatchObject({ ok: false, label: "#7", problem: { code: "deal_title_required" } });
    expect(dealFromPipedrive(deal({ title: "x".repeat(201) }), ctx())).toMatchObject({ ok: false, problem: { code: "deal_title_too_long" } });
  });
  it("keeps a GBP value in pence; leaves out another currency, a negative or too large value with a warning", () => {
    expect(ok(deal({ value: 1234.5 })).deal.valuePence).toBe(123450);
    expect(ok(deal({ value: 0 })).deal.valuePence).toBeNull();
    const usd = ok(deal({ value: 10, currency: "USD" }));
    expect(usd.deal.valuePence).toBeNull();
    expect(usd.warnings).toEqual([{ code: "pipedrive_deal_currency", args: { currency: "USD" } }]);
    for (const value of [-5, 1e13, 1.234]) {
      const r = ok(deal({ value }));
      expect(r.deal.valuePence).toBeNull();
      expect(r.warnings[0]).toMatchObject({ code: "pipedrive_value_invalid", args: { field: "value" } });
    }
  });
  it("leaves out an invalid expected close date with a warning", () => {
    expect(ok(deal({ expectedCloseDate: "2026-12-31" })).deal.expectedClose).toBe("2026-12-31");
    const r = ok(deal({ expectedCloseDate: "2026-02-30" }));
    expect(r.deal.expectedClose).toBeNull();
    expect(r.warnings).toEqual([{ code: "pipedrive_value_invalid", args: { field: "expected close date", value: "2026-02-30" } }]);
  });
  it("dates: created at add_time, in its stage since stage_change_time or add_time", () => {
    expect(ok(deal()).deal.createdAt).toEqual(new Date("2025-01-02T03:04:05Z"));
    expect(ok(deal()).deal.stageEnteredAt).toEqual(new Date("2025-01-02T03:04:05Z"));
    expect(ok(deal({ stageChangeTime: "2025-03-01 10:00:00" })).deal.stageEnteredAt).toEqual(new Date("2025-03-01T10:00:00Z"));
    expect(ok(deal({ addTime: "" })).deal.createdAt).toEqual(NOW);
  });
  it("won and lost with their dates and reasons; open stays open", () => {
    expect(ok(deal()).deal).toMatchObject({ status: "open", closedAt: null, lostReason: null });
    expect(ok(deal({ status: "won", wonTime: "2025-05-05 05:05:05" })).deal).toMatchObject({ status: "won", closedAt: new Date("2025-05-05T05:05:05Z") });
    expect(ok(deal({ status: "lost", lostTime: "2025-04-04 04:04:04", lostReason: " Too dear " })).deal).toMatchObject({
      status: "lost", closedAt: new Date("2025-04-04T04:04:04Z"), lostReason: "Too dear",
    });
    expect(ok(deal({ status: "lost", lostTime: "2025-04-04 04:04:04" })).deal.lostReason).toBe("No reason given in Pipedrive.");
    const long = ok(deal({ status: "lost", lostReason: "x".repeat(501) }));
    expect(long.deal.lostReason).toBe("Lost reason too long to import from Pipedrive.");
    expect(long.warnings).toEqual([{ code: "pipedrive_lost_reason_too_long" }]);
    expect(ok(deal({ status: "lost", closeTime: "2025-04-01 00:00:00" })).deal.closedAt).toEqual(new Date("2025-04-01T00:00:00Z"));
  });
  it("archived deals come in archived", () => {
    expect(ok(deal({ archived: true })).deal.archivedAt).toEqual(new Date("2025-06-01T00:00:00Z"));
    expect(ok(deal()).deal.archivedAt).toBeNull();
  });
  it("owner-only → private with the owner as creator; else shared with the importer as creator", () => {
    expect(ok(deal({ visibleTo: 1, ownerId: 2 })).deal).toMatchObject({ private: true, ownerId: 102, createdBy: 102 });
    const c = ctx();
    expect(ok(deal({ visibleTo: 1, ownerId: 3 }), c).deal).toMatchObject({ private: true, ownerId: 100, createdBy: 100 });
    expect(c.owners["3"]).toMatchObject({ name: "Jane Fake", records: 1 });
    expect(ok(deal({ ownerId: 2 })).deal).toMatchObject({ private: false, ownerId: 102, createdBy: 100 });
  });
  it("matches labels to offered deal labels ignoring case and spaces; lists the others", () => {
    const r = ok(deal({ labelIds: [1, 2, 99] }));
    expect(r.labelIds).toEqual([1]);
    expect(r.missingLabels).toEqual(["Cold"]);
  });
  it("needs a mapped stage; explains a stage that could not be created", () => {
    expect(dealFromPipedrive(deal({ stageId: 11 }), ctx())).toMatchObject({ ok: false, problem: { code: "pipedrive_stage_missing" } });
    const c = ctx({ stageMap: { "10": { code: "pipedrive_pipeline_not_created", args: { name: "x" } } } });
    expect(dealFromPipedrive(deal(), c)).toMatchObject({ ok: false, problem: { code: "pipedrive_pipeline_not_created", args: { name: "x" } } });
  });
});
