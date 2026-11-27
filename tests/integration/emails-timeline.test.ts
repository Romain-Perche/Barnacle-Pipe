// covers SF-127 FR-001, FR-002, FR-003, FR-004, US1 scenarios 1-7, SC-001, SC-007, edge cases "Missing sender name or
// subject", "Email with only attachments", "Timeline paging": emails copied by the Gmail sync show as EMAIL entries on
// the timelines of the people, organisations and deals their conversation is linked to, once each.
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
const { readTimeline } = await import("@/server/records/timeline");
const { entryTag } = await import("@/server/records/timeline-view");
const { messages } = await import("@/server/messages");
const { installGmailFake } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const { makeActivity } = await import("./activity-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
const AT = new Date("2026-11-25T14:05:00Z");

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const proposal = () =>
  fake.addMessage(e.ADA, {
    from: `"Ana Example" <ana@example.test>`,
    to: `"Ada Fake" <${e.ADA}>`,
    subject: "Proposal",
    text: "Hi Ada, here are the figures we discussed last week…",
    attachments: [{ name: "figures.pdf", size: 240 * 1024, type: "application/pdf" }],
    internalDate: AT,
  });

describe("US1: EMAIL entries on the timelines", () => {
  it("scenario 1: Ana's timeline shows the email with its sender, recipients, subject, text start and attachment", async () => {
    proposal();
    expect(await e.sync(w.adaConn)).toBe(1);
    const page = await readTimeline(w.bob, { personId: w.ana });
    const [entry] = page.entries.filter((x) => x.kind === "email");
    expect(entryTag(entry)).toBe("EMAIL");
    expect(entry.createdAt).toEqual(AT);
    expect(entry.email).toMatchObject({
      from: { email: "ana@example.test", name: "Ana Example" },
      to: [{ email: e.ADA, name: "Ada Fake" }],
      cc: [],
      bcc: [],
      subject: "Proposal",
      preview: "Hi Ada, here are the figures we discussed last week…",
      attachments: [{ name: "figures.pdf", size: 245760 }],
    });
    expect(entry.email!.conversationId).toBe((await e.conversationIds())[0]);
  });
  it("scenarios 2-3: the same entry on Example Ltd's timeline, the deal's page and drawer", async () => {
    proposal();
    await e.sync(w.adaConn);
    const onAna = (await e.emailEntries(w.bob, { personId: w.ana })).map((x) => x.id);
    expect(onAna).toHaveLength(1);
    expect((await e.emailEntries(w.bob, { organisationId: w.exampleLtd })).map((x) => x.id)).toEqual(onAna);
    // The deal page and the drawer read the same readTimeline (the drawer with the newest 50).
    expect((await e.emailEntries(w.bob, { dealId: w.pilot })).map((x) => x.id)).toEqual(onAna);
    expect((await e.emailEntries(w.bob, { organisationId: w.otherCo }))).toEqual([]);
  });
  it("scenario 4: Ada's reply comes newest first, Ada the sender, Ana the recipient", async () => {
    const first = proposal();
    await e.sync(w.adaConn);
    fake.addMessage(e.ADA, {
      from: `"Ada Fake" <${e.ADA}>`, to: `"Ana Example" <ana@example.test>`, subject: "Re: Proposal", text: "Thanks Ana",
      labels: ["SENT"], threadId: first.threadId, internalDate: new Date(AT.getTime() + 3600_000),
    });
    await e.sync(w.adaConn);
    const entries = await e.emailEntries(w.bob, { personId: w.ana });
    expect(entries.map((x) => x.email!.subject)).toEqual(["Re: Proposal", "Proposal"]);
    expect(entries[0].email!.from).toEqual({ email: e.ADA, name: "Ada Fake" });
    expect(entries[0].email!.to).toEqual([{ email: "ana@example.test", name: "Ana Example" }]);
    expect(new Set(entries.map((x) => x.email!.conversationId)).size).toBe(1);
  });
  it("scenario 5: Ben in Cc → on Ana's, Ben's, Example Ltd's and Other Co's timelines, Ben among the recipients", async () => {
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, cc: `"Ben Example" <ben@example.test>`, subject: "Both", text: "Hi", internalDate: AT });
    await e.sync(w.adaConn);
    for (const target of [{ personId: w.ana }, { personId: w.ben }, { organisationId: w.exampleLtd }, { organisationId: w.otherCo }]) {
      const [entry] = await e.emailEntries(w.bob, target);
      expect(entry.email!.cc).toEqual([{ email: "ben@example.test", name: "Ben Example" }]);
    }
  });
  it("scenario 6: one email in Ada's and Bob's mailboxes shows once on each timeline (the sender's copy when one is sent)", async () => {
    const messageId = "<shared-1@example.test>";
    fake.addMessage(e.ADA, { from: "ana@example.test", to: `${e.ADA}, ${e.BOB}`, subject: "To you both", text: "Hello", messageId, internalDate: AT });
    fake.addMessage(e.BOB, { from: "ana@example.test", to: `${e.ADA}, ${e.BOB}`, subject: "To you both", text: "Hello", messageId, internalDate: AT });
    await e.sync(w.adaConn);
    await e.sync(w.bobConn);
    expect(await e.conversationIds()).toHaveLength(1);
    for (const target of [{ personId: w.ana }, { organisationId: w.exampleLtd }, { dealId: w.pilot }]) {
      expect(await e.emailEntries(w.ada, target)).toHaveLength(1);
    }
    // Ada sends Ana a Bcc'd email that Bob also received: the sender's copy (with its Bcc) is shown.
    const sent = "<shared-2@example.test>";
    fake.addMessage(e.BOB, { from: e.ADA, to: "ana@example.test", subject: "Bcc", text: "x", messageId: sent, internalDate: new Date(AT.getTime() + 60_000) });
    await e.sync(w.bobConn);
    fake.addMessage(e.ADA, { from: e.ADA, to: "ana@example.test", bcc: e.BOB, subject: "Bcc", text: "x", messageId: sent, labels: ["SENT"], internalDate: new Date(AT.getTime() + 60_000) });
    await e.sync(w.adaConn);
    const entries = await e.emailEntries(w.ada, { personId: w.ana });
    expect(entries).toHaveLength(2);
    expect(entries[0].email!.bcc).toEqual([{ email: e.BOB, name: null }]);
  });
  it("scenario 7: an HTML-only email's text start is plain text, no markup", async () => {
    fake.addMessage(e.ADA, {
      from: "ana@example.test", to: e.ADA, subject: "Html", text: null, internalDate: AT,
      html: `<style>p{color:red}</style><p>Hello <b>Ada</b> <img src="https://tracker.example/x.png"> &lt;i&gt;</p><script>alert(1)</script>`,
    });
    await e.sync(w.adaConn);
    const [entry] = await e.emailEntries(w.bob, { personId: w.ana });
    expect(entry.email!.preview).toBe("Hello Ada <i>");
  });
});

describe("edge cases", () => {
  it("no name → bare address; empty subject kept empty (shown as (no subject)); attachments only → no text", async () => {
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "", text: null, attachments: [{ name: "a.txt", size: 10 }, { name: "b.png", size: 2048 }], internalDate: AT });
    await e.sync(w.adaConn);
    const [entry] = await e.emailEntries(w.bob, { personId: w.ana });
    expect(entry.email!.from).toEqual({ email: "ana@example.test", name: null });
    expect(entry.email!.subject).toBe("");
    expect(messages.email_no_subject).toBe("(no subject)");
    expect(entry.email!.preview).toBeNull();
    expect(entry.email!.attachments.map((a) => a.name)).toEqual(["a.txt", "b.png"]);
  });
  it("a long text is cut at 200 characters with …", async () => {
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "Long", text: "word ".repeat(100), internalDate: AT });
    await e.sync(w.adaConn);
    const [entry] = await e.emailEntries(w.bob, { personId: w.ana });
    expect([...entry.email!.preview!]).toHaveLength(201);
    expect(entry.email!.preview!.endsWith("…")).toBe(true);
  });
  it("EMAIL entries page with notes and activities, in time order ([ SHOW MORE ])", async () => {
    const base = new Date("2026-11-20T09:00:00Z").getTime();
    for (let i = 0; i < 3; i++) {
      fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: `E${i}`, text: "x", internalDate: new Date(base + i * 2 * 3600_000) });
    }
    await e.sync(w.adaConn);
    await sql`
      insert into timeline_events (person_id, kind, actor_id, body, created_at)
      values (${w.ana}, 'note', ${w.ada}, 'N0', ${new Date(base + 3600_000)}), (${w.ana}, 'note', ${w.ada}, 'N1', ${new Date(base + 3 * 3600_000)})`;
    await makeActivity({ type: "call", subject: "A0", personId: w.ana, by: w.ada, doneAt: new Date(base + 5 * 3600_000) });
    const all = await readTimeline(w.bob, { personId: w.ana }, 50);
    // E0 N0 E1 N1 E2 A0 (+ nothing else on Ana's own timeline), newest first.
    const label = (x: (typeof all.entries)[number]) => x.email?.subject ?? x.activity?.subject ?? x.kind;
    expect(all.entries.map(label)).toEqual(["A0", "E2", "note", "E1", "note", "E0"]);
    const first = await readTimeline(w.bob, { personId: w.ana }, 3);
    expect(first.more).toBe(true);
    expect(first.entries.map(label)).toEqual(["A0", "E2", "note"]);
  });
  it("a deleted person: the conversation still shows on the other linked records; a deleted deal's links go", async () => {
    proposal();
    await e.sync(w.adaConn);
    await sql`delete from deals where id = ${w.pilot}`;
    await sql`delete from persons where id = ${w.ana}`;
    expect(await e.emailEntries(w.bob, { organisationId: w.exampleLtd })).toHaveLength(1);
    expect(await e.linksOf((await e.conversationIds())[0])).toEqual([expect.objectContaining({ organisation_id: w.exampleLtd })]);
  });
});
