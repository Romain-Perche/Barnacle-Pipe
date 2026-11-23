// covers SF-102 US4 scenarios 1, 3, 4, FR-015, SC-005
import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, sidebar, signInAs } from "./helpers";
import { insertDeal } from "./deals";
import { addNote, makeRecords, noteBox, timelineRegion, userId } from "./notes-helpers";

test.beforeEach(async () => {
  await resetAndSeed();
  await db()`delete from note_mentions`;
});
test.afterAll(closeDb);

test("a private deal's note never shows on its person's or organisation's timeline for an admin it is hidden from (US4-1)", async ({ page, browser }) => {
  const { org, person } = await makeRecords();
  const deal = await insertDeal({
    title: "Secret notetest deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake", organisation: "Notetest Ltd Fake", person: "Nora Notetest", private: true,
  });
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  await addNote(page, "Private talk (fake)");
  await page.goto(`/organisations/${org}`);
  await expect(timelineRegion(page)).toContainText("Private talk (fake)");

  const ctx = await browser.newContext();
  const grace = await ctx.newPage();
  await signInAs(grace, "Grace Fake");
  for (const path of [`/organisations/${org}`, `/people/${person}`]) {
    await grace.goto(path);
    await expect(timelineRegion(grace)).toBeVisible();
    await expect(grace.locator("main")).not.toContainText("Secret notetest deal");
    await expect(grace.locator("main")).not.toContainText("Private talk");
  }
  await ctx.close();
});

test("the @ list on a private deal offers only those who can see it (US4-3)", async ({ page }) => {
  const deal = await insertDeal({ title: "Secret mention deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake", owner: "Linus Fake", private: true });
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  const box = noteBox(page).getByRole("textbox", { name: "Note" });
  await box.pressSequentially("Hi @Gr");
  await expect(noteBox(page).getByRole("option")).toHaveCount(0);
  await box.fill("");
  await box.pressSequentially("Hi @Li");
  await expect(noteBox(page).getByRole("option", { name: "Linus Fake" })).toBeVisible();
});

test("a notification on a deal later made private is gone from the page and the count (US4-4)", async ({ page }) => {
  const deal = await insertDeal({ title: "Soon private deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  const users = new Map((await db()<{ id: number; name: string }[]>`select id::int as id, name from users`).map((u) => [u.name, u.id]));
  const [n] = await db()<{ id: number }[]>`
    insert into timeline_events (deal_id, kind, actor_id, body) values (${deal}, 'note', ${users.get("Ada Fake")!}, ${`@[user:${users.get("Linus Fake")}] look`}) returning id::int as id`;
  await db()`insert into note_mentions (event_id, user_id, mentioned_by) values (${n.id}, ${users.get("Linus Fake")!}, ${users.get("Ada Fake")!})`;
  await signInAs(page, "Linus Fake", "/notifications");
  await expect(sidebar(page).getByRole("link", { name: "Notifications (1)" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText("Soon private deal");
  await db()`update deals set private = true where id = ${deal}`;
  await page.goto("/notifications");
  await expect(page.getByText("No notifications yet.")).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Soon private deal");
});

// covers US1 scenario 6, fix round 1: a delete posted for a hidden deal lands on the deal list, never names the deal
test("a note delete posted for a deal private to someone else shows the note message on the deal list", async ({ page }) => {
  const hidden = await insertDeal({ title: "Hidden delete deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake", private: true });
  const shown = await insertDeal({ title: "Shared delete deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  const ada = await userId("Ada Fake");
  const [hiddenNote] = await db()<{ id: number }[]>`
    insert into timeline_events (deal_id, kind, actor_id, body) values (${hidden}, 'note', ${ada}, 'secret note') returning id::int as id`;
  const [shownNote] = await db()<{ id: number }[]>`
    insert into timeline_events (deal_id, kind, actor_id, body) values (${shown}, 'note', ${ada}, 'shared note') returning id::int as id`;
  await signInAs(page, "Linus Fake", `/deals/${shown}?delete-note=${shownNote.id}`);
  const confirm = page.getByRole("alertdialog", { name: "Confirm note delete" });
  await confirm.locator('input[name="targetId"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), String(hidden));
  await confirm.locator('input[name="noteId"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), String(hiddenNote.id));
  await confirm.getByRole("button", { name: "[ DELETE ]" }).click();
  await expect(page).toHaveURL(/\/deals$/);
  await expect(page.locator("p.notice")).toHaveText("This note doesn't exist or you can't see it.");
  await expect(page.locator("main")).not.toContainText("This deal doesn't exist or you can't see it.");
  await expect(page.locator("main")).not.toContainText("Hidden delete deal");
  const left = await db()`select id from timeline_events where id in ${db()([hiddenNote.id, shownNote.id])}`;
  expect(left.length).toBe(2);
});

// covers US1 scenario 5, fix round 1: a delete keeps the page's shown count
test("a delete from a timeline opened with ?timeline=100 comes back to ?timeline=100", async ({ page }) => {
  const deal = await insertDeal({ title: "Long timeline deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  const ada = await userId("Ada Fake");
  await db()`
    insert into timeline_events (deal_id, kind, actor_id, body, created_at)
    select ${deal}, 'note', ${ada}, 'old note ' || n, now() - make_interval(mins => n) from generate_series(1, 60) n`;
  const [first] = await db()<{ id: number }[]>`
    select id::int as id from timeline_events where deal_id = ${deal} and body = 'old note 1'`;
  await signInAs(page, "Ada Fake", `/deals/${deal}?timeline=100&delete-note=${first.id}`);
  await page.getByRole("alertdialog", { name: "Confirm note delete" }).getByRole("button", { name: "[ DELETE ]" }).click();
  await expect(page.locator("p.notice")).toHaveText("Note deleted.");
  await expect(page).toHaveURL(new RegExp(`/deals/${deal}\\?timeline=100$`));
  await expect(timelineRegion(page)).toContainText("old note 60");
});

