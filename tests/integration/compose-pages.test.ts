// covers SF-129 FR-001, FR-002, FR-008, FR-022, US1 scenario 1, US4 scenarios 1–2, Edge Case "Archived records": the
// pages show [ WRITE EMAIL ] in the // TIMELINE heading (the drawer too, never on an archived record); ?email=new opens
// the panel (design B) with From, the To filled, the footer and [ SEND ]; without Gmail only the message and
// [ GO TO SETTINGS ]; after sending, the page shows "Email sent to …" once.
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
const actions = await import("@/app/(app)/records/email-actions");
const { afterResponseSettled } = await import("@/server/calendar/soon");
const { installGmailFake } = await import("../fakes/gmail");
const { resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const e = await import("./email-helpers");
const c = await import("./compose-helpers");

let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  w = await e.world(installGmailFake(), jar);
  await h.signInAs(jar, w.ada);
});
afterAll(async () => {
  await afterResponseSettled();
  vi.unstubAllEnvs();
  await closeDb();
});

const props = (id: number, q: Record<string, string> = {}) => ({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve(q) });
const amp = (s: string) => s.replaceAll("&", "&amp;");

describe("[ WRITE EMAIL ]", () => {
  it("in the // TIMELINE heading of the deal, person and organisation pages", async () => {
    expect(await e.html(await DealPage(props(w.pilot)))).toContain(`href="/deals/${w.pilot}?email=new">[ WRITE EMAIL ]</a>`);
    expect(await e.html(await PersonPage(props(w.ana)))).toContain(`href="/people/${w.ana}?email=new">[ WRITE EMAIL ]</a>`);
    expect(await e.html(await OrganisationPage(props(w.exampleLtd)))).toContain(`href="/organisations/${w.exampleLtd}?email=new">[ WRITE EMAIL ]</a>`);
  });
  it("in the board's drawer, keeping the drawer open", async () => {
    const [p] = await sql<{ id: number }[]>`select id::int as id from pipelines`;
    const out = await e.html(await DealsPage({ searchParams: Promise.resolve({ pipeline: String(p.id), open: String(w.pilot) }) }));
    expect(out).toContain(amp(`href="/deals?pipeline=${p.id}&open=${w.pilot}&email=new">[ WRITE EMAIL ]</a>`));
    const panel = await e.html(await DealsPage({ searchParams: Promise.resolve({ pipeline: String(p.id), open: String(w.pilot), email: "new" }) }));
    expect(panel).toContain("// NEW EMAIL · EXAMPLE LTD – PILOT");
    expect(panel).toContain(amp(`href="/deals?pipeline=${p.id}&open=${w.pilot}">[ CANCEL ]</a>`));
  });
  it("not on an archived record, where ?email=new opens nothing", async () => {
    await sql`update deals set archived_at = now() where id = ${w.pilot}`;
    const out = await e.html(await DealPage(props(w.pilot, { email: "new" })));
    expect(out).not.toContain("[ WRITE EMAIL ]");
    expect(out).not.toContain("NEW EMAIL");
  });
});

describe("the panel", () => {
  it("?email=new: heading, From, To filled, the fields, the footer, [ SEND ]; another value opens nothing", async () => {
    const out = await e.html(await DealPage(props(w.pilot, { email: "new" })));
    expect(out).toContain('aria-label="New email"');
    expect(out).toContain("// NEW EMAIL · EXAMPLE LTD – PILOT");
    expect(out).toContain(`<span class="muted">${e.ADA}</span>`);
    expect(out).toMatch(/<span class="chip">ana@example\.test<button/);
    expect(out).toContain('placeholder="Add an address"');
    expect(out).toContain("Sent from your Gmail. It shows on this record and on the CRM people it goes to.");
    expect(out).toContain("[ ATTACH FROM COMPUTER ]");
    expect(out).toContain("0 MB of 25 MB");
    expect(out).toContain("[ SEND ]</button>");
    expect(await e.html(await DealPage(props(w.pilot, { email: "<b>x</b>" })))).not.toContain("NEW EMAIL");
  });
  it("without a working Gmail: the message and [ GO TO SETTINGS ], no fields", async () => {
    await sql`update gmail_connections set state = 'needs_reconnect' where id = ${w.adaConn}`;
    const out = await e.html(await PersonPage(props(w.ana, { email: "new" })));
    expect(out).toContain("Reconnect your Gmail in Settings to send email from the CRM.");
    expect(out).toContain('href="/settings">[ GO TO SETTINGS ]</a>');
    expect(out).not.toContain("[ SEND ]");
  });
});

describe("after sending", () => {
  it("the page shows 'Email sent to …' once, and the EMAIL entry", async () => {
    const r = await actions.sendEmailFromRecord({ ...c.input({ kind: "person", id: w.ana }), target: "person", id: w.ana, back: `/people/${w.ana}` });
    expect(r.status).toBe("sent");
    const out = await e.html(await PersonPage(props(w.ana)));
    expect(out).toContain('<p class="notice" role="status">Email sent to ana@example.test.</p>');
    expect(out).toContain("Next steps");
  });
});
