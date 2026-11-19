// covers FR-005, FR-001, FR-002, FR-007 (edited field labels), edge case "£4,000.50 / 4000.5 saved as £4,000.50",
// clarification "largest value £9,999,999,999.99" (research.md §2, data-model.md § Validation)
import { describe, expect, it } from "vitest";
import { changedDealFields, parseMoney, validateDeal, validatePipelineName, type DealFields, type DealForm } from "@/server/deals/rules";

function form(over: Partial<DealForm> = {}): DealForm {
  return {
    title: "Fakeco website",
    value: "",
    pipelineId: "",
    stageId: "",
    organisationId: "",
    newOrganisationName: "",
    personId: "",
    ownerId: "",
    expectedClose: "",
    private: false,
    ...over,
  };
}

describe("parseMoney", () => {
  it("reads pounds and pence into whole pence", () => {
    expect(parseMoney("")).toEqual({ ok: true, pence: null });
    expect(parseMoney("   ")).toEqual({ ok: true, pence: null });
    expect(parseMoney("4000")).toEqual({ ok: true, pence: 400000 });
    expect(parseMoney("£4,000.50")).toEqual({ ok: true, pence: 400050 });
    expect(parseMoney(" 4000.5 ")).toEqual({ ok: true, pence: 400050 });
    expect(parseMoney("4,000")).toEqual({ ok: true, pence: 400000 });
    expect(parseMoney("0")).toEqual({ ok: true, pence: 0 });
    expect(parseMoney("1,234,567.89")).toEqual({ ok: true, pence: 123456789 });
    expect(parseMoney("9999999999.99")).toEqual({ ok: true, pence: 999999999999 });
  });
  it("refuses anything that is not an amount of money", () => {
    for (const raw of ["-1", "abc", "4.001", "4,00", "£", "10000000000", "1e3", "£-5", "4.", ".5", "4 000", "££4", "40,00,000"]) {
      expect(parseMoney(raw), raw).toEqual({ ok: false, code: "deal_value_invalid" });
    }
  });
});

describe("validateDeal", () => {
  it("trims the title and requires it, up to 200 characters", () => {
    const ok = validateDeal(form({ title: "  Fakeco website  " }));
    expect(ok.ok && ok.value.title).toBe("Fakeco website");
    expect(validateDeal(form({ title: "   " }))).toEqual({ ok: false, errors: { title: { code: "deal_title_required" } } });
    expect(validateDeal(form({ title: "x".repeat(201) }))).toEqual({ ok: false, errors: { title: { code: "deal_title_too_long" } } });
    expect(validateDeal(form({ title: "x".repeat(200) })).ok).toBe(true);
  });
  it("gives every refusal at once, next to its field", () => {
    expect(validateDeal(form({ title: "", value: "-5", expectedClose: "2026-02-30" }))).toEqual({
      ok: false,
      errors: { title: { code: "deal_title_required" }, value: { code: "deal_value_invalid" }, expectedClose: { code: "deal_close_date_invalid" } },
    });
  });
  it("accepts an empty or a real YYYY-MM-DD expected close date", () => {
    const empty = validateDeal(form());
    expect(empty.ok && empty.value.expectedClose).toBe(null);
    const real = validateDeal(form({ expectedClose: "2026-12-15" }));
    expect(real.ok && real.value.expectedClose).toBe("2026-12-15");
    for (const bad of ["2026-02-30", "15/12/2026", "2026-13-01", "tomorrow", "2026-1-5"]) {
      expect(validateDeal(form({ expectedClose: bad })).ok, bad).toBe(false);
    }
    const leap = validateDeal(form({ expectedClose: "2028-02-29" }));
    expect(leap.ok).toBe(true);
  });
  it("reads ids, the value and the private flag", () => {
    const v = validateDeal(form({ value: "£4,000", pipelineId: "3", stageId: "7", organisationId: "2", personId: "9", ownerId: "4", private: true }));
    expect(v).toEqual({
      ok: true,
      value: {
        title: "Fakeco website",
        valuePence: 400000,
        pipelineId: 3,
        stageId: 7,
        organisationId: 2,
        newOrganisationName: null,
        personId: 9,
        ownerId: 4,
        expectedClose: null,
        private: true,
      },
    });
    const typed = validateDeal(form({ organisationId: "", newOrganisationName: "  New Fakeco  ", personId: "abc", stageId: "-1" }));
    expect(typed.ok && typed.value).toMatchObject({ organisationId: null, newOrganisationName: "New Fakeco", personId: null, stageId: null });
  });
});

describe("validatePipelineName", () => {
  it("trims, requires a name and keeps it to 100 characters", () => {
    expect(validatePipelineName("  Sales  ")).toEqual({ ok: true, name: "Sales" });
    expect(validatePipelineName("   ")).toEqual({ ok: false, code: "pipeline_name_required" });
    expect(validatePipelineName("x".repeat(150))).toEqual({ ok: true, name: "x".repeat(100) });
  });
});

describe("changedDealFields", () => {
  const before: DealFields = {
    title: "Fakeco website",
    valuePence: 400000,
    pipelineId: null,
    stageId: null,
    organisationId: 1,
    newOrganisationName: null,
    personId: 2,
    ownerId: 3,
    expectedClose: null,
    private: false,
  };
  it("lists only the labels of changed fields, in form order", () => {
    expect(changedDealFields(before, { ...before })).toEqual([]);
    expect(changedDealFields(before, { ...before, valuePence: 500000 })).toEqual(["Value"]);
    expect(
      changedDealFields(before, {
        ...before,
        private: true,
        title: "Other",
        expectedClose: "2026-12-15",
        ownerId: 4,
        personId: null,
        organisationId: 5,
        valuePence: null,
      }),
    ).toEqual(["Title", "Value", "Organisation", "Person", "Owner", "Expected close date", "Private"]);
  });
});

// covers FR-013, FR-019, edge case "an address naming a pipeline or deal that does not exist: no text from the address is shown"
import { boardHref, parseBoardQuery } from "@/server/deals/rules";
describe("parseBoardQuery and boardHref", () => {
  it("reads numeric ids only and allow-listed error codes", () => {
    expect(parseBoardQuery({ pipeline: "3", open: "12", confirm: "delete", error: "deal_changed" })).toEqual({
      pipeline: 3, open: 12, confirmDelete: true, error: "deal_changed",
    });
    expect(parseBoardQuery({ pipeline: "abc", open: "<script>", confirm: "delete", error: "Hello there" })).toEqual({
      pipeline: null, open: null, confirmDelete: false, error: null,
    });
    expect(parseBoardQuery({ pipeline: ["4", "5"], error: "deal_deleted" })).toMatchObject({ pipeline: 4, error: null });
    expect(parseBoardQuery({})).toEqual({ pipeline: null, open: null, confirmDelete: false, error: null });
  });
  it("builds board addresses from ids", () => {
    expect(boardHref(null)).toBe("/deals");
    expect(boardHref(3)).toBe("/deals?pipeline=3");
    expect(boardHref(3, { open: 12 })).toBe("/deals?pipeline=3&open=12");
    expect(boardHref(3, { open: 12, confirm: "delete" })).toBe("/deals?pipeline=3&open=12&confirm=delete");
    expect(boardHref(3, { error: "deal_changed" })).toBe("/deals?pipeline=3&error=deal_changed");
  });
});
