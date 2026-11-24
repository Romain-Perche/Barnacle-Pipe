// covers SF-117 US3 scenarios 1–6 and 8, FR-020–FR-024, SC-002, SC-003: a long import runs in parts (each well within
// one request's time), waits when Pipedrive says 429, pauses on a failure or a closed page and continues from where it
// stopped, stops on request, and leaves exactly one CRM record per Pipedrive record, also when run again.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { removeToken, saveToken } from "@/server/pipedrive/connection";
import { continueImport, getImportView, runPart, stopImport } from "@/server/pipedrive/imports";
import { namesForReport } from "@/server/pipedrive/report";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeUser, resetDb } from "./db-helpers";
import { COMPANY, connect, fakeCompany, importRow, LINUS_TOKEN, OTHER_TOKEN, runToEnd, skipWait, start } from "./pipedrive-helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), redirect: () => {} }));
const { ReportStep } = await import("@/app/(app)/settings/pipedrive-import/ReportStep");

let linus: { id: number };
let fake: ReturnType<typeof installFakePipedrive>;

beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  fake = installFakePipedrive();
  fakeCompany(fake);
  await connect(linus.id, LINUS_TOKEN);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

function account(orgs: number, people: number) {
  const orgIds: number[] = [];
  for (let i = 1; i <= orgs; i++) orgIds.push(fake.addOrganization(COMPANY, { name: `Bulk Org ${i} Fake`, owner_id: 1 }));
  const personIds: number[] = [];
  for (let i = 1; i <= people; i++) {
    personIds.push(fake.addPerson(COMPANY, {
      first_name: `Bulk${i}`, last_name: "Fake", owner_id: 1, org_id: orgIds.length > 0 ? orgIds[i % orgIds.length] : null,
      emails: [{ value: `bulk${i}@fake.example`, primary: true, label: "work" }],
    }));
  }
  return { orgIds, personIds };
}
const linkCount = async (kind: string) => (await sql<{ n: number }[]>`select count(*)::int as n from pipedrive_links where kind = ${kind}`)[0].n;
const tableCount = async (t: "persons" | "organisations" | "person_emails" | "timeline_events") => (await sql<{ n: number }[]>`select count(*)::int as n from ${sql(t)}`)[0].n;
const snapshot = async () => ({
  persons: await tableCount("persons"), organisations: await tableCount("organisations"), emails: await tableCount("person_emails"),
  events: await tableCount("timeline_events"), links: await linkCount("person"), row: await importRow((await sql`select id from pipedrive_imports`)[0].id),
});

describe("a large account (SC-002, SC-003)", () => {
  it("imports 3,000 people and 800 organisations in parts, through 429s, a failure and a closed page, each record once", async () => {
    account(800, 3000);
    const id = await start(linus.id);
    fake.slowDownEvery(7, 8);
    let longest = 0;
    let sawWait = false;
    let failedOnce = false;
    let closedOnce = false;
    for (let parts = 0; parts < 400; parts++) {
      const row = await importRow(id);
      if (!failedOnce && row.step === "people" && row.people_done >= 1200) {
        // US3-4: a part fails half-way through the people: nothing of it is saved, the import pauses.
        failedOnce = true;
        const before = await snapshot();
        fake.failNext("network");
        expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
        const after = await snapshot();
        expect(after.row).toMatchObject({ state: "paused", pause_reason: "unreachable" });
        expect({ ...after, row: null }).toEqual({ ...before, row: null });
        expect(after.row.people_done).toBe(before.row.people_done);
        expect((await getImportView(linus.id))?.pauseReason).toBe("unreachable");
        expect(await continueImport(linus.id)).toBe(id);
        continue;
      }
      if (!closedOnce && row.step === "people" && row.people_done >= 2000) {
        // US3-3: the page was closed: no part for 31 seconds → shown paused; parts do not run until [ CONTINUE ].
        closedOnce = true;
        await sql`update pipedrive_imports set seen_at = now() - interval '31 seconds', wait_until = null, state = 'running' where id = ${id}`;
        const view = (await getImportView(linus.id))!;
        expect(view.effectiveState).toBe("paused");
        expect(view.pausedText).toMatch(/^Import paused: Organisations 800 of 800, People 2,\d{3} of 3,000\.$/);
        const before = (await importRow(id)).people_done;
        expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
        expect((await importRow(id)).people_done).toBe(before);
        await continueImport(linus.id);
        continue;
      }
      const t0 = Date.now();
      const r = await runPart(linus.id, id);
      longest = Math.max(longest, Date.now() - t0);
      if (r.next === "stop") break;
      if (r.next === "wait") {
        if (!sawWait) {
          // US3-2: Pipedrive asked to slow down: waiting about 8 seconds, then it carries on by itself.
          sawWait = true;
          expect(r).toEqual({ next: "wait", seconds: 8 });
          const w = await importRow(id);
          expect(w.state).toBe("waiting");
          expect(Math.abs(w.wait_until!.getTime() - Date.now() - 8000)).toBeLessThan(2000);
          expect((await getImportView(linus.id))!.waitSeconds).toBeGreaterThan(5);
          expect(await runPart(linus.id, id)).toMatchObject({ next: "wait" });
        }
        await skipWait(id);
      }
    }
    expect([sawWait, failedOnce, closedOnce]).toEqual([true, true, true]);
    const view = (await getImportView(linus.id))!;
    expect(view.state).toBe("finished");
    expect(view.progress).toEqual([{ kind: "organisations", done: 800, total: 800 }, { kind: "people", done: 3000, total: 3000 }]);
    expect(await linkCount("person")).toBe(3000);
    expect(await linkCount("organisation")).toBe(800);
    expect(await tableCount("persons")).toBe(3000);
    expect(await tableCount("organisations")).toBe(800);
    expect(view.counts.people).toEqual({ imported: 3000, linked: 0, already: 0, notImported: 0 });
    expect(longest).toBeLessThan(10_000);

    // US3-8: a second import from the same company counts everything as already imported and adds nothing.
    fake.slowDownEvery(null);
    await runToEnd(linus.id, await start(linus.id));
    const again = (await getImportView(linus.id))!;
    expect(again.counts.people).toEqual({ imported: 0, linked: 0, already: 3000, notImported: 0 });
    expect(again.counts.organisations).toEqual({ imported: 0, linked: 0, already: 800, notImported: 0 });
    expect(await tableCount("persons")).toBe(3000);
    expect(await tableCount("organisations")).toBe(800);
  }, 300_000);
});

describe("pauses (US3-3, US3-5, edge cases)", () => {
  it("pauses with token_refused when Pipedrive no longer accepts the token; records already imported stay", async () => {
    account(0, 150);
    const id = await start(linus.id, { organisations: false });
    for (let i = 0; i < 5 && (await importRow(id)).people_done === 0; i++) await runPart(linus.id, id);
    const done = await tableCount("persons");
    expect(done).toBe(100);
    fake.refuseToken(LINUS_TOKEN);
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    expect(await importRow(id)).toMatchObject({ state: "paused", pause_reason: "token_refused" });
    expect(await tableCount("persons")).toBe(done);
  });
  it("pauses with token_refused when the token was removed", async () => {
    account(2, 3);
    const id = await start(linus.id);
    await removeToken(linus.id);
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    expect(await importRow(id)).toMatchObject({ state: "paused", pause_reason: "token_refused" });
  });
  it("refuses to go on with a token of another Pipedrive company, and imports nothing", async () => {
    account(2, 3);
    const id = await start(linus.id);
    await runPart(linus.id, id);
    expect(await saveToken(linus.id, OTHER_TOKEN)).toEqual({ ok: true });
    await continueImport(linus.id);
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    expect(await importRow(id)).toMatchObject({ state: "paused", pause_reason: "other_company" });
    await continueImport(linus.id);
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    expect((await getImportView(linus.id))!.pauseReason).toBe("other_company");
    expect(await tableCount("persons")).toBe(0);
    expect(await tableCount("organisations")).toBe(0);
  });
});

describe("Pipedrive changes during an import (edge case)", () => {
  it("passes over a record deleted before its page, and takes in one added during the import", async () => {
    const { personIds } = account(0, 120);
    const id = await start(linus.id, { organisations: false });
    // prepare and count, then delete one person of the second page and add one.
    while ((await importRow(id)).step !== "people") await runPart(linus.id, id);
    fake.deletePerson(COMPANY, personIds[110]);
    const added = fake.addPerson(COMPANY, { first_name: "Late", last_name: "Fake", owner_id: 1 });
    await runToEnd(linus.id, id);
    expect(await sql`select 1 from pipedrive_links where pipedrive_id = ${personIds[110]} and kind = 'person'`).toHaveLength(0);
    expect(await sql`select 1 from pipedrive_links where pipedrive_id = ${added} and kind = 'person'`).toHaveLength(1);
    const view = (await getImportView(linus.id))!;
    expect(view.counts.people.notImported).toBe(0);
    expect(view.progress).toEqual([{ kind: "people", done: 120, total: 120 }]);
  });
});

describe("stopping (US3-6, FR-023)", () => {
  it("stops a running import: no more records, those imported stay, the report says it was stopped", async () => {
    account(0, 250);
    const id = await start(linus.id, { organisations: false });
    while ((await importRow(id)).people_done === 0) await runPart(linus.id, id);
    expect(await stopImport(linus.id)).toBe(id);
    expect(await importRow(id)).toMatchObject({ state: "stopped" });
    expect(await runPart(linus.id, id)).toEqual({ next: "stop" });
    expect(await tableCount("persons")).toBe(100);
    const view = (await getImportView(linus.id))!;
    expect(view.stoppedByUser).toBe(true);
    const html = renderToStaticMarkup(createElement(ReportStep, { view, names: await namesForReport(linus.id, view.report) }));
    expect(html).toContain("Stopped by you before the end.");
    expect(html).toContain("Already imported: 0");
  });
  it("stops a paused import too", async () => {
    account(1, 1);
    const id = await start(linus.id);
    fake.failNext(500);
    await runPart(linus.id, id);
    expect((await importRow(id)).state).toBe("paused");
    expect(await stopImport(linus.id)).toBe(id);
    expect((await importRow(id)).state).toBe("stopped");
  });
});
