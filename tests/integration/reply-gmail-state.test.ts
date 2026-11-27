// covers SF-130 US5 scenarios 1–3 and 5, FR-002, FR-018, SC-005 (T047): without a working Gmail connection every email
// shows "[ CONNECT GMAIL TO REPLY ]" (never connected, disconnected) or "[ RECONNECT GMAIL TO REPLY ]" (needs
// reconnecting), a link to Settings, and no reply buttons; Gmail off shows neither; a reply address opened directly shows
// SF-129's message and [ GO TO SETTINGS ] with no [ SEND ]; sendReply sends nothing.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/people" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { closeDb, sql } = await import("@/server/db");
const { default: DealPage } = await import("@/app/(app)/deals/[id]/page");
const { default: ConversationPage } = await import("@/app/(app)/emails/[id]/page");
const { replyState } = await import("@/server/emails/reply");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");
const r = await import("./reply-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
let pricing: Awaited<ReturnType<typeof r.received>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  pricing = await r.received(fake, e.ADA, w.adaConn);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const props = (id: number, q: Record<string, string> = {}) => ({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve(q) });
const pages = async () => [await e.html(await DealPage(props(w.pilot))), await e.html(await ConversationPage(props(pricing.conversation_id)))];

describe("US5 scenarios 1–3: the Settings link in place of the buttons", () => {
  it("never connected: [ CONNECT GMAIL TO REPLY ] to Settings on every email, no reply buttons", async () => {
    const cat = await makeUser({ email: "cat@barnacle.ai", name: "Cat Fake" });
    await h.signInAs(jar, cat.id);
    expect(await replyState(cat.id)).toBe("connect");
    for (const out of await pages()) {
      expect(out).toContain('<span class="acts mini"><a class="btn" href="/settings">[ CONNECT GMAIL TO REPLY ]</a></span>');
      expect(out).not.toMatch(/\[ REPLY \]|\[ REPLY ALL \]|\[ FORWARD \]/);
    }
  });
  it("disconnected: connect; needs reconnecting: [ RECONNECT GMAIL TO REPLY ]", async () => {
    // Bob's mailbox holds nothing: disconnecting it (the real path) leaves Ada's conversation in place.
    const { disconnect } = await import("@/server/gmail/connections");
    await disconnect(w.bob);
    await h.signInAs(jar, w.bob);
    for (const out of await pages()) expect(out).toContain('href="/settings">[ CONNECT GMAIL TO REPLY ]</a>');
    await h.signInAs(jar, w.ada);
    await sql`update gmail_connections set state = 'needs_reconnect' where id = ${w.adaConn}`;
    for (const out of await pages()) {
      expect(out).toContain('href="/settings">[ RECONNECT GMAIL TO REPLY ]</a>');
      expect(out).not.toContain("[ REPLY ]");
    }
  });
  it("Gmail off: neither the buttons nor the link", async () => {
    await h.signInAs(jar, w.ada);
    vi.stubEnv("GMAIL_TOKEN_KEY", "");
    expect(await replyState(w.ada)).toBe("off");
    for (const out of await pages()) {
      expect(out).toContain("Pricing");
      expect(out).not.toContain("GMAIL TO REPLY");
      expect(out).not.toContain("[ REPLY ]");
    }
  });
});

describe("US5 scenario 5, SC-005: a reply address opened directly, a send, without a connection", () => {
  it("the box shows SF-129's message and [ GO TO SETTINGS ], no [ SEND ]; sendReply sends nothing", async () => {
    const cat = await makeUser({ email: "cat@barnacle.ai", name: "Cat Fake" });
    await h.signInAs(jar, cat.id);
    const out = await e.html(await DealPage(props(w.pilot, { email: `reply-${pricing.id}` })));
    expect(out).toContain("Connect your Gmail in Settings to send email from the CRM.");
    expect(out).toContain('href="/settings">[ GO TO SETTINGS ]</a>');
    expect(out).not.toContain("[ SEND ]");
    fake.requests.length = 0;
    expect(await r.reply(cat.id, pricing.id)).toEqual({ status: "gmail", state: "not_connected" });
    await sql`update gmail_connections set state = 'needs_reconnect' where id = ${w.adaConn}`;
    expect(await r.reply(w.ada, pricing.id)).toEqual({ status: "gmail", state: "needs_reconnect" });
    expect(fake.requests).toEqual([]);
    expect(await r.sends()).toEqual([]);
  });
});
