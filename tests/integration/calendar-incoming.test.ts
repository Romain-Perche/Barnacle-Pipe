// covers SF-124 FR-009, FR-018, SC-003, US4 scenarios 1-8, edge cases "Recurring events", "Event declined",
// clarifications "(No title)", "archived organisation", "meetings from Google": a new event with a visible,
// non-archived CRM person as guest becomes one planned Meeting for the user, linked to the first such person and their
// organisation; nothing else comes in; the CRM only ever changes such a meeting's title and times in Google.
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
const { calendarAfterChange } = await import("@/server/calendar/sync");
const { listNotifications } = await import("@/server/notifications");
const { runGmailCheck } = await import("@/server/gmail/sync");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");
const c = await import("./calendar-helpers");

const ADA = "ada@barnacle.ai";
let ada: { id: number }, bob: { id: number };
let fake: ReturnType<typeof installGmailFake>;
let ana: number, fakeLtd: number;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  fakeLtd = await makeOrganisation({ name: "Fake Ltd", ownerId: ada.id });
  ana = await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: ada.id, organisationId: fakeLtd, emails: ["ana@example.test", "ana.k@example.test"] });
  fake = installGmailFake();
  await c.connectCalendar(jar, fake, ada.id);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const at = (dayN: number, time: string) => ukInstant(c.day(dayN), time).toISOString();
const meeting = (o: Partial<Parameters<typeof fake.addEvent>[1]> = {}) => ({ summary: "Intro with Ana", start: at(13, "15:00"), end: at(13, "15:45"), ...o });
const planned = async () => (await listActivities(ada.id, parseActivitiesQuery({ assignee: "all" }))).rows;
const meetings = async () => (await c.activitiesOf(ada.id)).filter((a) => a.type === "meeting");

describe("US4 scenario 1: an event with a CRM person as guest", () => {
  it("becomes a planned Meeting for Ada, on Ana and Fake Ltd, with no note and no assignment notification", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ANA.K@example.test"] }), { deliver: true });
    const [m] = await meetings();
    expect(m).toMatchObject({ type: "meeting", subject: "Intro with Ana", due_on: c.day(13), due_time: "15:00", duration_minutes: 45, assignee_id: ada.id, person_id: ana, organisation_id: fakeLtd, note: null, done: false });
    expect(await c.linkOf(m.id)).toMatchObject({ origin: "google", state: "synced", google_event_id: eventId });
    expect((await A.nextActivities(ada.id, { personId: ana })).map((a) => a.id)).toEqual([m.id]);
    expect((await A.nextActivities(ada.id, { organisationId: fakeLtd })).map((a) => a.id)).toEqual([m.id]);
    expect((await planned()).map((r) => r.id)).toEqual([m.id]);
    expect((await listNotifications(ada.id)).items).toEqual([]);
    // Nothing is sent back to Google.
    expect(c.calendarWrites(fake)).toEqual([]);
  });
});

describe("US4 scenarios 2, 5, 6 and edge cases: what never comes in", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["teammates only", () => fake.addEvent(ADA, meeting({ attendees: ["bob@barnacle.ai"] }), { deliver: true })],
    ["unknown addresses", () => fake.addEvent(ADA, meeting({ attendees: ["nobody@example.test"] }), { deliver: true })],
    ["no guests", () => fake.addEvent(ADA, meeting(), { deliver: true })],
    ["a weekly event", () => fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], recurrence: ["RRULE:FREQ=WEEKLY"] }), { deliver: true })],
    ["an event already over", () => fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], start: at(-1, "10:00"), end: at(-1, "11:00") }), { deliver: true })],
    ["out of office", () => fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], eventType: "outOfOffice" }), { deliver: true })],
    [
      "an invitation Ada declined",
      async () => {
        const id = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], organizer: "ana@example.test" }));
        await fake.declineEvent(ADA, id, { deliver: true });
      },
    ],
  ])("%s", async (_name, add) => {
    await add();
    await runGmailCheck();
    expect(await planned()).toEqual([]);
  });
  it("a private person Ada cannot see, or an archived one", async () => {
    await makePerson({ firstName: "Gus", lastName: "Fake", createdBy: bob.id, private: true, emails: ["gus@example.test"] });
    await makePerson({ firstName: "Old", lastName: "Fake", createdBy: ada.id, archived: true, emails: ["old@example.test"] });
    await fake.addEvent(ADA, meeting({ attendees: ["gus@example.test", "old@example.test"] }), { deliver: true });
    await runGmailCheck();
    expect(await planned()).toEqual([]);
  });
  it("an event made before Ada connected", async () => {
    await sql`delete from gmail_connections`;
    fake.advance(-60_000);
    await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"] }));
    fake.advance(60_000);
    await c.connectCalendar(jar, fake, ada.id);
    await runGmailCheck();
    expect(await planned()).toEqual([]);
  });
});

describe("US4 scenarios 3, 4, 7, 8", () => {
  it("several CRM guests: the first Ada can see, in guest order; once", async () => {
    await makePerson({ firstName: "Gus", lastName: "Fake", createdBy: bob.id, private: true, emails: ["gus@example.test"] });
    const kim = await makePerson({ firstName: "Kim", lastName: "Fake", createdBy: ada.id, emails: ["kim@example.test"] });
    await fake.addEvent(ADA, meeting({ attendees: ["gus@example.test", "kim@example.test", "ana@example.test"] }), { deliver: true });
    await runGmailCheck();
    const ms = await meetings();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ person_id: kim, organisation_id: null });
  });
  it("the CRM's own event coming back: still one activity", async () => {
    const id = await c.schedule(ada.id, { type: "meeting", subject: "CRM meeting", personId: String(ana) });
    await calendarAfterChange([id]);
    await fake.deliverCalendar(ADA);
    await runGmailCheck();
    expect((await planned()).map((r) => r.id)).toEqual([id]);
  });
  it("a CRM guest added later: it comes in from then on", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["bob@barnacle.ai"] }), { deliver: true });
    expect(await planned()).toEqual([]);
    await fake.changeEvent(ADA, eventId, { attendees: ["bob@barnacle.ai", "ana@example.test"] }, { deliver: true });
    expect(await meetings()).toHaveLength(1);
  });
  it("an empty title gives \"(No title)\"; an archived organisation is not linked", async () => {
    await sql`update organisations set archived_at = now() where id = ${fakeLtd}`;
    await fake.addEvent(ADA, meeting({ summary: "", attendees: ["ana@example.test"] }), { deliver: true });
    expect(await meetings()).toMatchObject([{ subject: "(No title)", person_id: ana, organisation_id: null }]);
  });
});

describe("a meeting from Google, afterwards", () => {
  it("moved in Google: the meeting follows", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"] }), { deliver: true });
    await fake.changeEvent(ADA, eventId, { start: at(14, "09:00"), end: at(14, "10:00"), summary: "Meeting · Intro moved" }, { deliver: true });
    expect(await meetings()).toMatchObject([{ due_on: c.day(14), due_time: "09:00", duration_minutes: 60, subject: "Intro moved" }]);
  });
  it("edited in the CRM: only its title (no \"Meeting · \") and times go to Google; ticking changes nothing there", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], description: "Agenda from Google" }), { deliver: true });
    const [m] = await meetings();
    const before = c.eventOf(fake, ADA, eventId)!;
    const r = await A.editActivity(ada.id, m.id, m.version, c.form({ type: "meeting", subject: "Intro, new time", dueOn: c.day(15), dueTime: "16:00", duration: "30", note: "CRM note", personId: String(ana), organisationId: String(fakeLtd) }));
    expect(r.status).toBe("ok");
    await calendarAfterChange([m.id]);
    const e = c.eventOf(fake, ADA, eventId)!;
    expect(e.summary).toBe("Intro, new time");
    expect(e.start.dateTime).toBe(at(15, "16:00"));
    expect(e.end.dateTime).toBe(at(15, "16:30"));
    expect(e.description).toBe("Agenda from Google");
    expect(e.attendees).toEqual(before.attendees);
    expect(e.reminders).toEqual(before.reminders);
    expect(e.visibility).toBeUndefined();
    const writes = c.calendarWrites(fake);
    expect(writes.map((w) => Object.keys(w.body as object).sort())).toEqual([["end", "start", "summary"]]);
    expect((await A.tickActivity(ada.id, m.id)).status).toBe("ok");
    await calendarAfterChange([m.id]);
    expect(c.calendarWrites(fake)).toHaveLength(1);
    expect(c.eventOf(fake, ADA, eventId)?.summary).toBe("Intro, new time");
  });
  it("deleted in the CRM: the Google event stays; a later change to it brings nothing in", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"] }), { deliver: true });
    const [m] = await meetings();
    expect((await A.deleteActivity(ada.id, m.id, m.version)).status).toBe("ok");
    await calendarAfterChange([m.id]);
    expect(c.eventOf(fake, ADA, eventId)?.status).toBe("confirmed");
    await fake.changeEvent(ADA, eventId, { summary: "Intro again" }, { deliver: true });
    await runGmailCheck();
    expect(await meetings()).toEqual([]);
    expect((await c.links()).map((l) => [l.state, l.activity_id])).toEqual([["ended", null]]);
  });
  it("declined by Ada later: the meeting stays as it was and is no longer synced", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], organizer: "ana@example.test" }), { deliver: true });
    const [m] = await meetings();
    await fake.declineEvent(ADA, eventId, { deliver: true });
    expect((await c.linkOf(m.id))?.state).toBe("ended");
    expect(await c.activity(m.id)).toEqual(m);
    await fake.changeEvent(ADA, eventId, { start: at(16, "09:00"), end: at(16, "10:00") }, { deliver: true });
    expect(await c.activity(m.id)).toEqual(m);
  });
  it("organised by someone else and edited in the CRM: Google's 403 is handled, each side keeps its value, no error", async () => {
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"], organizer: "ana@example.test" }), { deliver: true });
    const [m] = await meetings();
    const r = await A.editActivity(ada.id, m.id, m.version, c.form({ type: "meeting", subject: "My own title", dueOn: m.due_on, dueTime: "15:00", duration: "45", personId: String(ana), organisationId: String(fakeLtd) }));
    expect(r.status).toBe("ok");
    await calendarAfterChange([m.id]);
    expect((await c.activity(m.id))?.subject).toBe("My own title");
    expect(c.eventOf(fake, ADA, eventId)?.summary).toBe("Intro with Ana");
    expect((await c.linkOf(m.id))?.state).toBe("synced");
    // Not retried until the next change.
    const n = fake.requests.length;
    await c.sync(ada.id);
    expect(fake.requests.filter((x, i) => i >= n && x.method === "PATCH")).toEqual([]);
  });
  it("reassigned to a teammate: the event stays in Ada's calendar, unsynced, and no copy is made", async () => {
    await c.connectCalendar(jar, fake, bob.id);
    const eventId = await fake.addEvent(ADA, meeting({ attendees: ["ana@example.test"] }), { deliver: true });
    const [m] = await meetings();
    const r = await A.editActivity(ada.id, m.id, m.version, c.form({ type: "meeting", subject: m.subject, dueOn: m.due_on, dueTime: "15:00", duration: "45", assigneeId: String(bob.id), personId: String(ana), organisationId: String(fakeLtd) }));
    expect(r.status).toBe("ok");
    await calendarAfterChange([m.id]);
    expect(c.eventOf(fake, ADA, eventId)?.status).toBe("confirmed");
    expect(c.live(fake, "bob@barnacle.ai")).toEqual([]);
    expect((await c.linkOf(m.id))?.state).toBe("ended");
  });
});
