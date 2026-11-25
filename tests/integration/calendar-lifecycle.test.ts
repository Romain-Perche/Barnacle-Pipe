// covers SF-124 FR-003, FR-007, FR-010, edge cases "Disconnect or deactivation" and "Google no longer accepts the key"
// (research.md §11-§15): disconnecting or deactivating stops calendar sync (channel stopped, events left as they are);
// connecting again gives exactly one event per planned activity; the 15-minute check renews old channels only; Google
// taking Calendar away shows "Calendar access missing" while Gmail works; two syncs at once make one event each.
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
const { calendarAfterChange, syncCalendar } = await import("@/server/calendar/sync");
const { disconnect, gmailSettings, markNeedsReconnect, settingsWarning } = await import("@/server/gmail/connections");
const { runGmailCheck } = await import("@/server/gmail/sync");
const { deactivate } = await import("@/server/users");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeUser, resetDb } = await import("./db-helpers");
const c = await import("./calendar-helpers");

const ADA = "ada@barnacle.ai";
let ada: { id: number }, grace: { id: number };
let fake: ReturnType<typeof installGmailFake>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CALENDAR_SYNC", "on");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: ADA, name: "Ada Fake" });
  grace = await makeUser({ email: "grace@barnacle.ai", name: "Grace Fake", role: "admin" });
  fake = installGmailFake();
  await c.connectCalendar(jar, fake, ada.id);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const channelRow = async () =>
  (await sql<{ id: string | null; renewed: Date | null }[]>`
    select calendar_channel_id as id, calendar_channel_renewed_at as renewed from gmail_connections where user_id = ${ada.id}`)[0];

describe("edge case \"Disconnect or deactivation\"", () => {
  it.each([
    ["disconnect", () => disconnect(ada.id)],
    ["deactivation", async () => expect((await deactivate(grace.id, ada.id)).ok).toBe(true)],
  ])("%s: the channel is stopped, the events stay, a reschedule leaves its event as it was", async (_name, stop) => {
    const id = await c.schedule(ada.id, { subject: "Kept" });
    await calendarAfterChange([id]);
    const channel = fake.calendarChannel(ADA)!;
    await stop();
    expect(fake.calendarChannel(ADA)).toBeNull();
    expect(fake.requests.some((r) => r.url.endsWith("/channels/stop") && (r.body as { id?: string }).id === channel.id)).toBe(true);
    expect((await channelRow()).id).toBeNull();
    const before = c.live(fake, ADA);
    expect(before).toHaveLength(1);
    await sql`update activities set due_on = ${c.day(20)}, version = version + 1 where id = ${id}`;
    await calendarAfterChange([id]);
    await runGmailCheck();
    expect(c.live(fake, ADA)).toEqual(before);
    expect(await c.activity(id)).toBeTruthy();
  });
  it("connecting again: exactly one event per planned activity due today or later, kept links patched", async () => {
    const kept = await c.schedule(ada.id, { subject: "Kept" });
    await calendarAfterChange([kept]);
    await disconnect(ada.id);
    const a = (await c.activity(kept))!;
    expect((await A.editActivity(ada.id, kept, a.version, c.form({ subject: "Kept, edited" }))).status).toBe("ok");
    const added = await c.schedule(ada.id, { subject: "Added while off" });
    expect(await c.connectCalendar(jar, fake, ada.id)).toBe("/settings");
    const events = c.live(fake, ADA);
    expect(events.map((e) => e.summary).sort()).toEqual(["Call · Added while off", "Call · Kept, edited"]);
    expect((await c.linkOf(added))?.state).toBe("synced");
    expect(fake.calendarChannel(ADA)).not.toBeNull();
  });
});

describe("FR-010: the 15-minute check renews old channels only", () => {
  it("renews a channel older than 20 h, not a fresh one", async () => {
    const first = await channelRow();
    await runGmailCheck();
    expect((await channelRow()).id).toBe(first.id);
    await sql`update gmail_connections set calendar_channel_renewed_at = now() - interval '21 hours'`;
    await runGmailCheck();
    const after = await channelRow();
    expect(after.id).not.toBe(first.id);
    expect(fake.calendarChannel(ADA)?.id).toBe(after.id);
  });
  it("a connection with no channel (the watch failed at connect) gets one at the next check", async () => {
    await sql`update gmail_connections set calendar_channel_id = null, calendar_channel_resource_id = null, calendar_channel_token_hash = null, calendar_channel_renewed_at = null`;
    await runGmailCheck();
    expect((await channelRow()).id).toBeTruthy();
  });
});

describe("Google takes Calendar away (403 insufficientPermissions)", () => {
  it("the Calendar scope goes: \"Calendar access missing\" and the \"!\", while Gmail stays working", async () => {
    // The user removed the app's Calendar access in their Google Account.
    fake.removeScope(ADA, "https://www.googleapis.com/auth/calendar.events.owned");
    await c.schedule(ada.id);
    expect(await c.sync(ada.id)).toEqual({ skipped: "no_calendar" });
    expect(await gmailSettings(ada.id)).toMatchObject({ state: "working", calendar: "missing" });
    expect(await settingsWarning(ada.id)).toBe("calendar");
  });
});

describe("concurrency", () => {
  it("two syncs at once: one runs, the other asks it to go again; still one event each", async () => {
    const ids = [await c.schedule(ada.id, { subject: "One" }), await c.schedule(ada.id, { subject: "Two" })];
    const conn = await c.connectionIdOf(ada.id);
    const [r1, r2] = await Promise.all([syncCalendar(conn), syncCalendar(conn)]);
    expect([r1, r2].filter((r) => "skipped" in r && r.skipped === "busy")).toHaveLength(1);
    expect(c.live(fake, ADA).map((e) => e.summary).sort()).toEqual(["Call · One", "Call · Two"]);
    for (const id of ids) expect((await c.linkOf(id))?.state).toBe("synced");
    const [{ again }] = await sql<{ again: boolean }[]>`select calendar_sync_again as again from gmail_connections where id = ${conn}`;
    expect(again).toBe(false);
  });
});

// covers FR-006, Fix round 1 (1): a call reassigned while the old assignee's connection cannot be reached leaves her
// event until that connection syncs again with Calendar access; then it is removed, and the new assignee keeps one.
describe("FR-006: reassigned while the old assignee's calendar does not sync", () => {
  const LINUS = "linus@barnacle.ai";
  it.each([
    ["needs reconnecting (key refused)", async () => markNeedsReconnect(await c.connectionIdOf(ada.id))],
    ["working without the Calendar scope", async () => void (await sql`update gmail_connections set scopes = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send' where user_id = ${ada.id}`)],
    ["disconnected", () => disconnect(ada.id)],
  ])("%s: Linus gets one event at once, Ada's goes when she connects again", async (_name, cut) => {
    const linus = await makeUser({ email: LINUS, name: "Linus Fake" });
    await c.connectCalendar(jar, fake, linus.id);
    const id = await c.schedule(ada.id, { subject: "Moved on", dueOn: c.day(1) });
    await calendarAfterChange([id]);
    expect(c.live(fake, ADA).filter((e) => e.summary === "Call · Moved on")).toHaveLength(1);
    await cut();
    const r = await A.editActivity(ada.id, id, await c.versionOf(id), c.form({ subject: "Moved on", dueOn: c.day(1), assigneeId: String(linus.id) }));
    expect(r.status).toBe("ok");
    await c.sync(linus.id);
    expect(c.live(fake, LINUS).filter((e) => e.summary === "Call · Moved on")).toHaveLength(1);
    // Ada's connection cannot be reached: her event is left as it was for now.
    expect(c.live(fake, ADA).filter((e) => e.summary === "Call · Moved on")).toHaveLength(1);
    await c.connectCalendar(jar, fake, ada.id);
    await c.sync(ada.id);
    expect(c.live(fake, ADA).filter((e) => e.summary === "Call · Moved on")).toHaveLength(0);
    expect(c.live(fake, LINUS).filter((e) => e.summary === "Call · Moved on")).toHaveLength(1);
    const rows = await sql<{ connection_id: number }[]>`
      select connection_id::int as connection_id from calendar_events where activity_id = ${id} or activity_id is null`;
    expect(rows).toEqual([{ connection_id: await c.connectionIdOf(linus.id) }]);
  });
});
