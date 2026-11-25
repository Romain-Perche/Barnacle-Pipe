// covers SF-124 FR-015, T052 (research.md §17): the fake calendar page answers 404 outside fake mode and with Calendar
// off; it lists each event's fields; its buttons change the fake calendar and, with "deliver the notice", the CRM;
// unreachable then reachable plus the 15-minute check converge. It runs on the process's own fake Google, as in
// `npm run dev`.
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
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { closeDb } = await import("@/server/db");
const A = await import("@/server/activities/activities");
const { calendarAfterChange } = await import("@/server/calendar/sync");
const { fakeGmail } = await import("@/server/gmail/fake-gmail");
const CalendarPage = (await import("@/app/dev/fake-calendar/page")).default;
const page = await import("@/app/dev/fake-calendar/actions");
const { TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const c = await import("./calendar-helpers");
const { afterResponseSettled } = await import("@/server/calendar/soon");

const ADA = "ada@barnacle.ai";
let ada: { id: number };

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake" });
  // A fresh process fake for each test (the app keeps one per process).
  (globalThis as { __crmFakeGmail?: unknown }).__crmFakeGmail = undefined;
  await h.signInAs(jar, ada.id);
  // Connect through the process's own fake (no test fetch installed).
  await h.consentAndReturn(fakeGmail() as never, await h.startConnect());
  await afterResponseSettled();
});
afterAll(async () => {
  fakeGmail().setUnreachable(false);
  vi.unstubAllEnvs();
  await closeDb();
});

const formOf = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
const render = async (query: Record<string, string> = { user: ADA }) => renderToStaticMarkup(await CalendarPage({ searchParams: Promise.resolve(query) }));
const mine = () => fakeGmail().calendarEvents(ADA);

describe("the page answers 404 outside fake mode", () => {
  it.each([
    ["Calendar off", { CALENDAR_SYNC: "" }],
    ["real Gmail settings", { GMAIL_PUBSUB_TOPIC: "projects/p/topics/t" }],
    ["production", { APP_ENV: "production" }],
  ])("%s", async (_what, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await expect(render()).rejects.toMatchObject({ to: "not-found" });
    await expect(page.runFakeCalendarCheck(formOf({ user: ADA }))).rejects.toMatchObject({ to: "not-found" });
    await expect(page.addFakeCalendarEvent(formOf({ user: ADA, title: "x", date: c.day(3), start: "10:00", end: "11:00" }))).rejects.toMatchObject({ to: "not-found" });
  });
});

describe("a tester's run through the fake calendar page", () => {
  it("shows the CRM's events with their fields", async () => {
    const id = await c.schedule(ada.id, { subject: "Fake call", note: "Bring the price list", dueOn: c.day(3) });
    await calendarAfterChange([id]);
    const html = await render();
    expect(html).toContain("Call · Fake call");
    expect(html).toContain(`When: ${c.day(3)} 10:00–10:30 (UK)`);
    expect(html).toContain("Bring the price list");
    expect(html).toContain("Guests: none");
    expect(html).toContain("Reminders: email 15 min before, popup 15 min before");
    expect(html).toContain("Private · Busy");
    expect(html).toContain("Notices: channel active");
  });
  it("create with a CRM guest and deliver: a meeting comes in; change and decline; delete; with and without notices", async () => {
    const org = await makeOrganisation({ name: "Fake Ltd", ownerId: ada.id });
    const ana = await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: ada.id, organisationId: org, emails: ["ana@example.test", "ana.k@example.test"] });
    expect(await h.redirectOf(page.addFakeCalendarEvent(formOf({ user: ADA, title: "Intro with Ana", date: c.day(5), start: "15:00", end: "15:45", guests: "ANA.K@example.test", deliver: "on" })))).toBe(
      "/dev/fake-calendar?user=ada%40barnacle.ai&done=added_delivered",
    );
    const [m] = (await c.activitiesOf(ada.id)).filter((a) => a.type === "meeting");
    expect(m).toMatchObject({ subject: "Intro with Ana", due_on: c.day(5), due_time: "15:00", duration_minutes: 45, person_id: ana, organisation_id: org });
    const html = await render();
    expect(html).toContain("Guests: ANA.K@example.test");
    const eventId = mine()[0].id;
    // Changed without its notice: the CRM follows at the check.
    expect(await h.redirectOf(page.changeFakeCalendarEvent(formOf({ user: ADA, event: eventId, title: "Intro moved", date: c.day(6), start: "11:00", end: "12:00" })))).toContain("done=changed");
    expect((await c.activity(m.id))?.due_on).toBe(c.day(5));
    expect(await h.redirectOf(page.runFakeCalendarCheck(formOf({ user: ADA })))).toContain("done=checked");
    expect(await c.activity(m.id)).toMatchObject({ subject: "Intro moved", due_on: c.day(6), due_time: "11:00", duration_minutes: 60 });
    // All day, delivered.
    await h.redirectOf(page.changeFakeCalendarEvent(formOf({ user: ADA, event: eventId, title: "Intro moved", date: c.day(7), allDay: "on", deliver: "on" })));
    expect(await c.activity(m.id)).toMatchObject({ due_on: c.day(7), due_time: null });
    expect(await h.redirectOf(page.declineFakeCalendarEvent(formOf({ user: ADA, event: eventId, deliver: "on" })))).toContain("done=declined_delivered");
    expect((await c.linkOf(m.id))?.state).toBe("ended");
    expect(await render()).toContain(`Declined by ${ADA}`);
    expect(await h.redirectOf(page.deleteFakeCalendarEvent(formOf({ user: ADA, event: eventId, deliver: "on" })))).toContain("done=deleted_delivered");
    expect(mine()[0].status).toBe("cancelled");
    expect(await render()).toContain("[cancelled] Intro moved");
    // A recurring event with a CRM guest adds nothing.
    await h.redirectOf(page.addFakeCalendarEvent(formOf({ user: ADA, title: "Weekly", date: c.day(5), start: "09:00", end: "09:30", guests: "ana@example.test", recurring: "on", deliver: "on" })));
    expect((await c.activitiesOf(ada.id)).filter((a) => a.type === "meeting")).toHaveLength(1);
    expect(await h.redirectOf(page.addFakeCalendarEvent(formOf({ user: ADA, title: "Bad", date: "tomorrow" })))).toContain("done=bad_times");
  });
  it("unreachable, an edit with no error, reachable, the check: the event matches", async () => {
    const id = await c.schedule(ada.id, { subject: "Before" });
    await calendarAfterChange([id]);
    expect(await h.redirectOf(page.toggleFakeGoogleReachable(formOf({ user: ADA })))).toContain("done=unreachable");
    expect(await render()).toContain("[ MAKE GOOGLE REACHABLE ]");
    const a = (await c.activity(id))!;
    expect((await A.editActivity(ada.id, id, a.version, c.form({ subject: "After" }))).status).toBe("ok");
    await calendarAfterChange([id]);
    expect(mine().map((e) => e.summary)).toEqual(["Call · Before"]);
    expect(await h.redirectOf(page.toggleFakeGoogleReachable(formOf({ user: ADA })))).toContain("done=reachable");
    await h.redirectOf(page.runFakeCalendarCheck(formOf({ user: ADA })));
    expect(mine().map((e) => e.summary)).toEqual(["Call · After"]);
  });
  it("expire sync tokens: the next check lists again and still applies changes", async () => {
    const id = await c.schedule(ada.id, { subject: "Expire" });
    await calendarAfterChange([id]);
    expect(await h.redirectOf(page.expireFakeSyncTokens(formOf({ user: ADA })))).toContain("done=expired");
    const eventId = mine()[0].id;
    await h.redirectOf(page.changeFakeCalendarEvent(formOf({ user: ADA, event: eventId, title: "Call · Expired renamed" })));
    await h.redirectOf(page.runFakeCalendarCheck(formOf({ user: ADA })));
    expect((await c.activity(id))?.subject).toBe("Expired renamed");
  });
});
