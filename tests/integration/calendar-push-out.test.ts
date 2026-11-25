// covers SF-124 FR-004, FR-005, FR-006, FR-007, FR-013, SC-001, SC-003, SC-004, US2 scenarios 1-8, edge cases
// "Private records" and "Deleted linked record": every planned activity of a connected user has exactly one event in
// their calendar, kept in step with every CRM change (edit, reschedule, tick, untick, reassign, delete, record deletes,
// rows written by other code), never with guests or invitations; saving never waits on Google.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/settings" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));

const { closeDb, sql } = await import("@/server/db");
const A = await import("@/server/activities/activities");
const { calendarAfterChange } = await import("@/server/calendar/sync");
const { runGmailCheck } = await import("@/server/gmail/sync");
const { deletePerson } = await import("@/server/records/people");
const { deleteOrganisation } = await import("@/server/records/organisations");
const { deleteDeal } = await import("@/server/deals/deals");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");
const { makeDeal, makePipeline } = await import("./deal-helpers");
const c = await import("./calendar-helpers");

const ADA = "ada@barnacle.ai";
const BOB = "bob@barnacle.ai";
const APP = "http://localhost:3000";
let ada: { id: number }, bob: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installGmailFake>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake", role: "admin" });
  bob = await makeUser({ email: BOB, name: "Bob Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installGmailFake();
  await c.connectCalendar(jar, fake, ada.id);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const after = (ids: number[]) => calendarAfterChange(ids);
const one = () => {
  const events = c.live(fake, ADA);
  expect(events).toHaveLength(1);
  return events[0];
};
const edit = async (id: number, o: Parameters<typeof c.form>[0]) => {
  const a = (await c.activity(id))!;
  const base = { type: a.type, subject: a.subject, dueOn: a.due_on, dueTime: a.due_time ?? "", duration: a.duration_minutes === null ? "" : String(a.duration_minutes), note: a.note ?? "", assigneeId: String(a.assignee_id), personId: a.person_id ? String(a.person_id) : "", organisationId: a.organisation_id ? String(a.organisation_id) : "", dealId: a.deal_id ? String(a.deal_id) : "" };
  const r = await A.editActivity(ada.id, id, a.version, c.form({ ...base, ...o }));
  expect(r.status).toBe("ok");
};

describe("US2 scenario 1-3: the event of a new activity", () => {
  it("a call with a time and a note: title, times, description and link, reminders 15 minutes before, private, no guests", async () => {
    const due = c.day(7);
    const id = await c.schedule(ada.id, { subject: "Call Ada about the proposal", dueOn: due, dueTime: "10:00", duration: "30", note: "Bring the price list" });
    await after([id]);
    const e = one();
    expect(e.summary).toBe("Call · Call Ada about the proposal");
    expect(e.description).toBe(`Bring the price list\n\nOpen in Barnacle CRM: ${APP}/activities?activity=${id}`);
    const { ukInstant } = await import("@/server/activities/rules");
    expect(e.start.dateTime).toBe(ukInstant(due, "10:00").toISOString());
    expect(new Date(e.end.dateTime!).getTime() - new Date(e.start.dateTime!).getTime()).toBe(30 * 60_000);
    expect(e.reminders).toEqual({ useDefault: false, overrides: [{ method: "email", minutes: 15 }, { method: "popup", minutes: 15 }] });
    expect(e.visibility).toBe("private");
    expect(e.attendees).toBeUndefined();
    expect(e.id).toMatch(/^crm[0-9a-v]{32}$/);
    expect(await c.linkOf(id)).toMatchObject({ state: "synced", origin: "crm", google_event_id: e.id });
  });
  it("no duration → 30 minutes; a task with no time → all-day, free, no reminder", async () => {
    const a = await c.schedule(ada.id, { duration: "" });
    const t = await c.schedule(ada.id, { type: "task", subject: "Send contract", dueOn: c.day(8), dueTime: "", duration: "" });
    await after([a, t]);
    const call = c.eventOf(fake, ADA, (await c.linkOf(a))!.google_event_id)!;
    expect(new Date(call.end.dateTime!).getTime() - new Date(call.start.dateTime!).getTime()).toBe(30 * 60_000);
    const task = c.eventOf(fake, ADA, (await c.linkOf(t))!.google_event_id)!;
    expect(task.summary).toBe("Task · Send contract");
    expect(task.start).toEqual({ date: c.day(8) });
    expect(task.end).toEqual({ date: c.day(9) });
    expect(task.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(task.transparency).toBe("transparent");
  });
});

describe("US2 scenarios 4-7: changes in the CRM", () => {
  it("edit, reschedule, tick, untick: the same event follows; still one", async () => {
    const id = await c.schedule(ada.id, { subject: "First", note: "n1" });
    await after([id]);
    const eventId = one().id;
    await edit(id, { type: "meeting", subject: "Second", note: "n2", dueOn: c.day(9), dueTime: "14:00", duration: "45" });
    await after([id]);
    let e = one();
    expect(e.id).toBe(eventId);
    expect(e.summary).toBe("Meeting · Second");
    expect(e.description).toContain("n2");
    expect(new Date(e.end.dateTime!).getTime() - new Date(e.start.dateTime!).getTime()).toBe(45 * 60_000);
    await edit(id, { dueTime: "", duration: "" });
    await after([id]);
    e = one();
    expect(e.start).toEqual({ date: c.day(9) });
    expect(e.reminders?.overrides).toEqual([]);
    await edit(id, { dueTime: "09:00" });
    await after([id]);
    expect(one().reminders?.overrides).toHaveLength(2);
    expect((await A.tickActivity(ada.id, id)).status).toBe("ok");
    await after([id]);
    e = one();
    expect(e.summary).toBe("✓ Meeting · Second");
    expect(e.reminders).toEqual({ useDefault: false, overrides: [] });
    expect((await A.untickActivity(ada.id, id)).status).toBe("ok");
    await after([id]);
    e = one();
    expect(e.summary).toBe("Meeting · Second");
    expect(e.reminders?.overrides).toHaveLength(2);
    expect(e.id).toBe(eventId);
  });

  it("reassign to a connected user: gone from Ada's calendar, one in Bob's; to an unconnected one: in no calendar", async () => {
    await c.connectCalendar(jar, fake, bob.id);
    const id = await c.schedule(ada.id);
    await after([id]);
    expect(c.live(fake, ADA)).toHaveLength(1);
    await edit(id, { assigneeId: String(bob.id) });
    await after([id]);
    expect(c.live(fake, ADA)).toHaveLength(0);
    expect(c.live(fake, BOB)).toHaveLength(1);
    expect((await c.linkOf(id))?.connection_id).toBe(await c.connectionIdOf(bob.id));
    const r = await A.editActivity(ada.id, id, await c.versionOf(id), c.form({ assigneeId: String(margaret.id) }));
    expect(r.status).toBe("ok");
    await after([id]);
    expect(c.live(fake, BOB)).toHaveLength(0);
    expect(c.live(fake, ADA)).toHaveLength(0);
    expect(c.live(fake, "margaret@barnacle.ai")).toHaveLength(0);
    expect(await c.linkOf(id)).toBeUndefined();
  });

  it("deleted in the CRM, or with its person, organisation or deal: the event is removed", async () => {
    const org = await makeOrganisation({ name: "Fake Ltd", ownerId: ada.id });
    const person = await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: ada.id, organisationId: org });
    const org2 = await makeOrganisation({ name: "Other Fake Ltd", ownerId: ada.id });
    const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
    const deal = await makeDeal({ title: "Fake deal", stageId: stage, createdBy: ada.id });
    const own = await c.schedule(ada.id, { subject: "Own" });
    const onPerson = await c.schedule(ada.id, { subject: "On person", personId: String(person), organisationId: String(org) });
    const onOrg = await c.schedule(ada.id, { subject: "On org", organisationId: String(org2) });
    const onDeal = await c.schedule(ada.id, { subject: "On deal", dealId: String(deal) });
    await after([own, onPerson, onOrg, onDeal]);
    expect(c.live(fake, ADA)).toHaveLength(4);
    expect((await A.deleteActivity(ada.id, own, await c.versionOf(own))).status).toBe("ok");
    await after([own]);
    expect(c.live(fake, ADA).map((e) => e.summary).sort()).toEqual(["Call · On deal", "Call · On org", "Call · On person"]);
    expect((await deletePerson(ada.id, person)).status).toBe("deleted");
    await after([]);
    expect((await deleteOrganisation(ada.id, org2)).status).toBe("deleted");
    await after([]);
    expect((await deleteDeal(ada.id, deal)).status).toBe("deleted");
    await after([]);
    // An activity linked to a deleted record keeps living when another link is left; these had only that one.
    const left = c.live(fake, ADA).map((e) => e.summary);
    const remaining = (await c.activitiesOf(ada.id)).map((a) => `Call · ${a.subject}`);
    expect(left.sort()).toEqual(remaining.sort());
    expect(fake.calendarEvents(ADA).filter((e) => e.status === "cancelled").length).toBeGreaterThanOrEqual(1);
    expect((await c.links()).filter((l) => l.activity_id === null)).toEqual([]);
  });

  it("an activity written by other code (as SF-122's Pipedrive import) gets its event at the 15-minute check", async () => {
    const [row] = await sql<{ id: number }[]>`
      insert into activities (type, subject, due_on, assignee_id, created_by, assigned_by)
      values ('task', 'Imported fake task', ${c.day(2)}, ${ada.id}, ${ada.id}, ${ada.id}) returning id::int as id`;
    await runGmailCheck();
    expect(c.live(fake, ADA).map((e) => e.summary)).toEqual(["Task · Imported fake task"]);
    expect((await c.linkOf(row.id))?.state).toBe("synced");
  });
});

describe("US2 scenario 8, FR-007: Google unreachable while saving", () => {
  it("the save succeeds; after Google is back the check brings the event to the activity's values", async () => {
    const id = await c.schedule(ada.id, { subject: "Before" });
    await after([id]);
    fake.setUnreachable(true);
    await edit(id, { subject: "After" });
    await after([id]);
    expect(one().summary).toBe("Call · Before");
    fake.setUnreachable(false);
    await runGmailCheck();
    expect(one().summary).toBe("Call · After");
  });
  it("an insert whose answer was lost is retried: Google says the id exists, the event is patched, still one", async () => {
    const id = await c.schedule(ada.id, { subject: "Lost answer" });
    fake.loseNextCalendarAnswer();
    await after([id]);
    expect((await c.linkOf(id))?.state).toBe("creating");
    expect(c.live(fake, ADA)).toHaveLength(1);
    await edit(id, { subject: "Lost answer, edited" });
    await after([id]);
    expect(one().summary).toBe("Call · Lost answer, edited");
    expect((await c.linkOf(id))?.state).toBe("synced");
  });
});

describe("SC-004, FR-013: no guests, no invitations, no leaks", () => {
  it("every write sends sendUpdates=none and never attendees", async () => {
    const id = await c.schedule(ada.id, { note: "x" });
    await after([id]);
    await edit(id, { subject: "Edited" });
    await after([id]);
    expect((await A.deleteActivity(ada.id, id, await c.versionOf(id))).status).toBe("ok");
    await after([id]);
    const writes = c.calendarWrites(fake);
    expect(writes.map((w) => w.method)).toEqual(["POST", "PATCH", "DELETE"]);
    for (const w of writes) {
      expect(w.query.sendUpdates).toBe("none");
      expect(JSON.stringify(w.body ?? {})).not.toContain("attendees");
    }
    expect(fake.sent(ADA)).toEqual([]);
  });
  it("edge case \"Private records\": an activity on a private person is in its owner's calendar only, as written", async () => {
    await c.connectCalendar(jar, fake, bob.id);
    const secret = await makePerson({ firstName: "Gus", lastName: "Fake", createdBy: ada.id, private: true });
    const id = await c.schedule(ada.id, { subject: "Secret call", note: "Secret note", personId: String(secret) });
    await after([id]);
    expect(one()).toMatchObject({ summary: "Call · Secret call", visibility: "private" });
    expect(one().description).toContain("Secret note");
    expect(c.live(fake, BOB)).toEqual([]);
  });
  it("hidden from the assignee: the person made private by another owner → the event is removed at the next sync", async () => {
    const ana = await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: ada.id });
    const id = await c.schedule(ada.id, { personId: String(ana) });
    await after([id]);
    expect(c.live(fake, ADA)).toHaveLength(1);
    await sql`update persons set private = true, owner_id = ${bob.id}, created_by = ${bob.id} where id = ${ana}`;
    await c.sync(ada.id);
    expect(c.live(fake, ADA)).toEqual([]);
    expect(await c.linkOf(id)).toBeUndefined();
    // Visible again while planned and due later: put back.
    await sql`update persons set private = false where id = ${ana}`;
    await c.sync(ada.id);
    expect(c.live(fake, ADA)).toHaveLength(1);
  });
  it("a refusal (400) for one event: the others still sync, and it is not retried until its next change", async () => {
    const a = await c.schedule(ada.id, { subject: "A" });
    const b = await c.schedule(ada.id, { subject: "B" });
    await after([a, b]);
    const refusedId = (await c.linkOf(a))!.google_event_id;
    fake.refuseEventWrites(refusedId);
    await edit(a, { subject: "A2" });
    await edit(b, { subject: "B2" });
    await after([a, b]);
    expect(c.eventOf(fake, ADA, refusedId)?.summary).toBe("Call · A");
    expect(c.eventOf(fake, ADA, (await c.linkOf(b))!.google_event_id)?.summary).toBe("Call · B2");
    const before = c.calendarWrites(fake).length;
    await c.sync(ada.id);
    expect(c.calendarWrites(fake).length).toBe(before);
    fake.refuseEventWrites(refusedId, false);
    await edit(a, { subject: "A3" });
    await after([a]);
    expect(c.eventOf(fake, ADA, refusedId)?.summary).toBe("Call · A3");
  });
});
