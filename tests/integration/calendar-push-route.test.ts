// covers SF-124 FR-010, FR-013, T048 (research.md §11; Google's "Push notifications" guide, no public schema): POST
// /calendar/push accepts only a notice carrying the channel's secret token and resource id for a working connection
// with Calendar; anything else is refused with 403 and changes nothing; a channel's first "sync" message does nothing;
// answers never carry data. Renewing the channel stops the old one, whose notices are then refused.
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
const { ukInstant } = await import("@/server/activities/rules");
const { calendarAfterChange, renewCalendarChannel } = await import("@/server/calendar/sync");
const { disconnect } = await import("@/server/gmail/connections");
const { POST } = await import("@/app/calendar/push/route");
const { CALENDAR_NOTICE_HEADERS, installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeUser, resetDb } = await import("./db-helpers");
const c = await import("./calendar-helpers");

const ADA = "ada@barnacle.ai";
let ada: { id: number };
let fake: ReturnType<typeof installGmailFake>;
let id: number, eventId: string;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake" });
  fake = installGmailFake();
  await c.connectCalendar(jar, fake, ada.id);
  id = await c.schedule(ada.id, { dueOn: c.day(7) });
  await calendarAfterChange([id]);
  eventId = (await c.linkOf(id))!.google_event_id;
  // A change in Google waiting to be told.
  await fake.changeEvent(ADA, eventId, { start: ukInstant(c.day(9), "11:00").toISOString(), end: ukInstant(c.day(9), "12:00").toISOString() });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const post = async (headers: Headers) => {
  const res = await POST(new Request("http://localhost:3000/calendar/push", { method: "POST", headers }));
  return { status: res.status, body: await res.text() };
};
const notice = (change: Record<string, string> = {}) => {
  const h = fake.calendarNotice(ADA)!;
  for (const [k, v] of Object.entries(change)) h.set(k, v);
  return h;
};
const unchanged = async () => {
  expect((await c.activity(id))?.due_on).toBe(c.day(7));
  expect(c.eventOf(fake, ADA, eventId)?.start.dateTime).toBe(ukInstant(c.day(9), "11:00").toISOString());
};

describe("POST /calendar/push", () => {
  it("the notices Google sends carry exactly the push guide's headers", () => {
    expect([...notice().keys()].sort()).toEqual(CALENDAR_NOTICE_HEADERS);
  });
  it.each<[string, () => Headers | Promise<Headers>]>([
    ["a wrong token", () => notice({ "X-Goog-Channel-Token": "not-the-token" })],
    ["no token", () => {
      const h = notice();
      h.delete("X-Goog-Channel-Token");
      return h;
    }],
    ["an unknown channel id", () => notice({ "X-Goog-Channel-ID": "00000000-0000-4000-8000-000000000000" })],
    ["another resource id", () => notice({ "X-Goog-Resource-ID": "another-resource" })],
    ["a connection without the Calendar scope", async () => {
      const h = notice();
      await sql`update gmail_connections set scopes = ${"https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"}`;
      return h;
    }],
    ["a connection needing reconnecting", async () => {
      const h = notice();
      await sql`update gmail_connections set state = 'needs_reconnect'`;
      return h;
    }],
  ])("refuses %s with 403 and an empty body; nothing changes", async (_name, make) => {
    expect(await post(await make())).toEqual({ status: 403, body: "" });
    await unchanged();
  });
  it("refuses a disconnected connection's old channel", async () => {
    const h = notice();
    await disconnect(ada.id);
    expect(await post(h)).toEqual({ status: 403, body: "" });
    await unchanged();
  });
  it("a channel's first message (sync): 204 and no sync", async () => {
    expect(await post(notice({ "X-Goog-Resource-State": "sync" }))).toEqual({ status: 204, body: "" });
    await unchanged();
  });
  it("a real notice: 204, empty, and the change applied", async () => {
    expect(await post(notice())).toEqual({ status: 204, body: "" });
    expect(await c.activity(id)).toMatchObject({ due_on: c.day(9), due_time: "11:00" });
  });
  it("Calendar off: 204 and nothing done", async () => {
    vi.stubEnv("CALENDAR_SYNC", "");
    expect(await post(notice())).toEqual({ status: 204, body: "" });
    vi.stubEnv("CALENDAR_SYNC", "on");
    await unchanged();
  });
  it("after a renewal the old channel is stopped at Google and its notices are refused", async () => {
    const old = notice();
    const oldId = old.get("x-goog-channel-id");
    expect(await renewCalendarChannel(await c.connectionIdOf(ada.id))).toBe("renewed");
    const fresh = fake.calendarChannel(ADA)!;
    expect(fresh.id).not.toBe(oldId);
    expect(fake.requests.some((r) => r.url.endsWith("/channels/stop") && (r.body as { id?: string }).id === oldId)).toBe(true);
    expect(await post(old)).toEqual({ status: 403, body: "" });
    expect(await post(notice())).toEqual({ status: 204, body: "" });
    expect((await c.activity(id))?.due_on).toBe(c.day(9));
  });
});
