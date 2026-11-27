// covers SF-129 FR-005, FR-021, Edge Cases "Archived records", "Record no longer visible", "Addresses", "Required
// fields", "Sending to oneself": every refusal answers its code and sends nothing, leaves no ledger row; the record is
// checked again at send time; an address of no CRM person (a teammate) gets only the hand link.
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

describe("the form's checks (data-model.md § Validation)", () => {
  it("each refusal answers its codes and sends nothing", async () => {
    const cases: [Parameters<typeof c.send>[2], unknown[]][] = [
      [{ to: ["ana@"] }, [{ code: "compose_address_invalid", address: "ana@" }]],
      [{ to: [] }, [{ code: "compose_to_required" }]],
      [{ subject: "  " }, [{ code: "compose_subject_required" }]],
      [{ to: Array.from({ length: 101 }, (_, i) => `p${i}@example.test`) }, [{ code: "compose_too_many_addresses" }]],
      [{ subject: "s".repeat(251) }, [{ code: "compose_subject_too_long" }]],
      [{ text: "t".repeat(100_001) }, [{ code: "compose_text_too_long" }]],
      [{ to: ["ana@example.test\r\nBcc: x@example.test"] }, [{ code: "compose_address_invalid", address: "ana@example.test\r\nBcc: x@example.test" }]],
    ];
    for (const [o, errors] of cases) expect(await c.send(w.ada, deal(), o)).toEqual({ status: "refused", errors });
    await nothingSent();
  });
  it("duplicates are removed silently, the first kept", async () => {
    await c.send(w.ada, deal(), { to: ["Ana@Example.test"], cc: ["ana@example.test", "ben@example.test"], bcc: ["BEN@example.test"] });
    const [m] = fake.sentMessages(e.ADA);
    expect([m.to, m.cc, m.bcc]).toEqual(["Ana Example <Ana@Example.test>", "Ben Example <ben@example.test>", ""]);
  });
});

describe("FR-021: the record at send time", () => {
  it("archived after the box opened → compose_record_archived", async () => {
    await sql`update deals set archived_at = now() where id = ${w.pilot}`;
    expect(await c.send(w.ada, deal())).toEqual({ status: "refused", errors: [{ code: "compose_record_archived" }] });
    await nothingSent();
  });
  it("deleted, or made private to someone else → compose_record_not_found", async () => {
    const theirs = await makeDeal({ title: "Bob's", stageId: w.stage, createdBy: w.bob });
    await sql`update deals set private = true where id = ${theirs}`;
    expect(await c.send(w.ada, { kind: "deal", id: theirs })).toEqual({ status: "refused", errors: [{ code: "compose_record_not_found" }] });
    const gone = await makePerson({ firstName: "Gone", createdBy: w.ada });
    await sql`delete from persons where id = ${gone}`;
    expect(await c.send(w.ada, { kind: "person", id: gone })).toEqual({ status: "refused", errors: [{ code: "compose_record_not_found" }] });
    expect(await c.send(w.ada, { kind: "organisation", id: 999_999 })).toEqual({ status: "refused", errors: [{ code: "compose_record_not_found" }] });
    await nothingSent();
  });
});

describe("Edge Case: sending to a teammate (no CRM person)", () => {
  it("is sent, with only the hand link to the record", async () => {
    expect((await c.send(w.ada, deal(), { to: [e.BOB] })).status).toBe("sent");
    const links = await sql`select how, deal_id::int as deal_id from email_links`;
    expect(links).toEqual([{ how: "manual", deal_id: w.pilot }]);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(1);
  });
});
