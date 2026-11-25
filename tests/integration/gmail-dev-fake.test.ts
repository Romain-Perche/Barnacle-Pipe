// covers SF-118 FR-018, FR-002, US1 scenarios 2-5, US4 scenario 3, research.md §14, plan.md Fix round 1: the fake
// consent screen and the fake mailbox page work only where fakes are
// allowed and Gmail runs on the fake; through them (and the process's own fake Gmail, as in `npm run dev`) a tester
// connects, puts in mail with or without its notice, and runs the 15-minute check.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const paths = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, o?: { maxAge?: number; path?: string }) => {
      if (o?.maxAge === 0) jar.delete(name);
      else {
        jar.set(name, value);
        paths.set(name, o?.path ?? "/");
      }
    },
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
const { POST: answer } = await import("@/app/dev/fake-google/gmail/answer/route");
const MailboxPage = (await import("@/app/dev/fake-gmail/page")).default;
const mailbox = await import("@/app/dev/fake-gmail/actions");
const { GET: callback } = await import("@/app/(app)/settings/gmail/callback/route");
const { TEST_GMAIL_KEY } = await import("../fakes/gmail");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");
const h = await import("./gmail-helpers");
const { askedScopes } = await import("@/server/gmail/rules");

let linus: { id: number };
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("GMAIL_TOKEN_KEY", TEST_GMAIL_KEY);
  vi.stubEnv("GMAIL_PUBSUB_TOPIC", "");
  await resetDb();
  jar.clear();
  paths.clear();
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
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const SEND = "https://www.googleapis.com/auth/gmail.send";

// The browser posts the consent form (urlencoded) to the route; returns the route's answer.
const post = (values: Record<string, string>) =>
  answer(
    new NextRequest("http://localhost:3000/dev/fake-google/gmail/answer", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values).toString(),
    }),
  );
// Status of the route's answer, or "not-found" when it calls notFound().
const statusOf = async (values: Record<string, string>) => {
  try {
    return (await post(values)).status;
  } catch (e) {
    const to = (e as { to?: string }).to;
    if (to) return to;
    throw e;
  }
};
// The browser follows the 303: it loads the Location as a full navigation, sending only the cookies whose path covers
// it; returns where the callback sends the browser next.
async function follow(res: Response): Promise<string> {
  expect(res.status).toBe(303);
  const back = new URL(res.headers.get("location")!);
  expect(back.pathname).toBe("/settings/gmail/callback");
  for (const name of [...jar.keys()]) {
    const p = paths.get(name) ?? "/";
    if (!(back.pathname === p || back.pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) jar.delete(name);
  }
  const res2 = await callback(new NextRequest(back));
  const to = new URL(res2.headers.get("location")!);
  return `${to.pathname}${to.search}`;
}
const allowForm = (url: URL, o: { email?: string; scopes?: string[] } = {}) => ({
  ...params(url),
  email: o.email ?? "linus@barnacle.ai",
  ...Object.fromEntries((o.scopes ?? askedScopes()).map((s) => [`scope:${s}`, "on"])),
  decision: "allow",
});

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
    expect(await statusOf(allowForm(url))).toBe("not-found");
    expect(await statusOf({ ...params(url), decision: "cancel" })).toBe("not-found");
    await expect(mailbox.runFakeCheck(formOf({ user: "linus@barnacle.ai" }))).rejects.toMatchObject({ to: "not-found" });
  });
  it("the consent screen refuses a redirect_uri other than the app's Gmail callback", async () => {
    const url = await h.startConnect();
    const evil = { ...params(url), redirect_uri: "https://evil.example/settings/gmail/callback" };
    await expect(ConsentPage({ searchParams: Promise.resolve(evil) })).rejects.toMatchObject({ to: "not-found" });
    expect(await statusOf({ ...allowForm(url), redirect_uri: evil.redirect_uri })).toBe("not-found");
    expect(await statusOf({ ...evil, decision: "cancel" })).toBe("not-found");
  });
  it("the answer route refuses an unknown decision", async () => {
    const url = await h.startConnect();
    expect(await statusOf({ ...allowForm(url), decision: "maybe" })).toBe("not-found");
  });
});

describe("a tester's run through the fake pages", () => {
  it("consent screen → connected; mail put in with or without its notice; the 15-minute check; cancel", async () => {
    const url = await h.startConnect();
    const html = renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve(params(url)) }));
    expect(html).toContain("Read, change and send your email");
    expect(html).toContain("Send email as you");
    expect(html).toContain('value="linus@barnacle.ai"');
    // both buttons post a plain HTML form to the answer route (a full browser navigation), never a server action
    const forms = [...html.matchAll(/<form[^>]*>/g)].map((m) => m[0]);
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect(f).toContain('action="/dev/fake-google/gmail/answer"');
      expect(f).toContain('method="post"');
    }
    expect(html).toMatch(/<button[^>]*(value="allow"[^>]*name="decision"|name="decision"[^>]*value="allow")[^>]*>\[ ALLOW \]/);
    expect(html).toMatch(/<button[^>]*(value="cancel"[^>]*name="decision"|name="decision"[^>]*value="cancel")[^>]*>\[ CANCEL \]/);
    expect(html).not.toContain("$ACTION");

    const res = await post(allowForm(url));
    const back = new URL(res.headers.get("location")!);
    expect(back.searchParams.get("state")).toBe(url.searchParams.get("state"));
    expect(back.searchParams.get("code")).toBeTruthy();
    expect(await follow(res)).toBe("/settings");
    expect(JSON.parse(jar.get("crm_flash") ?? "{}").code).toBe("gmail_connected");
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

    await h.signInAs(jar, linus.id);
    const again = await h.startConnect();
    const cancelled = await post({ ...params(again), email: "linus@barnacle.ai", decision: "cancel" });
    const cancelledUrl = new URL(cancelled.headers.get("location")!);
    expect(cancelledUrl.searchParams.get("error")).toBe("access_denied");
    expect(cancelledUrl.searchParams.get("state")).toBe(again.searchParams.get("state"));
    expect(cancelledUrl.searchParams.get("code")).toBeNull();
    expect(await follow(cancelled)).toBe("/settings?gmail=not_connected");

    // US4 scenario 3: reconnect through the screen
    await h.signInAs(jar, linus.id);
    expect(await follow(await post(allowForm(await h.startConnect())))).toBe("/settings");
    expect(JSON.parse(jar.get("crm_flash") ?? "{}").code).toBe("gmail_reconnected");
    expect((await h.connectionOf(linus.id))?.state).toBe("working");
  });
  it("an unticked box and another account reach the callback and are refused there (US1 scenarios 4, 5)", async () => {
    expect(await follow(await post(allowForm(await h.startConnect(), { scopes: [MODIFY] })))).toBe("/settings?gmail=missing_scopes");
    await h.signInAs(jar, linus.id);
    expect(await follow(await post(allowForm(await h.startConnect(), { scopes: [SEND] })))).toBe("/settings?gmail=missing_scopes");
    await h.signInAs(jar, linus.id);
    expect(await follow(await post(allowForm(await h.startConnect(), { email: "margaret@barnacle.ai" })))).toBe("/settings?gmail=wrong_account");
    expect(await h.connectionOf(linus.id)).toBeFalsy();
  });
});

// covers SF-124 FR-001, US1 scenario 2, T031: the fake consent screen shows one box per asked scope, Calendar's too when
// Calendar sync is on; leaving it unticked is refused at the callback.
describe("the Calendar box on the fake consent screen (SF-124)", () => {
  const CAL = "https://www.googleapis.com/auth/calendar.events.owned";
  it("shows the Calendar box when Calendar is on, not when off", async () => {
    vi.stubEnv("CALENDAR_SYNC", "on");
    const on = renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve(params(await h.startConnect())) }));
    expect(on).toContain("See, create, change and delete events on calendars you own");
    expect(on).toContain(`name="scope:${CAL}"`);
    vi.stubEnv("CALENDAR_SYNC", "");
    const off = renderToStaticMarkup(await ConsentPage({ searchParams: Promise.resolve(params(await h.startConnect())) }));
    expect(off).not.toContain("See, create, change and delete events");
  });
  it("unticking Calendar gives missing_scopes; all ticked connects with Calendar", async () => {
    vi.stubEnv("CALENDAR_SYNC", "on");
    expect(await follow(await post(allowForm(await h.startConnect(), { scopes: [MODIFY, SEND] })))).toBe("/settings?gmail=missing_scopes");
    expect(await h.connectionOf(linus.id)).toBeFalsy();
    await h.signInAs(jar, linus.id);
    expect(await follow(await post(allowForm(await h.startConnect())))).toBe("/settings");
    expect((await h.connectionOf(linus.id))?.scopes.split(" ")).toContain(CAL);
  });
});
