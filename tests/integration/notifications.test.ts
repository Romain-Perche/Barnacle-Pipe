// covers SF-102 FR-010–FR-013, US3 scenarios 1–7, Edge Cases (deactivated mentioned user, renamed user, a token typed
// by hand, "@" not a chosen user)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { deleteDeal } from "@/server/deals/deals";
import { listNotifications, markAllRead, openNotification, unreadCount } from "@/server/notifications";
import { addNote, deleteNote, editNote, mentionCandidates, noteForEdit } from "@/server/records/notes";
import { readTimeline } from "@/server/records/timeline";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, linus: TestUser, cy: TestUser, alan: TestUser, boss: TestUser;
let deal: number, person: number, org: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  cy = await makeUser({ email: "cy@barnacle.ai", name: "Cy Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  boss = await makeUser({ email: "boss@barnacle.ai", name: "Boss Fake", role: "admin" });
  const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id });
  deal = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id });
});
afterAll(closeDb);

async function note(actor: number, target: Parameters<typeof addNote>[1], text: string, mentions: number[]) {
  const r = await addNote(actor, target, text, mentions);
  if (r.status !== "ok") throw new Error(JSON.stringify(r));
  return r.id;
}
const rows = (eventId: number) =>
  sql<{ user_id: number; mentioned_by: number; read: boolean }[]>`
    select user_id::int as user_id, mentioned_by::int as mentioned_by, read_at is not null as read from note_mentions
    where event_id = ${eventId} order by user_id`;

describe("mentionCandidates (US3-1)", () => {
  it("lists active users, never deactivated ones, ordered by name", async () => {
    for (const target of [{ dealId: deal }, { personId: person }, { organisationId: org }]) {
      expect((await mentionCandidates(ada.id, target)).map((u) => u.name)).toEqual(["Ada Fake", "Boss Fake", "Cy Fake", "Linus Fake"]);
    }
  });
});

describe("mentions and notifications", () => {
  it("a mention gives one unread notification; highlighted with the current name (US3-2, US3-3)", async () => {
    const id = await note(ada.id, { dealId: deal }, "@Linus Fake can you send the pricing sheet?", [linus.id]);
    expect(await rows(id)).toEqual([{ user_id: linus.id, mentioned_by: ada.id, read: false }]);
    expect(await unreadCount(linus.id)).toBe(1);
    expect(await unreadCount(ada.id)).toBe(0);
    const [entry] = (await readTimeline(cy.id, { dealId: deal })).entries;
    expect(entry.note?.segments).toEqual([{ mention: "Linus Fake" }, { text: " can you send the pricing sheet?" }]);
    const list = await listNotifications(linus.id);
    expect(list.more).toBe(false);
    expect(list.items).toEqual([
      { eventId: id, byName: "Ada Fake", recordName: "Fakeco website", href: `/deals/${deal}`, preview: "@Linus Fake can you send the pricing sheet?", createdAt: expect.any(Date), read: false },
    ]);
  });

  it("names the record for people and organisations", async () => {
    await note(ada.id, { personId: person }, "@Linus Fake p", [linus.id]);
    await note(ada.id, { organisationId: org }, "@Linus Fake o", [linus.id]);
    const { items } = await listNotifications(linus.id);
    expect(items.map((i) => [i.recordName, i.href])).toEqual([
      ["Example Ltd Fake", `/organisations/${org}`],
      ["Ada Example", `/people/${person}`],
    ]);
  });

  it("gives no self-notification and one notification per person per note (US3-5)", async () => {
    const id = await note(ada.id, { dealId: deal }, "@Ada Fake and @Linus Fake and @Linus Fake", [ada.id, linus.id, linus.id]);
    expect(await rows(id)).toEqual([
      { user_id: ada.id, mentioned_by: ada.id, read: false },
      { user_id: linus.id, mentioned_by: ada.id, read: false },
    ]);
    expect(await unreadCount(ada.id)).toBe(0);
    expect((await listNotifications(ada.id)).items).toEqual([]);
    expect(await unreadCount(linus.id)).toBe(1);
  });

  it("an edit notifies only new mentions and removes dropped ones (US3-6)", async () => {
    const id = await note(ada.id, { dealId: deal }, "@Linus Fake hi", [linus.id]);
    await openNotification(linus.id, id);
    expect((await editNote(cy.id, { dealId: deal }, id, 1, "@Linus Fake and @Cy Fake and @Ada Fake", [linus.id, cy.id, ada.id])).status).toBe("ok");
    expect(await rows(id)).toEqual([
      { user_id: ada.id, mentioned_by: cy.id, read: false },
      { user_id: linus.id, mentioned_by: ada.id, read: true },
      { user_id: cy.id, mentioned_by: cy.id, read: false },
    ].sort((a, b) => a.user_id - b.user_id));
    expect(await unreadCount(ada.id)).toBe(1);
    expect((await listNotifications(ada.id)).items[0].byName).toBe("Cy Fake");
    expect(await noteForEdit(ada.id, { dealId: deal }, id)).toEqual({
      text: "@Linus Fake and @Cy Fake and @Ada Fake",
      mentions: expect.arrayContaining([{ id: linus.id, name: "Linus Fake" }, { id: cy.id, name: "Cy Fake" }, { id: ada.id, name: "Ada Fake" }]),
      version: 2,
    });
    expect((await editNote(ada.id, { dealId: deal }, id, 2, "just @Cy Fake", [cy.id])).status).toBe("ok");
    expect((await rows(id)).map((r) => r.user_id)).toEqual([cy.id]);
    expect(await unreadCount(linus.id)).toBe(0);
  });

  it("deleting the note or the record removes the notifications (US3-7, Edge)", async () => {
    const a = await note(ada.id, { dealId: deal }, "@Linus Fake a", [linus.id]);
    await note(ada.id, { dealId: deal }, "@Linus Fake b", [linus.id]);
    expect(await unreadCount(linus.id)).toBe(2);
    await deleteNote(cy.id, { dealId: deal }, a);
    expect(await unreadCount(linus.id)).toBe(1);
    await deleteDeal(boss.id, deal);
    expect(await unreadCount(linus.id)).toBe(0);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from note_mentions`;
    expect(n).toBe(0);
  });

  it("lists newest first, 50 at a time, with a 200-character preview", async () => {
    for (let i = 0; i < 60; i++) await note(ada.id, { organisationId: org }, `@Linus Fake ${i} ${"x".repeat(250)}`, [linus.id]);
    const first = await listNotifications(linus.id);
    expect(first.items).toHaveLength(50);
    expect(first.more).toBe(true);
    expect(first.items[0].preview.startsWith("@Linus Fake 59 ")).toBe(true);
    expect(Array.from(first.items[0].preview)).toHaveLength(201);
    expect(first.items[0].preview.endsWith("…")).toBe(true);
    const all = await listNotifications(linus.id, 100);
    expect(all.items).toHaveLength(60);
    expect(all.more).toBe(false);
    expect(new Set(all.items.map((i) => i.eventId)).size).toBe(60);
  });

  it("openNotification marks read and returns the record's href; null for someone else's (US3-4, FR-013)", async () => {
    const id = await note(ada.id, { dealId: deal }, "@Linus Fake x", [linus.id]);
    expect(await openNotification(cy.id, id)).toBeNull();
    expect(await openNotification(ada.id, id)).toBeNull();
    expect(await unreadCount(linus.id)).toBe(1);
    expect(await openNotification(linus.id, id)).toEqual({ href: `/deals/${deal}` });
    expect(await unreadCount(linus.id)).toBe(0);
    expect((await listNotifications(linus.id)).items[0].read).toBe(true);
    expect(await openNotification(linus.id, id)).toEqual({ href: `/deals/${deal}` });
  });

  it("markAllRead clears the count, only for that user", async () => {
    await note(ada.id, { dealId: deal }, "@Linus Fake @Cy Fake", [linus.id, cy.id]);
    await note(ada.id, { personId: person }, "@Linus Fake", [linus.id]);
    await markAllRead(linus.id);
    expect(await unreadCount(linus.id)).toBe(0);
    expect(await unreadCount(cy.id)).toBe(1);
  });

  it("shows a renamed user's new name; a deactivated mentioned user stays in the note", async () => {
    const id = await note(ada.id, { dealId: deal }, "ask @Linus Fake", [linus.id]);
    await sql`update users set name = 'Linus Renamed' where id = ${linus.id}`;
    expect((await readTimeline(ada.id, { dealId: deal })).entries[0].note?.segments).toEqual([{ text: "ask " }, { mention: "Linus Renamed" }]);
    expect((await listNotifications(linus.id)).items[0].preview).toBe("ask @Linus Renamed");
    await sql`update users set status = 'deactivated' where id = ${linus.id}`;
    expect((await readTimeline(ada.id, { dealId: deal })).entries[0].note?.segments).toEqual([{ text: "ask " }, { mention: "Linus Renamed" }]);
    // Editing keeps the existing mention of a deactivated user (research.md §5).
    expect((await editNote(ada.id, { dealId: deal }, id, 1, "ask @Linus Renamed again", [linus.id])).status).toBe("ok");
    expect((await rows(id)).map((r) => r.user_id)).toEqual([linus.id]);
  });

  it("refuses a new mention of a deactivated user; '@' text and hand-typed tokens stay plain", async () => {
    expect(await addNote(ada.id, { dealId: deal }, "@Alan Fake", [alan.id])).toEqual({ status: "cannot_mention", name: "Alan Fake" });
    const id = await note(ada.id, { dealId: deal }, `mail ada@example.fake and @[user:${linus.id}] and @Cy Fake`, []);
    expect(await rows(id)).toEqual([]);
    expect((await readTimeline(ada.id, { dealId: deal })).entries[0].note?.segments).toEqual([
      { text: `mail ada@example.fake and @[user:${linus.id}] and @Cy Fake` },
    ]);
    expect(await unreadCount(linus.id)).toBe(0);
  });
});
