// covers SF-114 FR-009, US3 scenarios 4–6: // LATEST UPDATES merges the ambassador's own entries and those of the
// people and deals they referred, newest first, each once, 20 at a time
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { readAmbassadorUpdates } from "@/server/records/ambassadors";
import { addNote } from "@/server/records/notes";
import { makeAmbassador, refer } from "./ambassador-helpers";
import { makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";

let ada: TestUser;
let stage: number;
let cara: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  cara = await makeAmbassador({ firstName: "Cara", lastName: "Example", createdBy: ada.id });
});
afterAll(closeDb);

async function event(target: { person: number } | { deal: number }, minutesAgo: number, kind = "edited") {
  const [row] = await sql<{ id: number }[]>`
    insert into timeline_events (person_id, deal_id, kind, actor_id, created_at)
    values (${"person" in target ? target.person : null}, ${"deal" in target ? target.deal : null}, ${kind}, ${ada.id},
            now() - ${minutesAgo} * interval '1 minute')
    returning id::int as id`;
  return row.id;
}

describe("readAmbassadorUpdates", () => {
  it("merges own, referred people's and referred deals' entries newest first, each once, tagged by source (US3 scenario 4)", async () => {
    const ben = await makePerson({ firstName: "Ben", lastName: "Referredfake", createdBy: ada.id });
    await refer("person", ben, cara);
    const deal = await makeDeal({ title: "Fake referral · website", stageId: stage, createdBy: ada.id, personId: ben });
    await refer("deal", deal, cara);
    // Cara is only a contact on this deal: its entries are not hers.
    const contactDeal = await makeDeal({ title: "Contact only", stageId: stage, createdBy: ada.id, personId: cara });
    const own = await event({ person: cara }, 30);
    const onBen = await event({ person: ben }, 20);
    const onDeal = await event({ deal: deal }, 10);
    await event({ deal: contactDeal }, 5);
    await event({ person: await makePerson({ firstName: "Other", createdBy: ada.id }) }, 1);
    const page = await readAmbassadorUpdates(ada.id, cara, 20);
    expect(page.entries.map((e) => e.id)).toEqual([onDeal, onBen, own]);
    expect(page.entries[0].deal).toEqual({ id: deal, title: "Fake referral · website", archived: false });
    expect(page.entries[0].person).toBeNull();
    expect(page.entries[1].person).toEqual({ id: ben, name: "Ben Referredfake", archived: false });
    expect(page.entries[1].deal).toBeNull();
    expect(page.entries[2].person).toBeNull();
    expect(page.more).toBe(false);
  });

  it("puts a note just added on a referred deal first, with its text (US3 independent test)", async () => {
    const deal = await makeDeal({ title: "Fake referral · pilot", stageId: stage, createdBy: ada.id });
    await refer("deal", deal, cara);
    await event({ person: cara }, 60);
    expect((await addNote(ada.id, { dealId: deal }, "Cara says they will decide after Christmas.", [])).status).toBe("ok");
    const [first] = (await readAmbassadorUpdates(ada.id, cara, 20)).entries;
    expect(first.kind).toBe("note");
    expect(first.deal?.id).toBe(deal);
    expect(first.note?.segments).toEqual([{ text: "Cara says they will decide after Christmas." }]);
  });

  it("shows 20 then more; 40 adds the next 20 with no repeat or skip (US3 scenario 5)", async () => {
    const ben = await makePerson({ firstName: "Ben", createdBy: ada.id });
    await refer("person", ben, cara);
    // Same timestamps on purpose: the id breaks ties.
    await sql`insert into timeline_events (person_id, kind, actor_id, created_at) select ${ben}, 'edited', ${ada.id}, now() - (g / 3) * interval '1 minute' from generate_series(1, 30) g`;
    await sql`insert into timeline_events (person_id, kind, actor_id, created_at) select ${cara}, 'edited', ${ada.id}, now() - (g / 3) * interval '1 minute' from generate_series(1, 25) g`;
    const first = await readAmbassadorUpdates(ada.id, cara, 20);
    expect(first.entries).toHaveLength(20);
    expect(first.more).toBe(true);
    const second = await readAmbassadorUpdates(ada.id, cara, 40);
    expect(second.entries.slice(0, 20).map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
    expect(new Set(second.entries.map((e) => e.id)).size).toBe(40);
    const all = await readAmbassadorUpdates(ada.id, cara, 60);
    expect(all.entries).toHaveLength(55);
    expect(all.more).toBe(false);
    expect(all.entries.slice(0, 40).map((e) => e.id)).toEqual(second.entries.map((e) => e.id));
  });

  it("with nothing referred, shows only the ambassador's own entries (US3 scenario 6)", async () => {
    const own = await event({ person: cara }, 1, "ambassador_added");
    const page = await readAmbassadorUpdates(ada.id, cara, 20);
    expect(page.entries.map((e) => [e.id, e.kind, e.person, e.deal])).toEqual([[own, "ambassador_added", null, null]]);
  });
});
