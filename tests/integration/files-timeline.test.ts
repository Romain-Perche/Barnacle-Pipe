// covers SF-116 FR-007, US4 scenarios 1–4, SC-006 (T030): one FILE entry per upload and per delete, on the record and on
// the timelines of the deal's people and organisation; none for a viewer who cannot see the deal; none on an
// ambassador's latest updates.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteFile } from "@/server/files/files";
import { readAmbassadorUpdates } from "@/server/records/ambassadors";
import { readTimeline } from "@/server/records/timeline";
import { StorageFake } from "../fakes/storage";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";
import { PDF, PNG, uploadFile } from "./file-helpers";

const fake = new StorageFake();
let ada: TestUser, bob: TestUser;
let orgId: number, mainId: number, otherId: number, dealId: number;

beforeAll(() => void fake.install());
afterAll(async () => {
  fake.uninstall();
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Linus Fake" });
  const p = await makePipeline("Sales", ["Lead in"]);
  orgId = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  mainId = await makePerson({ firstName: "Main", lastName: "Fake", createdBy: ada.id });
  otherId = await makePerson({ firstName: "Other", lastName: "Fake", createdBy: ada.id });
  dealId = await makeDeal({ title: "Fakeco website", stageId: p.stages[0], createdBy: ada.id, organisationId: orgId, personId: mainId });
  await sql`insert into deal_people (deal_id, person_id) values (${dealId}, ${otherId})`;
});

const fileEntries = async (viewer: number, target: Parameters<typeof readTimeline>[1]) =>
  (await readTimeline(viewer, target)).entries.filter((e) => e.kind === "file_added" || e.kind === "file_deleted");

describe("FILE entries", () => {
  it("adds exactly one file_added per upload and one file_deleted per delete; the link goes with the file (US4-1, US4-2, SC-006)", async () => {
    const id = await uploadFile(fake, ada.id, { dealId }, "proposal.pdf", PDF);
    let entries = await fileEntries(bob.id, { dealId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "file_added", actorName: "Ada Fake", deal: null, file: { id, name: "proposal.pdf", size: PDF.length, kind: "pdf" } });
    expect(await deleteFile(bob.id, { dealId }, id)).toEqual({ status: "ok" });
    entries = await fileEntries(bob.id, { dealId });
    expect(entries.map((e) => e.kind)).toEqual(["file_deleted", "file_added"]);
    expect(entries[0]).toMatchObject({ actorName: "Linus Fake", file: { id: null, name: "proposal.pdf", size: null, kind: null } });
    expect(entries[1].file).toEqual({ id: null, name: "proposal.pdf", size: PDF.length, kind: null });
    const [{ n }] = await sql`select count(*)::int as n from timeline_events where kind in ('file_added', 'file_deleted')`;
    expect(n).toBe(2);
  });

  it("shows a deal's entries on its main person's, other person's and organisation's timelines as the deal's (US4-3)", async () => {
    await uploadFile(fake, ada.id, { dealId }, "shot.png", PNG);
    for (const target of [{ personId: mainId }, { personId: otherId }, { organisationId: orgId }]) {
      const entries = await fileEntries(ada.id, target);
      expect(entries, JSON.stringify(target)).toHaveLength(1);
      expect(entries[0].deal).toMatchObject({ id: dealId, title: "Fakeco website" });
    }
    // A person's own file is not on the deal's timeline.
    await uploadFile(fake, ada.id, { personId: mainId }, "cv.pdf", PDF);
    expect((await fileEntries(ada.id, { dealId })).map((e) => e.file?.name)).toEqual(["shot.png"]);
  });

  it("leaves them out for a viewer who cannot see the deal (US4-4)", async () => {
    await uploadFile(fake, ada.id, { dealId }, "shot.png", PNG);
    await sql`update deals set private = true where id = ${dealId}`;
    for (const target of [{ dealId }, { personId: mainId }, { organisationId: orgId }]) {
      expect(await fileEntries(bob.id, target)).toEqual([]);
    }
    expect(await fileEntries(ada.id, { organisationId: orgId })).toHaveLength(1);
  });

  it("keeps them off an ambassador's latest updates (notes and changes only)", async () => {
    await sql`update persons set is_ambassador = true where id = ${mainId}`;
    await sql`update deals set referred_by_id = ${mainId}, referred_at = now() where id = ${dealId}`;
    await uploadFile(fake, ada.id, { dealId }, "shot.png", PNG);
    await uploadFile(fake, ada.id, { personId: mainId }, "cv.pdf", PDF);
    const { entries } = await readAmbassadorUpdates(ada.id, mainId, 50);
    expect(entries.filter((e) => e.kind === "file_added" || e.kind === "file_deleted")).toEqual([]);
  });
});
