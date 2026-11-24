// covers SF-117 US3 scenarios 7 and 9, FR-006, FR-017, SC-003: one open import per user; two users of one Pipedrive
// company importing at once, or two tabs running the same part, leave exactly one CRM record per Pipedrive record; a
// Pipedrive record whose CRM record was deleted is never added again (spec Clarifications).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deletePerson } from "@/server/records/people";
import { getImportView, runPart, startImport } from "@/server/pipedrive/imports";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeUser, resetDb } from "./db-helpers";
import { COMPANY, connect, fakeCompany, importRow, LINUS_TOKEN, MARGARET_TOKEN, runToEnd, skipWait, start } from "./pipedrive-helpers";

let linus: { id: number }, margaret: { id: number }, ada: { id: number };
let fake: ReturnType<typeof installFakePipedrive>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  fake = installFakePipedrive();
  fakeCompany(fake);
  for (let i = 1; i <= 40; i++) fake.addOrganization(COMPANY, { name: `Shared Org ${i} Fake`, owner_id: 1 });
  for (let i = 1; i <= 350; i++) {
    fake.addPerson(COMPANY, { first_name: `Both${i}`, last_name: "Fake", owner_id: 1, org_id: (i % 40) + 1, emails: [{ value: `both${i}@fake.example`, primary: true, label: "work" }] });
  }
  await connect(linus.id, LINUS_TOKEN);
  await connect(margaret.id, MARGARET_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const counts = async () => (await sql<{ persons: number; orgs: number; links: number; emails: number }[]>`
  select (select count(*)::int from persons) as persons, (select count(*)::int from organisations) as orgs,
         (select count(*)::int from pipedrive_links) as links, (select count(*)::int from person_emails) as emails`)[0];

describe("one import per user (US3-7, FR-006)", () => {
  it("a second start while one is open returns the open one", async () => {
    const id = await start(linus.id);
    expect(await startImport(linus.id, { people: true, organisations: false, consent: "subscribed" })).toEqual({ id, existing: true });
    const both = await Promise.all([1, 2].map(() => startImport(margaret.id, { people: true, organisations: true, consent: "subscribed" })));
    const ids = both.map((r) => ("id" in r ? r.id : 0));
    expect(ids[0]).toBe(ids[1]);
    expect(await sql`select 1 from pipedrive_imports where user_id = ${margaret.id}`).toHaveLength(1);
  });
  it("starting after a finished import keeps only the new one (the latest report)", async () => {
    const first = await start(linus.id);
    await runToEnd(linus.id, first);
    const second = await start(linus.id);
    expect(second).not.toBe(first);
    expect((await sql`select id::int as id from pipedrive_imports where user_id = ${linus.id}`).map((r) => r.id)).toEqual([second]);
  });
});

describe("two users of one company (US3-9, SC-003)", () => {
  it("interleaved parts: each Pipedrive record once; the second import counts the first one's records as already imported", async () => {
    const a = await start(linus.id);
    const b = await start(margaret.id);
    let doneA = false;
    let doneB = false;
    for (let i = 0; i < 200 && !(doneA && doneB); i++) {
      if (!doneA) doneA = (await runPart(linus.id, a)).next === "stop";
      if (!doneB) doneB = (await runPart(margaret.id, b)).next === "stop";
    }
    expect(await counts()).toEqual({ persons: 350, orgs: 40, links: 390, emails: 350 });
    const va = (await getImportView(linus.id))!;
    const vb = (await getImportView(margaret.id))!;
    expect(va.counts.people.imported + vb.counts.people.imported).toBe(350);
    expect(va.counts.people.already + vb.counts.people.already).toBe(350);
    expect(va.counts.people.linked + vb.counts.people.linked).toBe(0);
  });
  it("parts at the same moment (Promise.all): each Pipedrive record once", async () => {
    const a = await start(linus.id);
    const b = await start(margaret.id);
    const run = async (userId: number, id: number) => {
      for (let i = 0; i < 200; i++) {
        const r = await runPart(userId, id);
        if (r.next === "stop") return;
        if (r.next === "wait") await skipWait(id);
      }
    };
    await Promise.all([run(linus.id, a), run(margaret.id, b)]);
    expect(await counts()).toEqual({ persons: 350, orgs: 40, links: 390, emails: 350 });
    expect((await importRow(a)).state).toBe("finished");
    expect((await importRow(b)).state).toBe("finished");
  });
});

describe("two tabs (FR-021)", () => {
  it("the same part run twice at once: the second page is thrown away, no copies", async () => {
    const id = await start(linus.id);
    for (let i = 0; i < 100; i++) {
      const [x, y] = await Promise.all([runPart(linus.id, id), runPart(linus.id, id)]);
      if (x.next === "stop" && y.next === "stop") break;
    }
    expect(await counts()).toEqual({ persons: 350, orgs: 40, links: 390, emails: 350 });
    const view = (await getImportView(linus.id))!;
    expect(view.progress).toEqual([{ kind: "organisations", done: 40, total: 40 }, { kind: "people", done: 350, total: 350 }]);
    expect(view.counts.people.imported).toBe(350);
  });
});

describe("a CRM record deleted after its import (spec Clarifications)", () => {
  it("is counted as already imported and never added again", async () => {
    await runToEnd(linus.id, await start(linus.id));
    const [{ id: personId }] = await sql<{ id: number }[]>`
      select person_id::int as id from pipedrive_links where kind = 'person' order by pipedrive_id limit 1`;
    expect((await deletePerson(ada.id, personId)).status).toBe("deleted");
    await runToEnd(linus.id, await start(linus.id));
    expect((await counts()).persons).toBe(349);
    const view = (await getImportView(linus.id))!;
    expect(view.counts.people).toEqual({ imported: 0, linked: 0, already: 350, notImported: 0 });
  });
});
