// covers SF-127 FR-014, US6 scenarios 1-4, SC-006, edge case "Several of a person's addresses in one email": every
// copied email raises the Last contacted of its sender and recipients (To, Cc, Bcc) to its Gmail time when later,
// never lowering it, private people included.
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

const { closeDb, sql } = await import("@/server/db");
const { installGmailFake } = await import("../fakes/gmail");
const { makePerson, resetDb } = await import("./db-helpers");
const e = await import("./email-helpers");

let fake: ReturnType<typeof installGmailFake>;
let w: Awaited<ReturnType<typeof e.world>>;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  fake = installGmailFake();
  w = await e.world(fake, jar);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const setLast = (id: number, at: string) => sql`update persons set last_contacted_at = ${new Date(at)} where id = ${id}`;

describe("US6: email raises Last contacted", () => {
  it("scenario 1: 20 Nov → an email of 25 Nov 14:05 raises it", async () => {
    await setLast(w.ana, "2026-11-20T10:00:00Z");
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "x", text: "x", internalDate: new Date("2026-11-25T14:05:00Z") });
    await e.sync(w.adaConn);
    expect(await e.lastContacted(w.ana)).toEqual(new Date("2026-11-25T14:05:00Z"));
  });
  it("scenario 2: 25 Nov → an email of 22 Nov leaves it", async () => {
    await setLast(w.ana, "2026-11-25T10:00:00Z");
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "x", text: "x", internalDate: new Date("2026-11-22T09:00:00Z") });
    await e.sync(w.adaConn);
    expect(await e.lastContacted(w.ana)).toEqual(new Date("2026-11-25T10:00:00Z"));
  });
  it("scenario 3: Ana in To and Ben in Bcc of Ada's email → both raised", async () => {
    const at = new Date("2026-11-25T16:00:00Z");
    fake.addMessage(e.ADA, { from: e.ADA, to: "ana@example.test", bcc: "ben@example.test", subject: "x", text: "x", labels: ["SENT"], internalDate: at });
    await e.sync(w.adaConn);
    expect(await e.lastContacted(w.ana)).toEqual(at);
    expect(await e.lastContacted(w.ben)).toEqual(at);
  });
  it("scenario 4: a private person is raised like anyone else", async () => {
    const pia = await makePerson({ firstName: "Pia", lastName: "Private", createdBy: w.ada, private: true, emails: ["pia@example.test"] });
    const at = new Date("2026-11-25T17:00:00Z");
    fake.addMessage(e.ADA, { from: "pia@example.test", to: e.ADA, subject: "x", text: "x", internalDate: at });
    await e.sync(w.adaConn);
    expect(await e.lastContacted(pia)).toEqual(at);
  });
  it("two of Ana's addresses in one email: raised once to the email's time; a later done call still wins", async () => {
    const at = new Date("2026-11-24T08:00:00Z");
    fake.addMessage(e.ADA, { from: e.ADA, to: "ana@example.test, ana.example@mail.test", subject: "x", text: "x", labels: ["SENT"], internalDate: at });
    await e.sync(w.adaConn);
    expect(await e.lastContacted(w.ana)).toEqual(at);
    await setLast(w.ana, "2026-11-26T09:00:00Z"); // a done call after it
    fake.addMessage(e.ADA, { from: "ana@example.test", to: e.ADA, subject: "y", text: "y", internalDate: new Date("2026-11-25T09:00:00Z") });
    await e.sync(w.adaConn);
    expect(await e.lastContacted(w.ana)).toEqual(new Date("2026-11-26T09:00:00Z"));
  });
});
