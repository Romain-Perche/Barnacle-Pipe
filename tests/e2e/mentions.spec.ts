// covers SF-102 US3 scenarios 1–4, FR-010–FR-013, Edge Case "@ in an email address stays plain text"
import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, sidebar, signInAs } from "./helpers";
import { insertDeal } from "./deals";
import { addNote, entries, noteBox } from "./notes-helpers";

test.beforeEach(async () => {
  await resetAndSeed();
  // Start every user at zero notifications (the fake data has some).
  await db()`delete from note_mentions`;
});
test.afterAll(closeDb);

test("@ offers teammates, a mention is highlighted and notifies them; opening it clears the count", async ({ page, browser }) => {
  const deal = await insertDeal({ title: "Mention deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  const box = noteBox(page).getByRole("textbox", { name: "Note" });
  await box.pressSequentially("Please call them @Li");
  const option = noteBox(page).getByRole("option", { name: "Linus Fake" });
  await expect(option).toBeVisible();
  await expect(noteBox(page).getByRole("option", { name: "Alan Fake" })).toHaveCount(0);
  await option.click();
  await expect(box).toHaveValue("Please call them @Linus Fake ");
  await box.pressSequentially("today");
  await noteBox(page).getByRole("button", { name: "[ ADD NOTE ]" }).click();
  await expect(box).toHaveValue("");
  await expect(entries(page).first().locator("mark.mention")).toHaveText("@Linus Fake");
  await expect(entries(page).first().locator(".notebody")).toHaveText("Please call them @Linus Fake today");
  await addNote(page, "Mail ada@example.fake");
  await expect(entries(page).first().locator("mark")).toHaveCount(0);

  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  await expect(sidebar(linus).getByRole("link", { name: "Notifications (1)" })).toBeVisible();
  await sidebar(linus).getByRole("link", { name: "Notifications (1)" }).click();
  const list = linus.getByRole("list", { name: "Notifications" });
  const item = list.getByRole("button", { name: /Ada Fake mentioned you in a note on Mention deal/ });
  await expect(item).toContainText("Please call them @Linus Fake today");
  await expect(item).toContainText(/\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
  await expect(item).toContainText("Unread");
  await item.click();
  await expect(linus).toHaveURL(new RegExp(`/deals/${deal}$`));
  await expect(sidebar(linus).getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  await ctx.close();
});

test("[ MARK ALL AS READ ] marks every notification read; with none, No notifications yet.", async ({ page }) => {
  const deal = await insertDeal({ title: "Mention deal 2", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  await signInAs(page, "Linus Fake", "/notifications");
  await expect(page.getByText("No notifications yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "[ MARK ALL AS READ ]" })).toHaveCount(0);
  const [ada] = await db()<{ id: number }[]>`select id::int as id from users where name = 'Ada Fake'`;
  const [linus] = await db()<{ id: number }[]>`select id::int as id from users where name = 'Linus Fake'`;
  for (const text of ["one", "two"]) {
    const [n] = await db()<{ id: number }[]>`
      insert into timeline_events (deal_id, kind, actor_id, body) values (${deal}, 'note', ${ada.id}, ${`@[user:${linus.id}] ${text}`}) returning id::int as id`;
    await db()`insert into note_mentions (event_id, user_id, mentioned_by) values (${n.id}, ${linus.id}, ${ada.id})`;
  }
  await page.goto("/notifications");
  await expect(sidebar(page).getByRole("link", { name: "Notifications (2)" })).toBeVisible();
  await page.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click();
  await expect(page.getByRole("button", { name: "[ MARK ALL AS READ ]" })).toHaveCount(0);
  await expect(sidebar(page).getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Notifications" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("Unread")).toHaveCount(0);
});
