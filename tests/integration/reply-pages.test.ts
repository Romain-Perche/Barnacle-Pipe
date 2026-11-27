// covers SF-130 US1 scenarios 1, 3 and 8, FR-001, FR-003, FR-008, FR-019, edge cases "Who sees the buttons", "Archived
// records", "Reply on the board's drawer" (T027): every EMAIL entry of a timeline (deal page, the board's drawer, person,
// organisation) and every email of the conversation page shows [ REPLY ] [ REPLY ALL ] [ FORWARD ] opening the box on
// the same page; none on an archived record; ?email=reply-<id> opens the box filled; a hidden or missing email opens
// "This conversation doesn't exist or you can't see it." with no [ SEND ]; the conversation page shows "Email sent to …".
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number }) => void (o?.maxAge === 0 ? jar.delete(name) : jar.set(name, value)),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-pathname": "/people" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { closeDb, sql } = await import("@/server/db");
const { default: PersonPage } = await import("@/app/(app)/people/[id]/page");
const { default: OrganisationPage } = await import("@/app/(app)/organisations/[id]/page");
const { default: DealPage } = await import("@/app/(app)/deals/[id]/page");
const { default: DealsPage } = await import("@/app/(app)/deals/page");
const { default: ConversationPage } = await import("@/app/(app)/emails/[id]/page");
const actions = await import("@/app/(app)/records/email-actions");
const { replyBox } = await import("@/server/emails/reply");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");
const r = await import("./reply-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;
let one: Awaited<ReturnType<typeof r.received>>, two: Awaited<ReturnType<typeof r.received>>;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
  await h.signInAs(jar, w.ada);
  one = await r.received(fake, e.ADA, w.adaConn, { internalDate: new Date("2026-11-20T10:00:00Z") });
  two = await r.received(fake, e.ADA, w.adaConn, { threadId: one.threadId, subject: "Re: Pricing" });
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const props = (id: number, q: Record<string, string> = {}) => ({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve(q) });
const amp = (s: string) => s.replaceAll("&", "&amp;");
const buttons = (base: string, id: number) =>
  [`href="${amp(`${base}reply-${id}`)}">[ REPLY ]</a>`, `href="${amp(`${base}reply-all-${id}`)}">[ REPLY ALL ]</a>`, `href="${amp(`${base}forward-${id}`)}">[ FORWARD ]</a>`];

describe("US1 scenario 8: the buttons", () => {
  it("on every EMAIL entry of the deal, person and organisation pages, in the .eh row", async () => {
    const pages = [
      [await DealPage(props(w.pilot)), `/deals/${w.pilot}?email=`],
      [await PersonPage(props(w.ana)), `/people/${w.ana}?email=`],
      [await OrganisationPage(props(w.exampleLtd)), `/organisations/${w.exampleLtd}?email=`],
    ] as const;
    for (const [node, base] of pages) {
      const out = await e.html(node);
      for (const id of [one.id, two.id]) for (const b of buttons(base, id)) expect(out).toContain(b);
      expect(out).toMatch(/<div class="eh"><div class="emailhead">Ana Example → ada@barnacle\.ai<\/div><span class="acts mini"><a class="btn"/);
    }
  });
  it("in the board's drawer, keeping the drawer open; ?email=reply- opens the box over it, back to the drawer", async () => {
    const [p] = await sql<{ id: number }[]>`select id::int as id from pipelines`;
    const base = `/deals?pipeline=${p.id}&open=${w.pilot}&email=`;
    const out = await e.html(await DealsPage({ searchParams: Promise.resolve({ pipeline: String(p.id), open: String(w.pilot) }) }));
    for (const b of buttons(base, two.id)) expect(out).toContain(b);
    const panel = await e.html(await DealsPage({ searchParams: Promise.resolve({ pipeline: String(p.id), open: String(w.pilot), email: `reply-${two.id}` }) }));
    expect(panel).toContain("// REPLY · Re: Pricing");
    expect(panel).toContain(amp(`href="/deals?pipeline=${p.id}&open=${w.pilot}">[ CANCEL ]</a>`));
  });
  it("on every email of the conversation page, with ?from= kept", async () => {
    const out = await e.html(await ConversationPage(props(one.conversation_id)));
    for (const id of [one.id, two.id]) for (const b of buttons(`/emails/${one.conversation_id}?email=`, id)) expect(out).toContain(b);
    expect(out).toContain(`<div class="eh"><div class="hd">To ada@barnacle.ai</div><span class="acts mini">`);
    const from = await e.html(await ConversationPage(props(one.conversation_id, { from: `deal-${w.pilot}` })));
    for (const b of buttons(`/emails/${one.conversation_id}?from=deal-${w.pilot}&email=`, one.id)) expect(from).toContain(b);
  });
  it("none on an archived deal's timeline, where ?email=reply- opens nothing; the conversation page still has them", async () => {
    await sql`update deals set archived_at = now() where id = ${w.pilot}`;
    const out = await e.html(await DealPage(props(w.pilot, { email: `reply-${one.id}` })));
    expect(out).toContain("Pricing");
    expect(out).not.toContain("[ REPLY ]");
    expect(out).not.toContain("// REPLY");
    expect(await e.html(await ConversationPage(props(one.conversation_id)))).toContain("[ REPLY ]");
  });
});

describe("US1 scenario 1, FR-003, FR-008: ?email=reply-<id> opens the box", () => {
  it("on the deal page: heading, From, To named, Re:, the quote as text, the reply footer, [ SEND ]", async () => {
    const out = await e.html(await DealPage(props(w.pilot, { email: `reply-${one.id}` })));
    expect(out).toContain('aria-label="Reply"');
    expect(out).toContain("// REPLY · Pricing");
    expect(out).toContain(`<span class="muted">${e.ADA}</span>`);
    expect(out).toContain('<span class="chip" title="ana@example.test">Ana Example<button');
    expect(out).toContain('value="Re: Pricing"');
    expect(out).toContain(`<pre class="quote" aria-label="Quoted below your text">${e.escaped("On 20 Nov 2026 at 10:00, Ana Example <ana@example.test> wrote:\n> Hello,\n>\n> The price is 10.")}</pre>`);
    expect(out).toContain("Sent from your Gmail, in this conversation.");
    expect(out).toContain("[ ATTACH FROM COMPUTER ]");
    expect(out).toContain("[ SEND ]</button>");
    expect(out).toContain(`href="/deals/${w.pilot}">[ CANCEL ]</a>`);
  });
  it("on the conversation page: the box goes back to the conversation; no record: no record files", async () => {
    const out = await e.html(await ConversationPage(props(one.conversation_id, { email: `forward-${one.id}` })));
    expect(out).toContain("// FORWARD · Pricing");
    expect(out).toContain('value="Fwd: Pricing"');
    expect(out).toContain(`href="/emails/${one.conversation_id}">[ CANCEL ]</a>`);
    expect(out).not.toContain("FILE ▾");
    const withFrom = await e.html(await ConversationPage(props(one.conversation_id, { from: `deal-${w.pilot}`, email: `reply-all-${one.id}` })));
    expect(withFrom).toContain("// REPLY ALL · Pricing");
    expect(withFrom).toContain(amp(`href="/emails/${one.conversation_id}?from=deal-${w.pilot}">[ CANCEL ]</a>`));
    expect((await replyBox(w.ada, { mode: "reply", messageId: one.id }, { kind: "deal", id: w.pilot })).record).toMatchObject({ kind: "deal", id: w.pilot });
  });
  it("a hidden or missing email: the box with 'This conversation doesn't exist or you can't see it.' and no [ SEND ]", async () => {
    await makePerson({ firstName: "Pia", createdBy: w.bob, private: true, emails: ["pia@example.test"] });
    const hidden = await r.received(fake, e.BOB, w.bobConn, { from: "pia@example.test", subject: "Secret" });
    for (const id of [hidden.id, 999_999]) {
      const out = await e.html(await DealPage(props(w.pilot, { email: `reply-${id}` })));
      expect(out).toContain("This conversation doesn&#x27;t exist or you can&#x27;t see it.");
      expect(out).not.toContain("[ SEND ]");
      expect(out).not.toContain("Secret");
      expect(out).toContain(`href="/deals/${w.pilot}">[ CLOSE ]</a>`);
    }
    expect(await e.html(await DealPage(props(w.pilot, { email: `reply-x` })))).not.toContain("[ CLOSE ]");
  });
});

describe("US1 scenario 3: after sending from the conversation page", () => {
  it("the same page, the reply as its newest email, 'Email sent to …'", async () => {
    const box = await replyBox(w.ada, { mode: "reply", messageId: two.id }, null);
    const answer = await actions.sendEmailReply({
      mode: "reply", messageId: two.id, record: null, sendKey: box.sendKey, to: box.to, cc: [], bcc: [], subject: box.reply!.subject,
      text: "Thanks Ana.", fileIds: [], uploadIds: [], forwardIds: [], back: `/emails/${one.conversation_id}`,
    });
    expect(answer).toEqual({ status: "sent", back: `/emails/${one.conversation_id}` });
    const out = await e.html(await ConversationPage(props(one.conversation_id)));
    expect(out).toContain('<p class="notice" role="status">Email sent to ana@example.test.</p>');
    expect(out).toContain("</span> CONVERSATION · 3 EMAILS</div>");
    const [sent] = await sql<{ id: number }[]>`select max(id)::int as id from email_messages`;
    expect(out.indexOf(`id="email-${sent.id}"`)).toBeGreaterThan(out.indexOf(`id="email-${two.id}"`));
    expect(out).toContain(`<div class="emailtext">Thanks Ana.\n\nOn `);
  });
});
