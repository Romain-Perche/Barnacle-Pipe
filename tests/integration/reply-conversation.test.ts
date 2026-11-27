// covers SF-130 US2 scenarios 1–6, FR-011, FR-014, FR-015, FR-016, FR-017, SC-003, SC-004: a reply to a conversation
// copied only from a colleague's mailbox joins the same CRM conversation (a new Gmail thread for the sender), a reply
// from the mailbox holding it stays in its Gmail thread, the links stay as they are, SF-127 adds the people newly in
// it, the sync never copies it twice, Last contacted follows SF-127.
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
const { linkRecord, unlinkRecord, getConversation } = await import("@/server/emails/conversations");
const { runGmailCheck } = await import("@/server/gmail/sync");
const past = await import("@/server/gmail/past");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const { makeDeal } = await import("./deal-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");
const r = await import("./reply-helpers");
const h = await import("./gmail-helpers");

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

const sentRow = async (gmailId: string) => (await c.messageRows()).find((m) => m.gmail_message_id === gmailId)!;

describe("US2 scenarios 1 and 2: the same conversation, whichever mailbox holds it", () => {
  it("Bob replies to a conversation copied only from Ada's mailbox: same conversation, a new Gmail thread for Bob; Ada's reply stays in her thread", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(1);
    expect((await r.reply(w.bob, pricing.id)).status).toBe("sent");
    const [bobs] = fake.sentMessages(e.BOB);
    expect(bobs).toMatchObject({ from: `Bob Fake <${e.BOB}>`, inReplyTo: pricing.rfc_message_id, references: pricing.rfc_message_id });
    expect(bobs.threadId).not.toBe(pricing.threadId);
    expect(fake.requests.filter((x) => x.path.endsWith("/messages/send")).at(-1)!.query.uploadType).toBe("media");
    const bobRow = await sentRow(bobs.id);
    expect(await r.conversationOf(bobRow.id)).toBe(pricing.conversation_id);
    expect(await e.conversationIds()).toEqual([pricing.conversation_id]);
    for (const t of [{ dealId: w.pilot }, { personId: w.ana }]) {
      expect((await e.emailEntries(w.ada, t)).map((x) => x.email!.conversationId)).toEqual([pricing.conversation_id, pricing.conversation_id]);
    }
    expect((await getConversation(w.ada, pricing.conversation_id))!.emails).toHaveLength(2);

    // Ada replies to Bob's reply: her own mailbox holds the conversation, so the same Gmail thread (SC-004).
    expect((await r.reply(w.ada, bobRow.id, { to: [e.BOB] })).status).toBe("sent");
    const [adas] = fake.sentMessages(e.ADA);
    expect(adas.threadId).toBe(pricing.threadId);
    expect(adas.references).toBe(`${pricing.rfc_message_id} ${bobs.messageId}`);
    expect(await r.conversationOf((await sentRow(adas.id)).id)).toBe(pricing.conversation_id);
    expect(await e.conversationIds()).toEqual([pricing.conversation_id]);
  });
});

describe("US2 scenarios 3 and 4: links", () => {
  it("a hand link and a link removed by hand stay as they are; no hand link is added", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    const conversationId = pricing.conversation_id;
    expect((await linkRecord(w.ada, { conversationId, kind: "organisation", recordId: w.otherCo })).status).toBe("ok");
    const [dealLink] = await sql<{ id: number }[]>`select id::int as id from email_links where conversation_id = ${conversationId} and deal_id = ${w.pilot}`;
    expect((await unlinkRecord(w.ada, { conversationId, linkId: dealLink.id })).status).toBe("ok");
    const before = await e.linksOf(conversationId);
    expect((await r.reply(w.bob, pricing.id)).status).toBe("sent");
    expect((await r.reply(w.ada, pricing.id)).status).toBe("sent");
    expect(await e.linksOf(conversationId)).toEqual(before);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(0);
    expect(await e.emailEntries(w.ada, { organisationId: w.otherCo })).toHaveLength(3);
  });
  it("a CRM person newly in Cc is linked automatically, with their organisation and their one open deal", async () => {
    const benDeal = await makeDeal({ title: "Other Co – trial", stageId: w.stage, createdBy: w.ada, personId: w.ben, organisationId: w.otherCo });
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    expect(await e.emailEntries(w.ada, { personId: w.ben })).toHaveLength(0);
    expect((await r.reply(w.bob, pricing.id, { cc: ["ben@example.test"] })).status).toBe("sent");
    const links = await e.linksOf(pricing.conversation_id);
    for (const l of [{ person_id: w.ben }, { organisation_id: w.otherCo }, { deal_id: benDeal }]) {
      expect(links).toContainEqual(expect.objectContaining({ ...l, how: "auto", removed: false }));
    }
    expect(await e.emailEntries(w.ada, { personId: w.ben })).toHaveLength(2);
  });
});

describe("US2 scenario 5, FR-016: the sync afterwards", () => {
  it("the push / 15-minute check copies nothing twice; the conversations count and a past-email fetch's copied do not grow", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    expect((await r.reply(w.bob, pricing.id)).status).toBe("sent");
    expect((await r.reply(w.ada, pricing.id)).status).toBe("sent");
    const counts = { ada: await h.conversations(w.ada), bob: await h.conversations(w.bob) };
    await e.sync(w.bobConn);
    await e.sync(w.adaConn);
    await runGmailCheck();
    expect(await c.messageRows()).toHaveLength(3);
    for (const t of [{ dealId: w.pilot }, { personId: w.ana }]) expect(await e.emailEntries(w.ada, t)).toHaveLength(3);
    expect({ ada: await h.conversations(w.ada), bob: await h.conversations(w.bob) }).toEqual(counts);
    expect(await past.startPastFetch(w.bob, new Date())).toBe("started");
    for (let i = 0; i < 50; i++) if ((await past.runPastFetchPart(w.bobConn, { now: new Date() })).next === "ended") break;
    expect((await h.pastFetchOf(w.bob))!).toMatchObject({ state: "ended", copied: 0 });
    expect(await e.conversationIds()).toEqual([pricing.conversation_id]);
  });
});

describe("US2 scenario 6: Last contacted", () => {
  it("the send time, unless it was already later", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    const sentAt = new Date("2026-11-28T09:00:00Z");
    const { sendReply } = await import("@/server/emails/reply");
    expect((await sendReply(w.bob, r.replyInput(pricing.id), sentAt)).status).toBe("sent");
    expect((await e.lastContacted(w.ana))!.toISOString()).toBe(sentAt.toISOString());
    const later = new Date("2027-01-01T00:00:00Z");
    await sql`update persons set last_contacted_at = ${later} where id = ${w.ana}`;
    expect((await sendReply(w.ada, r.replyInput(pricing.id), new Date("2026-11-29T09:00:00Z"))).status).toBe("sent");
    expect((await e.lastContacted(w.ana))!.toISOString()).toBe(later.toISOString());
  });
});
