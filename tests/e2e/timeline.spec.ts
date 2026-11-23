// covers SF-102 US2 scenarios 1–5, 7, FR-001–FR-003, FR-017
import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { dealDrawer, insertDeal, pipelineId } from "./deals";
import { addNote, entries, makeRecords, noteBox, timelineRegion, userId } from "./notes-helpers";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

test("the deal page shows // TIMELINE with day headings and NOTE / CHANGE tags (US2-1)", async ({ page }) => {
  const deal = await insertDeal({ title: "Timeline deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  await expect(timelineRegion(page)).toContainText("// TIMELINE");
  await expect(page.getByText("// HISTORY")).toHaveCount(0);
  await addNote(page, "A note on the deal");
  await expect(entries(page).nth(0).locator(".kd")).toHaveText("NOTE");
  await expect(entries(page).nth(1).locator(".kd")).toHaveText("CHANGE");
  await expect(entries(page).nth(1)).toContainText("Added by Ada Fake");
});

test("a person's and an organisation's timelines show their deal's notes and changes, tagged DEAL (US2-2, US2-3, US2-4)", async ({ page }) => {
  const { org, person } = await makeRecords();
  const ada = await userId("Ada Fake");
  const [other] = await db()<{ id: number }[]>`
    insert into persons (first_name, last_name, owner_id, created_by) values ('Otto', 'Notetest', ${ada}, ${ada}) returning id::int as id`;
  const deal = await insertDeal({
    title: "Notetest Ltd Fake · website", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake", organisation: "Notetest Ltd Fake", person: "Nora Notetest",
  });
  await db()`insert into deal_people (deal_id, person_id, linked_by) values (${deal}, ${other.id}, ${ada})`;
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  await addNote(page, "Budget confirmed (fake)");
  await page.getByRole("button", { name: "Move to Qualified" }).click();
  await expect(entries(page).first()).toContainText("Moved from Lead in to Qualified by Ada Fake");

  for (const path of [`/people/${person}`, `/organisations/${org}`, `/people/${other.id}`]) {
    await page.goto(path);
    const moved = entries(page).nth(0);
    const note = entries(page).nth(1);
    await expect(moved.locator(".kd")).toHaveText("DEAL");
    await expect(moved).toContainText("Moved from Lead in to Qualified by Ada Fake");
    await expect(moved.getByRole("link", { name: "Notetest Ltd Fake · website" })).toHaveAttribute("href", `/deals/${deal}`);
    await expect(note.locator(".kd")).toHaveText("DEAL");
    await expect(note.locator(".notebody")).toHaveText("Budget confirmed (fake)");
    await expect(note.getByRole("link", { name: "Edit note" })).toHaveCount(0);
    await expect(timelineRegion(page).locator(".notebody", { hasText: "Budget confirmed (fake)" })).toHaveCount(1);
  }

  await page.goto(`/deals/${deal}`);
  await page.getByRole("button", { name: "Unlink Otto Notetest" }).click();
  await expect(entries(page).first()).toContainText("Unlinked");
  await page.goto(`/people/${other.id}`);
  await expect(timelineRegion(page)).not.toContainText("Notetest Ltd Fake · website");
});

test("[ SHOW MORE ] adds the next 50 without a day heading twice (US2-5)", async ({ page }) => {
  const deal = await insertDeal({ title: "Busy deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  const ada = await userId("Ada Fake");
  await db()`insert into timeline_events (deal_id, kind, actor_id, body, created_at)
             select ${deal}, 'note', ${ada}, 'Fake note ' || g, now() - interval '1 day' - g * interval '10 minutes' from generate_series(1, 70) g`;
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  await expect(entries(page)).toHaveCount(50);
  await timelineRegion(page).getByRole("link", { name: "[ SHOW MORE ]" }).click();
  await expect(entries(page)).toHaveCount(71);
  await expect(page).toHaveURL(/timeline=100/);
  await expect(timelineRegion(page).getByRole("link", { name: "[ SHOW MORE ]" })).toHaveCount(0);
  const headings = await timelineRegion(page).locator(".day").allTextContents();
  expect(new Set(headings).size).toBe(headings.length);
  const texts = await timelineRegion(page).locator(".notebody").allTextContents();
  expect(new Set(texts).size).toBe(70);
});

test("an archived deal's entries stay on the organisation's timeline, marked Archived (US2-7)", async ({ page }) => {
  const { org } = await makeRecords();
  const deal = await insertDeal({ title: "Old notetest deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake", organisation: "Notetest Ltd Fake" });
  await db()`update deals set archived_at = now() where id = ${deal}`;
  await signInAs(page, "Ada Fake", `/organisations/${org}`);
  await expect(entries(page).first().locator(".on-deal")).toContainText("Old notetest deal");
  await expect(entries(page).first().locator(".on-deal")).toContainText("Archived");
});

test("the board drawer shows the deal's timeline read-only, with no note box", async ({ page }) => {
  const deal = await insertDeal({ title: "Drawer deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  await addNote(page, "Seen in the drawer");
  await page.goto(`/deals?pipeline=${await pipelineId("Sales")}&open=${deal}`);
  const drawer = dealDrawer(page);
  await expect(drawer.getByRole("region", { name: "Timeline" })).toContainText("Seen in the drawer");
  await expect(drawer.getByRole("textbox", { name: "Note" })).toHaveCount(0);
  await expect(noteBox(page)).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: "Edit note" })).toHaveCount(0);
});
