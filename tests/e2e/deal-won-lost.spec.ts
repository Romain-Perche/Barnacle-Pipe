// covers SF-95 US2 scenarios 1–6, FR-005–FR-008, SC-002 (Won, Lost with a reason in a box over the page, Reopen)
import { expect, test } from "@playwright/test";
import { formatDate } from "@/server/format";
import { closeDb, db, pageAlert, resetAndSeed, signInAs } from "./helpers";
import { card, column, expectHeader, history, insertDeal, lostBox, pipelineId, stageStep, strip } from "./deals";

test.beforeEach(async () => {
  await resetAndSeed();
  await db()`delete from deals where title = 'Fakeco website'`;
});
test.afterAll(closeDb);

const today = () => formatDate(new Date());

test("[ WON ] closes the deal: badge with the date, history line, gone from the board and its total", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Proposal", createdBy: "Linus Fake", valuePence: 400000 });
  await signInAs(page, "Linus Fake", `/deals/${id}`);
  await page.getByRole("button", { name: "[ WON ]" }).click();
  await expect(strip(page)).toContainText(`Won · ${today()}`);
  await expect(history(page).first()).toContainText("Marked as won by Linus Fake");
  await expect(page.getByRole("button", { name: "[ REOPEN ]" })).toBeVisible();
  await expect(page.getByRole("button", { name: "[ WON ]" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "[ LOST ]" })).toHaveCount(0);
  // Scenario 5: the bar shows the stages but does not move a closed deal.
  await expect(stageStep(page, "Proposal")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: /^Move to / })).toHaveCount(0);

  await page.goto(`/deals?pipeline=${await pipelineId("Sales")}`);
  await expect(column(page, "Proposal")).toBeVisible();
  await expect(card(page, "Fakeco website")).toHaveCount(0);
  await expectHeader(page, "Sales", "Proposal", "Linus Fake");
});

test("[ LOST ] asks why in a box, refuses an empty reason, shows the reason; [ REOPEN ] puts it back", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake", valuePence: 400000 });
  await signInAs(page, "Linus Fake", `/deals/${id}`);
  await page.getByRole("link", { name: "[ LOST ]" }).click();
  await expect(lostBox(page)).toBeVisible();
  await expect(lostBox(page).getByRole("button", { name: "[ MARK AS LOST ]" })).toBeVisible();
  await expect(lostBox(page).getByRole("link", { name: "[ CANCEL ]" })).toBeVisible();

  await lostBox(page).getByRole("button", { name: "[ MARK AS LOST ]" }).click();
  await expect(lostBox(page).getByRole("alert")).toHaveText("Enter why this deal was lost.");
  await expect(strip(page)).toContainText("Open");

  await lostBox(page).getByRole("textbox").fill("Went with a competitor");
  await lostBox(page).getByRole("button", { name: "[ MARK AS LOST ]" }).click();
  await expect(lostBox(page)).toHaveCount(0);
  await expect(strip(page)).toContainText(`Lost · ${today()}`);
  await expect(page.getByText("Lost because: Went with a competitor")).toBeVisible();
  await expect(history(page).first()).toContainText("Marked as lost by Linus Fake: Went with a competitor");
  await page.goto(`/deals?pipeline=${await pipelineId("Sales")}`);
  await expect(card(page, "Fakeco website")).toHaveCount(0);

  await page.goto(`/deals/${id}`);
  await page.getByRole("button", { name: "[ REOPEN ]" }).click();
  await expect(strip(page)).toContainText("Open");
  await expect(page.getByText("Lost because:")).toHaveCount(0);
  await expect(history(page).first()).toContainText("Reopened by Linus Fake");
  await page.goto(`/deals?pipeline=${await pipelineId("Sales")}`);
  await expect(column(page, "Qualified").locator("a.card").filter({ hasText: "Fakeco website" })).toBeVisible();
  await expectHeader(page, "Sales", "Qualified", "Linus Fake");
});

test("[ CANCEL ] closes the box; the box does not take more than 500 characters", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  await signInAs(page, "Linus Fake", `/deals/${id}?confirm=lost`);
  await expect(lostBox(page).getByRole("textbox")).toHaveAttribute("maxlength", "500");
  await lostBox(page).getByRole("link", { name: "[ CANCEL ]" }).click();
  await expect(lostBox(page)).toHaveCount(0);
  await expect(strip(page)).toContainText("Open");
});

test("a deal changed in another tab refuses Won and Lost with the 'changed' message, and nothing changes", async ({ page, context }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  await signInAs(page, "Linus Fake", `/deals/${id}`);
  const other = await context.newPage();
  await other.goto(`/deals/${id}?confirm=lost`);
  await expect(lostBox(other)).toBeVisible();
  const third = await context.newPage();
  await third.goto(`/deals/${id}`);

  await page.getByRole("button", { name: "[ WON ]" }).click();
  await expect(strip(page)).toContainText("Won");

  await lostBox(other).getByRole("textbox").fill("Went with a competitor");
  await lostBox(other).getByRole("button", { name: "[ MARK AS LOST ]" }).click();
  await expect(pageAlert(other)).toHaveText("Someone else changed this deal while you were editing. Reload to see their changes.");
  await third.getByRole("button", { name: "[ WON ]" }).click();
  await expect(pageAlert(third)).toHaveText("Someone else changed this deal while you were editing. Reload to see their changes.");
  const [row] = await db()<{ status: string; lost_reason: string | null }[]>`select status, lost_reason from deals where id = ${id}`;
  expect(row).toEqual({ status: "won", lost_reason: null });
  const events = await db()`select kind from timeline_events where deal_id = ${id} and kind in ('won', 'lost')`;
  expect(events.length).toBe(1);
});
