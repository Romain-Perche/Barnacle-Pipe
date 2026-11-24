// covers FR-001, FR-003, FR-007, US1 scenarios 2–3, US2 scenario 2 (names, choices, values per type)
// covers US2 scenario 3, US3 scenario 1, FR-009 (formatting, list text, timeline events)
// covers FR-013, US5 scenarios 2–4 (CSV cells)
import { describe, expect, it } from "vitest";
import {
  customEvent, formatDay, formatNumber, formatValue, listText, parseImportDate, parseNumber, parseYesNo, readImportCell, validateChoiceName,
  validateCustomValues, validateFieldForm, type CustomField,
} from "@/server/custom-fields/rules";
import { fieldMessage } from "@/server/messages";

const form = (over: Partial<{ name: string; type: string; choices: string; inList: boolean }> = {}) => ({ name: "Diet", type: "text", choices: "", inList: false, ...over });

function field(id: number, type: CustomField["type"], over: Partial<CustomField> = {}): CustomField {
  return { id, kind: "person", name: `Field ${id}`, type, position: id, inList: false, choices: [], ...over };
}
const diet = field(1, "single_choice", {
  name: "Diet",
  choices: [
    { id: 11, name: "None", position: 1, removed: false },
    { id: 12, name: "Vegetarian", position: 2, removed: false },
    { id: 13, name: "Vegan", position: 3, removed: false },
    { id: 14, name: "Pescatarian", position: 4, removed: true },
  ],
});
const topics = field(2, "multiple_choice", {
  name: "Topics",
  choices: [
    { id: 23, name: "Hiring", position: 3, removed: false },
    { id: 21, name: "AI", position: 1, removed: false },
    { id: 22, name: "Events", position: 2, removed: false },
    { id: 24, name: "Old", position: 4, removed: true },
  ],
});

describe("validateFieldForm", () => {
  it("needs a name of 1–60 characters", () => {
    expect(validateFieldForm("person", form({ name: "  " }))).toEqual({ ok: false, errors: { name: { code: "custom_field_name_required" } } });
    expect(validateFieldForm("person", form({ name: "x".repeat(61) }))).toEqual({ ok: false, errors: { name: { code: "custom_field_name_too_long" } } });
    expect(validateFieldForm("person", form({ name: ` ${"x".repeat(60)} ` }))).toMatchObject({ ok: true, value: { name: "x".repeat(60) } });
  });
  it("refuses a built-in name of the kind, ignoring case and end spaces", () => {
    expect(validateFieldForm("person", form({ name: " Email address " }))).toEqual({ ok: false, errors: { name: { code: "custom_field_exists", name: "Email address" } } });
    expect(validateFieldForm("organisation", form({ name: "WEBSITE" }))).toMatchObject({ ok: false, errors: { name: { code: "custom_field_exists" } } });
    expect(validateFieldForm("deal", form({ name: "title" }))).toMatchObject({ ok: false, errors: { name: { code: "custom_field_exists" } } });
    expect(validateFieldForm("deal", form({ name: "Website" }))).toMatchObject({ ok: true });
    expect(fieldMessage({ code: "custom_field_exists", name: "Owner" })).toBe("There is already a field called Owner.");
  });
  it("needs a type", () => {
    expect(validateFieldForm("person", form({ type: "colour" }))).toEqual({ ok: false, errors: { type: { code: "custom_field_type_required" } } });
  });
  it("checks the choices of the two choice types", () => {
    expect(validateFieldForm("person", form({ type: "single_choice", choices: "\n \n" }))).toMatchObject({ errors: { choices: { code: "custom_choices_required" } } });
    expect(validateFieldForm("person", form({ type: "multiple_choice", choices: "Vegan\nvegan" }))).toMatchObject({ errors: { choices: { code: "custom_choice_twice" } } });
    expect(validateFieldForm("person", form({ type: "single_choice", choices: "x".repeat(61) }))).toMatchObject({ errors: { choices: { code: "custom_choice_name_too_long" } } });
    const many = Array.from({ length: 101 }, (_, i) => `C${i}`).join("\n");
    expect(validateFieldForm("person", form({ type: "single_choice", choices: many }))).toMatchObject({ errors: { choices: { code: "custom_choices_limit" } } });
    expect(validateFieldForm("person", form({ type: "single_choice", choices: " None \r\n\nVegan\n", inList: true }))).toEqual({
      ok: true,
      value: { name: "Diet", type: "single_choice", choices: ["None", "Vegan"], inList: true },
    });
    // Other types ignore the choices box.
    expect(validateFieldForm("person", form({ type: "text", choices: "a\na" }))).toMatchObject({ ok: true, value: { choices: [] } });
  });
  it("checks a single choice name", () => {
    expect(validateChoiceName(" ")).toEqual({ ok: false, code: "custom_choice_name_required" });
    expect(validateChoiceName("x".repeat(61))).toEqual({ ok: false, code: "custom_choice_name_too_long" });
    expect(validateChoiceName(" Vegan ")).toEqual({ ok: true, name: "Vegan" });
  });
});

describe("validateCustomValues", () => {
  const check = (f: CustomField, raw: string[], current: Record<number, unknown> = {}) =>
    validateCustomValues([f], { [f.id]: raw }, current as never);
  const err = (f: CustomField, code: string) => ({ ok: false, errors: { [`cf.${f.id}`]: { code, name: f.name } } });

  it("text: at most 255 characters, trimmed", () => {
    const t = field(3, "text");
    expect(check(t, ["x".repeat(255)])).toEqual({ ok: true, values: { 3: "x".repeat(255) } });
    expect(check(t, ["x".repeat(256)])).toEqual(err(t, "custom_text_too_long"));
    expect(check(t, ["  "])).toEqual({ ok: true, values: { 3: null } });
    expect(check(t, [])).toEqual({ ok: true, values: { 3: null } });
  });
  it("long text: at most 10,000 characters, line ends kept as \\n", () => {
    const t = field(4, "long_text", { name: "Notes" });
    expect(check(t, ["x".repeat(10_000)])).toMatchObject({ ok: true });
    expect(check(t, ["x".repeat(10_001)])).toEqual(err(t, "custom_long_text_too_long"));
    expect(check(t, [" a\r\nb \n"])).toEqual({ ok: true, values: { 4: "a\nb" } });
    expect(fieldMessage({ code: "custom_long_text_too_long", name: "Notes" })).toBe("Notes: at most 10,000 characters.");
  });
  it("number: commas, sign, at most 4 decimals, within ±1e12", () => {
    const n = field(5, "number", { name: "Head count" });
    expect(check(n, ["1,234.5"])).toEqual({ ok: true, values: { 5: "1234.5" } });
    expect(check(n, ["-12"])).toEqual({ ok: true, values: { 5: "-12" } });
    expect(check(n, ["0"])).toEqual({ ok: true, values: { 5: "0" } });
    expect(check(n, ["abc"])).toEqual(err(n, "custom_number_invalid"));
    expect(check(n, ["1.23456"])).toEqual(err(n, "custom_number_decimals"));
    expect(check(n, ["1000000000001"])).toEqual(err(n, "custom_number_range"));
    expect(check(n, ["-1000000000000"])).toEqual({ ok: true, values: { 5: "-1000000000000" } });
    expect(fieldMessage({ code: "custom_number_invalid", name: "Head count" })).toBe("Head count: enter a number.");
    expect(parseNumber("1000000000000.5")).toEqual({ ok: false, code: "custom_number_range" });
    expect(parseNumber("1.50000")).toEqual({ ok: true, value: "1.5" });
  });
  it("money: the deal value's rules", () => {
    const m = field(6, "money");
    expect(check(m, ["£4,000.50"])).toEqual({ ok: true, values: { 6: 400050 } });
    expect(check(m, ["0"])).toEqual({ ok: true, values: { 6: 0 } });
    expect(check(m, ["-1"])).toEqual(err(m, "custom_money_invalid"));
  });
  it("date: a real day", () => {
    const d = field(7, "date", { name: "Birthday" });
    expect(check(d, ["2026-02-30"])).toEqual(err(d, "custom_date_invalid"));
    expect(check(d, ["2026-11-24"])).toEqual({ ok: true, values: { 7: "2026-11-24" } });
    expect(fieldMessage({ code: "custom_date_invalid", name: "Birthday" })).toBe("Birthday: enter a real date.");
  });
  it("single choice: an offered choice, or the removed one the record already has", () => {
    expect(check(diet, ["13"])).toEqual({ ok: true, values: { 1: 13 } });
    expect(check(diet, ["99"])).toEqual(err(diet, "custom_choice_invalid"));
    expect(check(diet, ["14"])).toEqual(err(diet, "custom_choice_invalid"));
    expect(check(diet, ["14"], { 1: 14 })).toEqual({ ok: true, values: { 1: 14 } });
    expect(check(diet, [""])).toEqual({ ok: true, values: { 1: null } });
  });
  it("multiple choice: stored in choice order", () => {
    expect(check(topics, ["23", "21"])).toEqual({ ok: true, values: { 2: [21, 23] } });
    expect(check(topics, ["24"])).toEqual(err(topics, "custom_choice_invalid"));
    expect(check(topics, ["24", "22"], { 2: [24] })).toEqual({ ok: true, values: { 2: [22, 24] } });
    expect(check(topics, [])).toEqual({ ok: true, values: { 2: null } });
  });
  it("yes/no", () => {
    const y = field(8, "yes_no");
    expect(check(y, ["yes"])).toEqual({ ok: true, values: { 8: true } });
    expect(check(y, ["no"])).toEqual({ ok: true, values: { 8: false } });
    expect(check(y, [""])).toEqual({ ok: true, values: { 8: null } });
    expect(check(y, ["maybe"])).toEqual(err(y, "custom_choice_invalid"));
  });
  it("keys every error by the field", () => {
    const t = field(3, "text");
    const n = field(5, "number");
    const result = validateCustomValues([t, n], { 3: ["x".repeat(300)], 5: ["x"] }, {});
    expect(result).toEqual({ ok: false, errors: { "cf.3": { code: "custom_text_too_long", name: "Field 3" }, "cf.5": { code: "custom_number_invalid", name: "Field 5" } } });
  });
});

describe("formatting", () => {
  it("numbers and days", () => {
    expect(formatNumber("1234.5000")).toBe("1,234.5");
    expect(formatNumber("0.0000")).toBe("0");
    expect(formatNumber("-12.0000")).toBe("-12");
    expect(formatNumber("-1234567.1234")).toBe("-1,234,567.1234");
    expect(formatDay("2026-11-24")).toBe("24 Nov 2026");
  });
  it("each type, '—' when empty", () => {
    expect(formatValue(field(6, "money"), 400000)).toBe("£4,000");
    expect(formatValue(field(6, "money"), 400050)).toBe("£4,000.50");
    expect(formatValue(field(6, "money"), 0)).toBe("£0");
    expect(formatValue(field(5, "number"), "0")).toBe("0");
    expect(formatValue(topics, [23, 21])).toBe("AI, Hiring");
    expect(formatValue(diet, 14)).toBe("Pescatarian");
    expect(formatValue(field(8, "yes_no"), true)).toBe("Yes");
    expect(formatValue(field(8, "yes_no"), false)).toBe("No");
    expect(formatValue(field(3, "text"), null)).toBe("—");
    expect(formatValue(field(3, "text"), "<b>Fake</b>")).toBe("<b>Fake</b>");
  });
  it("list text cuts long text at 80 characters", () => {
    const t = field(4, "long_text");
    expect(listText(t, "x".repeat(80))).toBe("x".repeat(80));
    expect(listText(t, "x".repeat(81))).toBe(`${"x".repeat(80)}…`);
    expect(listText(field(3, "text"), "x".repeat(200))).toBe("x".repeat(200));
  });
  it("customEvent gives the timeline row", () => {
    expect(customEvent(diet, 13, 13)).toBeNull();
    expect(customEvent(diet, null, undefined)).toBeNull();
    expect(customEvent(topics, [21, 22], [21, 22])).toBeNull();
    expect(customEvent(diet, null, 13)).toEqual({ kind: "custom_set", fieldName: "Diet", oldValue: null, newValue: "Vegan" });
    expect(customEvent(diet, 13, 12)).toEqual({ kind: "custom_changed", fieldName: "Diet", oldValue: "Vegan", newValue: "Vegetarian" });
    expect(customEvent(diet, 13, null)).toEqual({ kind: "custom_cleared", fieldName: "Diet", oldValue: null, newValue: null });
    const notes = field(4, "long_text", { name: "Notes" });
    expect(customEvent(notes, null, "a")).toEqual({ kind: "custom_changed", fieldName: "Notes", oldValue: null, newValue: null });
    expect(customEvent(notes, "a", "b")).toEqual({ kind: "custom_changed", fieldName: "Notes", oldValue: null, newValue: null });
    expect(customEvent(notes, "a", null)).toEqual({ kind: "custom_cleared", fieldName: "Notes", oldValue: null, newValue: null });
    expect(customEvent(field(8, "yes_no", { name: "NDA" }), null, false)).toEqual({ kind: "custom_set", fieldName: "NDA", oldValue: null, newValue: "No" });
  });
});

describe("CSV cells", () => {
  it("choices by name ignoring case, multiple split on , and ;", () => {
    expect(readImportCell(diet, " vegan ")).toEqual({ value: 13 });
    expect(readImportCell(diet, "Pescatarian")).toEqual({ unreadable: true });
    expect(readImportCell(topics, "hiring; ai, Events")).toEqual({ value: [21, 22, 23] });
    expect(readImportCell(topics, "AI, Cooking")).toEqual({ unreadable: true });
    expect(readImportCell(diet, "")).toEqual({ value: null });
  });
  it("yes/no words", () => {
    for (const w of ["yes", "Y", "TRUE", "1"]) expect(parseYesNo(w)).toBe(true);
    for (const w of ["no", "N", "false", "0"]) expect(parseYesNo(w)).toBe(false);
    expect(readImportCell(field(8, "yes_no"), "maybe")).toEqual({ unreadable: true });
  });
  it("money, dates and numbers", () => {
    expect(readImportCell(field(6, "money"), "£4,000.50")).toEqual({ value: 400050 });
    expect(readImportCell(field(6, "money"), "4000")).toEqual({ value: 400000 });
    expect(readImportCell(field(6, "money"), "lots")).toEqual({ unreadable: true });
    expect(parseImportDate("24/11/2026")).toBe("2026-11-24");
    expect(parseImportDate("24 Nov 2026")).toBe("2026-11-24");
    expect(parseImportDate("2026-11-24")).toBe("2026-11-24");
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(readImportCell(field(7, "date"), "soon")).toEqual({ unreadable: true });
    expect(readImportCell(field(5, "number"), "1,234.5")).toEqual({ value: "1234.5" });
    expect(readImportCell(field(5, "number"), "many")).toEqual({ unreadable: true });
  });
  it("text over its limit is too long", () => {
    expect(readImportCell(field(3, "text"), "x".repeat(256))).toEqual({ tooLong: true });
    expect(readImportCell(field(4, "long_text"), "x".repeat(10_001))).toEqual({ tooLong: true });
    expect(readImportCell(field(3, "text"), "fine")).toEqual({ value: "fine" });
  });
});
