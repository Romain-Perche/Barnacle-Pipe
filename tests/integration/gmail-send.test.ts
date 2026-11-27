// covers SF-118 US3 scenarios 1-4, FR-006, FR-013, FR-014, SC-006: sendGmail sends RFC 5322 mail from the user's own
// Gmail (in a conversation when asked), refuses before any Google call without a working connection, and the Settings
// test email goes to the user's own address.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
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
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { closeDb } = await import("@/server/db");
const { runGmailCheck } = await import("@/server/gmail/sync");
const { GmailNeedsReconnect, GmailNotConnected, GmailUnavailable, sendGmail } = await import("@/server/gmail/send");
const { BadHeader } = await import("@/server/gmail/rules");
const SettingsPage = (await import("@/app/(app)/settings/page")).default;
const actions = await import("@/app/(app)/settings/actions");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");

const LINUS = "linus@barnacle.ai";
let linus: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installGmailFake>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: LINUS, name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  await makePerson({ firstName: "Ana", createdBy: linus.id, emails: ["ana@example.test"] });
  fake = installGmailFake();
  await h.signInAs(jar, linus.id);
  await h.connectGmail(fake);
  fake.requests.length = 0;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const sends = () => fake.requests.filter((r) => r.path.endsWith("/messages/send"));
// SF-129: without a thread the message goes through the upload endpoint (the body is the message itself); in a thread
// through the JSON call ({ raw } in base64url).
const rawOf = (i = 0) => {
  const body = sends()[i].body;
  return typeof body === "string" ? body : Buffer.from((body as { raw: string }).raw, "base64url").toString("utf8");
};
const page = async (query: Record<string, string> = {}) => renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve(query) }));

describe("US3 scenario 1: [ SEND ME A TEST EMAIL ]", () => {
  it("sends one email from and to the user, with the fixed subject and text, into Sent and Inbox", async () => {
    expect(await h.redirectOf(actions.sendTestEmail())).toBe("/settings");
    expect(sends()).toHaveLength(1);
    const raw = rawOf();
    expect(raw).toContain(`From: ${LINUS}\r\n`);
    expect(raw).toContain(`To: ${LINUS}\r\n`);
    expect(raw).toContain("Subject: Barnacle CRM test email\r\n");
    const body = /\r\n\r\n([A-Za-z0-9+/=\r\n]+)$/.exec(raw)![1];
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(
      "This is a test email from Barnacle CRM. If you can read it, the CRM can send email from your Gmail.",
    );
    const box = fake.mailbox(LINUS);
    expect(box).toHaveLength(1);
    expect(box[0].labelIds).toEqual(expect.arrayContaining(["SENT", "INBOX"]));
    expect(await page()).toContain("Test email sent to linus@barnacle.ai. Check your inbox.");
  });
});

describe("US3 scenario 2: Gmail does not answer or refuses for another reason", () => {
  it("shows the failure message, changes nothing, sends nothing", async () => {
    fake.down();
    expect(await h.redirectOf(actions.sendTestEmail())).toBe("/settings?gmail=test_failed");
    fake.down(false);
    // A 500 from Gmail on send.
    const original = fake.checkedFetch;
    const failing = async (input: string, init: RequestInit) =>
      new URL(input).pathname.endsWith("/messages/send") ? new Response(JSON.stringify({ error: { code: 500, message: "Backend Error", status: "INTERNAL" } }), { status: 500 }) : original(input, init);
    const { useGmailFetchForTests } = await import("@/server/gmail/google-api");
    useGmailFetchForTests(failing);
    expect(await h.redirectOf(actions.sendTestEmail())).toBe("/settings?gmail=test_failed");
    useGmailFetchForTests(original);
    expect(fake.mailbox(LINUS)).toHaveLength(0);
    expect((await h.connectionOf(linus.id))!.state).toBe("working");
    expect(await page({ gmail: "test_failed" })).toContain("The test email could not be sent. Try again in a minute.");
  });
});

describe("US3 scenario 3: sendGmail for later features", () => {
  it("sends in a conversation: reads its headers, sets In-Reply-To and References, returns Gmail's ids", async () => {
    const first = fake.addMessage(LINUS, { from: "ana@example.test", to: LINUS, subject: "Proposal", text: "Here", messageId: "<first@example.test>" });
    const result = await sendGmail(linus.id, { to: ["ana@example.test"], cc: ["kim@example.test"], subject: "Re: Proposal", text: "Thanks", html: "<p>Thanks</p>", threadId: first.threadId });
    const thread = fake.requests.find((r) => r.path.includes("/threads/"))!;
    expect(thread.query).toMatchObject({ format: "metadata" });
    const raw = rawOf();
    expect(raw).toContain("In-Reply-To: <first@example.test>\r\n");
    expect(raw).toContain("References: <first@example.test>\r\n");
    expect(raw).toContain("Cc: kim@example.test\r\n");
    expect(raw).toContain("multipart/alternative");
    const sent = fake.sent(LINUS);
    expect(sent).toHaveLength(1);
    expect(result).toEqual({ messageId: sent[0].id, threadId: first.threadId });
    expect(sends()[0].body).toMatchObject({ threadId: first.threadId });
  });
  it("refuses without a connection, with no Google call", async () => {
    await expect(sendGmail(margaret.id, { to: ["ana@example.test"], subject: "Hi", text: "x" })).rejects.toThrow(GmailNotConnected);
    expect(fake.requests).toEqual([]);
  });
  it("refuses a subject with CR/LF, sending nothing", async () => {
    await expect(sendGmail(linus.id, { to: ["ana@example.test"], subject: "Hi\r\nBcc: evil@example.test", text: "x" })).rejects.toThrow(BadHeader);
    expect(fake.requests).toEqual([]);
  });
  it("other failures are GmailUnavailable", async () => {
    fake.down();
    await expect(sendGmail(linus.id, { to: ["ana@example.test"], subject: "Hi", text: "x" })).rejects.toThrow(GmailUnavailable);
  });
});

describe("US3 scenario 4 and FR-006", () => {
  it("the test email is not copied by the next check", async () => {
    await h.redirectOf(actions.sendTestEmail());
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(0);
  });
  it("a refused key on send → needs reconnecting, GmailNeedsReconnect, nothing sent", async () => {
    fake.refuseKey(LINUS);
    await expect(sendGmail(linus.id, { to: ["ana@example.test"], subject: "Hi", text: "x" })).rejects.toThrow(GmailNeedsReconnect);
    expect((await h.connectionOf(linus.id))!.state).toBe("needs_reconnect");
    expect(sends()).toEqual([]);
  });
});
