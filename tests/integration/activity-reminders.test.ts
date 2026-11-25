// covers SF-123 FR-001–FR-009, US1 scenarios 1–6, US2 scenarios 1–6, US3 scenarios 1–3, SC-001–SC-005, spec Edge Cases:
// in-app reminders of planned activities, read with an explicit `now` (no clock tricks, no waiting).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-pathname": "/notifications" }),
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

const { renderToStaticMarkup } = await import("react-dom/server");
const { deleteActivity, editActivity, scheduleActivity, tickActivity, untickActivity } = await import("@/server/activities/activities");
const { formatDue, TYPE_LABELS } = await import("@/server/activities/rules");
const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { deleteDeal } = await import("@/server/deals/deals");
const { formatDateTime } = await import("@/server/format");
const { templates } = await import("@/server/messages");
const notifications = await import("@/server/notifications");
const { deleteOrganisation } = await import("@/server/records/organisations");
const { deletePerson } = await import("@/server/records/people");
const { handOverPrivateRecords } = await import("@/server/records/handover");
const { deactivate } = await import("@/server/users");
const actions = await import("@/app/(app)/notifications/actions");
const NotificationsPage = (await import("@/app/(app)/notifications/page")).default;
const { activityForm, okId } = await import("./activity-helpers");
const { makeDeal, makePipeline } = await import("./deal-helpers");
const { makeOrganisation, makePerson, makeUser, resetDb } = await import("./db-helpers");

type ReminderView = import("@/server/notifications").ReminderView;
type TestUser = import("./db-helpers").TestUser;
const { listNotifications, markAllRead, openNotification, unreadCount } = notifications;

let ada: TestUser, bob: TestUser, cy: TestUser;
let org: number, person: number, deal: number, stage: number;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  bob = await makeUser({ email: "bob@barnacle.ai", name: "Bob Fake" });
  cy = await makeUser({ email: "cy@barnacle.ai", name: "Cy Fake", role: "admin" });
  stage = (await makePipeline("Sales", ["Lead in"])).stages[0];
  org = await makeOrganisation({ name: "Example Ltd Fake", ownerId: ada.id });
  person = await makePerson({ firstName: "Bob", lastName: "Example", createdBy: ada.id, organisationId: org });
  deal = await makeDeal({ title: "Fakeco website", stageId: stage, createdBy: ada.id, personId: person, organisationId: org });
});
afterAll(closeDb);

// 15 Jan 2030 is in GMT: UK time equals UTC.
const DAY = "2030-01-15";
const t = (hm: string, day = DAY) => new Date(`${day}T${hm}:00Z`);
const SUBJECT = "intro call with Bob Example";
const call = (over = {}) => activityForm({ subject: SUBJECT, dueOn: DAY, dueTime: "10:00", dealId: String(deal), ...over });
const reminders = async (user: number, now: Date) =>
  (await listNotifications(user, 50, now)).items.filter((i): i is ReminderView => i.kind === "reminder");
const remindRow = async (id: number) =>
  (await sql<{ remind_at: Date | null; reminder_read_at: Date | null }[]>`select remind_at, reminder_read_at from activities where id = ${id}`)[0];

describe("US1: reminded before a planned activity is due", () => {
  it("shows and counts a timed reminder from 15 minutes before, never earlier (scenarios 1, 3, 5)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    expect(await reminders(ada.id, t("09:44"))).toEqual([]);
    expect(await unreadCount(ada.id, t("09:44"))).toBe(0);
    const [r] = await reminders(ada.id, t("09:45"));
    expect(r).toMatchObject({ kind: "reminder", id, type: "call", subject: SUBJECT, dueOn: DAY, dueTime: "10:00", href: `/deals/${deal}`, read: false });
    expect(r.createdAt.toISOString()).toBe(t("09:45").toISOString());
    expect(await unreadCount(ada.id, t("09:45"))).toBe(1);
    expect(templates.reminder_title(TYPE_LABELS[r.type], r.subject, r.dueTime)).toBe("Call: intro call with Bob Example at 10:00");
    expect(templates.activity_due(formatDue(r))).toBe("Due 15 Jan 2030 10:00");
    // Self-scheduled: no assignment line, only the reminder (scenario 5).
    expect((await listNotifications(ada.id, 50, t("09:45"))).items.map((i) => i.kind)).toEqual(["reminder"]);
  });

  it("shows an untimed reminder from 09:00 UK on its due date (scenarios 2, 3)", async () => {
    okId(await scheduleActivity(ada.id, activityForm({ type: "task", subject: "send the pricing sheet", dueOn: DAY }), t("07:00", "2030-01-14")));
    expect(await reminders(ada.id, t("08:59"))).toEqual([]);
    const [r] = await reminders(ada.id, t("09:00"));
    expect(r.createdAt.toISOString()).toBe(t("09:00").toISOString());
    expect(templates.reminder_title(TYPE_LABELS[r.type], r.subject, r.dueTime)).toBe("Task: send the pricing sheet");
    expect(templates.activity_due(formatDue(r))).toBe("Due 15 Jan 2030");
    expect(await unreadCount(ada.id, t("09:00"))).toBe(1);
  });

  it("opens to the deal, else the person, else the organisation, else the list, marking it read (scenario 4, SC-005)", async () => {
    const onDeal = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    const onPerson = okId(await scheduleActivity(ada.id, call({ dealId: "", personId: String(person), organisationId: String(org) }), t("08:00")));
    const onOrg = okId(await scheduleActivity(ada.id, call({ dealId: "", organisationId: String(org) }), t("08:00")));
    const onNothing = okId(await scheduleActivity(ada.id, call({ dealId: "" }), t("08:00")));
    const now = t("09:50");
    expect(await unreadCount(ada.id, now)).toBe(4);
    expect(await openNotification(ada.id, { kind: "reminder", id: onDeal }, t("09:40"))).toBeNull();
    expect(await openNotification(bob.id, { kind: "reminder", id: onDeal }, now)).toBeNull();
    expect(await openNotification(ada.id, { kind: "reminder", id: onDeal }, now)).toEqual({ href: `/deals/${deal}` });
    expect(await unreadCount(ada.id, now)).toBe(3);
    expect(await openNotification(ada.id, { kind: "reminder", id: onPerson }, now)).toEqual({ href: `/people/${person}` });
    expect(await openNotification(ada.id, { kind: "reminder", id: onOrg }, now)).toEqual({ href: `/organisations/${org}` });
    expect(await openNotification(ada.id, { kind: "reminder", id: onNothing }, now)).toEqual({ href: "/activities" });
    expect(await unreadCount(ada.id, now)).toBe(0);
    expect((await reminders(ada.id, now)).every((r) => r.read)).toBe(true);
  });

  it("[ MARK ALL AS READ ] marks the reminders shown, not those still to come (scenario 4)", async () => {
    const shown = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    const later = okId(await scheduleActivity(ada.id, call({ dueTime: "12:00" }), t("08:00")));
    await markAllRead(ada.id, t("09:50"));
    expect(await unreadCount(ada.id, t("09:50"))).toBe(0);
    expect((await remindRow(later)).reminder_read_at).toBeNull();
    const at = await reminders(ada.id, t("11:45"));
    expect(at.map((r) => [r.id, r.read])).toEqual([[later, false], [shown, true]]);
    expect(await unreadCount(ada.id, t("11:45"))).toBe(1);
  });

  it("gives Bob both the assignment and the reminder; opening the reminder leaves the assignment unread (scenario 6, FR-008)", async () => {
    const id = okId(await scheduleActivity(ada.id, call({ assigneeId: String(bob.id) }), t("08:00")));
    const now = t("09:45");
    expect((await listNotifications(bob.id, 50, now)).items.map((i) => i.kind).sort()).toEqual(["assignment", "reminder"]);
    expect(await unreadCount(bob.id, now)).toBe(2);
    expect(await openNotification(bob.id, { kind: "reminder", id }, now)).toEqual({ href: `/deals/${deal}` });
    const items = (await listNotifications(bob.id, 50, now)).items;
    expect(items.find((i) => i.kind === "assignment")?.read).toBe(false);
    expect(items.find((i) => i.kind === "reminder")?.read).toBe(true);
    expect(await unreadCount(bob.id, now)).toBe(1);
    expect(await reminders(ada.id, now)).toEqual([]);
  });

  it("shows at once when saved less than 15 minutes before; never when saved after the due moment (edge cases)", async () => {
    const soon = okId(await scheduleActivity(ada.id, call(), t("09:50")));
    expect((await reminders(ada.id, t("09:50"))).map((r) => [r.id, r.read])).toEqual([[soon, false]]);
    const past = okId(await scheduleActivity(ada.id, call({ subject: "logged call", dueTime: "09:00" }), t("09:50")));
    expect((await remindRow(past)).remind_at).toBeNull();
    for (const now of [t("09:50"), t("23:00"), t("10:00", "2030-02-01")]) {
      expect((await reminders(ada.id, now)).map((r) => r.id)).toEqual([soon]);
      expect(await unreadCount(ada.id, now)).toBe(1);
    }
  });

  it("stays as one line after the due moment, until done (edge case)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    const later = await listNotifications(ada.id, 50, t("12:00", "2030-01-20"));
    expect(later.items.filter((i) => i.kind === "reminder" && i.id === id)).toHaveLength(1);
    expect(later.items).toHaveLength(1);
  });

  it("lists equal reminder times newest activity first, the same on every read (edge case)", async () => {
    const first = okId(await scheduleActivity(ada.id, call({ subject: "first" }), t("08:00")));
    const second = okId(await scheduleActivity(ada.id, call({ subject: "second" }), t("08:00")));
    const third = okId(await scheduleActivity(ada.id, call({ subject: "third" }), t("08:00")));
    const once = (await reminders(ada.id, t("09:50"))).map((r) => r.id);
    expect(once).toEqual([third, second, first]);
    expect((await reminders(ada.id, t("09:50"))).map((r) => r.id)).toEqual(once);
  });

  it("is listed for an activity on an archived deal and opens that deal (edge case)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    await sql`update deals set archived_at = now() where id = ${deal}`;
    expect((await reminders(ada.id, t("09:50"))).map((r) => r.id)).toEqual([id]);
    expect(await openNotification(ada.id, { kind: "reminder", id }, t("09:50"))).toEqual({ href: `/deals/${deal}` });
  });

  it("counts 15 real minutes on the night the clocks go forward (29 Mar 2026, SC-001)", async () => {
    okId(await scheduleActivity(ada.id, call({ dueOn: "2026-03-29", dueTime: "02:10" }), new Date("2026-03-28T12:00:00Z")));
    expect(await reminders(ada.id, new Date("2026-03-29T00:50:00Z"))).toEqual([]);
    const [r] = await reminders(ada.id, new Date("2026-03-29T00:55:00Z"));
    expect(formatDateTime(r.createdAt)).toBe("29 Mar 2026, 00:55");
  });

  it("works on both sides of midnight (a 00:10 call reminds at 23:55 the day before, SC-001)", async () => {
    okId(await scheduleActivity(ada.id, call({ dueOn: "2030-01-16", dueTime: "00:10" }), t("08:00")));
    expect(await reminders(ada.id, t("23:54"))).toEqual([]);
    expect((await reminders(ada.id, t("23:55"))).map((r) => formatDateTime(r.createdAt))).toEqual(["15 Jan 2030, 23:55"]);
  });
});

describe("US2: the reminder follows the activity", () => {
  it("moving the due time replaces the reminder; a past reminder time with the due ahead shows at once, unread (scenario 1)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    await openNotification(ada.id, { kind: "reminder", id }, t("09:46"));
    expect((await editActivity(ada.id, id, 1, call({ dueTime: "11:00" }), t("09:50"))).status).toBe("ok");
    expect(await reminders(ada.id, t("09:50"))).toEqual([]);
    expect(await unreadCount(ada.id, t("09:50"))).toBe(0);
    const [moved] = await reminders(ada.id, t("10:45"));
    expect(moved).toMatchObject({ id, read: false, dueTime: "11:00" });
    expect(moved.createdAt.toISOString()).toBe(t("10:45").toISOString());
    await openNotification(ada.id, { kind: "reminder", id }, t("10:46"));
    expect((await editActivity(ada.id, id, 2, call({ dueTime: "11:05" }), t("10:55"))).status).toBe("ok");
    expect((await reminders(ada.id, t("10:55"))).map((r) => [r.id, r.read])).toEqual([[id, false]]);
  });

  it("moving the due date to a later day moves the reminder there (scenario 1)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    expect((await editActivity(ada.id, id, 1, call({ dueOn: "2030-01-16" }), t("09:50"))).status).toBe("ok");
    expect(await reminders(ada.id, t("23:00"))).toEqual([]);
    expect((await reminders(ada.id, t("09:45", "2030-01-16"))).map((r) => r.id)).toEqual([id]);
  });

  it("moved to a due moment already past: no reminder, the old one gone too (scenario 2, FR-007)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    expect((await editActivity(ada.id, id, 1, call({ dueTime: "09:30" }), t("09:50"))).status).toBe("ok");
    expect(await remindRow(id)).toEqual({ remind_at: null, reminder_read_at: null });
    expect(await reminders(ada.id, t("12:00"))).toEqual([]);
  });

  it("reassigning moves the reminder from Ada to Bob, unread (scenario 3)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    await openNotification(ada.id, { kind: "reminder", id }, t("09:46"));
    expect((await editActivity(ada.id, id, 1, call({ assigneeId: String(bob.id) }), t("09:50"))).status).toBe("ok");
    expect(await reminders(ada.id, t("09:50"))).toEqual([]);
    expect(await unreadCount(ada.id, t("09:50"))).toBe(0);
    expect((await reminders(bob.id, t("09:50"))).map((r) => [r.id, r.read])).toEqual([[id, false]]);
    // Reassigned before the reminder time: it waits for it.
    const later = okId(await scheduleActivity(ada.id, call({ dueTime: "12:00" }), t("08:00")));
    expect((await editActivity(ada.id, later, 1, call({ dueTime: "12:00", assigneeId: String(bob.id) }), t("09:50"))).status).toBe("ok");
    expect((await reminders(bob.id, t("11:44"))).map((r) => r.id)).toEqual([id]);
    expect((await reminders(bob.id, t("11:45"))).map((r) => r.id)).toEqual([later, id]);
  });

  it("ticking hides it; unticking before the due moment brings it back as it was; after, never (scenario 4)", async () => {
    const read = okId(await scheduleActivity(ada.id, call({ subject: "read one" }), t("08:00")));
    const unread = okId(await scheduleActivity(ada.id, call({ subject: "unread one" }), t("08:00")));
    await openNotification(ada.id, { kind: "reminder", id: read }, t("09:46"));
    for (const id of [read, unread]) expect((await tickActivity(ada.id, id)).status).toBe("ok");
    expect(await reminders(ada.id, t("09:50"))).toEqual([]);
    expect(await unreadCount(ada.id, t("09:50"))).toBe(0);
    for (const id of [read, unread]) expect((await untickActivity(ada.id, id, t("09:55"))).status).toBe("ok");
    expect((await reminders(ada.id, t("09:55"))).map((r) => [r.id, r.read])).toEqual([[unread, false], [read, true]]);
    expect((await tickActivity(ada.id, unread)).status).toBe("ok");
    expect((await untickActivity(ada.id, unread, t("10:00"))).status).toBe("ok");
    expect((await reminders(ada.id, t("10:00"))).map((r) => r.id)).toEqual([read]);
    expect((await editActivity(ada.id, unread, 5, call({ subject: "renamed" }), t("10:05"))).status).toBe("ok");
    expect((await reminders(ada.id, t("10:05"))).map((r) => r.id)).toEqual([read]);
  });

  it("deleting the activity, or the record it goes with, removes the reminder (scenario 5)", async () => {
    const direct = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    const onPerson = okId(await scheduleActivity(ada.id, call({ dealId: "", personId: String(person) }), t("08:00")));
    const orgOnly = await makeOrganisation({ name: "Gone Ltd Fake", ownerId: ada.id });
    const onOrg = okId(await scheduleActivity(ada.id, call({ dealId: "", organisationId: String(orgOnly) }), t("08:00")));
    const kept = okId(await scheduleActivity(ada.id, call({ organisationId: String(org) }), t("08:00")));
    expect(await unreadCount(ada.id, t("09:50"))).toBe(4);
    expect((await deleteActivity(ada.id, direct, 1)).status).toBe("ok");
    expect((await deleteOrganisation(ada.id, orgOnly)).status).toBe("deleted");
    // The deal goes; the activity also linked to the organisation stays, its reminder now leads there.
    expect((await deleteDeal(ada.id, deal)).status).toBe("deleted");
    expect((await deletePerson(ada.id, person)).status).toBe("deleted");
    const left = await reminders(ada.id, t("09:50"));
    expect(left.map((r) => [r.id, r.href])).toEqual([[kept, `/organisations/${org}`]]);
    expect(await unreadCount(ada.id, t("09:50"))).toBe(1);
    for (const id of [direct, onPerson, onOrg]) expect(await remindRow(id)).toBeUndefined();
  });

  it("other edits keep the reminder's time and read state and show the new type and subject (scenario 6)", async () => {
    const id = okId(await scheduleActivity(ada.id, call(), t("08:00")));
    await openNotification(ada.id, { kind: "reminder", id }, t("09:46"));
    const form = call({ type: "meeting", subject: "kick-off", note: "bring slides", duration: "30", dealId: "", organisationId: String(org) });
    expect((await editActivity(ada.id, id, 1, form, t("09:50"))).status).toBe("ok");
    const [r] = await reminders(ada.id, t("09:50"));
    expect(r).toMatchObject({ id, read: true, type: "meeting", subject: "kick-off" });
    expect(r.createdAt.toISOString()).toBe(t("09:45").toISOString());
    expect(templates.reminder_title(TYPE_LABELS[r.type], r.subject, r.dueTime)).toBe("Meeting: kick-off at 10:00");
  });
});

describe("US3: reminders stay private like the activity", () => {
  it("a deal made private hides and stops counting Bob's reminder; shared again it is back as it was (scenarios 1–2)", async () => {
    const id = okId(await scheduleActivity(ada.id, call({ assigneeId: String(bob.id) }), t("08:00")));
    const now = t("09:50");
    await openNotification(bob.id, { kind: "assignment", id });
    await sql`update deals set private = true where id = ${deal}`;
    expect(await reminders(bob.id, now)).toEqual([]);
    expect(await unreadCount(bob.id, now)).toBe(0);
    expect(await openNotification(bob.id, { kind: "reminder", id }, now)).toBeNull();
    await markAllRead(bob.id, now);
    expect((await remindRow(id)).reminder_read_at).toBeNull();
    await sql`update deals set private = false where id = ${deal}`;
    expect((await reminders(bob.id, now)).map((r) => [r.id, r.read])).toEqual([[id, false]]);
    expect(await unreadCount(bob.id, now)).toBe(1);
  });

  it("a private linked person hides it too, and it comes back read when it was read", async () => {
    const id = okId(await scheduleActivity(ada.id, call({ dealId: "", personId: String(person), assigneeId: String(bob.id) }), t("08:00")));
    const now = t("09:50");
    await openNotification(bob.id, { kind: "reminder", id }, now);
    await sql`update persons set private = true where id = ${person}`;
    expect(await reminders(bob.id, now)).toEqual([]);
    await sql`update persons set private = false where id = ${person}`;
    expect((await reminders(bob.id, now)).map((r) => [r.id, r.read])).toEqual([[id, true]]);
  });

  it("nobody else, admins included, ever sees someone's reminder (scenario 3, SC-003)", async () => {
    okId(await scheduleActivity(ada.id, call({ assigneeId: String(bob.id) }), t("08:00")));
    okId(await scheduleActivity(bob.id, call({ subject: "Bob's own" }), t("08:00")));
    for (const u of [ada.id, cy.id]) {
      expect(await reminders(u, t("09:50"))).toEqual([]);
      expect(await unreadCount(u, t("09:50"))).toBe(0);
    }
    expect(await reminders(bob.id, t("09:50"))).toHaveLength(2);
  });

  it("a deactivated assignee's reminder goes to nobody until the activity is reassigned (edge case)", async () => {
    const id = okId(await scheduleActivity(ada.id, call({ assigneeId: String(bob.id) }), t("08:00")));
    expect(await deactivate(ada.id, bob.id)).toEqual({ ok: true });
    for (const u of [ada.id, cy.id]) expect(await reminders(u, t("09:50"))).toEqual([]);
    expect((await editActivity(ada.id, id, 1, call({ assigneeId: String(cy.id) }), t("09:50"))).status).toBe("ok");
    expect((await reminders(cy.id, t("09:50"))).map((r) => [r.id, r.read])).toEqual([[id, false]]);
  });

  it("a hand-over keeps the assignee; they see the reminder only while they see the deal; the new owner never (edge case)", async () => {
    const privateDeal = await makeDeal({ title: "Fake private deal", stageId: stage, createdBy: ada.id, ownerId: bob.id, private: true });
    const bobsOwn = await makeDeal({ title: "Fake Bob deal", stageId: stage, createdBy: bob.id, private: true });
    const hidden = okId(await scheduleActivity(bob.id, call({ dealId: String(privateDeal) }), t("08:00")));
    const kept = okId(await scheduleActivity(bob.id, call({ dealId: String(bobsOwn) }), t("08:00")));
    expect(await deactivate(ada.id, bob.id)).toEqual({ ok: true });
    expect((await handOverPrivateRecords(ada.id, bob.id, cy.id)).status).toBe("handed");
    expect((await reminders(bob.id, t("09:50"))).map((r) => r.id)).toEqual([kept]);
    expect(await reminders(cy.id, t("09:50"))).toEqual([]);
    expect(hidden).toBeGreaterThan(0);
  });
});

describe("the Notifications page and its actions (contracts/routes.md)", () => {
  const as = async (id: number) => jar.set(SESSION_COOKIE, (await createSession(id)).token);
  const post = (v: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, x] of Object.entries(v)) fd.set(k, x);
    return fd;
  };
  async function redirectOf(p: Promise<unknown>): Promise<string> {
    try {
      await p;
    } catch (e) {
      const to = (e as { to?: string }).to;
      if (to) return to;
      throw e;
    }
    throw new Error("no redirect");
  }
  // A reminder whose time has come by the real clock (the page and the actions read `now`).
  async function shownReminder(assignee: number, subject = SUBJECT): Promise<number> {
    const id = okId(await scheduleActivity(ada.id, call({ subject, dueOn: "2099-01-01", assigneeId: String(assignee) })));
    await sql`update activities set remind_at = now() - interval '1 minute' where id = ${id}`;
    return id;
  }

  it("opens a reminder by kind=reminder, marks only it read and goes to the record (FR-004)", async () => {
    const id = await shownReminder(bob.id);
    await as(bob.id);
    expect(await unreadCount(bob.id)).toBe(2);
    expect(await redirectOf(actions.openNotification(post({ kind: "reminder", id: String(id) })))).toBe(`/deals/${deal}`);
    expect((await remindRow(id)).reminder_read_at).not.toBeNull();
    expect(await unreadCount(bob.id)).toBe(1);
  });

  it("an unknown kind is a mention; someone else's reminder changes nothing", async () => {
    const id = await shownReminder(bob.id);
    await as(bob.id);
    expect(await redirectOf(actions.openNotification(post({ kind: "Reminder", id: String(id) })))).toBe("/notifications");
    await as(cy.id);
    expect(await redirectOf(actions.openNotification(post({ kind: "reminder", id: String(id) })))).toBe("/notifications");
    expect((await remindRow(id)).reminder_read_at).toBeNull();
  });

  it("[ MARK ALL AS READ ] marks the caller's shown reminders", async () => {
    const id = await shownReminder(bob.id);
    await as(bob.id);
    expect(await redirectOf(actions.markAllNotificationsRead())).toBe("/notifications");
    expect((await remindRow(id)).reminder_read_at).not.toBeNull();
    expect(await unreadCount(bob.id)).toBe(0);
  });

  it("lists the reminder as r-<id> with its title, date and due line; the subject as typed (FR-003, edge case)", async () => {
    const id = await shownReminder(ada.id, "<b>Call</b> https://example.com");
    await as(ada.id);
    const html = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`id="r-${id}"`);
    expect(html).toContain('name="kind" value="reminder"');
    expect(html).toContain("Call: &lt;b&gt;Call&lt;/b&gt; https://example.com at 10:00");
    expect(html).not.toContain("<b>Call</b>");
    expect(html).not.toContain('href="https://example.com"');
    expect(html).toContain("Due 01 Jan 2099 10:00");
    const [r] = await sql<{ remind_at: Date }[]>`select remind_at from activities where id = ${id}`;
    expect(html).toContain(formatDateTime(r.remind_at));
  });
});

describe("go-live (migration backfill, FR-007)", () => {
  it("gives planned activities still ahead a reminder, and none to past or done ones", async () => {
    const backfill = /update activities[\s\S]*?;/.exec(readFileSync("migrations/0017_activity_reminders.sql", "utf8"))![0];
    const ins = (dueOn: string, dueTime: string | null, done = false) => sql<{ id: number }[]>`
      insert into activities (type, subject, due_on, due_time, assignee_id, created_by, assigned_by, done_at, done_by)
      values ('call', 'Fake backfill', ${dueOn}, ${dueTime}, ${ada.id}, ${ada.id}, ${ada.id}, ${done ? new Date() : null}, ${done ? ada.id : null})
      returning id::int as id`.then((r) => r[0].id);
    const timed = await ins("2099-01-15", "10:00");
    const untimedSummer = await ins("2099-07-15", null);
    const past = await ins("2020-01-15", "10:00");
    const done = await ins("2099-01-15", "10:00", true);
    await sql.unsafe(backfill);
    expect((await remindRow(timed)).remind_at?.toISOString()).toBe("2099-01-15T09:45:00.000Z");
    expect((await remindRow(untimedSummer)).remind_at?.toISOString()).toBe("2099-07-15T08:00:00.000Z");
    expect((await remindRow(past)).remind_at).toBeNull();
    expect((await remindRow(done)).remind_at).toBeNull();
  });
});

describe("speed (SC-004)", () => {
  it("lists and counts under 1 s with 500 planned activities and 200 notifications", async () => {
    await sql`
      insert into activities (type, subject, due_on, due_time, assignee_id, created_by, assigned_by, deal_id, remind_at)
      select 'call', 'Fake perf ' || g, date '2030-01-15' + (g % 60), time '10:00', ${ada.id}, ${ada.id},
             case when g % 5 = 0 then ${bob.id}::bigint else ${ada.id}::bigint end, ${deal},
             case when g % 2 = 0 then timestamptz '2030-01-01T09:45:00Z' - make_interval(mins => g) else timestamptz '2030-03-01T09:45:00Z' end
      from generate_series(1, 500) g`;
    await sql`
      with e as (
        insert into timeline_events (deal_id, kind, actor_id, body)
        select ${deal}, 'note', ${bob.id}, 'Fake perf note ' || g from generate_series(1, 100) g returning id)
      insert into note_mentions (event_id, user_id, mentioned_by) select id, ${ada.id}, ${bob.id} from e`;
    await sql`analyze`;
    const now = t("12:00");
    const start = performance.now();
    const list = await listNotifications(ada.id, 50, now);
    const count = await unreadCount(ada.id, now);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(list.items).toHaveLength(50);
    expect(count).toBe(100 + 100 + 250);
  });
});
