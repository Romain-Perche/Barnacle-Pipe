// covers SF-130 US4 scenarios 1–4, 6–8, FR-006, FR-009, FR-012, SC-002 (T040): the forward box lists the email's
// attachments (2.3 MB of 25 MB); the sent forward carries the chosen ones byte for byte (fetched from Gmail at send
// time, the user's own mailbox first) with record and computer files read through the checked Storage fake, the
// forwarded block and In-Reply-To; over 25 MB is refused; an attachment Gmail can't give sends nothing.
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
const { startEmailUpload } = await import("@/server/emails/compose");
const { replyBox } = await import("@/server/emails/reply");
const { attachmentAccess } = await import("@/server/emails/attachments");
const { formatFileSize } = await import("@/server/format");
const { templates } = await import("@/server/messages");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { StorageFake } = await import("../fakes/storage");
const { resetDb } = await import("./db-helpers");
const { DOCX, PDF, PNG, sized, uploadFile } = await import("./file-helpers");
const e = await import("./email-helpers");
const r = await import("./reply-helpers");

const storage = new StorageFake();
let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
const quoteBytes = sized(PDF, 2 * 1024 * 1024);
const planBytes = sized(PNG, 300 * 1024);
const files = [
  { name: "quote.pdf", size: quoteBytes.length, type: "application/pdf", data: quoteBytes },
  { name: "plan.png", size: planBytes.length, type: "image/png", data: planBytes },
];

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  storage.install();
  storage.down(false);
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  await afterResponseSettled();
  storage.uninstall();
  vi.unstubAllEnvs();
  await closeDb();
});

const forward = (o: Parameters<typeof r.replyInput>[1] = {}) => ({ mode: "forward" as const, to: ["ed@example.test"], subject: "Fwd: Pricing", text: "See below.", ...o });
const attachmentIds = async (messageId: number) =>
  (await sql<{ id: number; name: string }[]>`select id::int as id, name from email_attachments where message_id = ${messageId} order by position`);

async function fromComputer(name: string, bytes: Uint8Array<ArrayBuffer>, userId: number) {
  const u = await startEmailUpload(userId, { name, size: bytes.length, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  if (u.status !== "ok") throw new Error(u.status);
  const put = await storage.fetch(u.url, { method: "PUT", headers: { "content-type": u.contentType }, body: bytes });
  if (put.status !== 200) throw new Error(`PUT ${put.status}`);
  return u.id;
}

const BLOCK = [
  "---------- Forwarded message ---------",
  "From: Ana Example <ana@example.test>",
  "Date: 27 Nov 2026 at 14:05",
  "Subject: Pricing",
  "To: ada@barnacle.ai",
  "",
  "Hello,\n\nThe price is 10.",
].join("\n");

describe("US4 scenarios 1–3, 8: [ FORWARD ]", () => {
  it("the box: Fwd:, To empty, both attachments with sizes, 2.3 MB of 25 MB; sent with quote.pdf only, byte for byte, the block, In-Reply-To", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn, { attachments: files });
    const [quote, plan] = await attachmentIds(pricing.id);
    const box = await replyBox(w.ada, { mode: "forward", messageId: pricing.id }, null);
    expect(box).toMatchObject({
      to: [], cc: [], record: null, files: [],
      reply: { mode: "forward", heading: "// FORWARD · Pricing", subject: "Fwd: Pricing", quote: BLOCK, forwarded: [{ id: quote.id, name: "quote.pdf", size: quoteBytes.length }, { id: plan.id, name: "plan.png", size: planBytes.length }] },
    });
    expect(templates.compose_room(formatFileSize(box.reply!.forwarded.reduce((n, f) => n + f.size, 0)))).toBe("2.3 MB of 25 MB");
    const links = await e.linksOf(pricing.conversation_id);
    // plan.png removed in the box.
    expect((await r.reply(w.ada, pricing.id, forward({ sendKey: box.sendKey, forwardIds: [quote.id] }))).status).toBe("sent");
    const [m] = fake.sentMessages(e.ADA);
    expect(m).toMatchObject({ to: "ed@example.test", subject: "Fwd: Pricing", text: `See below.\n\n${BLOCK}`, inReplyTo: pricing.rfc_message_id });
    expect(m.attachments).toEqual([{ name: "quote.pdf", type: "application/pdf", bytes: Buffer.from(quoteBytes) }]);
    // Listed in the same conversation, links unchanged (ed is no CRM person).
    const [row] = await sql<{ id: number }[]>`select id::int as id from email_messages where gmail_message_id = ${m.id}`;
    expect(await r.conversationOf(row.id)).toBe(pricing.conversation_id);
    expect(await e.linksOf(pricing.conversation_id)).toEqual(links);
    expect(await sql`select name from email_attachments where message_id = ${row.id}`).toEqual([{ name: "quote.pdf" }]);
  });
});

describe("US4 scenario 4: with a record file and a computer file", () => {
  it("all sent together; over 25 MB in total refused", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn, { attachments: files });
    const [quote, plan] = await attachmentIds(pricing.id);
    const proposal = await uploadFile(storage, w.ada, { dealId: w.pilot }, "proposal.pdf", sized(PDF, 2000));
    const notes = await fromComputer("notes.docx", sized(DOCX, 300), w.ada);
    const box = await replyBox(w.ada, { mode: "forward", messageId: pricing.id }, { kind: "deal", id: w.pilot });
    expect(box.files.map((f) => f.name)).toEqual(["proposal.pdf"]);
    const answer = await r.reply(w.ada, pricing.id, forward({ record: { kind: "deal", id: w.pilot }, forwardIds: [quote.id, plan.id], fileIds: [proposal], uploadIds: [notes] }));
    expect(answer.status).toBe("sent");
    expect(fake.sentMessages(e.ADA)[0].attachments.map((a) => [a.name, a.bytes.length])).toEqual([
      ["quote.pdf", quoteBytes.length], ["plan.png", planBytes.length], ["proposal.pdf", 2000], ["notes.docx", 300],
    ]);
    // A forwarded file of 25 MB minus 100 bytes plus the record file: over 25 MB, nothing sent.
    const big = await r.received(fake, e.ADA, w.adaConn, { attachments: [{ name: "big.bin", size: 25 * 1024 * 1024 - 100 }] });
    const [bigId] = await attachmentIds(big.id);
    expect(await r.reply(w.ada, big.id, forward({ record: { kind: "deal", id: w.pilot }, forwardIds: [bigId.id], fileIds: [proposal] }))).toEqual({ status: "refused", errors: [{ code: "compose_attachments_too_large" }] });
    expect(fake.sentMessages(e.ADA)).toHaveLength(1);
  });
  it("a forwarded id of another email, or a record file without a usable record: compose_attachment_gone", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn, { attachments: files });
    const other = await r.received(fake, e.ADA, w.adaConn, { attachments: [files[1]] });
    const [otherPlan] = await attachmentIds(other.id);
    expect(await r.reply(w.ada, pricing.id, forward({ forwardIds: [otherPlan.id] }))).toEqual({ status: "refused", errors: [{ code: "compose_attachment_gone" }] });
    const proposal = await uploadFile(storage, w.ada, { dealId: w.pilot }, "proposal.pdf", sized(PDF, 2000));
    await sql`update deals set archived_at = now() where id = ${w.pilot}`;
    expect(await r.reply(w.ada, pricing.id, forward({ record: { kind: "deal", id: w.pilot }, fileIds: [proposal] }))).toEqual({ status: "refused", errors: [{ code: "compose_attachment_gone" }] });
    expect(fake.sentMessages(e.ADA)).toEqual([]);
  });
});

describe("US4 scenario 7, FR-012: Gmail can't give an attachment", () => {
  it("failAttachments: reply_forward_unavailable, nothing sent, no ledger row; then it sends", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn, { attachments: files });
    const [quote] = await attachmentIds(pricing.id);
    const input = r.replyInput(pricing.id, forward({ forwardIds: [quote.id] }));
    fake.failAttachments();
    const { sendReply } = await import("@/server/emails/reply");
    expect(await sendReply(w.ada, input)).toEqual({ status: "refused", errors: [{ code: "reply_forward_unavailable" }] });
    expect(fake.sentMessages(e.ADA)).toEqual([]);
    expect(await r.sends()).toEqual([]);
    fake.failAttachments(false);
    expect((await sendReply(w.ada, input)).status).toBe("sent");
  });
  it("the email no longer in any working mailbox (Ada's mailbox disconnected, Bob forwards): nothing sent", async () => {
    const pricing = await r.received(fake, e.ADA, w.adaConn, { attachments: files });
    const [quote] = await attachmentIds(pricing.id);
    await sql`update gmail_connections set state = 'needs_reconnect' where id = ${w.adaConn}`;
    expect(await r.reply(w.bob, pricing.id, forward({ forwardIds: [quote.id] }))).toEqual({ status: "refused", errors: [{ code: "reply_forward_unavailable" }] });
    expect(fake.sentMessages(e.BOB)).toEqual([]);
  });
});

describe("FR-012: the user's own mailbox first", () => {
  it("attachmentAccess with preferConnectionId puts that mailbox's copy first; without it the order is unchanged", async () => {
    const id = "<shared@example.test>";
    const ada = await r.received(fake, e.ADA, w.adaConn, { attachments: files, messageId: id, to: `${e.ADA}, ${e.BOB}` });
    await r.received(fake, e.BOB, w.bobConn, { attachments: files, messageId: id, to: `${e.ADA}, ${e.BOB}` });
    const [quote] = await attachmentIds(ada.id);
    expect((await attachmentAccess(w.bob, quote.id))!.candidates.map((c) => c.connectionId)).toEqual([w.adaConn, w.bobConn]);
    expect((await attachmentAccess(w.bob, quote.id, { preferConnectionId: w.bobConn }))!.candidates.map((c) => c.connectionId)).toEqual([w.bobConn, w.adaConn]);
    fake.requests.length = 0;
    expect((await r.reply(w.bob, ada.id, forward({ forwardIds: [quote.id] }))).status).toBe("sent");
    // The bytes came from Bob's own mailbox only.
    const reads = fake.requests.filter((x) => x.path.includes("/attachments/"));
    expect(reads).toHaveLength(1);
    expect(fake.sentMessages(e.BOB)[0].attachments[0].bytes).toEqual(Buffer.from(quoteBytes));
  });
});
