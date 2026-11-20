// covers SF-95 US4 scenarios 1–3, FR-011, FR-014, FR-015, SC-007, Edge Cases (delete from the deal page)
import { expect, test } from "@playwright/test";
import { formatDate } from "@/server/format";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { column, dealDrawer, history, insertDeal, pipelineId, strip } from "./deals";

test.beforeEach(async () => {
  await resetAndSeed();
  await db()`delete from deals where title = 'Fakeco website'`;
});
test.afterAll(closeDb);

test("archive from the board, find it with 'Show archived deals', restore it from its page", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  const sales = await pipelineId("Sales");
  await signInAs(page, "Linus Fake", `/deals?pipeline=${sales}&open=${id}`);
  await dealDrawer(page).getByRole("button", { name: "[ ARCHIVE ]" }).click();
  await expect(column(page, "Qualified").locator("a.card").filter({ hasText: "Fakeco website" })).toHaveCount(0);

  await page.goto("/deals/list");
  await page.getByLabel("Show archived deals").check();
  await expect(page).toHaveURL(/archived=1/);
  const row = page.locator("tbody tr").filter({ hasText: "Fakeco website" });
  await expect(row.locator(".badge.off")).toHaveText("Archived");
  await expect(page.locator("tbody tr").filter({ hasText: "Old fake tender (lost)" })).toBeVisible();
  await row.getByRole("link", { name: "Fakeco website", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/deals/${id}$`));
  await expect(strip(page)).toContainText(`Archived · ${formatDate(new Date())}`);
  await expect(page.getByRole("button", { name: "[ RESTORE ]" })).toBeVisible();
  for (const name of ["[ WON ]", "[ REOPEN ]", "[ ARCHIVE ]", "[ FOLLOW ]", "[ LINK PERSON ]"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  for (const name of ["[ EDIT ]", "[ LOST ]", "[ DELETE ]"]) await expect(page.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move to / })).toHaveCount(0);

  await page.getByRole("button", { name: "[ RESTORE ]" }).click();
  await expect(history(page).first()).toContainText("Restored by Linus Fake");
  await expect(strip(page)).not.toContainText("Archived");
  await page.goto(`/deals?pipeline=${sales}`);
  await expect(column(page, "Qualified").locator("a.card").filter({ hasText: "Fakeco website" })).toBeVisible();
});

test("an admin deletes a deal from its page after the confirmation and lands on the list", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  await signInAs(page, "Ada Fake", `/deals/${id}`);
  await page.getByRole("link", { name: "[ DELETE ]" }).click();
  await expect(page.getByText("Delete Fakeco website for good? This can't be undone.")).toBeVisible();
  await page.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click();
  await expect(page).toHaveURL(/\/deals\/list$/);
  await expect(page.getByRole("status")).toHaveText("Fakeco website was deleted.");
  const rows = await db()`select 1 from deals where id = ${id}`;
  expect(rows.length).toBe(0);
});

test("an archived deal's page offers [ DELETE ] to admins, beside [ RESTORE ]", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake" });
  await db()`update deals set archived_at = now() where id = ${id}`;
  await signInAs(page, "Ada Fake", `/deals/${id}`);
  await expect(page.getByRole("button", { name: "[ RESTORE ]" })).toBeVisible();
  await expect(page.getByRole("link", { name: "[ DELETE ]" })).toBeVisible();
  await expect(page.getByRole("link", { name: "[ EDIT ]" })).toHaveCount(0);
});
