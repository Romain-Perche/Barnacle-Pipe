// SF-121: the public route handlers (button and RFC 8058 one-click), the unsubscribe page and the development links
// page, called directly on the real Postgres.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failing = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/records/unsubscribe", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/records/unsubscribe")>();
  return {
    ...real,
    unsubscribeByToken: async (...args: Parameters<typeof real.unsubscribeByToken>) => {
      if (failing.on) throw new Error("database unreachable");
      return real.unsubscribeByToken(...args);
    },
  };
});

const { renderToStaticMarkup } = await import("react-dom/server");
const { closeDb, sql } = await import("@/server/db");
const { messages } = await import("@/server/messages");
const confirm = await import("@/app/unsubscribe/[token]/confirm/route");
const oneClick = await import("@/app/unsubscribe/[token]/one-click/route");
const Page = (await import("@/app/unsubscribe/[token]/page")).default;
const DevLinks = (await import("@/app/dev/unsubscribe-links/page")).default;
const { makePerson, makeUser, resetDb } = await import("./db-helpers");

let adaId: number;
beforeEach(async () => {
  await resetDb();
  failing.on = false;
  adaId = (await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" })).id;
});
afterAll(closeDb);

async function subscribed(over: { firstName?: string; emails?: string[] } = {}) {
  const id = await makePerson({ createdBy: adaId, firstName: over.firstName ?? "Cara", lastName: "Fakename", emails: over.emails });
  const [r] = await sql<{ t: string }[]>`select unsubscribe_token as t from persons where id = ${id}`;
  return { id, token: r.t };
}
const consentOf = async (id: number) => (await sql<{ consent: string }[]>`select consent from persons where id = ${id}`)[0].consent;
const lineCount = async (id: number, kind: string) =>
  (await sql<{ n: number }[]>`select count(*)::int as n from timeline_events where person_id = ${id} and kind = ${kind}`)[0].n;
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const render = async (token: string, search: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ token }), searchParams: Promise.resolve(search) }));

describe("POST /unsubscribe/<token>/confirm", () => {
  // covers FR-005, US1 scenario 2
  it("unsubscribes and sends the browser back to the page with a 303, setting no cookie", async () => {
    const { id, token } = await subscribed();
    const res = await confirm.POST(new Request(`http://localhost/unsubscribe/${token}/confirm`, { method: "POST" }), ctx(token));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`/unsubscribe/${token}$`));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await consentOf(id)).toBe("unsubscribed");
    expect(await lineCount(id, "unsubscribed_link")).toBe(1);
    expect("GET" in confirm).toBe(false);
  });

  // covers the edge case "database unavailable"
  it("sends the browser back with error=unavailable when the database fails", async () => {
    const { id, token } = await subscribed();
    failing.on = true;
    const res = await confirm.POST(new Request(`http://localhost/unsubscribe/${token}/confirm`, { method: "POST" }), ctx(token));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`/unsubscribe/${token}\\?error=unavailable$`));
    expect(await consentOf(id)).toBe("subscribed");
  });

  it("keeps a bad token as one path segment", async () => {
    const res = await confirm.POST(new Request("http://localhost/x", { method: "POST" }), ctx("a/../b?c"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/unsubscribe\/a%2F\.\.%2Fb%3Fc$/);
  });
});

describe("POST /unsubscribe/<token>/one-click (RFC 8058)", () => {
  const post = (token: string, body?: BodyInit, headers?: Record<string, string>) =>
    oneClick.POST(new Request(`http://localhost/unsubscribe/${token}/one-click`, { method: "POST", body, headers }), ctx(token));
  const urlencoded = { "content-type": "application/x-www-form-urlencoded" };
  const expectPlain = (res: Response) => {
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  };

  // covers FR-006, US2 scenarios 1-2
  it("answers 200 to the urlencoded and the multipart one-click body; one line with no actor", async () => {
    const { id, token } = await subscribed();
    const res = await post(token, "List-Unsubscribe=One-Click", urlencoded);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Unsubscribed");
    expectPlain(res);
    expect(await consentOf(id)).toBe("unsubscribed");
    const [line] = await sql`select actor_id from timeline_events where person_id = ${id} and kind = 'unsubscribed_mail_app'`;
    expect(line.actor_id).toBeNull();

    const fd = new FormData();
    fd.set("List-Unsubscribe", "One-Click");
    const again = await post(token, fd);
    expect(again.status).toBe(200);
    expect(await lineCount(id, "unsubscribed_mail_app")).toBe(1);
    // No content type at all: the body read as urlencoded text.
    const bare = await post(token, new Blob(["List-Unsubscribe=One-Click"]));
    expect(bare.status).toBe(200);
  });

  // covers FR-006: anything but List-Unsubscribe=One-Click is refused before the token is looked at
  it("answers 400 to an empty or wrong body, changing nothing", async () => {
    const { id, token } = await subscribed();
    for (const body of [undefined, "", "List-Unsubscribe=Yes"]) {
      const res = await post(token, body, urlencoded);
      expect(res.status, String(body)).toBe(400);
      expect(await res.text()).toBe("Bad request");
      expectPlain(res);
    }
    expect(await consentOf(id)).toBe("subscribed");
    expect(await lineCount(id, "unsubscribed_mail_app")).toBe(0);
  });

  // covers FR-008, US2 scenario 3
  it("answers the same 404 to an unknown, changed, badly shaped or deleted person's token", async () => {
    const { token } = await subscribed();
    const gone = await subscribed({ firstName: "Gone" });
    await sql`delete from persons where id = ${gone.id}`;
    const flip = token[5] === "a" ? "b" : "a";
    const bodies = new Set<string>();
    for (const t of ["f".repeat(64), token.slice(0, 5) + flip + token.slice(6), "not-a-token", gone.token]) {
      const res = await post(t, "List-Unsubscribe=One-Click", urlencoded);
      expect(res.status, t).toBe(404);
      expectPlain(res);
      bodies.add(await res.text());
    }
    expect([...bodies]).toEqual(["Not found"]);
  });

  // covers the edge case "database unavailable"
  it("answers 503 when the database fails", async () => {
    const { token } = await subscribed();
    failing.on = true;
    const res = await post(token, "List-Unsubscribe=One-Click", urlencoded);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Try again later");
    expectPlain(res);
  });
});

describe("GET /unsubscribe/<token> (the page)", () => {
  // covers FR-004, FR-009, FR-013, US1 scenarios 1 and 4, US4 scenario 1
  it("shows the button when ready, done after, not valid for a bad token; never a name, an email or a way back in", async () => {
    const { token } = await subscribed({ emails: ["cara@example.com"] });
    const ready = await render(token);
    expect(ready).toContain(messages.unsubscribe_lead);
    expect(ready).toContain(`action="/unsubscribe/${token}/confirm"`);
    expect(ready).toContain("[ UNSUBSCRIBE ]");
    await confirm.POST(new Request("http://localhost/x", { method: "POST" }), ctx(token));
    const done = await render(token);
    expect(done).toContain(messages.unsubscribe_done.replace(/'/g, "&#x27;"));
    expect(done).not.toContain("<form");
    const invalid = await render("f".repeat(64));
    expect(invalid).toContain(messages.unsubscribe_invalid.replace(/'/g, "&#x27;"));
    expect(invalid).not.toContain("<form");
    for (const html of [ready, done, invalid]) {
      for (const bit of ["Cara", "Fakename", "cara@example.com", "href="]) expect(html).not.toContain(bit);
      // The only form is the [ UNSUBSCRIBE ] one: nothing offers to subscribe again.
      expect(html.match(/<form/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(html.toLowerCase().replace(/unsubscribe/g, "")).not.toContain("subscribe");
    }
  });

  // covers FR-009: no text from the address is shown; only error=unavailable is read
  it("ignores every query value but error=unavailable", async () => {
    const { token } = await subscribed();
    const html = await render(token, { next: "https://evil.example", message: "<b>x</b>", error: "<i>boom</i>" });
    for (const bit of ["evil.example", "&lt;b&gt;", "<b>x", "boom", messages.unsubscribe_error]) expect(html).not.toContain(bit);
    expect(await render(token, { error: "unavailable" })).toContain(messages.unsubscribe_error);
  });

  it("shows the error on a preview deployment", async () => {
    const { token } = await subscribed();
    process.env.VERCEL_ENV = "preview";
    try {
      const html = await render(token);
      expect(html).toContain(messages.unsubscribe_error);
      expect(html).not.toContain("<form");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});

describe("GET /dev/unsubscribe-links", () => {
  const saved = { app: process.env.APP_ENV, vercel: process.env.VERCEL_ENV };
  afterEach(() => {
    process.env.APP_ENV = saved.app;
    if (saved.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.vercel;
  });

  // covers FR-017
  it("lists every person's link and headers in test, and is a 404 in production and on previews", async () => {
    const a = await subscribed({ firstName: "Cara" });
    const b = await subscribed({ firstName: "Dev" });
    const html = renderToStaticMarkup(await DevLinks());
    for (const t of [a.token, b.token]) {
      expect(html).toContain(`href="http://localhost:3000/unsubscribe/${t}"`);
      expect(html).toContain(`&lt;http://localhost:3000/unsubscribe/${t}/one-click&gt;`);
    }
    expect(html).toContain("List-Unsubscribe=One-Click");
    process.env.APP_ENV = "production";
    await expect(DevLinks()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    process.env.APP_ENV = "test";
    process.env.VERCEL_ENV = "preview";
    await expect(DevLinks()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
