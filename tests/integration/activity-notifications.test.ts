// covers SF-109 FR-018, US6 scenarios 1–5 (T047, T048; replaces the browser test of the sidebar count and the page)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteActivity, editActivity, scheduleActivity, tickActivity, untickActivity } from "@/server/activities/activities";
import { formatDue } from "@/server/activities/rules";
import { closeDb, sql } from "@/server/db";
import { listNotifications, markAllRead, openNotification, unreadCount, type AssignmentView } from "@/server/notifications";
import { templates } from "@/server/messages";
import { addNote } from "@/server/records/notes";
import { activityForm, activityRow, okId } from "./activity-helpers";
import { makeDeal, makePipeline } from "./deal-helpers";
import { makeOrganisation, makePerson, makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, bob: TestUser, cy: TestUser;
let org: number, person: number, deal: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  cy = await makeUser({ email: "cy@barnacle.ai", name: "Cy Fake" });
  const stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  person = await makePerson({ firstName: "Ada", lastName: "Example", createdBy: ada.id, organisationId: org });
  deal = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, personId: person, organisationId: org });
});
afterAll(closeDb);

const forBob = (over = {}) => activityForm({ assigneeId: String(bob.id), dealId: String(deal), dueOn: "2026-11-25", dueTime: "10:00", ...over });
const assignments = async (user: number) => (await listNotifications(user)).items.filter((i): i is AssignmentView => i.kind === "assignment");

describe("assignment notifications", () => {
  it("tells Bob when Ada assigns him an activity, newest first among his mentions", async () => {
    await addNote(ada.id, { dealId: deal }, "@Bob Fake see this", [bob.id]);
    await sql`update note_mentions set created_at = now() - interval '1 hour'`;
    expect(await unreadCount(bob.id)).toBe(1);
    const id = okId(await scheduleActivity(ada.id, forBob()));
    expect(await unreadCount(bob.id)).toBe(2);
    const { items } = await listNotifications(bob.id);
    expect(items.map((i) => i.kind)).toEqual(["assignment", "mention"]);
    const a = items[0] as AssignmentView;
    expect(a).toMatchObject({ id, byName: "Ada Fake", type: "call", subject: "Call Ada about the proposal", href: `/deals/${deal}`, read: false });
    expect(templates.assigned_you(a.byName, a.type, a.subject)).toBe("Ada Fake assigned you a call: Call Ada about the proposal");
    expect(templates.activity_due(formatDue(a))).toBe("Due 25 Nov 2026 10:00");
    expect(a.createdAt).toBeInstanceOf(Date);
  });

  it("gives nothing for an activity assigned to oneself", async () => {
    okId(await scheduleActivity(bob.id, forBob()));
    okId(await scheduleActivity(ada.id, activityForm()));
    expect(await unreadCount(bob.id)).toBe(0);
    expect(await unreadCount(ada.id)).toBe(0);
    expect(await assignments(bob.id)).toEqual([]);
  });

  it("moves to Cy on reassignment; other edits, ticking and unticking change nothing; delete removes it", async () => {
    const id = okId(await scheduleActivity(ada.id, forBob()));
    expect((await editActivity(ada.id, id, 1, forBob({ subject: "Renamed" }))).status).toBe("ok");
    expect(await unreadCount(bob.id)).toBe(1);
    await openNotification(bob.id, { kind: "assignment", id });
    await tickActivity(ada.id, id);
    await untickActivity(ada.id, id);
    expect((await assignments(bob.id))[0]).toMatchObject({ subject: "Renamed", read: true });
    expect((await editActivity(ada.id, id, 4, forBob({ assigneeId: String(cy.id) }))).status).toBe("ok");
    expect(await assignments(bob.id)).toEqual([]);
    expect(await unreadCount(cy.id)).toBe(1);
    expect((await assignments(cy.id))[0]).toMatchObject({ id, read: false, byName: "Ada Fake" });
    expect((await deleteActivity(ada.id, id, 5)).status).toBe("ok");
    expect(await unreadCount(cy.id)).toBe(0);
    expect(await assignments(cy.id)).toEqual([]);
  });

  it("reassigning to oneself removes the notification", async () => {
    const id = okId(await scheduleActivity(ada.id, forBob()));
    expect((await editActivity(bob.id, id, 1, forBob())).status).toBe("ok");
    expect(await unreadCount(bob.id)).toBe(1);
    expect((await editActivity(ada.id, id, 2, forBob({ assigneeId: String(ada.id) }))).status).toBe("ok");
    expect(await unreadCount(ada.id)).toBe(0);
    expect(await unreadCount(bob.id)).toBe(0);
    expect((await activityRow(id)).assigned_by).toBe(ada.id);
  });

  it("opening marks it read and leads to the deal, else the person, else the organisation, else the list", async () => {
    const onDeal = okId(await scheduleActivity(ada.id, forBob()));
    const onPerson = okId(await scheduleActivity(ada.id, forBob({ dealId: "", personId: String(person), organisationId: String(org) })));
    const onOrg = okId(await scheduleActivity(ada.id, forBob({ dealId: "", organisationId: String(org) })));
    const onNothing = okId(await scheduleActivity(ada.id, forBob({ dealId: "" })));
    expect(await unreadCount(bob.id)).toBe(4);
    expect(await openNotification(cy.id, { kind: "assignment", id: onDeal })).toBeNull();
    expect(await openNotification(bob.id, { kind: "assignment", id: onDeal })).toEqual({ href: `/deals/${deal}` });
    expect(await unreadCount(bob.id)).toBe(3);
    expect(await openNotification(bob.id, { kind: "assignment", id: onPerson })).toEqual({ href: `/people/${person}` });
    expect(await openNotification(bob.id, { kind: "assignment", id: onOrg })).toEqual({ href: `/organisations/${org}` });
    expect(await openNotification(bob.id, { kind: "assignment", id: onNothing })).toEqual({ href: "/activities" });
    expect(await unreadCount(bob.id)).toBe(0);
  });

  it("[ MARK ALL AS READ ] marks mentions and assignments", async () => {
    await addNote(ada.id, { dealId: deal }, "@Bob Fake see this", [bob.id]);
    okId(await scheduleActivity(ada.id, forBob()));
    expect(await unreadCount(bob.id)).toBe(2);
    await markAllRead(bob.id);
    expect(await unreadCount(bob.id)).toBe(0);
    expect((await listNotifications(bob.id)).items.every((i) => i.read)).toBe(true);
  });

  it("hides and does not count an assignment whose record becomes hidden from Bob", async () => {
    const id = okId(await scheduleActivity(ada.id, forBob()));
    await sql`update deals set private = true where id = ${deal}`;
    expect(await unreadCount(bob.id)).toBe(0);
    expect(await assignments(bob.id)).toEqual([]);
    expect(await openNotification(bob.id, { kind: "assignment", id })).toBeNull();
    await sql`update deals set private = false where id = ${deal}`;
    expect(await unreadCount(bob.id)).toBe(1);
  });

  it("mentions still open by kind, and by a bare id as before", async () => {
    const note = await addNote(ada.id, { dealId: deal }, "@Bob Fake see this", [bob.id]);
    const eventId = note.status === "ok" ? note.id : 0;
    expect(await openNotification(bob.id, { kind: "mention", id: eventId })).toEqual({ href: `/deals/${deal}` });
    expect(await openNotification(bob.id, eventId)).toEqual({ href: `/deals/${deal}` });
  });
});
