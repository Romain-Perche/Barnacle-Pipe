// covers SF-109 FR-008, FR-009, SC-006, US3 scenarios 1–6, spec Edge Cases (unlinked activity only in the list,
// archived record marked, deactivated assignee) (T034, T036) — every query passes a fixed `now`
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { activityFilterOptions, listActivities } from "@/server/activities/list";
import { scheduleActivity } from "@/server/activities/activities";
import { closeDb, sql } from "@/server/db";
import { parseActivitiesQuery, type ActivitiesQuery } from "@/server/records/list-query";
import { activityForm, makeActivity, okId } from "./activity-helpers";
import { makeOrganisation, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, bob: TestUser, gone: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  gone = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
});
afterAll(closeDb);

const q = (over: Partial<ActivitiesQuery> = {}): ActivitiesQuery => ({ ...parseActivitiesQuery({}), ...over });
const subjects = async (viewer: number, query: ActivitiesQuery, now: Date) => {
  const r = await listActivities(viewer, query, now);
  expect(r.count, "count matches the rows on one page").toBe(r.rows.length);
  return r.rows.map((x) => x.subject);
};

describe("listActivities", () => {
  // Wednesday 25 Nov 2026, 12:00 UK (GMT).
  const now = new Date("2026-11-25T12:00:00Z");
  beforeEach(async () => {
    await makeActivity({ by: ada.id, subject: "Last week", dueOn: "2026-11-18" });
    await makeActivity({ by: ada.id, subject: "Monday", dueOn: "2026-11-23", dueTime: "09:00" });
    await makeActivity({ by: ada.id, subject: "Today 09:00", dueOn: "2026-11-25", dueTime: "09:00" });
    await makeActivity({ by: ada.id, subject: "Today untimed", dueOn: "2026-11-25" });
    await makeActivity({ by: ada.id, subject: "Today 15:00", dueOn: "2026-11-25", dueTime: "15:00" });
    await makeActivity({ by: ada.id, subject: "Sunday", dueOn: "2026-11-29", type: "meeting" });
    await makeActivity({ by: ada.id, subject: "Next Monday", dueOn: "2026-11-30", type: "task" });
    await makeActivity({ by: ada.id, subject: "Done early", dueOn: "2026-11-24", doneAt: new Date("2026-11-24T10:00:00Z") });
    await makeActivity({ by: ada.id, subject: "Done late", dueOn: "2026-11-20", doneAt: new Date("2026-11-25T08:00:00Z") });
    await makeActivity({ by: bob.id, subject: "Bob's", dueOn: "2026-11-25" });
    await makeActivity({ by: ada.id, assignee: gone.id, subject: "Alan's", dueOn: "2026-11-26" });
  });

  it("defaults to the viewer's planned activities, overdue first, then by date and time, untimed last in a day", async () => {
    expect(await subjects(ada.id, q(), now)).toEqual(["Last week", "Monday", "Today 09:00", "Today 15:00", "Today untimed", "Sunday", "Next Monday"]);
    const [first] = (await listActivities(ada.id, q(), now)).rows;
    expect(first.state).toBe("overdue");
  });

  it("filters Overdue, Today, This week, Planned and Done", async () => {
    expect(await subjects(ada.id, q({ when: "overdue" }), now)).toEqual(["Last week", "Monday", "Today 09:00"]);
    expect(await subjects(ada.id, q({ when: "today" }), now)).toEqual(["Today 09:00", "Today 15:00", "Today untimed"]);
    expect(await subjects(ada.id, q({ when: "week" }), now)).toEqual(["Monday", "Today 09:00", "Today 15:00", "Today untimed", "Sunday"]);
    expect(await subjects(ada.id, q({ when: "done" }), now)).toEqual(["Done late", "Done early"]);
  });

  it("filters by assignee (one user, a deactivated one, everyone) and type", async () => {
    expect(await subjects(ada.id, q({ assignee: bob.id }), now)).toEqual(["Bob's"]);
    expect(await subjects(bob.id, q({ assignee: gone.id }), now)).toEqual(["Alan's"]);
    expect((await subjects(bob.id, q({ assignee: "all" }), now))).toHaveLength(9);
    expect(await subjects(ada.id, q({ type: "meeting" }), now)).toEqual(["Sunday"]);
    expect(await subjects(ada.id, q({ assignee: "all", type: "task" }), now)).toEqual(["Next Monday"]);
  });

  it("moves at midnight UK: 23:59 still today, 00:01 overdue", async () => {
    expect(await subjects(ada.id, q({ when: "overdue" }), new Date("2026-11-25T23:59:00Z"))).toEqual(["Last week", "Monday", "Today 09:00", "Today 15:00"]);
    expect(await subjects(ada.id, q({ when: "overdue" }), new Date("2026-11-26T00:01:00Z"))).toEqual(["Last week", "Monday", "Today 09:00", "Today 15:00", "Today untimed"]);
    expect(await subjects(ada.id, q({ when: "today" }), new Date("2026-11-26T00:01:00Z"))).toEqual([]);
  });

  it("is a page of 50 with the total count", async () => {
    for (let i = 0; i < 55; i++) await makeActivity({ by: bob.id, assignee: bob.id, subject: `Bulk ${i}`, dueOn: "2026-12-01" });
    const one = await listActivities(bob.id, q(), now);
    expect([one.rows.length, one.count, one.page, one.pages]).toEqual([50, 56, 1, 2]);
    const two = await listActivities(bob.id, q({ page: 2 }), now);
    expect([two.rows.length, two.page]).toEqual([6, 2]);
  });

  it("lists an activity scheduled with no link, and marks an archived linked record", async () => {
    const id = okId(await scheduleActivity(bob.id, activityForm({ subject: "No link", dueOn: "2026-12-02" })));
    const old = await makeOrganisation({ name: "Old Fakeco", ownerId: ada.id, archived: true });
    await makeActivity({ by: bob.id, subject: "On archived", organisationId: old, dueOn: "2026-12-03" });
    const rows = (await listActivities(bob.id, q({ when: "planned" }), now)).rows;
    expect(rows.map((r) => r.id)).toContain(id);
    expect(rows.find((r) => r.subject === "On archived")).toMatchObject({ organisation: { name: "Old Fakeco", archived: true }, archived: true });
  });
});

// SC-006: on the days the clocks change, "Today" and "Overdue" follow UK time.
describe("listActivities across the clocks changing", () => {
  it("29 Mar 2026: a call at 03:00 BST is overdue from 02:00 UTC", async () => {
    await makeActivity({ by: ada.id, subject: "Spring", dueOn: "2026-03-29", dueTime: "03:00" });
    expect(await subjects(ada.id, q({ when: "overdue" }), new Date("2026-03-29T01:59:00Z"))).toEqual([]);
    expect(await subjects(ada.id, q({ when: "today" }), new Date("2026-03-29T01:59:00Z"))).toEqual(["Spring"]);
    expect(await subjects(ada.id, q({ when: "overdue" }), new Date("2026-03-29T02:00:00Z"))).toEqual(["Spring"]);
  });
  it("25 Oct 2026: an untimed task is today from 23:00 UTC the day before until 23:59 UTC", async () => {
    await makeActivity({ by: ada.id, subject: "Autumn", dueOn: "2026-10-25" });
    expect(await subjects(ada.id, q({ when: "today" }), new Date("2026-10-24T22:59:00Z"))).toEqual([]);
    expect(await subjects(ada.id, q({ when: "today" }), new Date("2026-10-24T23:00:00Z"))).toEqual(["Autumn"]);
    expect(await subjects(ada.id, q({ when: "today" }), new Date("2026-10-25T23:59:00Z"))).toEqual(["Autumn"]);
    expect(await subjects(ada.id, q({ when: "overdue" }), new Date("2026-10-26T00:00:00Z"))).toEqual(["Autumn"]);
  });
  it("a Sunday 23:30 UTC in summer already counts the next UK week", async () => {
    await makeActivity({ by: ada.id, subject: "Monday 6 Jul", dueOn: "2026-07-06" });
    await makeActivity({ by: ada.id, subject: "Sunday 5 Jul", dueOn: "2026-07-05", doneAt: null });
    expect(await subjects(ada.id, q({ when: "week" }), new Date("2026-07-05T23:30:00Z"))).toEqual(["Monday 6 Jul"]);
  });
});

describe("activityFilterOptions", () => {
  it("lists every user A–Z, deactivated ones marked", async () => {
    await sql`update users set name = 'Zed Fake' where id = ${bob.id}`;
    expect((await activityFilterOptions()).map((o) => o.name)).toEqual(["Ada Fake", "Alan Fake (deactivated)", "Zed Fake"]);
  });
});
