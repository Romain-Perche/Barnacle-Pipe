// covers SF-117 FR-028, edge case "a Pipedrive value such as <a href=…>Click</a> or 'Your account is locked'": the
// rendered Settings, progress and report pages and the imported person's timeline show Pipedrive values only as text
// (escaped, never a link), and the report shows them inside quotes.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-pathname": "/settings/pipedrive-import" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { to: "not-found" });
  },
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/settings",
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { runPart } = await import("@/server/pipedrive/imports");
const SettingsPage = (await import("@/app/(app)/settings/page")).default;
const ImportPage = (await import("@/app/(app)/settings/pipedrive-import/page")).default;
const { installFakePipedrive, TEST_PIPEDRIVE_KEY } = await import("../fakes/pipedrive");
const { makeField } = await import("./custom-helpers");
const { makeUser, resetDb } = await import("./db-helpers");
const { connect, runToEnd, start } = await import("./pipedrive-helpers");

const EVIL = '<a href="https://evil.example">Click</a>';
const LOCKED = "Your account is locked";
let linus: { id: number };

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  const fake = installFakePipedrive();
  fake.addCompany({ token: "test-token-markup", user: { id: 1, name: `<b>Fake</b> Person`, email: "linus@barnacle.ai" }, companyId: 7, companyName: `<i>Evilco</i>` });
  fake.addField(7, "person", { field_code: "label_ids", field_name: "Labels", field_type: "set", is_custom_field: false, options: [{ id: 1, label: LOCKED }] });
  fake.addField(7, "person", { field_code: "colour", field_name: "Colour", field_type: "enum", is_custom_field: true, options: [{ id: 1, label: "<script>x</script>" }] });
  fake.addField(7, "person", { field_code: "odd", field_name: `<img src=x onerror=alert(1)>`, field_type: "varchar", is_custom_field: true });
  await makeField({ kind: "person", name: "Colour", type: "single_choice", choices: ["Red"] });
  fake.addPerson(7, { first_name: EVIL, last_name: "Fake", owner_id: 1, label_ids: [1], custom_fields: { colour: 1 }, emails: [{ value: "evil@fake.example", primary: true, label: "work" }] });
  fake.addPerson(7, { first_name: "<u>Second</u>", last_name: "Fake", owner_id: 1, emails: [{ value: "evil@fake.example", primary: true, label: "work" }] });
  await connect(linus.id, "test-token-markup");
  jar.set(SESSION_COOKIE, (await createSession(linus.id)).token);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const noMarkup = (html: string) => {
  expect(html).not.toContain('<a href="https://evil.example"');
  expect(html).not.toContain("<script>x");
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain("<b>Fake</b>");
  expect(html).not.toContain("<i>Evilco</i>");
  expect(html).not.toContain("<u>Second</u>");
};

describe("Pipedrive values on the pages", () => {
  it("are escaped text on Settings, the progress page and the report, and quoted in report lines", async () => {
    const settings = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
    noMarkup(settings);
    expect(settings).toContain("Connected to Pipedrive as &lt;b&gt;Fake&lt;/b&gt; Person (&lt;i&gt;Evilco&lt;/i&gt;).");

    const id = await start(linus.id);
    await runPart(linus.id, id);
    const progress = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));
    noMarkup(progress);
    expect(progress).toContain("&lt;I&gt;EVILCO&lt;/I&gt;");

    await runToEnd(linus.id, id);
    const report = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));
    noMarkup(report);
    expect(report).toContain("Label not on the list: &#x27;Your account is locked&#x27; (1 person)");
    expect(report).toContain("&#x27;&lt;script&gt;x&lt;/script&gt;&#x27; is not a choice of &#x27;Colour&#x27;: left out (1 record).");
    expect(report).toContain("No CRM field named &#x27;&lt;img src=x onerror=alert(1)&gt;&#x27;.");
    expect(report).toContain("Person · &lt;u&gt;Second&lt;/u&gt; Fake");
    expect(report).toContain("Another Pipedrive person, &#x27;&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt; Fake&#x27;, has the same email address.");
  });
  it("keep the imported person's name as typed (text, not markup) in the CRM", async () => {
    await runToEnd(linus.id, await start(linus.id));
    const [p] = await sql`select first_name from persons`;
    expect(p.first_name).toBe(EVIL);
  });
});
