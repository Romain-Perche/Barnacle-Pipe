// covers SF-118 FR-018, research.md §14: the fake consent screen and the fake mailbox page work only where fakes are
// allowed and Gmail runs on the fake; through them (and the process's own fake Gmail, as in `npm run dev`) a tester
// connects, puts in mail with or without its notice, and runs the 15-minute check.
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

const { renderToStaticMarkup } = await import("react-dom/server");
const { NextRequest } = await import("next/server");
const { closeDb } = await import("@/server/db");
const ConsentPage = (await import("@/app/dev/fake-google/gmail/page")).default;
const consent = await import("@/app/dev/fake-google/gmail/actions");
const MailboxPage = (await import("@/app/dev/fake-gmail/page")).default;
const mailbox = await import("@/app/dev/fake-gmail/actions");
const { GET: callback } = await import("@/app/(app)/settings/gmail/callback/route");
const { TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");

let linus: { id: number };
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  await makePerson({ firstName: "Ana", createdBy: linus.id, emails: ["ana@example.test"] });
  await h.signInAs(jar, linus.id);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const formOf = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
const params = (url: URL) => Object.fromEntries(url.searchParams);

describe("the fake pages answer 404 outside fake mode", () => {
  it.each([
    ["real Gmail settings", { GMAIL_PUBSUB_TOPIC: "projects/p/topics/t" }],
    ["no GMAIL_TOKEN_KEY", { GMAIL_TOKEN_KEY: "" }],
    ["production", { APP_ENV: "production" }],
  ])("%s", async (_what, env) => {
    const url = await h.startConnect();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await expect(ConsentPage({ searchParams: Promise.resolve(params(url)) })).rejects.toMatchObject({ to: "not-found" });
    await expect(MailboxPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ to: "not-found" });
    await expect(consent.allowFakeGmail(formOf(params(url)))).rejects.toMatchObject({ to: "not-found" });
    await expect(mailbox.runFakeCheck(formOf({ user: "linus@barnacle.ai" }))).rejects.toMatchObject({ to: "not-found" });
  });
  it("the consent screen refuses a redirect_uri other than the app's Gmail callback", async () => {
    const url = await h.startConnect();
    const evil = { ...params(url), redirect_uri: "https://evil.example/settings/gmail/callback" };
    await expect(ConsentPage({ searchParams: Promise.resolve(evil) })).rejects.toMatchObject({ to: "not-found" });
    await expect(consent.allowFakeGmail(formOf(evil))).rejects.toMatchObject({ to: "not-found" });
  });
});

describe("a tester's run through the fake pages", () => {
  it("consent screen → connected; mail put in with or without its notice; the 15-minute check; cancel", async () => {
    const url = await h.startConnect();
    const html = renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve(params(url)) }));
    expect(html).toContain("Read, change and send your email");
    expect(html).toContain("Send email as you");
    expect(html).toContain('value="linus@barnacle.ai"');
    const allow = formOf({ ...params(url), email: "linus@barnacle.ai", "scope:https://www.googleapis.com/auth/gmail.modify": "on", "scope:https://www.googleapis.com/auth/gmail.send": "on" });
    const back = new URL(await h.redirectOf(consent.allowFakeGmail(allow)));
    expect(back.pathname).toBe("/settings/gmail/callback");
    const res = await callback(new NextRequest(back));
    expect(res.headers.get("location")).toBe("http://localhost:3000/settings");
    expect((await h.connectionOf(linus.id))?.state).toBe("working");

    const put = (deliver: boolean, subject: string) =>
      h.redirectOf(mailbox.putFakeMessage(formOf({ user: "linus@barnacle.ai", direction: "received", from: "Ana <ana@example.test>", subject, text: "x", attachments: "a.pdf:10\n:5", label: "INBOX", ...(deliver ? { deliver: "on" } : {}) })));
    expect(await put(true, "Delivered")).toBe("/dev/fake-gmail?user=linus%40barnacle.ai&done=delivered");
    expect(await h.conversations(linus.id)).toBe(1);
    expect(await put(false, "Dropped")).toBe("/dev/fake-gmail?user=linus%40barnacle.ai&done=dropped");
    expect(await h.conversations(linus.id)).toBe(1);
    expect(await h.redirectOf(mailbox.runFakeCheck(formOf({ user: "linus@barnacle.ai" })))).toContain("done=checked");
    expect(await h.conversations(linus.id)).toBe(2);
    expect((await h.attachmentsOf(linus.id)).map((a) => a.name)).toEqual(["a.pdf", "(no name)", "a.pdf", "(no name)"]);
    const page = renderToStaticMarkup(await MailboxPage({ searchParams: Promise.resolve({ user: "linus@barnacle.ai" }) }));
    expect(page).toContain("Key: active");
    expect(page).toContain("Watch: active");
    expect(page).toContain("Delivered");

    await h.redirectOf(mailbox.refuseFakeKey(formOf({ user: "linus@barnacle.ai" })));
    await h.redirectOf(mailbox.runFakeCheck(formOf({ user: "linus@barnacle.ai" })));
    expect((await h.connectionOf(linus.id))?.state).toBe("needs_reconnect");

    const again = await h.startConnect();
    const cancelled = new URL(await h.redirectOf(consent.cancelFakeGmail(formOf(params(again)))));
    expect(cancelled.searchParams.get("error")).toBe("access_denied");
    expect((await callback(new NextRequest(cancelled))).headers.get("location")).toBe("http://localhost:3000/settings?gmail=not_connected");
  });
});
