// covers SF-124 FR-001, FR-002, FR-003, US1 scenarios 1-5, edge cases "Calendar not set up" and "Past and done
// activities on connect": connecting asks for Calendar on top of Gmail and refuses a grant without it; a Gmail-only
// connection shows "Calendar access missing" and the "!" while Gmail copying goes on; reconnecting starts calendar sync
// with exactly one event per planned activity due today or later.
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

const { renderToStaticMarkup } = await import("react-dom/server");
const { closeDb, sql } = await import("@/server/db");
const { gmailSettings, settingsWarning } = await import("@/server/gmail/connections");
const { syncConnection } = await import("@/server/gmail/sync");
const { tickActivity } = await import("@/server/activities/activities");
const SettingsPage = (await import("@/app/(app)/settings/page")).default;
const AppLayout = (await import("@/app/(app)/layout")).default;
const { currentSidebar } = await import("@/app/(app)/notifications/actions");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const c = await import("./calendar-helpers");

const ADA = "ada@barnacle.ai";
let ada: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installGmailFake>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installGmailFake();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const page = async (query: Record<string, string> = {}) => renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve(query) }));
const layout = async () => renderToStaticMarkup(await AppLayout({ children: null }));
const row = async () => (await sql<{ scopes: string; channel: string | null; resource: string | null; hash: Buffer | null; connected: Date | null }[]>`
  select scopes, calendar_channel_id as channel, calendar_channel_resource_id as resource, calendar_channel_token_hash as hash,
         calendar_connected_at as connected
  from gmail_connections where user_id = ${ada.id}`)[0];

// A connection made before SF-124: the two Gmail scopes only (as SF-118 stored them).
async function gmailOnly() {
  vi.stubEnv("CALENDAR_SYNC", "");
  expect(await c.connectCalendar(jar, fake, ada.id)).toBe("/settings");
  vi.stubEnv("CALENDAR_SYNC", "on");
  expect((await row()).scopes).toBe(`${h.MODIFY} ${h.SEND}`);
}

describe("US1 scenario 1: connect with Calendar", () => {
  it("asks for the two Gmail scopes and Calendar's; once allowed, the card shows the Calendar line and a channel is stored", async () => {
    await h.signInAs(jar, ada.id);
    const url = await h.startConnect();
    expect(url.searchParams.get("scope")).toBe(`${h.MODIFY} ${h.SEND} ${h.CALENDAR}`);
    expect(await h.consentAndReturn(fake, url)).toBe("/settings");
    expect(await gmailSettings(ada.id)).toMatchObject({ state: "working", calendar: "syncing" });
    expect(await settingsWarning(ada.id)).toBeNull();
    const r = await row();
    expect(r.channel).toBeTruthy();
    expect(r.resource).toBeTruthy();
    expect(r.hash?.length).toBe(32);
    expect(r.connected).toBeInstanceOf(Date);
    // The token Google holds is never stored: only its sha256.
    const ch = fake.calendarChannel(ADA)!;
    expect(ch.id).toBe(r.channel);
    const dump = JSON.stringify(await sql`select * from gmail_connections`);
    expect(dump).not.toContain(ch.token);
    expect(await page()).toContain("<li>Calendar: Syncing your activities with your Google Calendar</li>");
    expect(await layout()).not.toContain('class="warn"');
  });
});

describe("US1 scenario 2: a permission left out", () => {
  it.each([
    ["Calendar", [h.MODIFY, h.SEND]],
    ["a Gmail one", [h.MODIFY, h.CALENDAR]],
  ])("unticking %s stores nothing and shows the message for all permissions", async (_name, scopes) => {
    await h.signInAs(jar, ada.id);
    expect(await h.connectGmail(fake, { scopes })).toBe("/settings?gmail=missing_scopes");
    expect(await h.connectionOf(ada.id)).toBeUndefined();
    expect(await page({ gmail: "missing_scopes" })).toContain("Google needs all the permissions asked for. Try again and tick every box.");
  });
});

describe("US1 scenarios 3-4: a connection made before Calendar", () => {
  it("shows Calendar access missing and the \"!\", while Gmail copying goes on", async () => {
    await gmailOnly();
    expect(await gmailSettings(ada.id)).toMatchObject({ state: "working", calendar: "missing" });
    expect(await settingsWarning(ada.id)).toBe("calendar");
    expect(await currentSidebar()).toEqual({ unread: 0, gmailWarn: true, warnLabel: "Reconnect Google to sync your calendar" });
    const side = await layout();
    expect(side).toContain('class="warn"');
    expect(side).toContain('aria-label="Reconnect Google to sync your calendar"');
    const html = await page();
    expect(html).toContain("Gmail · connected");
    expect(html).toContain("Reconnect Google to sync your activities with your calendar.");
    expect(html).toContain("<li>Calendar: Not synced: Calendar access missing</li>");
    for (const b of ["[ RECONNECT GMAIL ]", "[ SEND ME A TEST EMAIL ]", "[ DISCONNECT ]"]) expect(html).toContain(b);
    // Gmail still copies a new message from a CRM person.
    await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: ada.id, emails: ["ana@example.test"] });
    fake.addMessage(ADA, { from: "Ana Fake <ana@example.test>", to: ADA, subject: "Hello", text: "Hi" });
    expect(await syncConnection(await c.connectionIdOf(ada.id))).toEqual({ copied: 1 });
    // Nothing syncs with the calendar meanwhile.
    await c.schedule(ada.id);
    expect(await c.sync(ada.id)).toEqual({ skipped: "no_calendar" });
    expect(c.live(fake, ADA)).toEqual([]);
  });

  it("reconnecting with everything: \"Gmail reconnected.\", the \"!\" gone, one event per planned activity due today or later", async () => {
    await gmailOnly();
    const today = await c.schedule(ada.id, { subject: "Today task", type: "task", dueOn: c.day(0), dueTime: "", duration: "" });
    const later = await c.schedule(ada.id, { subject: "Later call", dueOn: c.day(3) });
    const past = await c.schedule(ada.id, { subject: "Yesterday call", dueOn: c.day(-1) });
    const done = await c.schedule(ada.id, { subject: "Done call", dueOn: c.day(1) });
    expect((await tickActivity(ada.id, done)).status).toBe("ok");

    expect(await c.connectCalendar(jar, fake, ada.id)).toBe("/settings");
    expect(JSON.parse(jar.get("crm_flash") ?? "{}").code).toBe("gmail_reconnected");
    expect(await settingsWarning(ada.id)).toBeNull();
    expect(await gmailSettings(ada.id)).toMatchObject({ calendar: "syncing" });
    // The callback's sync, after the answer, already put the events in.
    const events = c.live(fake, ADA);
    expect(events.map((e) => e.summary).sort()).toEqual(["Call · Later call", "Task · Today task"]);
    for (const id of [today, later]) expect((await c.linkOf(id))?.state).toBe("synced");
    for (const id of [past, done]) expect(await c.linkOf(id)).toBeUndefined();
    // Another sync makes no second event.
    await c.sync(ada.id);
    expect(c.live(fake, ADA)).toHaveLength(2);
  });
});

describe("US1 scenario 5: a user who never connects", () => {
  it("their activities are saved as before and no calendar gets an event", async () => {
    await c.connectCalendar(jar, fake, ada.id);
    const id = await c.schedule(ada.id, { assigneeId: String(margaret.id) });
    expect((await c.activity(id))?.assignee_id).toBe(margaret.id);
    await c.sync(ada.id);
    expect(c.live(fake, ADA)).toEqual([]);
    expect(c.live(fake, "margaret@barnacle.ai")).toEqual([]);
    expect(await c.linkOf(id)).toBeUndefined();
  });
});

describe("edge case \"Calendar not set up\"", () => {
  it("asks only the Gmail scopes, shows no Calendar line and no Calendar \"!\", and puts nothing in a calendar", async () => {
    vi.stubEnv("CALENDAR_SYNC", "");
    await h.signInAs(jar, ada.id);
    const url = await h.startConnect();
    expect(url.searchParams.get("scope")).toBe(`${h.MODIFY} ${h.SEND}`);
    expect(await h.consentAndReturn(fake, url)).toBe("/settings");
    expect(await gmailSettings(ada.id)).toMatchObject({ state: "working", calendar: "off" });
    expect(await settingsWarning(ada.id)).toBeNull();
    expect(await page()).not.toContain("Calendar:");
    await c.schedule(ada.id);
    expect(await c.sync(ada.id)).toEqual({ skipped: "off" });
    expect(fake.calendarEmails()).toEqual([]);
    expect((await row()).channel).toBeNull();
  });
});
