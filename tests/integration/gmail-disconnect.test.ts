// covers SF-118 US4 scenarios 1-4, FR-005, FR-006, FR-017, SC-005, edge case "Deactivated user", Clarifications
// (plan review: no gap copy after a disconnect; a reconnect carries on from the last sync): disconnecting forgets the
// key and keeps what was copied; a refused key shows the reconnect state and the "!"; reconnecting carries on.
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
const { gmailNeedsReconnect, gmailSettings, markNeedsReconnect } = await import("@/server/gmail/connections");
const { renewWatch, runGmailCheck } = await import("@/server/gmail/sync");
const { GmailNeedsReconnect, sendGmail } = await import("@/server/gmail/send");
const { deactivate, reactivate } = await import("@/server/users");
const SettingsPage = (await import("@/app/(app)/settings/page")).default;
const AppLayout = (await import("@/app/(app)/layout")).default;
const actions = await import("@/app/(app)/settings/actions");
const adminActions = await import("@/app/(app)/admin/users/actions");
const { currentSidebar } = await import("@/app/(app)/notifications/actions");
const { installGmailFake, TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");

const LINUS = "linus@barnacle.ai";
let linus: { id: number }, ada: { id: number };
let fake: ReturnType<typeof installGmailFake>;

beforeEach(async () => {
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: LINUS, name: "Linus Fake" });
  await makePerson({ firstName: "Ana", createdBy: linus.id, emails: ["ana@example.test"] });
  fake = installGmailFake();
  await h.signInAs(jar, linus.id);
  await h.connectGmail(fake);
  jar.delete("crm_flash");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const page = async (query: Record<string, string> = {}) => renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve(query) }));
const layout = async () => renderToStaticMarkup(await AppLayout({ children: null }));
const conn = async () => (await h.connectionOf(linus.id))!;
const fromAna = (subject: string, o: Partial<Parameters<typeof fake.addMessage>[1]> = {}) =>
  fake.addMessage(LINUS, { from: "ana@example.test", to: LINUS, subject, text: "x", ...o });

describe("US4 scenario 1: disconnect", () => {
  it("asks first, then forgets the key, stops Gmail's notices, cancels the key and keeps the conversations", async () => {
    fromAna("Before");
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(1);
    const confirm = await page({ disconnect: "1" });
    expect(confirm).toContain("Disconnect Gmail? New email will stop being copied. Emails already copied stay in the CRM.");
    expect(confirm).toContain("[ CANCEL ]");
    const [{ token }] = fake.tokensOf(LINUS);
    expect(await h.redirectOf(actions.disconnectGmail())).toBe("/settings");
    expect(await conn()).toMatchObject({ state: "disconnected", has_key: false, watch_renewed_at: null, watch_expires_at: null, sync_lease_until: null });
    expect(fake.requests.some((r) => r.path.endsWith("/stop"))).toBe(true);
    expect(fake.watchOf(LINUS)).toBeNull();
    expect(fake.tokenStatus(token)).toBe("revoked");
    const html = await page();
    expect(html).toContain("Gmail disconnected.");
    expect(html).toContain("[ CONNECT GMAIL ]");
    expect(await h.conversations(linus.id)).toBe(1);
    // A notice for the address afterwards changes nothing (no watch: a forged one is acknowledged and ignored).
    fromAna("After");
    expect(await fake.deliver(LINUS)).toBeNull();
    const forged = { authorization: `Bearer ${fake.signPushToken()}`, body: { message: { data: Buffer.from(JSON.stringify({ emailAddress: LINUS, historyId: 1 })).toString("base64"), messageId: "1", publishTime: new Date().toISOString() }, subscription: "projects/crm-fake/subscriptions/gmail-push-fake" } };
    const { receiveGmailPush } = await import("@/server/gmail/push");
    expect((await receiveGmailPush(forged.authorization, forged.body)).status).toBe(204);
    await runGmailCheck(new Date());
    expect(await h.conversations(linus.id)).toBe(1);
  });
  it("FR-005: with Google unreachable, the key is still forgotten", async () => {
    fake.down();
    await h.redirectOf(actions.disconnectGmail());
    expect(await conn()).toMatchObject({ state: "disconnected", has_key: false });
  });
  it("markNeedsReconnect after a disconnect does not bring the row back", async () => {
    await h.redirectOf(actions.disconnectGmail());
    await markNeedsReconnect((await conn()).id);
    expect((await conn()).state).toBe("disconnected");
  });
  it("disconnect then connect again: a new connected_at, old conversations still counted, mail in the gap not copied", async () => {
    fromAna("Before");
    await fake.deliver(LINUS);
    const first = (await conn()).connected_at;
    await h.redirectOf(actions.disconnectGmail());
    fromAna("In the gap");
    await new Promise((r) => setTimeout(r, 5));
    expect(await h.connectGmail(fake)).toBe("/settings");
    const again = await conn();
    expect(again.connected_at.getTime()).toBeGreaterThan(first.getTime());
    expect(again.last_synced_at).toBeNull();
    fromAna("After");
    await fake.deliver(LINUS);
    await runGmailCheck(new Date());
    expect((await h.storedMessages(linus.id)).map((m) => m.subject)).toEqual(["Before", "After"]);
    expect(await h.conversations(linus.id)).toBe(2);
  });
});

describe("US4 scenario 2: Google no longer accepts the key", () => {
  async function expectNeedsReconnect(lastSynced: Date | null, count: number) {
    expect(await conn()).toMatchObject({ state: "needs_reconnect", has_key: true });
    expect((await conn()).last_synced_at).toEqual(lastSynced);
    expect(await h.conversations(linus.id)).toBe(count);
    expect(await gmailNeedsReconnect(linus.id)).toBe(true);
    expect(await currentSidebar()).toEqual({ unread: 0, gmailWarn: true, warnLabel: "Gmail needs reconnecting" });
    const side = await layout();
    expect(side).toMatch(/>Settings<span class="warn" role="img" aria-label="Gmail needs reconnecting"[^>]*>!<\/span>/);
    const html = await page();
    expect(html).toContain("Gmail · needs reconnecting");
    expect(html).toContain('class="dot bad"');
    expect(html).toContain("Google no longer accepts the CRM&#x27;s access to linus@barnacle.ai. Reconnect to carry on copying email.");
    expect(html).toContain("[ RECONNECT GMAIL ]");
    expect(html).toContain("[ DISCONNECT ]");
    expect(html).not.toContain("[ SEND ME A TEST EMAIL ]");
    expect(html).toContain(`${count} conversation`);
  }
  it("found by the check's sync", async () => {
    fromAna("Copied");
    await fake.deliver(LINUS);
    const synced = (await conn()).last_synced_at;
    fake.refuseKey(LINUS);
    fromAna("Not copied");
    await runGmailCheck(new Date());
    await expectNeedsReconnect(synced, 1);
    // A later check does not sync it.
    fake.requests.length = 0;
    await runGmailCheck(new Date());
    expect(fake.requests).toEqual([]);
  });
  it("found by the renewal", async () => {
    fake.refuseKey(LINUS);
    expect(await renewWatch((await conn()).id)).toBe("needs_reconnect");
    await expectNeedsReconnect(null, 0);
  });
  it("found by a send; then sends are refused with no Google call (scenario 4)", async () => {
    fake.refuseKey(LINUS);
    await expect(sendGmail(linus.id, { to: ["ana@example.test"], subject: "Hi", text: "x" })).rejects.toThrow(GmailNeedsReconnect);
    await expectNeedsReconnect(null, 0);
    fake.requests.length = 0;
    await expect(sendGmail(linus.id, { to: ["ana@example.test"], subject: "Hi", text: "x" })).rejects.toThrow(GmailNeedsReconnect);
    expect(fake.requests).toEqual([]);
  });
});

describe("US4 scenario 3: reconnect", () => {
  it("keeps connected_at and the count, removes the \"!\", copies new mail and what came meanwhile, never twice", async () => {
    const id = (await conn()).id;
    for (let i = 0; i < 37; i++) {
      await sql`insert into email_threads (connection_id, gmail_thread_id, subject) values (${id}, ${`seeded-${i}`}, 'Seeded')`;
    }
    const copied = fromAna("Copied before");
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(38);
    const before = await conn();
    fake.refuseKey(LINUS);
    await runGmailCheck(new Date());
    expect((await conn()).state).toBe("needs_reconnect");
    fromAna("Meanwhile");
    expect(await h.connectGmail(fake)).toBe("/settings");
    const html = await page();
    expect(html).toContain("Gmail reconnected.");
    expect(html).toContain("Gmail · connected");
    expect(html).toContain("38 conversations copied");
    expect((await conn()).connected_at).toEqual(before.connected_at);
    expect(await currentSidebar()).toEqual({ unread: 0, gmailWarn: false, warnLabel: null });
    expect(await layout()).not.toContain('class="warn"');
    fromAna("New conversation");
    fromAna("Re: Copied before", { threadId: copied.threadId });
    await fake.deliver(LINUS);
    expect(await h.conversations(linus.id)).toBe(40);
    const subjects = (await h.storedMessages(linus.id)).map((m) => m.subject);
    expect(subjects.filter((s) => s === "Copied before")).toHaveLength(1);
    expect(subjects).toEqual(expect.arrayContaining(["Meanwhile", "New conversation", "Re: Copied before"]));
  });
});

describe("edge case: deactivated user", () => {
  it("deactivating forgets the key, cancels it at Google and stops the watch; reactivated, Settings says not connected", async () => {
    const [{ token }] = fake.tokensOf(LINUS);
    expect(await deactivate(ada.id, linus.id)).toEqual({ ok: true });
    expect(await conn()).toMatchObject({ state: "disconnected", has_key: false });
    expect(fake.tokenStatus(token)).toBe("revoked");
    expect(fake.watchOf(LINUS)).toBeNull();
    expect(await reactivate(ada.id, linus.id)).toEqual({ ok: true });
    expect(await gmailSettings(linus.id)).toMatchObject({ state: "not_connected" });
  });
  it("through the admin action as well", async () => {
    const [{ token }] = fake.tokensOf(LINUS);
    await h.signInAs(jar, ada.id);
    const form = new FormData();
    form.set("userId", String(linus.id));
    expect(await h.redirectOf(adminActions.deactivate(form))).toBe("/admin/users");
    expect(fake.tokenStatus(token)).toBe("revoked");
    expect((await conn()).state).toBe("disconnected");
  });
});
