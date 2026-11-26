// covers SF-128 (Fetch past emails): US1 to US4, FR-001 to FR-012, SC-001 to SC-005 and the Edge Cases, on the fake
// mailbox of 100 conversations (data-model.md § Fake mailbox) with the fake Gmail checked against gmail-api.json and a
// real Postgres.
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
const { disconnect, gmailSettings } = await import("@/server/gmail/connections");
const { runGmailCheck } = await import("@/server/gmail/sync");
const past = await import("@/server/gmail/past");
const { putPastMailbox, PAST_ADDRESSES: A, COPIED_GROUPS } = await import("@/server/gmail/fake-past-mailbox");
const actions = await import("@/app/(app)/settings/actions");
const users = await import("@/server/users");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");

const LINUS = "linus@barnacle.ai";
const MARGARET = "margaret@barnacle.ai";
const DAY = 86_400_000;
let linus: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installGmailFake>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  past.setPastFetchPartForTests(null);
  linus = await makeUser({ email: LINUS, name: "Linus Fake" });
  margaret = await makeUser({ email: MARGARET, name: "Margaret Fake" });
  fake = installGmailFake();
  await h.signInAs(jar, linus.id);
  expect(await h.connectGmail(fake)).toBe("/settings");
});
afterAll(async () => {
  past.setPastFetchPartForTests(null);
  vi.unstubAllEnvs();
  await closeDb();
});

const conn = async (userId = linus.id) => (await h.connectionOf(userId))!;
const row = async (userId = linus.id) => h.pastFetchOf(userId);
const threadRequests = () => fake.requests.filter((r) => r.path.includes("/threads")).length;

// Runs parts until the fetch ends; returns `copied` after each part.
async function runToEnd(userId = linus.id, now = new Date()): Promise<number[]> {
  const id = (await conn(userId)).id;
  const seen: number[] = [];
  for (let i = 0; i < 100; i++) {
    const r = await past.runPastFetchPart(id, { now });
    seen.push((await row(userId))!.copied);
    if (r.next === "ended") return seen;
    if (r.next !== "again") throw new Error(`part answered ${JSON.stringify(r)}`);
  }
  throw new Error("the fetch never ended");
}

async function threadsOf(userId: number) {
  return (
    await sql<{ id: string; n: number }[]>`
      select t.gmail_thread_id as id, (select count(*)::int from email_messages m where m.thread_id = t.id) as n
      from email_threads t join gmail_connections c on c.id = t.connection_id where c.user_id = ${userId}`
  ).reduce((m, r) => m.set(r.id, r.n), new Map<string, number>());
}

describe("US1: fetch my last 12 months of conversations with CRM people", () => {
  // covers FR-002, FR-003, FR-004, FR-005, SC-001, US1 scenarios 1-3, Edge Cases "Address matching", "Conversation
  // partly older", "CRM person only in an older message", "Private and archived people"
  it("the 100-conversation mailbox: 60 copied, each once, none of groups G-O, group D with 2 messages each", async () => {
    await h.makePastPeople(linus.id, margaret.id);
    const now = new Date();
    const groups = putPastMailbox(fake, LINUS, { now });
    expect(Object.values(groups).flat()).toHaveLength(100);
    expect(await past.startPastFetch(linus.id, now)).toBe("started");
    expect((await gmailSettings(linus.id)).pastFetch).toEqual({ state: "running", copied: 0, paused: false, unreachable: false, waitSeconds: 0 });
    await runToEnd(linus.id, now);
    const f = (await row())!;
    expect(f).toMatchObject({ state: "ended", copied: 60 });
    expect(f.ended_at).toEqual(now);
    expect(await h.conversations(linus.id)).toBe(60);
    const threads = await threadsOf(linus.id);
    for (const g of COPIED_GROUPS) for (const t of groups[g]) expect(threads.has(t), `group ${g}`).toBe(true);
    for (const g of ["G", "H", "I", "J", "K", "L", "M", "N", "O"] as const) for (const t of groups[g]) expect(threads.has(t), `group ${g}`).toBe(false);
    for (const t of groups.D) expect(threads.get(t)).toBe(2);
    const [dup] = await sql<{ n: number }[]>`select count(*)::int - count(distinct (connection_id, gmail_message_id))::int as n from email_messages`;
    expect(dup.n).toBe(0);
    expect(await gmailSettings(linus.id)).toMatchObject({ conversations: 60, pastFetch: { state: "ended", copied: 60, endedAt: now } });
  });

  // covers FR-004, US1 scenario 3: the same details as the live sync keeps (one readMessage, one storeMessage)
  it("a group A message is stored with its sender, recipients, subject, Gmail date, text, HTML and attachment names and sizes", async () => {
    await h.makePastPeople(linus.id, margaret.id);
    const now = new Date();
    const groups = putPastMailbox(fake, LINUS, { now });
    await past.startPastFetch(linus.id, now);
    await runToEnd();
    const [m] = await sql<{ id: string; direction: string; from_address: string; from_name: string; to_list: unknown; subject: string; received_at: Date; text_body: string; html_body: string }[]>`
      select m.id::text as id, m.direction, m.from_address, m.from_name, m.to_list, m.subject, m.received_at, m.text_body, m.html_body
      from email_messages m join email_threads t on t.id = m.thread_id where t.gmail_thread_id = ${groups.A[0]}`;
    expect(m).toMatchObject({
      direction: "received",
      from_address: A.ana,
      from_name: "Ana Fake",
      to_list: [{ email: LINUS, name: null }],
      subject: "Proposal 0",
      received_at: new Date(now.getTime() - 5 * DAY),
      text_body: "Hello from a fake contact.",
      html_body: "<p>Proposal 0</p>",
    });
    const att = await sql`select name, content_type, size::int as size from email_attachments where message_id = ${m.id}`;
    expect(att.map((a) => ({ ...a }))).toEqual([{ name: "proposal-0.pdf", content_type: "application/pdf", size: 1000 }]);
  });

  // covers US1 scenario 5, Edge Case "The test email"
  it("no CRM conversation in the 12 months → ended with 0; the test email is never copied", async () => {
    putPastMailbox(fake, LINUS, { now: new Date() });
    expect(await h.redirectOf(actions.sendTestEmail())).toBe("/settings");
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect(await row()).toMatchObject({ state: "ended", copied: 0 });
    expect(await h.conversations(linus.id)).toBe(0);
  });

  // covers Edge Cases "The 12 months", "Address matching"
  it("11 months 29 days counts, 12 months 2 days does not; another case counts, a display name does not", async () => {
    await makePerson({ firstName: "Ana", createdBy: linus.id, emails: ["ana@example.test"] });
    const now = new Date("2026-11-26T10:00:00Z");
    fake.addMessage(LINUS, { from: "ana@example.test", to: LINUS, internalDate: new Date("2025-11-27T10:00:00Z") });
    fake.addMessage(LINUS, { from: "ana@example.test", to: LINUS, internalDate: new Date("2025-11-24T10:00:00Z") });
    fake.addMessage(LINUS, { from: "ANA@Example.test", to: LINUS, internalDate: new Date("2026-05-01T10:00:00Z") });
    fake.addMessage(LINUS, { from: '"Ana" <other@example.test>', to: LINUS, internalDate: new Date("2026-06-01T10:00:00Z") });
    await past.startPastFetch(linus.id, now);
    await runToEnd(linus.id, now);
    expect((await row())!.copied).toBe(2);
  });

  // covers FR-001, FR-002 (contracts/routes.md § Server actions)
  it("[ FETCH PAST EMAILS ] (the action) starts the fetch and answers /settings; the page's part runs it", async () => {
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    expect(await h.redirectOf(actions.startPastFetchAction())).toBe("/settings");
    expect((await row())!.state).toBe("running");
    let answer;
    for (let i = 0; i < 20; i++) {
      answer = await actions.runPastFetchPartAction();
      if (answer.next !== "again") break;
    }
    expect(answer).toEqual({ next: "stop" });
    expect(await row()).toMatchObject({ state: "ended", copied: 60 });
  });
});

describe("US2: it finishes even if I close the page", () => {
  // covers FR-007, SC-002, US2 scenario 1
  it("with parts of 10 threads, copied never goes down and ends at 60", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    const seen = await runToEnd();
    expect(seen.length).toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(60);
  });

  // covers FR-008, SC-003, US2 scenario 2
  it("one part, the page closed, then only the 15-minute check: ended with 60, as with the page open", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    expect(await past.runPastFetchPart((await conn()).id, { now: new Date() })).toEqual({ next: "again" });
    for (let i = 0; i < 3 && (await row())!.state === "running"; i++) await runGmailCheck(new Date());
    expect(await row()).toMatchObject({ state: "ended", copied: 60 });
    expect((await gmailSettings(linus.id)).conversations).toBe(60);
  });

  // covers FR-007, FR-011, SC-005, US2 scenario 3
  it("a slow-down: no Gmail request before wait_until (page or check), then it ends with 60", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    const t0 = new Date();
    putPastMailbox(fake, LINUS, { now: t0 });
    await past.startPastFetch(linus.id, t0);
    await past.runPastFetchPart((await conn()).id, { now: t0 });
    const before = (await row())!;
    fake.slowDown(30);
    expect(await past.runPastFetchPartFor(linus.id, { now: t0 })).toEqual({ next: "wait", seconds: 30 });
    const waiting = (await row())!;
    expect(waiting.wait_until).toEqual(new Date(t0.getTime() + 30_000));
    expect(waiting).toMatchObject({ copied: before.copied, page_offset: before.page_offset, lease_until: null, problem: null });
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "running", copied: before.copied });
    const calls = threadRequests();
    const t10 = new Date(t0.getTime() + 10_000);
    expect(await past.runPastFetchPartFor(linus.id, { now: t10 })).toEqual({ next: "wait", seconds: 20 });
    await runGmailCheck(t10);
    expect(threadRequests()).toBe(calls);
    expect((await row())!.copied).toBe(before.copied);
    const t31 = new Date(t0.getTime() + 31_000);
    let answer;
    for (let i = 0; i < 20; i++) {
      answer = await past.runPastFetchPartFor(linus.id, { now: t31 });
      if (answer.next !== "again") break;
    }
    expect(answer).toEqual({ next: "stop" });
    expect(await row()).toMatchObject({ state: "ended", copied: 60 });
  });

  // covers FR-011, US2 scenario 4
  it("Gmail can't be reached: problem 'unavailable', cursor and count kept, the card says so; then the check ends it", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    await past.runPastFetchPart((await conn()).id, { now: new Date() });
    const before = (await row())!;
    fake.setUnreachable(true);
    expect(await past.runPastFetchPartFor(linus.id, { now: new Date() })).toEqual({ next: "wait", seconds: 30 });
    expect(await row()).toMatchObject({ problem: "unavailable", copied: before.copied, page_offset: before.page_offset, page_token: before.page_token, slice_end: before.slice_end, lease_until: null });
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "running", unreachable: true, copied: before.copied });
    fake.setUnreachable(false);
    await runGmailCheck(new Date());
    expect(await row()).toMatchObject({ state: "ended", copied: 60, problem: null });
  });

  // covers Edge Case "Large mailbox", SC-001
  it("100 conversations to copy, parts of 10: never lower, ends at 100", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await makePerson({ firstName: "Ana", createdBy: linus.id, emails: [A.ana] });
    const now = new Date();
    for (let i = 0; i < 100; i++) fake.addMessage(LINUS, { from: A.ana, to: LINUS, subject: `Many ${i}`, internalDate: new Date(now.getTime() - (1 + i * 3) * DAY) });
    await past.startPastFetch(linus.id, now);
    const seen = await runToEnd();
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(100);
    expect(await h.conversations(linus.id)).toBe(100);
  });

  // covers FR-007 (one part at a time)
  it("a second part while one holds the lease does nothing; the page is asked to come back in 5 s", async () => {
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    await sql`update past_email_fetches set lease_until = ${new Date(Date.now() + 60_000)}`;
    const calls = threadRequests();
    expect(await past.runPastFetchPart((await conn()).id, { now: new Date() })).toEqual({ next: "idle" });
    expect(await past.runPastFetchPartFor(linus.id, { now: new Date() })).toEqual({ next: "wait", seconds: 5 });
    expect(threadRequests()).toBe(calls);
    expect((await row())!.copied).toBe(0);
  });

  // covers FR-011, T018 (Google OAuth 2.0 token endpoint, RFC 6749 §6): one fresh access token per part
  it("each part asks the token endpoint once, with grant_type=refresh_token", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    const tokens = () => fake.requests.filter((r) => r.url === "https://oauth2.googleapis.com/token").length;
    const n = tokens();
    await past.runPastFetchPart((await conn()).id, { now: new Date() });
    expect(tokens()).toBe(n + 1);
    await past.runPastFetchPart((await conn()).id, { now: new Date() });
    expect(tokens()).toBe(n + 2);
  });
});

describe("US3: press it again later; nothing is ever copied twice", () => {
  // covers FR-002, FR-005, SC-001, US3 scenarios 1-2
  it("again with nothing changed → 0 (total 60); after adding Nia Later → 5 (total 65)", async () => {
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect(await past.startPastFetch(linus.id, new Date())).toBe("started");
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "running", copied: 0 });
    await runToEnd();
    expect(await row()).toMatchObject({ state: "ended", copied: 0 });
    expect(await h.conversations(linus.id)).toBe(60);
    await makePerson({ firstName: "Nia", lastName: "Later", createdBy: linus.id, emails: [A.nia] });
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect(await row()).toMatchObject({ state: "ended", copied: 5 });
    expect((await gmailSettings(linus.id)).conversations).toBe(65);
  });

  // covers FR-005, US3 scenario 3 (clarified 2026-11-26)
  it("a conversation the live sync copied: not counted, its earlier in-window messages added once beside the reply", async () => {
    await makePerson({ firstName: "Ana", createdBy: linus.id, emails: [A.ana] });
    const first = fake.addMessage(LINUS, { from: A.ana, to: LINUS, subject: "Spring", internalDate: new Date(Date.now() - 90 * DAY) });
    fake.addMessage(LINUS, { from: LINUS, to: A.ana, subject: "Re: Spring", labels: ["SENT"], internalDate: new Date(Date.now() - 80 * DAY), threadId: first.threadId });
    fake.addMessage(LINUS, { from: A.ana, to: LINUS, subject: "Re: Spring", threadId: first.threadId });
    expect(await fake.deliver(LINUS)).toBe(204);
    expect((await threadsOf(linus.id)).get(first.threadId)).toBe(1);
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect(await row()).toMatchObject({ state: "ended", copied: 0 });
    expect(await h.conversations(linus.id)).toBe(1);
    expect((await threadsOf(linus.id)).get(first.threadId)).toBe(3);
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect((await threadsOf(linus.id)).get(first.threadId)).toBe(3);
  });

  // covers FR-006, US3 scenario 4
  it("a message the live sync copies during a fetch counts once in the total and is stored once", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date(Date.now() - 60_000) });
    await past.startPastFetch(linus.id, new Date());
    await past.runPastFetchPart((await conn()).id, { now: new Date() });
    const live = fake.addMessage(LINUS, { from: A.ben, to: LINUS, subject: "Just now" });
    expect(await fake.deliver(LINUS)).toBe(204);
    await runToEnd();
    expect((await row())!.copied).toBe(60);
    expect(await h.conversations(linus.id)).toBe(61);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from email_messages where gmail_message_id = ${live.id}`;
    expect(n.n).toBe(1);
  });

  // covers FR-002, SC-004, US3 scenario 5
  it("two presses at once start one fetch; pressing while running changes nothing", async () => {
    const results = await Promise.all([past.startPastFetch(linus.id, new Date()), past.startPastFetch(linus.id, new Date())]);
    expect(results.sort()).toEqual(["running", "started"]);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from past_email_fetches`;
    expect(n.n).toBe(1);
    await sql`update past_email_fetches set copied = 7`;
    const was = (await row())!;
    expect(await h.redirectOf(actions.startPastFetchAction())).toBe("/settings");
    expect(await row()).toEqual(was);
  });

  // covers Edge Case "Teammates' mailboxes"
  it("two users with the same conversation each copy 1; one user's fetch leaves the other's row unchanged", async () => {
    await makePerson({ firstName: "Ana", createdBy: linus.id, emails: [A.ana] });
    await h.signInAs(jar, margaret.id);
    expect(await h.connectGmail(fake)).toBe("/settings");
    for (const who of [LINUS, MARGARET]) fake.addMessage(who, { from: A.ana, to: `${LINUS}, ${MARGARET}`, subject: "Both", internalDate: new Date(Date.now() - 10 * DAY) });
    await past.startPastFetch(margaret.id, new Date());
    await sql`update past_email_fetches set lease_until = null`;
    const hers = (await row(margaret.id))!;
    await past.startPastFetch(linus.id, new Date());
    await runToEnd(linus.id);
    expect((await row(linus.id))!.copied).toBe(1);
    expect(await row(margaret.id)).toEqual(hers);
    await runToEnd(margaret.id);
    expect((await row(margaret.id))!.copied).toBe(1);
  });

  // covers Edge Case "Private and archived people"
  it("2 with a private person and 1 with an archived one → 3; a deleted person's address → 0", async () => {
    await makePerson({ firstName: "Pia", createdBy: margaret.id, private: true, emails: [A.pia] });
    await makePerson({ firstName: "Arlo", createdBy: linus.id, archived: true, emails: [A.arlo] });
    const gone = await makePerson({ firstName: "Gone", createdBy: linus.id, emails: ["gone@example.test"] });
    await sql`delete from persons where id = ${gone}`;
    for (const [who, d] of [[A.pia, 3], [A.pia, 9], [A.arlo, 20], ["gone@example.test", 30]] as const) {
      fake.addMessage(LINUS, { from: who, to: LINUS, internalDate: new Date(Date.now() - d * DAY) });
    }
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect((await row())!.copied).toBe(3);
  });
});

describe("US4: a fetch stops cleanly when the connection changes", () => {
  // covers FR-011, US4 scenarios 1-2
  it("a refused key pauses it (needs reconnecting, no part); reconnecting carries it on to 60", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    await past.runPastFetchPart((await conn()).id, { now: new Date() });
    fake.refuseKey(LINUS);
    expect(await past.runPastFetchPartFor(linus.id, { now: new Date() })).toEqual({ next: "stop" });
    expect((await conn()).state).toBe("needs_reconnect");
    const paused = (await row())!;
    expect(paused.state).toBe("running");
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "running", paused: true });
    expect(await past.runPastFetchPartFor(linus.id, { now: new Date() })).toEqual({ next: "stop" });
    await runGmailCheck(new Date());
    expect(await row()).toEqual(paused);
    expect(await past.startPastFetch(linus.id, new Date())).toBe("not_working");
    expect(await h.connectGmail(fake)).toBe("/settings");
    expect((await conn()).state).toBe("working");
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "running", paused: false });
    await runToEnd();
    expect(await row()).toMatchObject({ state: "ended", copied: 60 });
  });

  // covers FR-011, US4 scenario 3, Edge Case "Reload after the end"
  it("disconnect mid-fetch: the row is gone, the check does nothing, copies stay; connecting again shows no old fetch", async () => {
    past.setPastFetchPartForTests({ threads: 10 });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    await past.runPastFetchPart((await conn()).id, { now: new Date() });
    const copied = await h.conversations(linus.id);
    expect(copied).toBeGreaterThan(0);
    await disconnect(linus.id);
    expect(await row()).toBeUndefined();
    expect((await gmailSettings(linus.id)).pastFetch).toEqual({ state: "none" });
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(copied);
    expect(await past.runPastFetchPartFor(linus.id, { now: new Date() })).toEqual({ next: "stop" });
    expect(await h.connectGmail(fake)).toBe("/settings");
    expect((await gmailSettings(linus.id)).pastFetch).toEqual({ state: "none" });
    expect(await h.conversations(linus.id)).toBe(copied);
  });

  // covers US4 scenario 3, Edge Case "Deactivated user reactivated"
  it("deactivation mid-fetch deletes the fetch; reactivated and connected again: no old fetch", async () => {
    const admin = await makeUser({ email: "admin.fake@barnacle.ai", role: "admin" });
    await h.makePastPeople(linus.id, margaret.id);
    putPastMailbox(fake, LINUS, { now: new Date() });
    await past.startPastFetch(linus.id, new Date());
    await users.deactivate(admin.id, linus.id);
    expect(await row()).toBeUndefined();
    await runGmailCheck(new Date());
    await users.reactivate(admin.id, linus.id);
    expect((await gmailSettings(linus.id)).state).toBe("not_connected");
    await h.signInAs(jar, linus.id);
    expect(await h.connectGmail(fake)).toBe("/settings");
    expect((await gmailSettings(linus.id)).pastFetch).toEqual({ state: "none" });
  });

  // covers FR-001, Edge Case "Connection not working"
  it("not connected, needs reconnecting or Gmail off: no fetch starts", async () => {
    expect(await past.startPastFetch(margaret.id, new Date())).toBe("not_working");
    await sql`update gmail_connections set state = 'needs_reconnect' where user_id = ${linus.id}`;
    expect(await past.startPastFetch(linus.id, new Date())).toBe("not_working");
    await sql`update gmail_connections set state = 'working' where user_id = ${linus.id}`;
    vi.stubEnv("GMAIL_TOKEN_KEY", "");
    expect(await past.startPastFetch(linus.id, new Date())).toBe("not_working");
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from past_email_fetches`;
    expect(n.n).toBe(0);
  });

  // covers FR-010, Edge Case "Reload after the end"
  it("after the end the card keeps the end message until the next press", async () => {
    await past.startPastFetch(linus.id, new Date());
    await runToEnd();
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "ended", copied: 0 });
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "ended", copied: 0 });
    await past.startPastFetch(linus.id, new Date());
    expect((await gmailSettings(linus.id)).pastFetch).toMatchObject({ state: "running", copied: 0 });
  });
});
