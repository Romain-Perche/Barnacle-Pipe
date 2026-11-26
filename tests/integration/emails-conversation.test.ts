// covers SF-127 FR-004, FR-005, FR-016, US2 scenarios 1, 2, 5, SC-003, SC-004, edge case "Header text with markup": the
// conversation page shows every email once, oldest first, as plain text (no email HTML ever rendered), with To / Cc
// (Bcc only on the sender's copy), the count, the subject, the back link to a record the viewer can see, and only
// fixed notices.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/emails" }),
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
const { getConversation } = await import("@/server/emails/conversations");
const { default: ConversationPage } = await import("@/app/(app)/emails/[id]/page");
const { messages } = await import("@/server/messages");
const { installGmailFake } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
let conversationId: number;
const T = (h: number) => new Date(Date.UTC(2026, 10, 20, h, 30));
const HOSTILE = `<html><head><style>body{display:none}</style></head><body><p>Thanks <b>Ana</b>!</p><img src="https://tracker.example/p.png"><script>alert("x")</script><a href="https://evil.example">link</a><p>&lt;b&gt;bold&lt;/b&gt;</p></body></html>`;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  // 1: Ana → Ada and Bob (copied in both mailboxes); 2: Ada's HTML-only reply with a Bcc to Bob; 3: Ana with Ben in Cc.
  const first = fake.addMessage(e.ADA, { from: `"Ana Example" <ana@example.test>`, to: `"Ada Fake" <${e.ADA}>, ${e.BOB}`, subject: "Proposal", text: "Hi Ada,\nhere are the figures.\n\nBest, Ana", messageId: "<p1@x>", internalDate: T(9), attachments: [{ name: "figures.pdf", size: 240 * 1024 }] });
  fake.addMessage(e.BOB, { from: `"Ana Example" <ana@example.test>`, to: `"Ada Fake" <${e.ADA}>, ${e.BOB}`, subject: "Proposal", text: "Hi Ada,\nhere are the figures.\n\nBest, Ana", messageId: "<p1@x>", internalDate: T(9), attachments: [{ name: "figures.pdf", size: 240 * 1024 }] });
  fake.addMessage(e.ADA, { from: `"Ada Fake" <${e.ADA}>`, to: `"Ana Example" <ana@example.test>`, bcc: e.BOB, subject: "Re: Proposal", text: null, html: HOSTILE, labels: ["SENT"], threadId: first.threadId, messageId: "<p2@x>", internalDate: T(11) });
  fake.addMessage(e.ADA, { from: `"Ana Example" <ana@example.test>`, to: e.ADA, cc: `"Ben <i>Example</i>" <ben@example.test>`, subject: "Re: Proposal", text: "One more thing.", threadId: first.threadId, messageId: "<p3@x>", internalDate: T(13) });
  await e.sync(w.adaConn);
  await e.sync(w.bobConn);
  conversationId = (await e.conversationIds())[0];
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function page(userId: number, query: Record<string, string> = {}, id: string = String(conversationId)) {
  await h.signInAs(jar, userId);
  return e.html(await ConversationPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }));
}

describe("US2: the whole conversation", () => {
  it("scenarios 1, 5: each email once, oldest first, with sender, To, Cc, full text and attachments; Bcc only on the sender's copy", async () => {
    const c = (await getConversation(w.bob, conversationId))!;
    expect(c.subject).toBe("Proposal");
    expect(c.emails).toHaveLength(3);
    expect(c.emails.map((m) => m.receivedAt)).toEqual([T(9), T(11), T(13)]);
    expect(c.emails[0]).toMatchObject({
      from: { email: "ana@example.test", name: "Ana Example" },
      to: [{ email: e.ADA, name: "Ada Fake" }, { email: e.BOB, name: null }],
      text: "Hi Ada,\nhere are the figures.\n\nBest, Ana",
      attachments: [{ name: "figures.pdf", size: 245760 }],
    });
    expect(c.emails[1].bcc).toEqual([{ email: e.BOB, name: null }]);
    expect(c.emails[2].cc).toEqual([{ email: "ben@example.test", name: "Ben <i>Example</i>" }]);
    expect(c.links.map((l) => [l.kind, l.name])).toEqual([["person", "Ana Example"], ["person", "Ben Example"], ["organisation", "Example Ltd"], ["organisation", "Other Co"], ["deal", "Example Ltd – pilot"]]);
  });
  it("scenario 1: the page: count, subject, back link, // LINKED TO and // EMAILS · OLDEST FIRST, [ DOWNLOAD ]", async () => {
    const out = await page(w.bob, { from: `person-${w.ana}` });
    expect(out).toContain("CONVERSATION · 3 EMAILS");
    expect(out).toContain("<h1>Proposal</h1>");
    expect(out).toContain(`href="/people/${w.ana}">← ANA EXAMPLE</a>`);
    expect(out).toContain("LINKED TO");
    expect(out).toContain("EMAILS · OLDEST FIRST");
    expect(out.indexOf('id="email-')).toBeLessThan(out.indexOf("One more thing."));
    expect(out).toContain("20 NOV 2026, 09:30");
    expect(out).toMatch(/figures\.pdf · 240 KB<a href="\/emails\/attachments\/\d+\/download"/);
    expect(out).toContain("[ UNLINK ]");
    expect(out).toContain("[ LINK DEAL ]");
    expect(out).toContain("[ LINK PERSON ]");
    expect(out).toContain("[ LINK ORGANISATION ]");
  });
  it("scenario 2, SC-003: an HTML-only email shows as plain text: no script, image, style or link from it; markup stays text", async () => {
    const out = await page(w.bob);
    expect(out).not.toMatch(/<script|<img|<style|<iframe|tracker\.example|evil\.example"/);
    expect(out).toContain("Thanks Ana!");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(out).toContain("Ben &lt;i&gt;Example&lt;/i&gt; &lt;ben@example.test&gt;");
  });
  it("the back link only for a record the viewer can see, from a well-formed ?from=", async () => {
    const pia = await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.ada, private: true });
    expect(await page(w.bob, { from: `person-${pia}` })).not.toContain("←");
    expect(await page(w.ada, { from: `person-${pia}` })).toContain("← PIA PRIVATE");
    expect(await page(w.bob, { from: "<script>" })).not.toContain("←");
    expect(await page(w.bob, { from: `deal-${w.pilot}` })).toContain("← EXAMPLE LTD – PILOT");
    expect(await page(w.bob, { from: `organisation-${w.exampleLtd}` })).toContain("← EXAMPLE LTD");
  });
  it("?notice= shows only the fixed texts", async () => {
    expect(await page(w.bob, { notice: "attachment-unavailable" })).toContain(e.escaped(messages.email_attachment_unavailable));
    const odd = await page(w.bob, { notice: "<b>hello</b>" });
    expect(odd).not.toContain("hello");
    expect(await page(w.bob, { notice: "toString" })).not.toContain('role="alert"');
  });
  it("a missing id or a non-number answers not found", async () => {
    await expect(page(w.bob, {}, String(conversationId + 99))).rejects.toMatchObject({ to: "not-found" });
    await expect(page(w.bob, {}, "abc")).rejects.toMatchObject({ to: "not-found" });
  });
});
