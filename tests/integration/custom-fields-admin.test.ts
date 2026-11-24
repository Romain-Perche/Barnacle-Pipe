// covers FR-001, FR-002, FR-003, FR-005, FR-014, US1 scenarios 1–8, US3 scenario 5, edge case "two admins rename"
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import {
  addField, addFieldChoice, fieldCounts, getField, listFields, moveField, moveFieldChoice, removeFieldChoice, renameFieldChoice, updateField,
} from "@/server/custom-fields/fields";
import { CUSTOM_TYPES } from "@/server/custom-fields/rules";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeField } from "./custom-helpers";

let ada: TestUser;
let linus: TestUser;
let alan: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", role: "admin", status: "deactivated" });
});
afterAll(closeDb);

const add = (kind: "person" | "organisation" | "deal", name: string, type = "text", over: { choices?: string; inList?: boolean } = {}) =>
  addField(ada.id, kind, { name, type, choices: over.choices ?? "", inList: over.inList ?? false });
const shape = async (kind: "person" | "organisation" | "deal") =>
  (await listFields(kind)).map((f) => ({ name: f.name, type: f.type, position: f.position, inList: f.inList }));

describe("adding fields", () => {
  it("adds each of the eight types at the end, counted per kind (US1 scenario 1)", async () => {
    for (const type of CUSTOM_TYPES) {
      const r = await add("person", `F ${type}`, type, { choices: "A\nB" });
      expect(r.ok, type).toBe(true);
    }
    expect((await shape("person")).map((f) => [f.type, f.position])).toEqual(CUSTOM_TYPES.map((t, i) => [t, i + 1]));
    expect((await listFields("person")).find((f) => f.type === "single_choice")!.choices.map((c) => [c.name, c.position])).toEqual([["A", 1], ["B", 2]]);
    expect((await listFields("person")).find((f) => f.type === "text")!.choices).toEqual([]);
    await add("deal", "Contract end", "date");
    expect(await fieldCounts()).toEqual({ person: 8, organisation: 0, deal: 1 });
  });

  it("refuses names that are empty, too long, built-in or taken in the kind (US1 scenario 2)", async () => {
    expect(await add("person", " ")).toMatchObject({ ok: false, code: "custom_field_name_required" });
    expect(await add("person", "x".repeat(61))).toMatchObject({ ok: false, code: "custom_field_name_too_long" });
    expect(await add("person", " owner ")).toMatchObject({ ok: false, errors: { name: { code: "custom_field_exists", name: "owner" } } });
    expect(await add("person", "Diet")).toMatchObject({ ok: true });
    expect(await add("person", " DIET ")).toMatchObject({ ok: false, errors: { name: { code: "custom_field_exists", name: "DIET" } } });
    expect(await add("deal", "Diet")).toMatchObject({ ok: true });
    expect(await fieldCounts()).toEqual({ person: 1, organisation: 0, deal: 1 });
  });

  it("needs choices for the choice types (US1 scenario 3)", async () => {
    expect(await add("person", "Diet", "single_choice")).toMatchObject({ ok: false, errors: { choices: { code: "custom_choices_required" } } });
    expect(await add("person", "Diet", "multiple_choice", { choices: "A\na" })).toMatchObject({ ok: false, errors: { choices: { code: "custom_choice_twice" } } });
    expect(await fieldCounts()).toEqual({ person: 0, organisation: 0, deal: 0 });
  });

  it("refuses the 51st field of a kind (FR-005)", async () => {
    for (let i = 1; i <= 50; i++) await makeField({ kind: "organisation", name: `F${i}`, type: "text" });
    expect(await add("organisation", "One more")).toMatchObject({ ok: false, code: "custom_fields_limit" });
    expect(await add("person", "One more")).toMatchObject({ ok: true });
  });
});

describe("changing fields", () => {
  it("renames, never changes the type, and keeps the in-list tick (US1 scenarios 4 and 7)", async () => {
    const r = await add("person", "Dietary needs", "single_choice", { choices: "None\nVegetarian\nVegan" });
    if (!r.ok) throw new Error("not added");
    expect(await updateField(ada.id, r.id, { name: "Diet", inList: true })).toMatchObject({ ok: true });
    expect(await getField(r.id)).toMatchObject({ name: "Diet", type: "single_choice", inList: true });
    expect(await updateField(ada.id, r.id, { name: "Email", inList: true })).toMatchObject({ ok: false, code: "custom_field_exists" });
    await add("person", "Birthday", "date");
    expect(await updateField(ada.id, r.id, { name: "birthday", inList: true })).toMatchObject({ ok: false, code: "custom_field_exists" });
    expect(await updateField(ada.id, r.id, { name: "diet", inList: false })).toMatchObject({ ok: true });
    expect(await getField(r.id)).toMatchObject({ name: "diet", inList: false });
  });

  it("moves fields up and down, renumbering 1..n (US1 scenario 5)", async () => {
    const ids = [];
    for (const name of ["A", "B", "C"]) ids.push((await makeField({ kind: "person", name, type: "text" })).id);
    await moveField(ada.id, ids[2], "up");
    expect((await shape("person")).map((f) => [f.name, f.position])).toEqual([["A", 1], ["C", 2], ["B", 3]]);
    await moveField(ada.id, ids[0], "up"); // already first
    await moveField(ada.id, ids[0], "down");
    expect((await shape("person")).map((f) => [f.name, f.position])).toEqual([["C", 1], ["A", 2], ["B", 3]]);
  });

  it("shows at most 8 fields in a list (US3 scenario 5)", async () => {
    for (let i = 1; i <= 8; i++) await makeField({ kind: "deal", name: `F${i}`, type: "text", inList: true });
    const ninth = await makeField({ kind: "deal", name: "F9", type: "text" });
    expect(await updateField(ada.id, ninth.id, { name: "F9", inList: true })).toMatchObject({ ok: false, code: "custom_list_limit", errors: { inList: { code: "custom_list_limit" } } });
    expect(await getField(ninth.id)).toMatchObject({ inList: false });
    expect(await add("deal", "F10", "text", { inList: true })).toMatchObject({ ok: false, code: "custom_list_limit" });
    // A field already in the list can still be renamed.
    const [first] = await listFields("deal");
    expect(await updateField(ada.id, first.id, { name: "First", inList: true })).toMatchObject({ ok: true });
  });

  it("two renames one after the other: the last wins, listed once, order kept (edge case)", async () => {
    const a = await makeField({ kind: "person", name: "A", type: "text" });
    await makeField({ kind: "person", name: "B", type: "text" });
    await Promise.all([updateField(ada.id, a.id, { name: "First", inList: false }), updateField(ada.id, a.id, { name: "Second", inList: false })]);
    await updateField(ada.id, a.id, { name: "Last", inList: false });
    expect((await shape("person")).map((f) => [f.name, f.position])).toEqual([["Last", 1], ["B", 2]]);
  });
});

describe("choices", () => {
  it("adds, renames, moves and removes choices like labels (US1 scenario 6)", async () => {
    const f = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["None", "Vegetarian", "Vegan"] });
    const names = async () => (await getField(f.id))!.choices.map((c) => `${c.name}${c.removed ? " (removed)" : ""}`);
    expect(await addFieldChoice(ada.id, f.id, " Pescatarian ")).toMatchObject({ ok: true });
    expect(await addFieldChoice(ada.id, f.id, "vegan")).toMatchObject({ ok: false, code: "custom_choice_exists", name: "vegan" });
    expect(await renameFieldChoice(ada.id, f.choices.Vegan, "Plant based")).toMatchObject({ ok: true });
    expect(await renameFieldChoice(ada.id, f.choices.Vegan, "none")).toMatchObject({ ok: false, code: "custom_choice_exists" });
    expect(await moveFieldChoice(ada.id, f.choices.Vegetarian, "up")).toMatchObject({ ok: true });
    expect(await names()).toEqual(["Vegetarian", "None", "Plant based", "Pescatarian"]);
    expect(await removeFieldChoice(ada.id, f.choices.None)).toMatchObject({ ok: true });
    expect(await renameFieldChoice(ada.id, f.choices.Vegetarian, "NONE")).toMatchObject({ ok: false, code: "custom_choice_removed_exists" });
    // Moving skips over removed choices.
    expect(await moveFieldChoice(ada.id, f.choices.Vegan, "up")).toMatchObject({ ok: true });
    expect(await names()).toEqual(["Plant based", "None (removed)", "Vegetarian", "Pescatarian"]);
    // Adding a removed choice's name brings it back, at the end.
    expect(await addFieldChoice(ada.id, f.id, "none")).toMatchObject({ ok: true });
    expect(await names()).toEqual(["Plant based", "Vegetarian", "Pescatarian", "None"]);
    expect((await getField(f.id))!.choices.map((c) => c.position)).toEqual([1, 3, 4, 5]);
  });

  it("keeps at least one offered choice and at most 100 (FR-003, FR-005)", async () => {
    const f = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["Only"] });
    expect(await removeFieldChoice(ada.id, f.choices.Only)).toMatchObject({ ok: false, code: "custom_choice_last" });
    const many = await makeField({ kind: "person", name: "Many", type: "multiple_choice", choices: Array.from({ length: 100 }, (_, i) => `C${i}`) });
    expect(await addFieldChoice(ada.id, many.id, "C100")).toMatchObject({ ok: false, code: "custom_choices_limit" });
    expect(await addFieldChoice(ada.id, f.id, " ")).toMatchObject({ ok: false, code: "custom_choice_name_required" });
    const text = await makeField({ kind: "person", name: "Text", type: "text" });
    expect(await addFieldChoice(ada.id, text.id, "A")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("admins only (US1 scenario 8, FR-014)", () => {
  it("refuses every change from a user or a deactivated admin, with nothing changed", async () => {
    const f = await makeField({ kind: "person", name: "Diet", type: "single_choice", choices: ["A", "B"] });
    const before = await sql`select * from custom_fields order by id`;
    const choicesBefore = await sql`select * from custom_field_choices order by id`;
    for (const actor of [linus, alan]) {
      const calls = [
        addField(actor.id, "person", { name: "New", type: "text", choices: "", inList: false }),
        updateField(actor.id, f.id, { name: "Renamed", inList: true }),
        moveField(actor.id, f.id, "down"),
        addFieldChoice(actor.id, f.id, "C"),
        renameFieldChoice(actor.id, f.choices.A, "Z"),
        moveFieldChoice(actor.id, f.choices.B, "up"),
        removeFieldChoice(actor.id, f.choices.A),
      ];
      for (const r of await Promise.all(calls)) expect(r).toEqual({ ok: false, code: "forbidden" });
    }
    expect(await sql`select * from custom_fields order by id`).toEqual(before);
    expect(await sql`select * from custom_field_choices order by id`).toEqual(choicesBefore);
  });
});
