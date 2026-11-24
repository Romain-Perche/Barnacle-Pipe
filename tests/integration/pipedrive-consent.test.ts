// covers SF-117 US2 scenario 14, FR-014, FR-018, SC-004, SC-005: no person is imported Subscribed unless Pipedrive or
// the user said so; an existing Subscribed person unsubscribed in Pipedrive becomes Unsubscribed (version + 1, a
// timeline entry, a report line named only when visible), nothing else changes; an import never makes anyone Subscribed.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImportView } from "@/server/pipedrive/imports";
import { namesForReport, reportLines } from "@/server/pipedrive/report";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makePerson, makeUser, resetDb } from "./db-helpers";
import { COMPANY, connect, fakeCompany, LINUS_TOKEN, runToEnd, start } from "./pipedrive-helpers";

let linus: { id: number }, margaret: { id: number };
let fake: ReturnType<typeof installFakePipedrive>;
const e = (value: string) => [{ value, primary: true, label: "work" }];

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  fake = installFakePipedrive();
  fakeCompany(fake);
  await connect(linus.id, LINUS_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const row = async (id: number) => (await sql`select * from persons where id = ${id}`)[0];
const consents = async () =>
  new Map((await sql<{ pd: string; consent: string }[]>`
    select l.pipedrive_id::text as pd, p.consent from pipedrive_links l join persons p on p.id = l.person_id where l.kind = 'person' and l.how = 'imported'`)
    .map((r) => [Number(r.pd), r.consent]));

describe("existing CRM people", () => {
  it("a Subscribed person unsubscribed in Pipedrive becomes Unsubscribed, nothing else changes (US2-14, SC-005)", async () => {
    const ada = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: margaret.id, emails: ["ada@fake.example"], role: "Kept role", consent: "subscribed" });
    fake.addPerson(COMPANY, { first_name: "Ada", last_name: "Changed", owner_id: 1, emails: e("ada@fake.example"), marketing_status: "unsubscribed", job_title: "New role" });
    const before = await row(ada);
    await runToEnd(linus.id, await start(linus.id, { consent: "subscribed" }));
    const after = await row(ada);
    expect(after).toEqual({ ...before, consent: "unsubscribed", version: before.version + 1 });
    const events = await sql`select kind, actor_id::int as actor from timeline_events where person_id = ${ada}`;
    expect(events).toEqual([{ kind: "pipedrive_unsubscribed", actor: linus.id }]);
    const view = (await getImportView(linus.id))!;
    const lines = reportLines(view.report, await namesForReport(linus.id, view.report)).map((l) => l.text);
    expect(lines).toContain("Ada Example is unsubscribed in Pipedrive: now Unsubscribed in the CRM.");
  });
  it("names them only when the importer can see them", async () => {
    const hidden = await makePerson({ firstName: "Hidden", lastName: "Privfake", createdBy: margaret.id, private: true, emails: ["hidden@fake.example"] });
    fake.addPerson(COMPANY, { first_name: "Hidden", last_name: "Privfake", owner_id: 1, emails: e("hidden@fake.example"), marketing_status: "unsubscribed" });
    await runToEnd(linus.id, await start(linus.id));
    expect((await row(hidden)).consent).toBe("unsubscribed");
    const view = (await getImportView(linus.id))!;
    const lines = reportLines(view.report, await namesForReport(linus.id, view.report)).map((l) => l.text);
    expect(lines).toContain("A person already in the CRM is unsubscribed in Pipedrive: now Unsubscribed in the CRM.");
    expect(lines.join("\n")).not.toContain("Privfake");
  });
  it("an already imported Subscribed person unsubscribed later in Pipedrive becomes Unsubscribed on the next import", async () => {
    const pd = fake.addPerson(COMPANY, { first_name: "Later", last_name: "Unsubfake", owner_id: 1, marketing_status: "subscribed" });
    await runToEnd(linus.id, await start(linus.id));
    const [{ id }] = await sql<{ id: number }[]>`select person_id::int as id from pipedrive_links where kind = 'person' and pipedrive_id = ${pd}`;
    expect((await row(id)).consent).toBe("subscribed");
    fake.deletePerson(COMPANY, pd);
    fake.addPerson(COMPANY, { id: pd, first_name: "Later", last_name: "Unsubfake", owner_id: 1, marketing_status: "unsubscribed" });
    await runToEnd(linus.id, await start(linus.id));
    expect((await row(id)).consent).toBe("unsubscribed");
    expect(await sql`select 1 from timeline_events where person_id = ${id} and kind = 'pipedrive_unsubscribed'`).toHaveLength(1);
  });
  it("an Unsubscribed CRM person subscribed in Pipedrive stays Unsubscribed (FR-018)", async () => {
    const una = await makePerson({ firstName: "Una", lastName: "Stayfake", createdBy: margaret.id, emails: ["una@fake.example"], consent: "unsubscribed" });
    fake.addPerson(COMPANY, { first_name: "Una", last_name: "Stayfake", owner_id: 1, emails: e("una@fake.example"), marketing_status: "subscribed" });
    const before = await row(una);
    await runToEnd(linus.id, await start(linus.id, { consent: "subscribed" }));
    expect(await row(una)).toEqual(before);
    expect(await sql`select 1 from timeline_events where person_id = ${una}`).toHaveLength(0);
  });
});

describe("imported people (SC-004)", () => {
  it("are Subscribed only when Pipedrive says subscribed or the user chose it", async () => {
    const ids = {
      sub: fake.addPerson(COMPANY, { first_name: "S", last_name: "Fake", owner_id: 1, marketing_status: "subscribed" }),
      unsub: fake.addPerson(COMPANY, { first_name: "U", last_name: "Fake", owner_id: 1, marketing_status: "unsubscribed" }),
      none: fake.addPerson(COMPANY, { first_name: "N", last_name: "Fake", owner_id: 1, marketing_status: "no_consent" }),
      archived: fake.addPerson(COMPANY, { first_name: "A", last_name: "Fake", owner_id: 1, marketing_status: "archived" }),
      unset: fake.addPerson(COMPANY, { first_name: "X", last_name: "Fake", owner_id: 1 }),
    };
    await runToEnd(linus.id, await start(linus.id, { consent: "unsubscribed" }));
    const c = await consents();
    expect([ids.sub, ids.unsub, ids.none, ids.archived, ids.unset].map((id) => c.get(id))).toEqual(["subscribed", "unsubscribed", "unsubscribed", "unsubscribed", "unsubscribed"]);
  });
  it("with the user's Subscribed choice, still never Subscribed when Pipedrive says unsubscribed", async () => {
    const unsub = fake.addPerson(COMPANY, { first_name: "U", last_name: "Fake", owner_id: 1, marketing_status: "unsubscribed" });
    const none = fake.addPerson(COMPANY, { first_name: "N", last_name: "Fake", owner_id: 1, marketing_status: null });
    await runToEnd(linus.id, await start(linus.id, { consent: "subscribed" }));
    const c = await consents();
    expect([c.get(unsub), c.get(none)]).toEqual(["unsubscribed", "subscribed"]);
  });
  it("without Pipedrive's marketing app, everyone gets the user's choice and the part is asked again without it", async () => {
    fake.noMarketingApp();
    const a = fake.addPerson(COMPANY, { first_name: "A", last_name: "Fake", owner_id: 1, marketing_status: "subscribed" });
    const b = fake.addPerson(COMPANY, { first_name: "B", last_name: "Fake", owner_id: 1, marketing_status: "unsubscribed" });
    const id = await start(linus.id, { consent: "unsubscribed" });
    await runToEnd(linus.id, id);
    const c = await consents();
    expect([c.get(a), c.get(b)]).toEqual(["unsubscribed", "unsubscribed"]);
    const asks = fake.requests.filter((r) => r.path === "/api/v2/persons" && r.query.limit === "100");
    expect(asks.map((r) => r.query.include_fields ?? null)).toEqual(["marketing_status", null]);
    const [{ options }] = await sql`select options from pipedrive_imports where id = ${id}`;
    expect(options).toEqual({ noMarketingStatus: true });
  });
});
