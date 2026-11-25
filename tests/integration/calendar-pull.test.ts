// covers SF-124 FR-008, FR-010, FR-011, FR-018, SC-002, US3 scenarios 1-6, edge cases "Both sides changed", "Archived
// records", "Times Google allows but the CRM does not", "Title limits", "Google no longer accepts the key": moving or
// renaming a synced event in Google changes the activity once (by notice or by the 15-minute check), never its note,
// links, assignee or done state; a deleted event ends the sync for good; the later change wins on both sides.
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
const { ukInstant } = await import("@/server/activities/rules");
const { listActivities } = await import("@/server/activities/list");
const { parseActivitiesQuery } = await import("@/server/records/list-query");
const { beforeMergeForTests, calendarAfterChange } = await import("@/server/calendar/sync");
const { gmailSettings } = await import("@/server/gmail/connections");
const { runGmailCheck } = await import("@/server/gmail/sync");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");
const c = await import("./calendar-helpers");

const ADA = "ada@barnacle.ai";
let ada: { id: number }, bob: { id: number };
let fake: ReturnType<typeof installGmailFake>;
let ana: number, org: number;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  org = await makeOrganisation({ name: "Fake Ltd", ownerId: ada.id });
  ana = await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: ada.id, organisationId: org });
  fake = installGmailFake();
  await c.connectCalendar(jar, fake, ada.id);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const at = (dayN: number, time: string) => ukInstant(c.day(dayN), time).toISOString();

// A synced call on Ana and Fake Ltd, due in 7 days at 10:00 for 30 minutes, with a note.
async function synced(o: Parameters<typeof c.form>[0] = {}) {
  const id = await c.schedule(ada.id, { subject: "Call Ada about the proposal", note: "Bring the price list", personId: String(ana), organisationId: String(org), ...o });
  await calendarAfterChange([id]);
  const link = (await c.linkOf(id))!;
  expect(link.state).toBe("synced");
  return { id, eventId: link.google_event_id };
}
const keep = (a: import("./calendar-helpers").ActivityRow) => ({ type: a.type, note: a.note, person_id: a.person_id, organisation_id: a.organisation_id, deal_id: a.deal_id, assignee_id: a.assignee_id, done: a.done });

describe("US3 scenarios 1-3: moved or renamed in Google", () => {
  it("moved to 11:00–12:00 with its notice: due then for 1 hour; record pages and the Activities list show it", async () => {
    const { id, eventId } = await synced();
    const before = (await c.activity(id))!;
    await fake.changeEvent(ADA, eventId, { start: at(9, "11:00"), end: at(9, "12:00") }, { deliver: true });
    const a = (await c.activity(id))!;
    expect(a).toMatchObject({ due_on: c.day(9), due_time: "11:00", duration_minutes: 60 });
    expect(keep(a)).toEqual(keep(before));
    const next = await A.nextActivities(ada.id, { personId: ana });
    expect(next.map((n) => [n.dueOn, n.dueTime, n.durationMinutes])).toEqual([[c.day(9), "11:00", 60]]);
    const list = await listActivities(ada.id, parseActivitiesQuery({}));
    expect(list.rows.find((r) => r.id === id)).toMatchObject({ dueOn: c.day(9), dueTime: "11:00" });
  });
  it("all-day in Google → no time, no duration; back to 14:00–14:45 → 14:00 for 45 minutes", async () => {
    const { id, eventId } = await synced();
    await fake.changeEvent(ADA, eventId, { start: c.day(10), end: c.day(11), allDay: true }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ due_on: c.day(10), due_time: null, duration_minutes: null });
    await fake.changeEvent(ADA, eventId, { start: at(10, "14:00"), end: at(10, "14:45"), allDay: false }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ due_on: c.day(10), due_time: "14:00", duration_minutes: 45 });
  });
  it("renamed: the subject follows without the type; another title is the whole subject; the type stays", async () => {
    const { id, eventId } = await synced();
    await fake.changeEvent(ADA, eventId, { summary: "Call · Call Ada about the new price" }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ subject: "Call Ada about the new price", type: "call" });
    await fake.changeEvent(ADA, eventId, { summary: "Lunch with Ana" }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ subject: "Lunch with Ana", type: "call" });
  });
});

describe("US3 scenarios 4-5: once, and only what Google may change", () => {
  it("a lost notice is caught by the 15-minute check; the same notice again changes nothing", async () => {
    const { id, eventId } = await synced();
    await fake.changeEvent(ADA, eventId, { start: at(8, "09:00"), end: at(8, "09:30") });
    fake.dropCalendarNotice(ADA);
    expect((await c.activity(id))?.due_on).toBe(c.day(7));
    await runGmailCheck();
    const a = (await c.activity(id))!;
    expect(a).toMatchObject({ due_on: c.day(8), due_time: "09:00" });
    expect(await fake.deliverCalendar(ADA)).toBe(204);
    expect((await c.activity(id))?.version).toBe(a.version);
    // Nothing is sent back to Google for a change that came from it.
    expect(c.eventOf(fake, ADA, eventId)?.start.dateTime).toBe(at(8, "09:00"));
  });
  it("a change to the description, place or guests leaves the activity exactly as it was", async () => {
    const { id, eventId } = await synced();
    const before = await c.activity(id);
    await fake.changeEvent(ADA, eventId, { description: "Changed in Google", location: "Room 1", attendees: ["kim@example.test"] }, { deliver: true });
    expect(await c.activity(id)).toEqual(before);
  });
});

describe("US3 scenario 6, FR-018: deleted in Google", () => {
  it("the activity stays as it was, its sync ends for good", async () => {
    await c.connectCalendar(jar, fake, bob.id);
    const { id, eventId } = await synced();
    const before = await c.activity(id);
    await fake.deleteEvent(ADA, eventId, { deliver: true });
    expect(await c.activity(id)).toEqual(before);
    expect((await c.linkOf(id))?.state).toBe("ended");
    const a = (await c.activity(id))!;
    expect((await A.editActivity(ada.id, id, a.version, c.form({ subject: "Edited", personId: String(ana), organisationId: String(org) }))).status).toBe("ok");
    expect((await A.tickActivity(ada.id, id)).status).toBe("ok");
    expect((await A.untickActivity(ada.id, id)).status).toBe("ok");
    await calendarAfterChange([id]);
    expect(c.live(fake, ADA)).toEqual([]);
    const v = await c.versionOf(id);
    expect((await A.editActivity(ada.id, id, v, c.form({ subject: "Edited", assigneeId: String(bob.id), personId: String(ana), organisationId: String(org) }))).status).toBe("ok");
    await calendarAfterChange([id]);
    expect(c.live(fake, ADA)).toEqual([]);
    expect(c.live(fake, "bob@barnacle.ai")).toEqual([]);
    // A later change to the cancelled event never reaches the activity.
    const now = await c.activity(id);
    await fake.changeEvent(ADA, eventId, { summary: "Call · From the bin" }, { deliver: true });
    await runGmailCheck();
    expect(await c.activity(id)).toEqual(now);
  });
});

describe("FR-011, edge case \"Both sides changed\": the later change wins on both sides", () => {
  it("CRM 11:00, then Google 14:00 five minutes later → both 14:00", async () => {
    const { id, eventId } = await synced();
    const a = (await c.activity(id))!;
    expect((await A.editActivity(ada.id, id, a.version, c.form({ subject: a.subject, note: a.note ?? "", dueTime: "11:00", personId: String(ana), organisationId: String(org) }))).status).toBe("ok");
    fake.advance(5 * 60_000);
    await fake.changeEvent(ADA, eventId, { start: at(7, "14:00"), end: at(7, "14:30") });
    await runGmailCheck();
    expect((await c.activity(id))?.due_time).toBe("14:00");
    expect(c.eventOf(fake, ADA, eventId)?.start.dateTime).toBe(at(7, "14:00"));
  });
  it("Google 14:00, then CRM 11:00 five minutes later → both 11:00", async () => {
    // Google's clock: the event is made 10 minutes ago and moved 5 minutes ago; the CRM changes it now.
    fake.advance(-10 * 60_000);
    const { id, eventId } = await synced();
    fake.advance(5 * 60_000);
    await fake.changeEvent(ADA, eventId, { start: at(7, "14:00"), end: at(7, "14:30") });
    fake.advance(5 * 60_000);
    const a = (await c.activity(id))!;
    expect((await A.editActivity(ada.id, id, a.version, c.form({ subject: a.subject, note: a.note ?? "", dueTime: "11:00", personId: String(ana), organisationId: String(org) }))).status).toBe("ok");
    await runGmailCheck();
    expect((await c.activity(id))?.due_time).toBe("11:00");
    expect(c.eventOf(fake, ADA, eventId)?.start.dateTime).toBe(at(7, "11:00"));
  });
  it("Google moves the time while the CRM changed the note: both kept, and the note reaches Google", async () => {
    const { id, eventId } = await synced();
    const a = (await c.activity(id))!;
    expect((await A.editActivity(ada.id, id, a.version, c.form({ subject: a.subject, note: "New note", personId: String(ana), organisationId: String(org) }))).status).toBe("ok");
    fake.advance(60_000);
    await fake.changeEvent(ADA, eventId, { start: at(7, "15:00"), end: at(7, "15:30") });
    await runGmailCheck();
    expect(await c.activity(id)).toMatchObject({ due_time: "15:00", note: "New note" });
    const e = c.eventOf(fake, ADA, eventId)!;
    expect(e.start.dateTime).toBe(at(7, "15:00"));
    expect(e.description).toContain("New note");
  });
});

describe("edge cases on what Google sends", () => {
  it("\"Archived records\": the move still applies; the CRM still refuses edits", async () => {
    const { id, eventId } = await synced();
    await sql`update persons set archived_at = now() where id = ${ana}`;
    await fake.changeEvent(ADA, eventId, { start: at(9, "10:00"), end: at(9, "10:30") }, { deliver: true });
    expect((await c.activity(id))?.due_on).toBe(c.day(9));
    const next = await A.nextActivities(ada.id, { personId: ana });
    expect(next[0]?.dueOn).toBe(c.day(9));
    expect((await A.editActivity(ada.id, id, await c.versionOf(id), c.form({ personId: String(ana), organisationId: String(org) }))).status).toBe("archived");
  });
  it("\"Times Google allows but the CRM does not\": 10:00–10:07 → 5 minutes, 10:07–10:52 → 10:07 for 45; the event keeps Google's times", async () => {
    const { id, eventId } = await synced();
    await fake.changeEvent(ADA, eventId, { start: at(7, "10:00"), end: ukInstant(c.day(7), "10:07").toISOString() }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ due_time: "10:00", duration_minutes: 5 });
    await runGmailCheck();
    expect(c.eventOf(fake, ADA, eventId)?.end.dateTime).toBe(at(7, "10:07"));
    await fake.changeEvent(ADA, eventId, { start: at(7, "10:07"), end: at(7, "10:52") }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ due_time: "10:07", duration_minutes: 45 });
    await fake.changeEvent(ADA, eventId, { start: c.day(7), end: c.day(10), allDay: true }, { deliver: true });
    expect(await c.activity(id)).toMatchObject({ due_on: c.day(7), due_time: null, duration_minutes: null });
    expect(c.eventOf(fake, ADA, eventId)?.end).toEqual({ date: c.day(10) });
  });
  it("\"Title limits\": an empty title leaves the subject; 250 characters give the first 200", async () => {
    const { id, eventId } = await synced();
    await fake.changeEvent(ADA, eventId, { summary: "" }, { deliver: true });
    expect((await c.activity(id))?.subject).toBe("Call Ada about the proposal");
    await fake.changeEvent(ADA, eventId, { summary: "x".repeat(250) }, { deliver: true });
    expect((await c.activity(id))?.subject).toBe("x".repeat(200));
  });
  it("an expired sync token (410): the catch-up listing applies what changed since the last sync", async () => {
    const { id, eventId } = await synced();
    await fake.changeEvent(ADA, eventId, { start: at(11, "16:00"), end: at(11, "16:30") });
    fake.expireCalendarTokens(ADA);
    await runGmailCheck();
    expect(await c.activity(id)).toMatchObject({ due_on: c.day(11), due_time: "16:00" });
  });
});

describe("edge case \"Google no longer accepts the key\"", () => {
  it("needs reconnecting; saves still work; after reconnecting and the check both sides converge", async () => {
    const one = await synced({ subject: "Changed in the CRM" });
    const two = await synced({ subject: "Moved in Google", dueOn: c.day(8) });
    fake.refuseKey(ADA);
    await runGmailCheck();
    expect((await gmailSettings(ada.id)).state).toBe("needs_reconnect");
    const a = (await c.activity(one.id))!;
    expect((await A.editActivity(ada.id, one.id, a.version, c.form({ subject: "Changed in the CRM, again", note: a.note ?? "", personId: String(ana), organisationId: String(org) }))).status).toBe("ok");
    await calendarAfterChange([one.id]);
    await fake.changeEvent(ADA, two.eventId, { start: at(12, "12:00"), end: at(12, "12:30") });
    expect(await c.connectCalendar(jar, fake, ada.id)).toBe("/settings");
    await runGmailCheck();
    expect(c.eventOf(fake, ADA, one.eventId)?.summary).toBe("Call · Changed in the CRM, again");
    expect(await c.activity(two.id)).toMatchObject({ due_on: c.day(12), due_time: "12:00" });
    expect(c.live(fake, ADA)).toHaveLength(2);
  });
});

// covers FR-013, FR-006, Fix round 1 (2): a Google change is never written to an activity that left the user between the
// read and the merge (reassigned meanwhile).
describe("FR-013: reassigned just before the merge", () => {
  it("the move in Google is not written to the teammate's activity", async () => {
    const { id, eventId } = await synced({ dueOn: c.day(1), dueTime: "10:00" });
    await fake.changeEvent(ADA, eventId, { start: at(1, "14:00"), end: at(1, "14:30") });
    let version = 0;
    beforeMergeForTests(async () => {
      beforeMergeForTests(null);
      const a = (await c.activity(id))!;
      const r = await A.editActivity(ada.id, id, a.version, c.form({ subject: a.subject, note: a.note ?? "", dueOn: c.day(1), dueTime: "10:00", assigneeId: String(bob.id), personId: String(ana), organisationId: String(org) }));
      expect(r.status).toBe("ok");
      version = await c.versionOf(id);
    });
    try {
      await c.sync(ada.id);
    } finally {
      beforeMergeForTests(null);
    }
    expect(version).toBeGreaterThan(0);
    expect(await c.activity(id)).toMatchObject({ due_on: c.day(1), due_time: "10:00", assignee_id: bob.id, version });
  });
});
