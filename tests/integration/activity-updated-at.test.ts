// covers SF-124 FR-011, T016 (data-model.md § Activity): editActivity, tickActivity and untickActivity move the
// activity's updated_at forward (the later change wins against Google); a refused edit does not.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { editActivity, scheduleActivity, tickActivity, untickActivity } from "@/server/activities/activities";
import { closeDb, sql } from "@/server/db";
import { makeUser, resetDb } from "./db-helpers";

let ada: { id: number };
let id: number;
const form = { type: "call", subject: "Fake call", dueOn: "2030-01-10", dueTime: "10:00", duration: "30", assigneeId: "", note: "", dealId: "", personId: "", organisationId: "" };
const stamp = async () => (await sql<{ at: Date; version: number }[]>`select updated_at as at, version from activities where id = ${id}`)[0];
// Puts updated_at in the past, so a change made now is later.
const age = () => sql`update activities set updated_at = now() - interval '1 hour' where id = ${id}`;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  const r = await scheduleActivity(ada.id, form);
  if (r.status !== "ok") throw new Error(r.status);
  id = r.id;
  await age();
});
afterAll(closeDb);

describe("activities.updated_at", () => {
  const none = async () => {};
  it.each<[string, () => Promise<unknown>, () => Promise<void>]>([
    ["edit", none, async () => expect((await editActivity(ada.id, id, (await stamp()).version, { ...form, subject: "Edited" })).status).toBe("ok")],
    ["tick", none, async () => expect((await tickActivity(ada.id, id)).status).toBe("ok")],
    ["untick", async () => (await tickActivity(ada.id, id), await age()), async () => expect((await untickActivity(ada.id, id)).status).toBe("ok")],
  ])("%s moves it forward", async (_name, prepare, change) => {
    await prepare();
    const before = (await stamp()).at;
    await change();
    expect((await stamp()).at.getTime()).toBeGreaterThan(before.getTime());
  });
  it("a refused edit (version conflict) leaves it", async () => {
    const before = await stamp();
    expect((await editActivity(ada.id, id, before.version + 5, { ...form, subject: "Late" })).status).toBe("conflict");
    expect((await stamp()).at.getTime()).toBe(before.at.getTime());
  });
});
