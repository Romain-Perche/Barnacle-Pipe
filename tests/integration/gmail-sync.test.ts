// covers SF-118 US2 scenarios 1-7, FR-007 to FR-012, FR-015, SC-003, edge cases "Person added to the CRM later",
// "Address match", "Private and archived people", "Same conversation in two mailboxes", "Drafts, spam, bin", "Large
// catch-up", "Notices not from Google", "Renewal fails", "Messages with only HTML or only attachments": push notices and
// the 15-minute check copy exactly the messages with CRM people, once each, with attachment names and sizes only.
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

const { closeDb, sql } = await import("@/server/db");
const { gmailSettings } = await import("@/server/gmail/connections");
const { runGmailCheck, syncConnection } = await import("@/server/gmail/sync");
const { POST: pushRoute } = await import("@/app/gmail/push/route");
const { GET: cronRoute } = await import("@/app/cron/gmail/route");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");

const LINUS = "linus@barnacle.ai";
// A cron secret made for this run (never a literal in the repo).
const CRON = `cron-${(await import("node:crypto")).randomBytes(16).toString("hex")}`;
let linus: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installGmailFake>;
let ana: number;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  vi.stubEnv("CRON_SECRET", CRON);
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: LINUS, name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  ana = await makePerson({ firstName: "Ana", lastName: "Fake", createdBy: linus.id, emails: ["ana@example.test", "ana.k@example.test"] });
  fake = installGmailFake();
  await h.signInAs(jar, linus.id);
  expect(await h.connectGmail(fake)).toBe("/settings");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const conn = async (userId = linus.id) => (await h.connectionOf(userId))!;
const fromAna = (o: Partial<Parameters<typeof fake.addMessage>[1]> = {}) =>
  fake.addMessage(LINUS, { from: `"Ana Fake" <ana@example.test>`, to: LINUS, subject: "Hello", text: "Hi Linus", ...o });

describe("US2: copied as they happen", () => {
  it("scenario 1: a message from her second address with two attachments, delivered → 1 conversation, last sync set", async () => {
    fake.addMessage(LINUS, {
      from: "Ana K <ana.k@example.test>",
      to: LINUS,
      subject: "Two files",
      text: "See attached",
      attachments: [
        { name: "plan.pdf", size: 1200, type: "application/pdf" },
        { name: "photo.png", size: 3400, type: "image/png" },
      ],
    });
    expect(await fake.deliver(LINUS)).toBe(204);
    expect(await h.conversations(linus.id)).toBe(1);
    expect((await conn()).last_synced_at).not.toBeNull();
    expect(await h.attachmentsOf(linus.id)).toEqual([
      { name: "plan.pdf", content_type: "application/pdf", size: "1200" },
      { name: "photo.png", content_type: "image/png", size: "3400" },
    ]);
    expect(await gmailSettings(linus.id)).toMatchObject({ conversations: 1 });
  });
  it("scenario 2: a message sent from Gmail to her in a new conversation → 2, direction sent", async () => {
    fromAna();
    await fake.deliver(LINUS);
    fake.addMessage(LINUS, { from: LINUS, to: "ana@example.test", subject: "From Gmail", text: "Hi Ana", labels: ["SENT"] });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(2);
    expect((await h.storedMessages(linus.id)).map((m) => m.direction)).toEqual(["received", "sent"]);
  });
  it("scenario 3: a newsletter, or mail between teammates only → count unchanged, last sync moves", async () => {
    fromAna();
    await fake.deliver(LINUS);
    const before = (await conn()).last_synced_at!;
    await new Promise((r) => setTimeout(r, 5));
    fake.addMessage(LINUS, { from: "news@letters.example", to: LINUS, subject: "News", html: "<p>news</p>" });
    fake.addMessage(LINUS, { from: "kim@barnacle.ai", to: LINUS, cc: "margaret@barnacle.ai", subject: "Lunch", text: "?" });
    expect(await fake.deliver(LINUS)).toBe(204);
    expect(await h.conversations(linus.id)).toBe(1);
    expect((await conn()).last_synced_at!.getTime()).toBeGreaterThan(before.getTime());
  });
  it("scenario 4: a teammate-only reply in a copied conversation is stored, the count is unchanged", async () => {
    const first = fromAna();
    await fake.deliver(LINUS);
    fake.addMessage(LINUS, { from: "kim@barnacle.ai", to: LINUS, subject: "Re: Hello", text: "fwd", threadId: first.threadId });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(1);
    expect(await h.storedMessages(linus.id)).toHaveLength(2);
  });
  it("scenario 5: a dropped notice is caught by the 15-minute check; the same notice again changes nothing", async () => {
    fromAna();
    fake.dropNotice(LINUS);
    expect(await h.conversations(linus.id)).toBe(0);
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(1);
    const n = fake.notice(LINUS)!;
    await fake.deliver(LINUS, () => n);
    await fake.deliver(LINUS, () => n);
    expect(await h.conversations(linus.id)).toBe(1);
    expect(await h.storedMessages(linus.id)).toHaveLength(1);
  });
  it("scenario 6: a message Gmail got a day before the connection is not copied", async () => {
    const connectedAt = (await conn()).connected_at;
    fromAna({ internalDate: new Date(connectedAt.getTime() - 24 * 3600 * 1000) });
    await fake.deliver(LINUS);
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(0);
  });
  it("scenario 7: a 20 MB contract.pdf keeps its name and size, never its contents, and Gmail's attachment is never read", async () => {
    fromAna({ attachments: [{ name: "contract.pdf", size: 20971520, type: "application/pdf" }] });
    await fake.deliver(LINUS);
    expect(await h.attachmentsOf(linus.id)).toEqual([{ name: "contract.pdf", content_type: "application/pdf", size: "20971520" }]);
    const cols = await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'email_attachments' order by ordinal_position`;
    expect(cols.map((c) => c.column_name)).toEqual(["id", "message_id", "position", "name", "content_type", "size"]);
    expect(fake.requests.filter((r) => r.path.includes("/attachments"))).toEqual([]);
  });
});

describe("edge cases", () => {
  it("a person added later: earlier mail stays uncopied, mail after it is copied", async () => {
    fake.addMessage(LINUS, { from: "new@example.test", to: LINUS, subject: "Early", text: "x" });
    await fake.deliver(LINUS);
    await makePerson({ firstName: "New", createdBy: linus.id, emails: ["new@example.test"] });
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(0);
    fake.addMessage(LINUS, { from: "new@example.test", to: LINUS, subject: "Later", text: "y" });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(1);
  });
  it("address match: other case and spaces match; a display name alone does not", async () => {
    fake.addMessage(LINUS, { from: "ANA@Example.test ", to: LINUS, subject: "Caps", text: "x" });
    fake.addMessage(LINUS, { from: `"Ana Fake" <other@example.test>`, to: LINUS, subject: "Name only", text: "x" });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(1);
    expect((await h.storedMessages(linus.id)).map((m) => m.subject)).toEqual(["Caps"]);
  });
  it("only in Bcc on a sent message: copied", async () => {
    fake.addMessage(LINUS, { from: LINUS, to: "kim@barnacle.ai", bcc: "ana@example.test", subject: "Bcc", text: "x", labels: ["SENT"] });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(1);
  });
  it("private and archived people match; a deleted person no longer does", async () => {
    await makePerson({ firstName: "Pat", createdBy: margaret.id, private: true, emails: ["pat@example.test"] });
    await makePerson({ firstName: "Fay", createdBy: margaret.id, archived: true, emails: ["fay@example.test"] });
    fake.addMessage(LINUS, { from: "pat@example.test", to: LINUS, subject: "Private", text: "x" });
    fake.addMessage(LINUS, { from: "fay@example.test", to: LINUS, subject: "Archived", text: "x" });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(2);
    await sql`delete from persons where id = ${ana}`;
    fromAna({ subject: "After delete" });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(2);
  });
  it("two connected teammates each count the same email once, with the same Message-ID", async () => {
    await h.signInAs(jar, margaret.id);
    await h.connectGmail(fake);
    const both = { from: "ana@example.test", to: `${LINUS}, margaret@barnacle.ai`, subject: "Both", text: "x", messageId: "<both-1@example.test>" };
    fake.addMessage(LINUS, both);
    fake.addMessage("margaret@barnacle.ai", both);
    await fake.deliver(LINUS);
    await fake.deliver("margaret@barnacle.ai");
    expect(await h.conversations(linus.id)).toBe(1);
    expect(await h.conversations(margaret.id)).toBe(1);
    expect((await h.storedMessages(linus.id))[0].rfc_message_id).toBe("<both-1@example.test>");
    expect((await h.storedMessages(margaret.id))[0].rfc_message_id).toBe("<both-1@example.test>");
  });
  it("drafts, spam and bin are skipped; moving a copied message to the bin keeps the count", async () => {
    fromAna({ subject: "Draft", labels: ["DRAFT"] });
    fromAna({ subject: "Spam", labels: ["SPAM"] });
    fromAna({ subject: "Bin", labels: ["TRASH"] });
    await fake.deliver(LINUS);
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(0);
    const kept = fromAna({ subject: "Kept" });
    await fake.deliver(LINUS);
    fake.setLabels(LINUS, kept.id, ["TRASH"]);
    await fake.deliver(LINUS);
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(1);
  });
  it("a large catch-up after Gmail's history is gone copies every matching message once, 300 per run", async () => {
    fake.forgetHistory();
    for (let i = 0; i < 600; i++) fromAna({ subject: `Bulk ${i}`, threadId: null });
    await runGmailCheck(new Date());
    const firstRun = (await h.storedMessages(linus.id)).length;
    expect(firstRun).toBe(300);
    for (let i = 0; i < 5 && (await h.storedMessages(linus.id)).length < 600; i++) await runGmailCheck(new Date());
    const stored = await h.storedMessages(linus.id);
    expect(stored).toHaveLength(600);
    expect(new Set(stored.map((m) => m.gmail_message_id)).size).toBe(600);
    expect(await h.conversations(linus.id)).toBe(600);
    expect(fake.requests.filter((r) => r.path.endsWith("/history")).length).toBeGreaterThan(0);
  });
  it("an HTML-only message is copied; a nameless attachment is stored as (no name) with its size", async () => {
    fromAna({ text: null, html: "<p>Only HTML</p>", attachments: [{ name: "", size: 77, type: "image/png" }] });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(1);
    expect((await h.storedMessages(linus.id))[0]).toMatchObject({ text_body: null, html_body: "<p>Only HTML</p>" });
    expect(await h.attachmentsOf(linus.id)).toEqual([{ name: "(no name)", content_type: "image/png", size: "77" }]);
  });
  it("renewal fails for another reason: the check still copies, the state stays working, the renewal is tried again", async () => {
    const id = (await conn()).id;
    await sql`update gmail_connections set watch_renewed_at = now() - interval '21 hours' where id = ${id}`;
    const old = (await conn()).watch_renewed_at!;
    fake.failWatch(true);
    fromAna();
    fake.dropNotice(LINUS);
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(1);
    expect(await conn()).toMatchObject({ state: "working", watch_renewed_at: old });
    fake.failWatch(false);
    await runGmailCheck(new Date());
    expect((await conn()).watch_renewed_at!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
  it("renews each watch once a day: not when renewed within 20 hours", async () => {
    const watches = () => fake.requests.filter((r) => r.path.endsWith("/watch")).length;
    const before = watches();
    await runGmailCheck(new Date());
    expect(watches()).toBe(before);
  });
});

describe("FR-011: one sync at a time", () => {
  it("two syncs at once: one copies, the other is busy and asks for one more round; every message stored once", async () => {
    for (let i = 0; i < 5; i++) fromAna({ subject: `Race ${i}`, threadId: null });
    const id = (await conn()).id;
    const results = await Promise.all([syncConnection(id, new Date()), syncConnection(id, new Date())]);
    expect(results).toContainEqual({ skipped: "busy" });
    expect(results).toContainEqual({ copied: 5 });
    expect(await h.storedMessages(linus.id)).toHaveLength(5);
    expect(await conn()).toMatchObject({ sync_lease_until: null, sync_again: false });
  });
});

describe("the push route", () => {
  const post = (body: unknown, authorization?: string) =>
    pushRoute(new Request("http://localhost:3000/gmail/push", { method: "POST", headers: authorization ? { authorization, "content-type": "application/json" } : {}, body: JSON.stringify(body) }));
  it("bad proof → 403 with an empty body, nothing changed", async () => {
    fromAna();
    const n = fake.notice(LINUS)!;
    for (const auth of [undefined, "Bearer x.y.z", `Bearer ${fake.signPushToken({ aud: "https://evil.example/gmail/push" })}`, `Bearer ${fake.signPushToken({}, {}, { otherKey: true })}`]) {
      const res = await post(n.body, auth);
      expect(res.status, String(auth)).toBe(403);
      expect(await res.text()).toBe("");
    }
    expect(await fake.deliver(LINUS, (x) => ({ ...x, body: { ...x.body, subscription: "projects/other/subscriptions/x" } }))).toBe(403);
    expect(await h.conversations(linus.id)).toBe(0);
    expect((await conn()).last_synced_at).toBeNull();
  });
  it("bad body → 400", async () => {
    const auth = `Bearer ${fake.signPushToken()}`;
    expect((await post({}, auth)).status).toBe(400);
    expect((await post({ message: { data: Buffer.from("not json").toString("base64") }, subscription: "projects/crm-fake/subscriptions/gmail-push-fake" }, auth)).status).toBe(400);
    const res = await pushRoute(new Request("http://localhost:3000/gmail/push", { method: "POST", headers: { authorization: auth }, body: "{{" }));
    expect(res.status).toBe(400);
  });
  it("a good notice → 204 and the sync done; an unknown address or a connection that is not working → 204, nothing changed", async () => {
    fromAna();
    const n = fake.notice(LINUS)!;
    const res = await post(n.body, n.authorization);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await h.conversations(linus.id)).toBe(1);
    const data = (email: string) => Buffer.from(JSON.stringify({ emailAddress: email, historyId: 1 })).toString("base64");
    expect((await post({ ...n.body, message: { ...n.body.message, data: data("nobody@barnacle.ai") } }, n.authorization)).status).toBe(204);
    await sql`update gmail_connections set state = 'needs_reconnect' where user_id = ${linus.id}`;
    fromAna({ subject: "While not working" });
    expect((await post(n.body, n.authorization)).status).toBe(204);
    expect(await h.storedMessages(linus.id)).toHaveLength(1);
  });
});

describe("the cron route", () => {
  const get = (authorization?: string) => cronRoute(new Request("http://localhost:3000/cron/gmail", { headers: authorization ? { authorization } : {} }));
  it("401 with an empty body without the secret or with a wrong one", async () => {
    fromAna();
    for (const auth of [undefined, `Bearer ${CRON}x`, CRON, `Bearer ${CRON.slice(0, -1)}`]) {
      const res = await get(auth);
      expect(res.status, String(auth)).toBe(401);
      expect(await res.text()).toBe("");
    }
    expect(await h.conversations(linus.id)).toBe(0);
  });
  it("204 with the secret, after the check", async () => {
    fromAna();
    const res = await get(`Bearer ${CRON}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await h.conversations(linus.id)).toBe(1);
  });
  it("Gmail off: both routes answer 204 and do nothing", async () => {
    fromAna();
    const n = fake.notice(LINUS)!;
    vi.stubEnv("GMAIL_TOKEN_KEY", "");
    expect((await get()).status).toBe(204);
    expect((await post(n.body)).status).toBe(204);
    expect(await h.conversations(linus.id)).toBe(0);
  });
  const post = (body: unknown) => pushRoute(new Request("http://localhost:3000/gmail/push", { method: "POST", body: JSON.stringify(body) }));
});
