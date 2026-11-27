// covers SF-129 US4 scenarios 1–4, FR-008, SC-004, SC-006: without a working Gmail connection the box shows the state
// (and no fields), a send answers it with no Google call; a key Google refuses at send time marks the connection
// needs_reconnect (the sidebar's Settings "!") and nothing is recorded.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/deals/1" }),
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

const { closeDb, sql } = await import("@/server/db");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  fake.requests.length = 0;
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const deal = () => ({ kind: "deal" as const, id: w.pilot });
const nothingSent = async () => {
  expect(fake.sentMessages(e.ADA)).toEqual([]);
  expect(await c.ledger()).toEqual([]);
  expect(await c.messageRows()).toEqual([]);
};
const { settingsWarning } = await import("@/server/gmail/connections");

describe("the Gmail state of the box and of a send", () => {
  it("never connected → not_connected", async () => {
    const zed = (await (await import("./db-helpers")).makeUser({ email: "zed@barnacle.ai", name: "Zed Fake" })).id;
    expect((await (await import("@/server/emails/compose")).emailBox(zed, deal()))!.gmail).toBe("not_connected");
    expect(await c.send(zed, deal())).toEqual({ status: "gmail", state: "not_connected" });
    expect(fake.requests).toEqual([]);
  });
  it("disconnected → not_connected; needs reconnecting → needs_reconnect", async () => {
    const { emailBox } = await import("@/server/emails/compose");
    await (await import("@/server/gmail/connections")).disconnect(w.ada);
    fake.requests.length = 0;
    expect((await emailBox(w.ada, deal()))!.gmail).toBe("not_connected");
    expect(await c.send(w.ada, deal())).toEqual({ status: "gmail", state: "not_connected" });
    await sql`update gmail_connections set state = 'needs_reconnect' where user_id = ${w.bob}`;
    expect((await emailBox(w.bob, deal()))!.gmail).toBe("needs_reconnect");
    expect(await c.send(w.bob, deal())).toEqual({ status: "gmail", state: "needs_reconnect" });
    expect(fake.requests).toEqual([]);
    await nothingSent();
  });
  it("Gmail off for the app → off", async () => {
    vi.stubEnv("GMAIL_TOKEN_KEY", "");
    const { emailBox } = await import("@/server/emails/compose");
    expect((await emailBox(w.ada, deal()))!.gmail).toBe("off");
    expect(await c.send(w.ada, deal())).toEqual({ status: "gmail", state: "off" });
    vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
    expect(fake.requests).toEqual([]);
  });
  it("a key refused at send time → needs_reconnect, the connection marked, the Settings warning, nothing recorded", async () => {
    fake.refuseKey(e.ADA);
    expect(await c.send(w.ada, deal())).toEqual({ status: "gmail", state: "needs_reconnect" });
    expect((await sql`select state from gmail_connections where id = ${w.adaConn}`)[0].state).toBe("needs_reconnect");
    expect(await settingsWarning(w.ada)).toBe("gmail");
    await nothingSent();
  });
});
