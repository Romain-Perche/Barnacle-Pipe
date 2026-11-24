// SF-121: the unsubscribe domain code on the real Postgres: unsubscribeByToken, unsubscribePageState,
// unsubscribeLinksFor, and the Consent edit that follows (consent_changed, consentShown).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { unreadCount } from "@/server/notifications";
import { deletePerson, getPerson, updatePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { unsubscribeByToken, unsubscribeLinksFor, unsubscribePageState } from "@/server/records/unsubscribe";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { personForm } from "./record-helpers";

let ada: TestUser;
let linus: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
});
afterAll(closeDb);

async function tokenOf(id: number): Promise<string> {
  const [r] = await sql<{ t: string }[]>`select unsubscribe_token as t from persons where id = ${id}`;
  return r.t;
}
async function person(id: number) {
  const [r] = await sql<{ consent: string; version: number }[]>`select consent, version from persons where id = ${id}`;
  return r;
}
async function lines(id: number, kinds = ["unsubscribed_link", "unsubscribed_mail_app"]): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from timeline_events where person_id = ${id} and kind = any(${kinds})`;
  return r.n;
}
const consentOf = async (id: number) => (await person(id)).consent;

describe("unsubscribeByToken", () => {
  // covers FR-005, FR-018, US1 scenario 2
  it("unsubscribes a subscribed person: one line with no actor, version unchanged, nobody notified", async () => {
    const id = await makePerson({ createdBy: ada.id, ownerId: linus.id, firstName: "Cara" });
    const before = await person(id);
    const unread = await unreadCount(linus.id);
    expect(await unsubscribeByToken(await tokenOf(id), "link")).toBe("done");
    expect(await person(id)).toEqual({ consent: "unsubscribed", version: before.version });
    const { entries } = await readTimeline(linus.id, { personId: id });
    expect(entries.filter((e) => e.kind === "unsubscribed_link")).toEqual([expect.objectContaining({ actorName: null })]);
    expect(await unreadCount(linus.id)).toBe(unread);
  });

  // covers FR-007, FR-015, US3 scenario 3, SC-004
  it("is harmless to repeat, in sequence and at the same moment: one line", async () => {
    const a = await makePerson({ createdBy: ada.id });
    const ta = await tokenOf(a);
    expect(await unsubscribeByToken(ta, "link")).toBe("done");
    expect(await unsubscribeByToken(ta, "link")).toBe("done");
    expect(await lines(a)).toBe(1);

    const b = await makePerson({ createdBy: ada.id });
    const tb = await tokenOf(b);
    expect(await Promise.all([unsubscribeByToken(tb, "link"), unsubscribeByToken(tb, "link")])).toEqual(["done", "done"]);
    expect(await lines(b)).toBe(1);

    const c = await makePerson({ createdBy: ada.id });
    const tc = await tokenOf(c);
    expect(await Promise.all([unsubscribeByToken(tc, "link"), unsubscribeByToken(tc, "mail_app")])).toEqual(["done", "done"]);
    expect(await lines(c)).toBe(1);
  });

  // covers FR-010, US3 scenario 5
  it("unsubscribes archived and private people; the line follows the person's visibility", async () => {
    const archived = await makePerson({ createdBy: ada.id, archived: true });
    const hidden = await makePerson({ createdBy: linus.id, ownerId: linus.id, private: true });
    expect(await unsubscribeByToken(await tokenOf(archived), "mail_app")).toBe("done");
    expect(await unsubscribeByToken(await tokenOf(hidden), "link")).toBe("done");
    expect(await consentOf(archived)).toBe("unsubscribed");
    expect(await consentOf(hidden)).toBe("unsubscribed");
    expect((await readTimeline(ada.id, { personId: archived })).entries.map((e) => e.kind)).toContain("unsubscribed_mail_app");
    expect((await readTimeline(linus.id, { personId: hidden })).entries.map((e) => e.kind)).toContain("unsubscribed_link");
    expect(await getPerson(ada.id, hidden)).toBeNull();
    expect((await readTimeline(ada.id, { personId: hidden })).entries).toEqual([]);
  });
});

describe("unsubscribePageState", () => {
  // covers FR-004, US1 scenarios 1 and 3
  it("is ready for a subscribed person and writes nothing; done once unsubscribed", async () => {
    const id = await makePerson({ createdBy: ada.id });
    const token = await tokenOf(id);
    expect(await unsubscribePageState(token)).toBe("ready");
    expect(await unsubscribePageState(token)).toBe("ready");
    expect(await consentOf(id)).toBe("subscribed");
    expect(await lines(id, ["unsubscribed_link", "unsubscribed_mail_app", "edited", "consent_changed"])).toBe(0);
    await unsubscribeByToken(token, "link");
    expect(await unsubscribePageState(token)).toBe("done");
  });

  // covers the edge case "database unavailable" (preview deployments have no database for the public page)
  it("is error on a preview deployment, before any query", async () => {
    const id = await makePerson({ createdBy: ada.id });
    process.env.VERCEL_ENV = "preview";
    try {
      expect(await unsubscribePageState(await tokenOf(id))).toBe("error");
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});

describe("links that cannot be guessed or changed", () => {
  const saved = process.env.APP_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  });

  // covers FR-002, US3 scenario 1
  it("gives each person a different 64-hex token that never changes and holds nothing about them", async () => {
    const a = await makePerson({ createdBy: ada.id, firstName: "Cara", lastName: "Fakename", emails: ["cara@example.com"] });
    const b = await makePerson({ createdBy: ada.id, firstName: "Dev", lastName: "Fakename" });
    const [ta, tb] = [await tokenOf(a), await tokenOf(b)];
    expect(ta).toMatch(/^[0-9a-f]{64}$/);
    expect(tb).toMatch(/^[0-9a-f]{64}$/);
    expect(ta).not.toBe(tb);
    expect(await tokenOf(a)).toBe(ta);
    const links = JSON.stringify(await unsubscribeLinksFor(a));
    for (const bit of ["Cara", "Fakename", "cara@example.com", `/${a}/`]) expect(links).not.toContain(bit);
  });

  // covers FR-008, US3 scenario 2, SC-002
  it("refuses a token changed, lengthened or shortened by one character, and changes nobody", async () => {
    const id = await makePerson({ createdBy: ada.id });
    const token = await tokenOf(id);
    const flip = token[10] === "a" ? "b" : "a";
    for (const bad of [token.slice(0, 10) + flip + token.slice(11), `${token}a`, token.slice(1), "", "../../etc"]) {
      expect(await unsubscribePageState(bad), bad).toBe("not_found");
      expect(await unsubscribeByToken(bad, "link"), bad).toBe("not_found");
    }
    expect(await consentOf(id)).toBe("subscribed");
  });

  // covers FR-008, US3 scenario 4, SC-005
  it("answers a deleted person's link exactly like a made-up one", async () => {
    const id = await makePerson({ createdBy: ada.id });
    const token = await tokenOf(id);
    expect((await deletePerson(ada.id, id)).status).toBe("deleted");
    expect(await unsubscribePageState(token)).toBe("not_found");
    expect(await unsubscribeByToken(token, "mail_app")).toBe("not_found");
  });

  // covers FR-012, US5 scenarios 1-2, SC-006
  it("unsubscribeLinksFor builds the link and both headers on APP_URL; each address leads to that person only", async () => {
    process.env.APP_URL = "https://crm.example.test/";
    const a = await makePerson({ createdBy: ada.id });
    const b = await makePerson({ createdBy: ada.id });
    const token = await tokenOf(a);
    const links = await unsubscribeLinksFor(a);
    expect(links).toEqual({
      pageUrl: `https://crm.example.test/unsubscribe/${token}`,
      listUnsubscribe: `<https://crm.example.test/unsubscribe/${token}/one-click>`,
      listUnsubscribePost: "List-Unsubscribe=One-Click",
    });
    expect(await unsubscribeLinksFor(999999)).toBeNull();
    const fromPage = links!.pageUrl.split("/").pop()!;
    const fromHeader = links!.listUnsubscribe.match(/unsubscribe\/([^/]+)\/one-click>$/)![1];
    expect(await unsubscribeByToken(fromPage, "link")).toBe("done");
    expect(await unsubscribeByToken(fromHeader, "mail_app")).toBe("done");
    expect(await consentOf(a)).toBe("unsubscribed");
    expect(await consentOf(b)).toBe("subscribed");
  });
});

describe("only a teammate subscribes a person again", () => {
  const edit = async (id: number, over: Parameters<typeof personForm>[0]) => {
    const { version } = await person(id);
    return updatePerson(ada.id, id, version, personForm({ ownerId: String(ada.id), ...over }));
  };

  // covers US4 scenarios 2-3, FR-003, FR-011
  it("teammate subscribes again (Consent line with their name); the old link still works and writes a second line", async () => {
    const id = await makePerson({ createdBy: ada.id, firstName: "Ada", lastName: "Example" });
    const token = await tokenOf(id);
    await unsubscribeByToken(token, "link");
    expect((await edit(id, { consent: "subscribed", consentShown: "unsubscribed" })).status).toBe("saved");
    expect(await consentOf(id)).toBe("subscribed");
    const { entries } = await readTimeline(ada.id, { personId: id });
    expect(entries[0]).toMatchObject({ kind: "consent_changed", actorName: "Ada Fake", oldValue: "Unsubscribed", newValue: "Subscribed" });
    expect(await unsubscribePageState(token)).toBe("ready");
    expect(await unsubscribeByToken(token, "link")).toBe("done");
    expect(await lines(id, ["unsubscribed_link"])).toBe(2);
  });

  // covers FR-019, US4 scenario 4, edge case "edit form opened before the person unsubscribed"
  it("a form opened before the unsubscribe never subscribes the person again", async () => {
    const id = await makePerson({ createdBy: ada.id, firstName: "Ada", lastName: "Example" });
    const { version } = await person(id);
    await unsubscribeByToken(await tokenOf(id), "link");
    const stale = personForm({ ownerId: String(ada.id), firstName: "Ada", lastName: "Example", role: "CFO", consent: "subscribed", consentShown: "subscribed" });
    const res = await updatePerson(ada.id, id, version, stale);
    expect(res.status).toBe("saved");
    expect(await consentOf(id)).toBe("unsubscribed");
    const { entries } = await readTimeline(ada.id, { personId: id });
    expect(entries[0]).toMatchObject({ kind: "edited", fields: ["Role"] });
    expect(entries.some((e) => e.kind === "consent_changed")).toBe(false);

    // A refused save, then a valid one sent back with the same consentShown.
    const v2 = (await person(id)).version;
    expect((await updatePerson(ada.id, id, v2, { ...stale, firstName: "", lastName: "" })).status).toBe("invalid");
    expect((await updatePerson(ada.id, id, v2, { ...stale, role: "CEO" })).status).toBe("saved");
    expect(await consentOf(id)).toBe("unsubscribed");
    expect(await lines(id, ["consent_changed"])).toBe(0);
  });
});
