// covers edge case "two users edit the same person at the same time" (research.md §9)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { createPerson, getPerson, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { makeUser, resetDb, type TestUser } from "./db-helpers";
import { personForm, saved } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

describe("concurrent edits", () => {
  it("refuses the second save made from the same version and keeps the first one's values", async () => {
    const id = saved(await createPerson(ada.id, personForm({ role: "COO" })));
    const first = await updatePerson(ada.id, id, 1, personForm({ role: "CEO" }));
    expect(first.status).toBe("saved");
    const second = await updatePerson(linus.id, id, 1, personForm({ role: "CFO" }));
    expect(second).toEqual({ status: "invalid", errors: { form: { code: "edit_conflict" } } });
    const p = await getPerson(ada.id, id);
    expect(p!.role).toBe("CEO");
    expect(p!.version).toBe(2);
    expect(((await readTimeline(ada.id, { personId: id })).entries).map((e) => e.actorName)).toEqual(["Ada Fake", "Ada Fake"]);
  });

  it("lets exactly one of two saves running at the same time win", async () => {
    const id = saved(await createPerson(ada.id, personForm({ role: "COO" })));
    const results = await Promise.all([
      updatePerson(ada.id, id, 1, personForm({ role: "CEO" })),
      updatePerson(linus.id, id, 1, personForm({ role: "CFO" })),
    ]);
    expect(results.filter((r) => r.status === "saved")).toHaveLength(1);
    expect(results.filter((r) => r.status === "invalid")).toHaveLength(1);
    expect((await getPerson(ada.id, id))!.version).toBe(2);
  });
});
