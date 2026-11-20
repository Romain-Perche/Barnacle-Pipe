// covers SF-102 US4 scenarios 1, 3, 4, FR-015, SC-005
import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, sidebar, signInAs } from "./helpers";
import { insertDeal } from "./deals";
import { addNote, makeRecords, noteBox, timelineRegion } from "./notes-helpers";

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
