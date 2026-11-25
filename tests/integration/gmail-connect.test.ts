// covers SF-118 US1 scenarios 1-5, FR-001, FR-002, FR-003, FR-004, FR-016, FR-017, SC-004, edge cases "Connecting
// twice" and "Gmail not set up": connecting through the start action, the consent screen and the callback stores the
// sealed key only for the user's own account with both permissions; the key never shows in plain text anywhere.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
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
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { closeDb, sql } = await import("@/server/db");
const { gmailNeedsReconnect, gmailSettings } = await import("@/server/gmail/connections");
const { messages, templates } = await import("@/server/messages");
const SettingsPage = (await import("@/app/(app)/settings/page")).default;
const AppLayout = (await import("@/app/(app)/layout")).default;
const actions = await import("@/app/(app)/settings/actions");
const { currentSidebar } = await import("@/app/(app)/notifications/actions");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");

let linus: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installGmailFake>;
const FLASH = "crm_flash";

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  // SF-118's Gmail-only connection: Calendar sync off (SF-124's three-scope connect is tests/integration/calendar-connect.test.ts).
  vi.stubEnv("CALENDAR_SYNC", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installGmailFake();
  await h.signInAs(jar, linus.id);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const page = async (query: Record<string, string> = {}) => renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve(query) }));
const layout = async () => renderToStaticMarkup(await AppLayout({ children: null }));
const count = async (table: string) => (await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`)[0].n;

describe("US1 scenario 1: not connected", () => {
  it("shows the Gmail card after Pipedrive with [ CONNECT GMAIL ], and one Settings link with no \"!\"", async () => {
    expect(await gmailSettings(linus.id)).toMatchObject({ mode: "fake", state: "not_connected", conversations: 0 });
    expect(await gmailNeedsReconnect(linus.id)).toBe(false);
    expect(await currentSidebar()).toEqual({ unread: 0, gmailWarn: false, warnLabel: null });
    const html = await page();
    expect(html.indexOf("PIPEDRIVE")).toBeGreaterThan(-1);
    expect(html.indexOf("GMAIL")).toBeGreaterThan(html.indexOf("PIPEDRIVE"));
    expect(html).toContain("Gmail is not connected.");
    expect(html).toContain("[ CONNECT GMAIL ]");
    expect(html).not.toContain("[ SEND ME A TEST EMAIL ]");
    const side = await layout();
    expect(side.match(/>Settings</g)).toHaveLength(1);
    expect(side).not.toContain('class="warn"');
  });
});

describe("US1 scenario 2: connect", () => {
  it("asks Google for both scopes, offline, for the user's own address, and remembers the request in a cookie", async () => {
    const url = await h.startConnect();
    expect(`${url.origin}${url.pathname}`).toBe("http://localhost:3000/dev/fake-google/gmail");
    const p = url.searchParams;
    expect(p.get("scope")).toBe(`${h.MODIFY} ${h.SEND}`);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("login_hint")).toBe("linus@barnacle.ai");
    expect(p.get("redirect_uri")).toBe("http://localhost:3000/settings/gmail/callback");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(JSON.parse(jar.get("crm_gmail_oauth")!)).toMatchObject({ state: p.get("state"), userId: linus.id });
  });
  it("stores a working connection, starts Gmail's notices, and shows the connected card once", async () => {
    expect(await h.connectGmail(fake)).toBe("/settings");
    expect(jar.has("crm_gmail_oauth")).toBe(false);
    const row = (await h.connectionOf(linus.id))!;
    expect(row).toMatchObject({ state: "working", email: "linus@barnacle.ai", has_key: true, last_synced_at: null, scopes: `${h.MODIFY} ${h.SEND}` });
    expect(Date.now() - row.connected_at.getTime()).toBeLessThan(60_000);
    expect(row.history_id).not.toBeNull();
    expect(row.watch_expires_at!.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(fake.watchOf("linus@barnacle.ai")?.topic).toBe("projects/crm-fake/topics/gmail-fake");
    expect(await h.conversations(linus.id)).toBe(0);
    const html = await page();
    expect(html).toContain("Gmail connected.");
    expect(html).toContain("Gmail · connected");
    expect(html).toContain('class="dot"');
    expect(html).toContain("Connected as linus@barnacle.ai");
    expect(html).toContain("Last sync: Not synced yet");
    expect(html).toContain("0 conversations copied");
    expect(html).toMatch(/Copying since \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
    for (const b of ["[ SEND ME A TEST EMAIL ]", "[ DISCONNECT ]"]) expect(html).toContain(b);
    expect(html).not.toContain("[ CONNECT GMAIL ]");
    // The flash shows once: the proxy drops its cookie on the next page load.
    jar.delete(FLASH);
    expect(await page()).not.toContain("Gmail connected.");
  });
});

describe("US1 scenarios 3-5 and FR-002: refusals store nothing", () => {
  it("cancel on Google's screen, or a state that does not match → not connected", async () => {
    expect(await h.connectGmail(fake, { deny: true })).toBe("/settings?gmail=not_connected");
    expect(await h.connectGmail(fake, { state: "another-state" })).toBe("/settings?gmail=not_connected");
    expect(await h.connectionOf(linus.id)).toBeUndefined();
    const html = await page({ gmail: "not_connected" });
    expect(html).toContain("Gmail was not connected.");
    expect(html).toContain("[ CONNECT GMAIL ]");
  });
  it("another Google account → nothing stored, the wrong-account message with the sign-in address, the key cancelled", async () => {
    expect(await h.connectGmail(fake, { email: "someone@gmail.example" })).toBe("/settings?gmail=wrong_account");
    expect(await h.connectionOf(linus.id)).toBeUndefined();
    expect(fake.tokensOf("someone@gmail.example").map((t) => t.status)).toEqual(["revoked"]);
    expect(await page({ gmail: "wrong_account" })).toContain(templates.gmail_wrong_account("linus@barnacle.ai"));
  });
  it("one permission unticked → missing scopes, nothing stored, the key cancelled", async () => {
    expect(await h.connectGmail(fake, { scopes: [h.MODIFY] })).toBe("/settings?gmail=missing_scopes");
    expect(await h.connectionOf(linus.id)).toBeUndefined();
    expect(fake.tokensOf("linus@barnacle.ai").map((t) => t.status)).toEqual(["revoked"]);
    expect(await page({ gmail: "missing_scopes" })).toContain("Google needs all the permissions asked for. Try again and tick every box.");
  });
  it("a callback with no cookie, or with a cookie made for another user, is refused", async () => {
    const url = await h.startConnect();
    jar.delete("crm_gmail_oauth");
    expect(await h.consentAndReturn(fake, url)).toBe("/settings?gmail=not_connected");
    const other = await h.startConnect();
    const cookie = JSON.parse(jar.get("crm_gmail_oauth")!);
    jar.set("crm_gmail_oauth", JSON.stringify({ ...cookie, userId: margaret.id }));
    expect(await h.consentAndReturn(fake, other)).toBe("/settings?gmail=not_connected");
    expect(await count("gmail_connections")).toBe(0);
    // A cookie started by Margaret, used by Linus's session.
    await h.signInAs(jar, margaret.id);
    const hers = await h.startConnect();
    await h.signInAs(jar, linus.id);
    expect(await h.consentAndReturn(fake, hers, { email: "margaret@barnacle.ai" })).toBe("/settings?gmail=not_connected");
    expect(await count("gmail_connections")).toBe(0);
  });
  it("never shows text from the address", async () => {
    const html = await page({ gmail: "<b>Your account is locked</b>" });
    expect(html).not.toContain("Your account is locked");
    expect(html).not.toContain('class="err"');
  });
});

describe("edge cases", () => {
  it("connecting twice keeps one row and cancels the first key at Google", async () => {
    await h.connectGmail(fake);
    await h.connectGmail(fake);
    expect(await count("gmail_connections")).toBe(1);
    expect(fake.tokensOf("linus@barnacle.ai").map((t) => t.status)).toEqual(["revoked", "active"]);
  });
  it("Gmail not set up (no GMAIL_TOKEN_KEY): the card says so, no button, and the start action refuses", async () => {
    vi.stubEnv("GMAIL_TOKEN_KEY", "");
    expect(await gmailSettings(linus.id)).toMatchObject({ mode: "off", state: "not_connected" });
    const html = await page();
    expect(html).toContain("Gmail can&#x27;t be connected right now.");
    expect(html).not.toContain("[ CONNECT GMAIL ]");
    expect(await h.redirectOf(actions.startGmailConnect())).toBe("/settings?gmail=unavailable");
    expect(jar.has("crm_gmail_oauth")).toBe(false);
  });
});

describe("SC-004: the key never shows in plain text", () => {
  it("is in no table, no page, no message and no console output", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" "))));
    try {
      await h.connectGmail(fake);
      fake.addMessage("linus@barnacle.ai", { from: "ana@example.test", to: "linus@barnacle.ai", subject: "Hi", text: "Hello" });
      const { runGmailCheck } = await import("@/server/gmail/sync");
      await runGmailCheck(new Date());
      const [{ token }] = fake.tokensOf("linus@barnacle.ai");
      expect(token.length).toBeGreaterThan(20);
      const secret = token.slice(-24);
      const columns = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
        select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and data_type in ('text', 'bytea', 'jsonb', 'character varying')`;
      expect(columns.some((c) => c.table_name === "gmail_connections" && c.column_name === "token_cipher")).toBe(true);
      for (const c of columns) {
        const col = sql(c.column_name);
        const text = c.data_type === "bytea" ? sql`encode(${col}, 'escape')` : sql`${col}::text`;
        const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(c.table_name)} where position(${secret} in ${text}) > 0`;
        expect(n, `${c.table_name}.${c.column_name}`).toBe(0);
        if (c.data_type === "bytea") {
          const [{ b }] = await sql<{ b: number }[]>`select count(*)::int as b from ${sql(c.table_name)} where position(convert_to(${secret}, 'UTF8') in ${col}) > 0`;
          expect(b, `${c.table_name}.${c.column_name} bytes`).toBe(0);
        }
      }
      const html = (await page()) + (await page({ disconnect: "1" })) + (await layout());
      expect(html).not.toContain(secret);
      expect(JSON.stringify(await gmailSettings(linus.id))).not.toContain(secret);
      expect(JSON.stringify(messages)).not.toContain(secret);
      expect(JSON.stringify([...jar.values()])).not.toContain(secret);
      expect(logged.join("\n")).not.toContain(secret);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
