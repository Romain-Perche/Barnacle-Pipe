// covers SF-130 US3 scenarios 1 and 4, FR-005, FR-009 (T036): the reply all box (To and Cc filled with everyone but the
// user, named as the user's visible CRM people), and the email sent to exactly the addresses left after removing one.
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

const { closeDb } = await import("@/server/db");
const { replyBox } = await import("@/server/emails/reply");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const r = await import("./reply-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

describe("US3 scenarios 1 and 4: [ REPLY ALL ]", () => {
  it("To = the sender and the other To, Cc = the Cc, the user nowhere; sent to exactly the addresses left", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn, { to: `Ada Fake <Ada@Barnacle.ai>, ben@example.test`, cc: "cat@example.test" });
    const box = await replyBox(w.ada, { mode: "reply_all", messageId: pricing.id }, { kind: "deal", id: w.pilot });
    expect(box).toMatchObject({
      gmail: "ok", from: e.ADA, to: ["ana@example.test", "ben@example.test"], cc: ["cat@example.test"],
      names: { "ana@example.test": "Ana Example", "ben@example.test": "Ben Example" },
      record: { kind: "deal", id: w.pilot, name: "Example Ltd – pilot" },
      reply: { mode: "reply_all", messageId: pricing.id, heading: "// REPLY ALL · Pricing", subject: "Re: Pricing", forwarded: [] },
    });
    // Ben removed in the box.
    expect((await r.reply(w.ada, pricing.id, { mode: "reply_all", sendKey: box.sendKey, to: ["ana@example.test"], cc: box.cc })).status).toBe("sent");
    const [m] = fake.sentMessages(e.ADA);
    expect([m.to, m.cc, m.bcc]).toEqual(["Ana Example <ana@example.test>", "cat@example.test", ""]);
  });
});
