// covers SF-127 FR-003, FR-011, research.md §1-§3, Plan clarifications "two conversations found to be one: whose links
// win" and "emails copied before this issue": one conversation across mailboxes by Message-ID, merged into the oldest
// when they meet later; emails stored before SF-127 (linked_at null) are processed by the 15-minute Gmail check;
// processing twice changes nothing.
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
const { processMessage } = await import("@/server/emails/process");
const { runGmailCheck } = await import("@/server/gmail/sync");
const { installGmailFake } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
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

const threadsOf = async () =>
  sql<{ connection_id: number; conversation_id: number | null }[]>`
    select connection_id::int as connection_id, conversation_id::int as conversation_id from email_threads order by id`;

describe("one conversation across mailboxes", () => {
  it("joins the conversation of another mailbox's copy of the same email", async () => {
    fake.addMessage(e.ADA, { from: "ana@example.test", to: `${e.ADA}, ${e.BOB}`, subject: "Hi", text: "x", messageId: "<m1@x>", internalDate: AT });
    fake.addMessage(e.BOB, { from: "ana@example.test", to: `${e.ADA}, ${e.BOB}`, subject: "Hi", text: "x", messageId: "<m1@x>", internalDate: AT });
    await e.sync(w.adaConn);
    await e.sync(w.bobConn);
    const t = await threadsOf();
    expect(t).toHaveLength(2);
    expect(t[0].conversation_id).toBe(t[1].conversation_id);
    expect(await e.conversationIds()).toEqual([t[0].conversation_id]);
  });
  it("two conversations that meet later are merged into the oldest, links kept by the hand-choice rule", async () => {
    // Ada's thread with Ana, Bob's thread with Ben: two conversations.
    const a1 = fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "A", text: "x", messageId: "<a1@x>", internalDate: AT });
    const b1 = fake.addMessage(e.BOB, { from: "ben@example.test", to: e.BOB, subject: "B", text: "x", messageId: "<b1@x>", internalDate: AT });
    await e.sync(w.adaConn);
    await e.sync(w.bobConn);
    const [older, newer] = await e.conversationIds();
    // Hand choices: on the older, Ana's deal unlinked (earlier); on the newer, the same deal linked by hand (later), and
    // Example Ltd unlinked by hand while the older keeps it as an automatic link.
    await sql`update email_links set removed = true, how = 'manual', changed_by = ${w.ada}, changed_at = '2026-11-25T15:00:00Z'
              where conversation_id = ${older} and deal_id = ${w.pilot}`;
    await sql`insert into email_links (conversation_id, deal_id, how, changed_by, changed_at) values (${newer}, ${w.pilot}, 'manual', ${w.bob}, '2026-11-25T16:00:00Z')`;
    await sql`insert into email_links (conversation_id, organisation_id, how, removed, changed_by, changed_at)
              values (${newer}, ${w.exampleLtd}, 'manual', true, ${w.bob}, '2026-11-25T16:00:00Z')`;
    // One email both mailboxes get, in each one's thread: the conversations are one.
    fake.addMessage(e.ADA, { from: "ana@example.test", to: `${e.ADA}, ${e.BOB}`, cc: "ben@example.test", subject: "Both", text: "x", messageId: "<both@x>", threadId: a1.threadId, internalDate: AT });
    fake.addMessage(e.BOB, { from: "ana@example.test", to: `${e.ADA}, ${e.BOB}`, cc: "ben@example.test", subject: "Both", text: "x", messageId: "<both@x>", threadId: b1.threadId, internalDate: AT });
    await e.sync(w.adaConn);
    await e.sync(w.bobConn);
    expect(await e.conversationIds()).toEqual([older]);
    expect((await threadsOf()).map((t) => t.conversation_id)).toEqual([older, older]);
    const links = await e.linksOf(older);
    expect(links.find((l) => l.deal_id === w.pilot)).toMatchObject({ how: "manual", removed: false });
    expect(links.find((l) => l.organisation_id === w.exampleLtd)).toMatchObject({ how: "manual", removed: true });
    expect(links.filter((l) => l.person_id !== null).map((l) => l.person_id).sort()).toEqual([w.ana, w.ben].sort());
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from email_conversation_addresses where conversation_id = ${older}`;
    expect(n).toBe(4); // ana, ben, ada, bob
    // The merged conversation is linked to Ana as a whole: each of its emails once on her timeline.
    expect((await e.emailEntries(w.ada, { personId: w.ana })).map((x) => x.email!.subject).sort()).toEqual(["A", "B", "Both"]);
  });
});

describe("emails copied before SF-127", () => {
  it("the 15-minute check processes them: conversation, links, Last contacted; a second processing changes nothing", async () => {
    // Stored as SF-118 did, with linked_at null and no conversation.
    const [t] = await sql<{ id: number }[]>`
      insert into email_threads (connection_id, gmail_thread_id, subject) values (${w.adaConn}, 'old-thread', 'Old') returning id::int as id`;
    const [m] = await sql<{ id: number }[]>`
      insert into email_messages (connection_id, thread_id, gmail_message_id, rfc_message_id, direction, from_address, to_list, subject, received_at, text_body)
      values (${w.adaConn}, ${t.id}, 'old-1', '<old@x>', 'received', 'ana@example.test', ${sql.json([{ email: e.ADA, name: null }])}, 'Old', ${AT}, 'Old text')
      returning id::int as id`;
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toEqual([]);
    await runGmailCheck(new Date());
    const [row] = await sql<{ linked_at: Date | null; conversation_id: number | null }[]>`
      select m.linked_at, t.conversation_id::int as conversation_id from email_messages m join email_threads t on t.id = m.thread_id where m.id = ${m.id}`;
    expect(row.linked_at).not.toBeNull();
    expect(row.conversation_id).not.toBeNull();
    expect(await e.emailEntries(w.bob, { personId: w.ana })).toHaveLength(1);
    expect(await e.lastContacted(w.ana)).toEqual(AT);
    const before = await e.linksOf(row.conversation_id!);
    await sql.begin((tx) => processMessage(tx as never, m.id));
    expect(await e.linksOf(row.conversation_id!)).toEqual(before);
    expect(await e.conversationIds()).toEqual([row.conversation_id]);
  });
});
