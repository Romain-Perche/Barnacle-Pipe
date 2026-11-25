// covers SF-122 FR-011–FR-013, US3 scenarios 1–6, SC-003, SC-006, edge cases (subject, due date, duration, note, private
// record, archived deal): calls, meetings, tasks and other types imported with UK times, done or not, the right assignee
// and links, no notification, Last contacted raised and never lowered
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cardLine } from "@/server/activities/rules";
import { listActivities as listCrmActivities } from "@/server/activities/list";
import { getActivity } from "@/server/activities/activities";
import { closeDb, sql } from "@/server/db";
import { getBoard } from "@/server/deals/deals";
import { unreadCount } from "@/server/notifications";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { getImportView } from "@/server/pipedrive/imports";
import { itemText, namesForReport, reportLines, warningLines } from "@/server/pipedrive/report";
import { readTimeline } from "@/server/records/timeline";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makePerson, makeUser, resetDb } from "./db-helpers";
import { makePipeline } from "./deal-helpers";
import { COMPANY, connect, fakeCompany, linkTarget, LINUS_TOKEN, runToEnd, start } from "./pipedrive-helpers";

const NOW = new Date("2026-11-24T12:00:00Z");

function seedActivitiesSet(fake: FakePipedrive) {
  fakeCompany(fake);
  const pipeline = fake.addPipeline(COMPANY, { name: "Sales" });
  const stage = fake.addStage(COMPANY, { pipeline_id: pipeline, name: "Lead" });
  const e = (value: string) => [{ value, primary: true, label: "work" }];
  const org = fake.addOrganization(COMPANY, { name: "Activities Org Fake", owner_id: 1 });
  const person = fake.addPerson(COMPANY, { first_name: "Abe", last_name: "Actfake", owner_id: 1, org_id: org, emails: e("abe@fake.example") });
  const contacted = fake.addPerson(COMPANY, { first_name: "Cy", last_name: "Contactfake", owner_id: 1, emails: e("cy.contacted@fake.example") });
  const noName = fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "", owner_id: 1, emails: e("noname.act@fake.example") });
  const deal = fake.addDeal(COMPANY, { title: "Activities fake deal", owner_id: 1, stage_id: stage, person_id: person, org_id: org });
  const archivedDeal = fake.addDeal(COMPANY, { title: "Archived act deal", owner_id: 1, stage_id: stage, is_archived: true });
  const notDeal = fake.addDeal(COMPANY, { title: "Not imported act deal", owner_id: 1, stage_id: stage, person_id: noName });
  const A = (o: Parameters<FakePipedrive["addActivity"]>[1]) => fake.addActivity(COMPANY, o);
  const act = {
    call: A({ subject: "Call Abe", type: "call", owner_id: 2, deal_id: deal, person_id: person, org_id: org, due_date: "2026-07-15", due_time: "09:30", duration: "00:07", note: "<p>Bring <b>slides</b></p>" }),
    meetingDone: A({ subject: "Met Cy", type: "meeting", owner_id: 1, person_id: contacted, due_date: "2026-10-01", due_time: "10:00", done: true, marked_as_done_time: "2026-10-02 08:00:00" }),
    earlierCall: A({ subject: "Called Cy earlier", type: "call", owner_id: 1, person_id: contacted, due_date: "2026-01-01", done: true, marked_as_done_time: "2026-01-01 09:00:00" }),
    taskOverdue: A({ subject: "Overdue task", type: "task", owner_id: 1, deal_id: deal, due_date: "2026-11-20" }),
    taskToday: A({ subject: "Today task", type: "task", owner_id: 1, due_date: "2026-11-24" }),
    taskPlanned: A({ subject: "Planned task", type: "task", owner_id: 1, deal_id: deal, due_date: "2026-12-10" }),
    deadlines: [1, 2, 3].map((i) => A({ subject: `Deadline ${i}`, type: "deadline", owner_id: 1, due_date: "2026-12-01" })),
    lunch: A({ subject: "Lunch with Abe", type: "lunch", owner_id: 1, person_id: person, due_date: "2026-12-02" }),
    byJane: A({ subject: "Jane's call", type: "call", owner_id: 3, due_date: "2026-12-03" }),
    onNotDeal: A({ subject: "On a deal not imported", type: "call", owner_id: 1, deal_id: notDeal, due_date: "2026-12-04" }),
    onNothing: A({ subject: "On nothing", type: "task", owner_id: 1, due_date: "2026-12-05" }),
    onLead: A({ subject: "On a lead", type: "call", owner_id: 1, lead_id: "lead-1", due_date: "2026-12-06" }),
    noDue: A({ subject: "No due date", type: "task", owner_id: 1, due_date: null }),
    longNote: A({ subject: "Long note", type: "task", owner_id: 1, due_date: "2026-12-07", note: "n".repeat(10_001) }),
    tooLong: A({ subject: "Too long", type: "meeting", owner_id: 1, due_date: "2026-12-07", due_time: "09:00", duration: "25:00" }),
    onArchived: A({ subject: "On archived deal", type: "task", owner_id: 1, deal_id: archivedDeal, due_date: "2026-12-08" }),
  };
  return { org, person, contacted, deal, archivedDeal, act };
}

let linus: { id: number }, margaret: { id: number };
let fake: FakePipedrive;
let set: ReturnType<typeof seedActivitiesSet>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  set = seedActivitiesSet(fake);
  await connect(linus.id, LINUS_TOKEN);
  await makePipeline("Sales", ["Lead"]);
  // Cy is already in the CRM with a later Last contacted than the earlier call (never lowered).
  await makePerson({ firstName: "Cy", lastName: "Contactfake", createdBy: linus.id, emails: ["cy.contacted@fake.example"], lastContactedAt: new Date("2026-06-01T00:00:00Z") });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function importActivities() {
  const id = await start(linus.id, { deals: true, activities: true });
  await runToEnd(linus.id, id);
  return (await getImportView(linus.id))!;
}
const actOf = async (pdId: number) => {
  const id = await linkTarget("activity", pdId);
  if (typeof id !== "number") throw new Error(`activity ${pdId} not imported`);
  return id;
};

describe("activity values (US3-1, US3-2, FR-011)", () => {
  it("imports type, subject, UK due date and time, duration, note, links and assignee; other types as tasks, counted", async () => {
    const before = [await unreadCount(linus.id), await unreadCount(margaret.id)];
    const view = await importActivities();
    const call = (await getActivity(margaret.id, await actOf(set.act.call)))!;
    expect(call).toMatchObject({ type: "call", subject: "Call Abe", dueOn: "2026-07-15", dueTime: "10:30", durationMinutes: 10, note: "Bring slides", assignee: { id: margaret.id }, doneAt: null });
    expect(call.deal?.id).toBe(await linkTarget("deal", set.deal));
    expect(call.person?.id).toBe(await linkTarget("person", set.person));
    expect(call.organisation?.id).toBe(await linkTarget("organisation", set.org));
    const [row] = await sql<{ assigned_by: number; created_by: number }[]>`select assigned_by::int as assigned_by, created_by::int as created_by from activities where id = ${call.id}`;
    expect(row).toEqual({ assigned_by: margaret.id, created_by: linus.id });
    expect((await getActivity(linus.id, await actOf(set.act.deadlines[0])))!.type).toBe("task");
    const names = await namesForReport(linus.id, view.report);
    const lines = reportLines(view.report, names).map((l) => l.text);
    expect(lines).toContain("3 'deadline' activities imported as tasks.");
    expect(lines).toContain("1 'lunch' activity imported as tasks.");
    expect(lines).toContain("1 activity on Pipedrive leads: not imported.");
    expect(lines).toContain("Owner 'Jane Fake' (jane@fake.example) has no CRM user: 1 record given to you.");
    const warnings = warningLines(view.report, names).map((w) => `${w.label}: ${w.text}`);
    expect(warnings).toContain("Long note: Note longer than 10000 characters: left out.");
    expect(warnings).toContain("Too long: Duration '25:00' is not between 5 minutes and 24 hours: left out.");
    // US3-6: an import notifies nobody.
    expect([await unreadCount(linus.id), await unreadCount(margaret.id)]).toEqual(before);
  });

  it("skips activities on records not imported (listed), imports one on nothing unlinked, and one on an archived deal onto it", async () => {
    const view = await importActivities();
    const names = await namesForReport(linus.id, view.report);
    const item = view.report.notImported.find((n) => n.kind === "activity" && n.pipedriveId === set.act.onNotDeal)!;
    expect(item.label).toBe("On a deal not imported");
    expect(itemText(item, names)).toBe("Its deal 'Not imported act deal' was not imported.");
    expect(itemText(view.report.notImported.find((n) => n.pipedriveId === set.act.noDue)!, names)).toBe("No due date.");
    expect(await linkTarget("activity", set.act.onNotDeal)).toBeUndefined();
    const nothing = (await getActivity(linus.id, await actOf(set.act.onNothing)))!;
    expect([nothing.deal, nothing.person, nothing.organisation]).toEqual([null, null, null]);
    expect((await getActivity(linus.id, await actOf(set.act.onArchived)))!.deal?.id).toBe(await linkTarget("deal", set.archivedDeal));
    expect(view.counts.activities).toMatchObject({ imported: 15, notImported: 2 });
  });
});

describe("done and planned (US3-3, US3-4, FR-013)", () => {
  it("done ones are done by the assignee at Pipedrive's time, on the timeline, and raise Last contacted (never lowering it)", async () => {
    await importActivities();
    const met = (await getActivity(linus.id, await actOf(set.act.meetingDone)))!;
    expect(met).toMatchObject({ doneAt: new Date("2026-10-02T08:00:00Z"), doneBy: { id: linus.id } });
    const cy = (await linkTarget("person", set.contacted))!;
    const timeline = await readTimeline(linus.id, { personId: cy });
    expect(timeline.entries.filter((e) => e.kind === "activity").map((e) => e.activity?.subject).sort()).toEqual(["Called Cy earlier", "Met Cy"]);
    // least(due 2026-10-01 10:00 UTC (11:00 UK), done 2026-10-02 08:00) = the due time; later than 2026-06-01.
    const [p] = await sql<{ at: Date }[]>`select last_contacted_at as at from persons where id = ${cy}`;
    expect(p.at).toEqual(new Date("2026-10-01T10:00:00Z"));
  });

  it("planned ones are on the Activities list as Overdue, Today or planned, and the deal card shows the next one", async () => {
    await importActivities();
    const list = await listCrmActivities(linus.id, { when: "planned", assignee: null, type: null, page: 1 }, NOW);
    const subjects = list.rows.map((r) => r.subject);
    expect(subjects).toEqual(expect.arrayContaining(["Overdue task", "Today task", "Planned task"]));
    expect(list.rows.find((r) => r.subject === "Overdue task")!.state).toBe("overdue");
    expect(list.rows.find((r) => r.subject === "Today task")!.state).toBe("today");
    const margaretList = await listCrmActivities(margaret.id, { when: "planned", assignee: null, type: null, page: 1 }, NOW);
    expect(margaretList.rows.map((r) => r.subject)).toEqual(["Call Abe"]);
    const board = (await getBoard(linus.id, null))!;
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.title === "Activities fake deal")!;
    expect(card.next).toMatchObject({ dueOn: "2026-07-15" });
    expect(cardLine(card.next, NOW).kind).toBe("next");
  });
});

describe("reminders of imported activities (SF-123 FR-001, FR-007; SF-122 US3-6)", () => {
  // covers SF-123 FR-001, FR-007 with SF-122 US3-6: a planned imported activity gets the reminder of any planned activity
  // when its reminder time is still to come; none for done or past ones, and none shown at once (an import notifies nobody)
  it("sets remind_at on planned imported activities whose reminder time is still to come", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      await importActivities();
    } finally {
      vi.useRealTimers();
    }
    const remind = async (pd: number) =>
      (await sql<{ remind_at: Date | null }[]>`select remind_at from activities where id = ${await actOf(pd)}`)[0].remind_at;
    expect(await remind(set.act.taskPlanned)).toEqual(new Date("2026-12-10T09:00:00Z"));
    expect(await remind(set.act.tooLong)).toEqual(new Date("2026-12-07T08:45:00Z"));
    expect(await remind(set.act.taskOverdue)).toBeNull();
    expect(await remind(set.act.meetingDone)).toBeNull();
    // Today, untimed: its 09:00 reminder time has passed at noon: no reminder shown at once.
    expect(await remind(set.act.taskToday)).toBeNull();
    expect([await unreadCount(linus.id, NOW), await unreadCount(margaret.id, NOW)]).toEqual([0, 0]);
  });
});
