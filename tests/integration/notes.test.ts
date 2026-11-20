// covers SF-102 FR-005–FR-009, US1 scenarios 1–8, SC-006, Edge Cases (deactivated author, two notes at once, edited by
// several people, delete of the record, line breaks kept)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteDeal } from "@/server/deals/deals";
import { addNote, deleteNote, editNote, noteForEdit, type NoteTarget } from "@/server/records/notes";
import { archiveOrganisation, deleteOrganisation, restoreOrganisation } from "@/server/records/organisations";
import { archivePerson, deletePerson, restorePerson } from "@/server/records/people";
import { readTimeline } from "@/server/records/timeline";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, bob: TestUser, cy: TestUser, boss: TestUser;
let dealId: number, personId: number, orgId: number;
const targets = () => [{ dealId }, { personId }, { organisationId: orgId }] as NoteTarget[];

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  cy = await makeUser({ email: "cy@barnacle.ai", name: "Cy Fake" });
  boss = await makeUser({ email: "boss@barnacle.ai", name: "Grace Fake", role: "admin" });
  const p = await makePipeline("Sales", ["Lead in"]);
  orgId = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  personId = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
  dealId = await makeDeal({ title: "Fakeco website", stageId: p.stages[0], createdBy: ada.id });
});
afterAll(closeDb);

async function added(actor: number, target: NoteTarget, text: string) {
  const r = await addNote(actor, target, text, []);
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.id;
}

describe("addNote", () => {
  it("stores the trimmed text with its line breaks, author and date; first on the timeline (US1-1)", async () => {
    for (const target of targets()) {
      const id = await added(ada.id, target, "  Called Ada,\nwants a proposal by Friday  ");
      const { entries } = await readTimeline(bob.id, target);
      expect(entries[0].id).toBe(id);
      expect(entries[0].kind).toBe("note");
      expect(entries[0].actorName).toBe("Ada Fake");
      expect(entries[0].authorActive).toBe(true);
      expect(entries[0].note).toEqual({ segments: [{ text: "Called Ada,\nwants a proposal by Friday" }], editedByName: null, version: 1 });
      expect(Date.now() - entries[0].createdAt.getTime()).toBeLessThan(60_000);
    }
  });

  it("refuses empty text and text over 10,000 characters; nothing stored (US1-2, US1-3)", async () => {
    expect(await addNote(ada.id, { dealId }, "   ", [])).toEqual({ status: "invalid", code: "note_required" });
    expect(await addNote(ada.id, { dealId }, "x".repeat(10_001), [])).toEqual({ status: "invalid", code: "note_too_long" });
    expect((await addNote(ada.id, { dealId }, "x".repeat(10_000), [])).status).toBe("ok");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from timeline_events where kind = 'note'`;
    expect(n).toBe(1);
  });

  // covers FR-005, fix round 1: line breaks posted as CRLF
  it("stores a CRLF line break as LF on add and edit, and saves 10,000 characters with one line break", async () => {
    const id = await added(ada.id, { dealId }, "one\r\ntwo");
    expect((await sql`select body from timeline_events where id = ${id}`)[0].body).toBe("one\ntwo");
    expect((await editNote(ada.id, { dealId }, id, 1, "three\r\nfour\rfive", [])).status).toBe("ok");
    expect((await sql`select body from timeline_events where id = ${id}`)[0].body).toBe("three\nfour\nfive");
    const long = await added(ada.id, { dealId }, `${"a".repeat(5_000)}\r\n${"a".repeat(4_999)}`);
    expect((await sql`select length(body)::int as n from timeline_events where id = ${long}`)[0].n).toBe(10_000);
  });

  it("keeps two notes added at the same moment", async () => {
    await Promise.all([added(ada.id, { dealId }, "one"), added(bob.id, { dealId }, "two")]);
    const { entries } = await readTimeline(ada.id, { dealId });
    expect(entries.filter((e) => e.kind === "note")).toHaveLength(2);
  });
});

describe("editNote", () => {
  it("keeps author, date and place; marks the last editor; version + 1 (US1-4, Edge: several editors)", async () => {
    const id = await added(ada.id, { personId }, "first");
    await added(ada.id, { personId }, "second");
    const [before] = await sql<{ created_at: Date }[]>`select created_at from timeline_events where id = ${id}`;
    expect(await editNote(bob.id, { personId }, id, 1, "first, changed", [])).toEqual({ status: "ok", id });
    let entry = (await readTimeline(ada.id, { personId })).entries.find((e) => e.id === id)!;
    expect(entry.actorName).toBe("Ada Fake");
    expect(entry.createdAt).toEqual(before.created_at);
    expect(entry.note).toEqual({ segments: [{ text: "first, changed" }], editedByName: "Bob Fake", version: 2 });
    expect((await readTimeline(ada.id, { personId })).entries.map((e) => e.id).indexOf(id)).toBe(1);
    expect((await editNote(cy.id, { personId }, id, 2, "again", [])).status).toBe("ok");
    entry = (await readTimeline(ada.id, { personId })).entries.find((e) => e.id === id)!;
    expect(entry.note?.editedByName).toBe("Cy Fake");
    expect(await noteForEdit(ada.id, { personId }, id)).toEqual({ text: "again", mentions: [], version: 3 });
  });

  it("refuses a stale version, a deleted note, an empty text and another record's target (US1-7)", async () => {
    const id = await added(ada.id, { dealId }, "text");
    expect((await editNote(bob.id, { dealId }, id, 1, "bob", [])).status).toBe("ok");
    expect(await editNote(ada.id, { dealId }, id, 1, "ada", [])).toEqual({ status: "conflict" });
    expect(await editNote(ada.id, { dealId }, id, 2, "  ", [])).toEqual({ status: "invalid", code: "note_required" });
    expect(await editNote(ada.id, { personId }, id, 2, "ada", [])).toEqual({ status: "not_found" });
    expect(await deleteNote(ada.id, { personId }, id)).toEqual({ status: "not_found" });
    expect(await deleteNote(bob.id, { dealId }, id)).toEqual({ status: "ok" });
    expect(await editNote(ada.id, { dealId }, id, 2, "ada", [])).toEqual({ status: "gone" });
    const [row] = await sql`select count(*)::int as n from timeline_events where id = ${id}`;
    expect(row.n).toBe(0);
  });

  it("a note whose author is deactivated reads authorActive false and can still be edited", async () => {
    const id = await added(bob.id, { organisationId: orgId }, "bob's");
    await sql`update users set status = 'deactivated' where id = ${bob.id}`;
    expect((await readTimeline(ada.id, { organisationId: orgId })).entries[0].authorActive).toBe(false);
    expect((await editNote(ada.id, { organisationId: orgId }, id, 1, "ada's", [])).status).toBe("ok");
    await sql`update users set status = 'deactivated' where id = ${ada.id}`;
    expect((await readTimeline(cy.id, { organisationId: orgId })).entries[0].note?.editedByName).toBe("Ada Fake (deactivated)");
  });
});

describe("deleteNote", () => {
  it("removes the note from the timeline (US1-5)", async () => {
    const id = await added(ada.id, { dealId }, "bye");
    expect(await deleteNote(bob.id, { dealId }, id)).toEqual({ status: "ok" });
    expect((await readTimeline(ada.id, { dealId })).entries.find((e) => e.id === id)).toBeUndefined();
  });
});

describe("records the user cannot see (US1-6, SC-006)", () => {
  it("answers not_found for add and edit, record_not_found for delete, on a private deal or person of someone else", async () => {
    await sql`update deals set private = true where id = ${dealId}`;
    await sql`update persons set private = true where id = ${personId}`;
    for (const target of [{ dealId }, { personId }] as NoteTarget[]) {
      const id = await added(ada.id, target, "secret");
      for (const viewer of [bob.id, boss.id]) {
        expect(await addNote(viewer, target, "x", [])).toEqual({ status: "not_found" });
        expect(await editNote(viewer, target, id, 1, "x", [])).toEqual({ status: "not_found" });
        expect(await deleteNote(viewer, target, id)).toEqual({ status: "record_not_found" });
        expect(await noteForEdit(viewer, target, id)).toBeNull();
      }
      expect((await noteForEdit(ada.id, target, id))?.text).toBe("secret");
    }
  });

  it("answers not_found (record_not_found for delete) on a deleted record and removes its notes with it (FR-008)", async () => {
    const onDeal = await added(ada.id, { dealId }, "d");
    const onPerson = await added(ada.id, { personId }, "p");
    const onOrg = await added(ada.id, { organisationId: orgId }, "o");
    expect((await deleteDeal(boss.id, dealId)).status).toBe("deleted");
    expect((await deletePerson(boss.id, personId)).status).toBe("deleted");
    expect((await deleteOrganisation(boss.id, orgId)).status).toBe("deleted");
    const [row] = await sql`select count(*)::int as n from timeline_events where id in ${sql([onDeal, onPerson, onOrg])}`;
    expect(row.n).toBe(0);
    expect(await addNote(ada.id, { dealId }, "x", [])).toEqual({ status: "not_found" });
    expect(await addNote(ada.id, { personId }, "x", [])).toEqual({ status: "not_found" });
    expect(await addNote(ada.id, { organisationId: orgId }, "x", [])).toEqual({ status: "not_found" });
    expect(await deleteNote(ada.id, { dealId }, onDeal)).toEqual({ status: "record_not_found" });
    expect(await deleteNote(ada.id, { personId }, onPerson)).toEqual({ status: "record_not_found" });
    expect(await deleteNote(ada.id, { organisationId: orgId }, onOrg)).toEqual({ status: "record_not_found" });
  });
});

describe("archived records (US1-8, FR-009)", () => {
  it("refuses add, edit and delete until restored; the notes are still read", async () => {
    const ids = [] as number[];
    for (const target of targets()) ids.push(await added(ada.id, target, "kept"));
    await sql`update deals set archived_at = now() where id = ${dealId}`;
    await archivePerson(ada.id, personId);
    await archiveOrganisation(ada.id, orgId);
    for (const [i, target] of targets().entries()) {
      expect(await addNote(ada.id, target, "x", [])).toEqual({ status: "archived" });
      expect(await editNote(ada.id, target, ids[i], 1, "x", [])).toEqual({ status: "archived" });
      expect(await deleteNote(ada.id, target, ids[i])).toEqual({ status: "archived" });
      expect((await readTimeline(ada.id, target)).entries.some((e) => e.id === ids[i])).toBe(true);
    }
    await sql`update deals set archived_at = null where id = ${dealId}`;
    await restorePerson(ada.id, personId);
    await restoreOrganisation(ada.id, orgId);
    for (const [i, target] of targets().entries()) {
      expect((await editNote(ada.id, target, ids[i], 1, "changed", [])).status).toBe("ok");
      expect(await deleteNote(ada.id, target, ids[i])).toEqual({ status: "ok" });
    }
  });
});
