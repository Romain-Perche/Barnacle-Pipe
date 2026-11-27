// covers SF-130 US1 scenarios 2, 6, 7, FR-010, FR-013, FR-014, SC-002, SC-006 and the edge cases "Double press", "Gmail
// slow or failing", "Long quotes", "Email with no Message-ID", "Conversation hidden or emptied while writing"; T010 (the
// OAuth token endpoint's invalid_grant → needs_reconnect): a reply to a copied email is sent from the user's Gmail with
// the quote and the threading headers, stored at once in the same conversation, once per box.
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
const { sendReply, replyBox } = await import("@/server/emails/reply");
const { getConversation } = await import("@/server/emails/conversations");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");
const r = await import("./reply-helpers");
const actions = await import("@/app/(app)/records/email-actions");
const { readFlash } = await import("@/server/records/flash");
const { signInAs, connectionOf } = await import("./gmail-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  await signInAs(jar, w.ada);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const QUOTE = "On 27 Nov 2026 at 14:05, Ana Example <ana@example.test> wrote:\n> Hello,\n>\n> The price is 10.";

describe("US1 scenario 2 and 7: [ SEND ] on a reply", () => {
  // covers US1 scenario 2 (fix round 1): SF-129's notice lists the addresses ("Email sent to ana@example.test.")
  it("one email from the user's Gmail: Re:, the text then the quote, In-Reply-To and References; stored in the same conversation at once", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    fake.requests.length = 0;
    const box = await replyBox(w.ada, { mode: "reply", messageId: pricing.id }, { kind: "deal", id: w.pilot });
    expect(box.reply!.quote).toBe(QUOTE);
    const answer = await actions.sendEmailReply({
      mode: "reply", messageId: pricing.id, record: { target: "deal", id: w.pilot }, sendKey: box.sendKey, to: box.to, cc: box.cc, bcc: [],
      subject: box.reply!.subject, text: "Thanks Ana,\n\nAgreed.", fileIds: [], uploadIds: [], forwardIds: [], back: `/deals/${w.pilot}`,
    });
    expect(answer).toEqual({ status: "sent", back: `/deals/${w.pilot}` });
    const sent = fake.sentMessages(e.ADA);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: `Ada Fake <${e.ADA}>`, to: "Ana Example <ana@example.test>", cc: "", bcc: "", subject: "Re: Pricing",
      text: `Thanks Ana,\n\nAgreed.\n\n${QUOTE}`, inReplyTo: pricing.rfc_message_id, references: pricing.rfc_message_id,
    });
    // Ada's mailbox holds the conversation: the same Gmail thread, through the multipart upload.
    expect(sent[0].threadId).toBe(pricing.threadId);
    expect(fake.requests.filter((x) => x.path.endsWith("/messages/send")).map((x) => x.query.uploadType)).toEqual(["multipart"]);
    // Stored at once, in the same conversation, the newest EMAIL entry of the deal; no hand link (FR-015).
    const [row] = (await c.messageRows()).filter((m) => m.gmail_message_id === sent[0].id);
    expect(row).toMatchObject({ direction: "sent", subject: "Re: Pricing", text_body: `Thanks Ana,\n\nAgreed.\n\n${QUOTE}` });
    expect(await r.conversationOf(row.id)).toBe(pricing.conversation_id);
    expect(await e.conversationIds()).toEqual([pricing.conversation_id]);
    const entries = await e.emailEntries(w.ada, { dealId: w.pilot });
    expect(entries.map((x) => x.email!.subject)).toEqual(["Re: Pricing", "Pricing"]);
    expect((await getConversation(w.ada, pricing.conversation_id))!.emails.map((x) => x.id)).toEqual([pricing.id, row.id]);
    expect(await r.sends()).toEqual([{ id: expect.any(Number), state: "sent", reply_message_id: pricing.id, deal_id: null, person_id: null, organisation_id: null, message_id: row.id }]);
    expect(await c.handLinks()).toEqual([]);
    expect((await readFlash(["email_sent"]))?.text).toBe("Email sent to ana@example.test.");
  });
  it("References: the conversation's Message-IDs oldest first, up to and including the answered one", async () => {
    const one = await r.received(fake, e.ADA, w.adaConn, { messageId: "<one@example.test>", internalDate: new Date("2026-11-20T10:00:00Z") });
    const two = await r.received(fake, e.ADA, w.adaConn, { messageId: "<two@example.test>", threadId: one.threadId, subject: "Re: Pricing", internalDate: new Date("2026-11-21T10:00:00Z") });
    await r.received(fake, e.ADA, w.adaConn, { messageId: "<three@example.test>", threadId: one.threadId, subject: "Re: Pricing", internalDate: new Date("2026-11-22T10:00:00Z") });
    expect(two.conversation_id).toBe(one.conversation_id);
    expect((await r.reply(w.ada, two.id)).status).toBe("sent");
    expect(fake.sentMessages(e.ADA)[0]).toMatchObject({ inReplyTo: "<two@example.test>", references: "<one@example.test> <two@example.test>", threadId: one.threadId });
  });
});

describe("US1 scenario 6: cancelled", () => {
  it("opening the box sends nothing and adds no entry", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    await replyBox(w.ada, { mode: "reply", messageId: pricing.id }, null);
    expect(fake.sentMessages(e.ADA)).toEqual([]);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(1);
  });
});

describe("Edge case: double press", () => {
  it("the same send key twice, and twice at once: one email, one entry", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    const one = r.replyInput(pricing.id);
    expect((await sendReply(w.ada, one)).status).toBe("sent");
    expect((await sendReply(w.ada, one)).status).toBe("sent");
    const two = r.replyInput(pricing.id);
    expect((await Promise.all([sendReply(w.ada, two), sendReply(w.ada, two)])).map((x) => x.status)).toEqual(["sent", "sent"]);
    expect(fake.sentMessages(e.ADA)).toHaveLength(2);
    expect(await e.emailEntries(w.ada, { dealId: w.pilot })).toHaveLength(3);
  });
});

describe("Edge case: Gmail failing (not the key); T010: the key refused", () => {
  it("compose_send_failed, nothing recorded, no ledger row; the same box then sends", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    const box = r.replyInput(pricing.id);
    fake.down();
    expect(await sendReply(w.ada, box)).toEqual({ status: "refused", errors: [{ code: "compose_send_failed" }] });
    fake.down(false);
    expect(await r.sends()).toEqual([]);
    expect(fake.sentMessages(e.ADA)).toEqual([]);
    expect((await sendReply(w.ada, box)).status).toBe("sent");
  });
  it("Google refuses the key (invalid_grant): nothing sent, needs_reconnect, the connection marked", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    fake.refuseKey(e.ADA);
    expect(await r.reply(w.ada, pricing.id)).toEqual({ status: "gmail", state: "needs_reconnect" });
    expect((await connectionOf(w.ada))!.state).toBe("needs_reconnect");
    expect(fake.sentMessages(e.ADA)).toEqual([]);
    expect(await r.sends()).toEqual([]);
  });
});

describe("Edge cases: long quotes, no Message-ID", () => {
  it("an earlier text of 150,000 characters with a short reply sends; the whole quote is sent", async () => {
    const long = "x".repeat(150_000);
    const pricing = await r.received(fake, e.ADA, w.adaConn, { text: long });
    expect((await r.reply(w.ada, pricing.id, { text: "Short." })).status).toBe("sent");
    expect(fake.sentMessages(e.ADA)[0].text).toBe(`Short.\n\nOn 27 Nov 2026 at 14:05, Ana Example <ana@example.test> wrote:\n> ${long}`);
    // The typed text alone is limited.
    expect(await r.reply(w.ada, pricing.id, { text: "y".repeat(100_001) })).toEqual({ status: "refused", errors: [{ code: "compose_text_too_long" }] });
  });
  it("an earlier email without a Message-ID: no In-Reply-To, References with the earlier ids; still the same conversation", async () => {
    const one = await r.received(fake, e.ADA, w.adaConn, { messageId: "<one@example.test>", internalDate: new Date("2026-11-20T10:00:00Z") });
    const two = await r.received(fake, e.ADA, w.adaConn, { threadId: one.threadId, internalDate: new Date("2026-11-21T10:00:00Z") });
    await sql`update email_messages set rfc_message_id = null where id = ${two.id}`;
    expect((await r.reply(w.ada, two.id)).status).toBe("sent");
    const [m] = fake.sentMessages(e.ADA);
    expect(m.inReplyTo).toBe("");
    expect(m.references).toBe("<one@example.test>");
    const [row] = (await c.messageRows()).filter((x) => x.gmail_message_id === m.id);
    expect(await r.conversationOf(row.id)).toBe(one.conversation_id);
  });
});

describe("FR-013: the conversation hidden or emptied while writing", () => {
  it("a person in it made private (Bob can no longer see it): email_not_found, nothing sent", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    expect((await replyBox(w.bob, { mode: "reply", messageId: pricing.id }, null)).missing).toBeUndefined();
    await sql`update persons set private = true where id = ${w.ana}`;
    expect(await r.reply(w.bob, pricing.id)).toEqual({ status: "refused", errors: [{ code: "email_not_found" }] });
    expect(fake.sentMessages(e.BOB)).toEqual([]);
    expect(await r.sends()).toEqual([]);
  });
  it("the email no longer stored: email_not_found", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    await sql`delete from email_messages where id = ${pricing.id}`;
    expect(await r.reply(w.ada, pricing.id)).toEqual({ status: "refused", errors: [{ code: "email_not_found" }] });
    expect(fake.sentMessages(e.ADA)).toEqual([]);
  });
  it("a hidden private person is never named: an address of no visible person is sent as itself", async () => {
    await makePerson({ firstName: "Pia", createdBy: w.bob, private: true, emails: ["pia@example.test"] });
    const pricing = await r.received(fake, e.ADA, w.adaConn);
    expect((await r.reply(w.ada, pricing.id, { to: ["pia@example.test"] })).status).toBe("sent");
    expect(fake.sentMessages(e.ADA)[0].to).toBe("pia@example.test");
  });
});
