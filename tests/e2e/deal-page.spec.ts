// covers SF-95 US1 scenarios 1–5, FR-001–FR-004, FR-020 (the deal page, design C)
import { expect, test } from "@playwright/test";
import { formatDate } from "@/server/format";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { dealDrawer, history, insertDeal, pipelineId, stageId, stageStep, strip } from "./deals";

test.beforeEach(async () => {
  await resetAndSeed();
  await db()`delete from deals where title = 'Fakeco website'`;
});
test.afterAll(closeDb);

test("the board drawer opens the deal page, which shows every field and links back to the board", async ({ page }) => {
  const id = await insertDeal({
    title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 400000,
    organisation: "Fakeco Ltd", person: "Abe Example",
  });
  await db()`update deals set expected_close_on = '2026-12-19' where id = ${id}`;
  await db()`insert into deal_followers (deal_id, user_id) select ${id}, id from users where name = 'Grace Fake'`;
  const sales = await pipelineId("Sales");
  await signInAs(page, "Linus Fake", `/deals?pipeline=${sales}&open=${id}`);
  await dealDrawer(page).getByRole("link", { name: "[ OPEN DEAL PAGE ]" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${id}$`));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fakeco website");
  await expect(strip(page)).toContainText("£4,000");
  await expect(strip(page)).toContainText("Ada Fake");
  await expect(strip(page)).toContainText("19 Dec 2026");
  await expect(strip(page)).toContainText("Open");
  const details = page.getByRole("region", { name: "Details" });
  await expect(details).toContainText("Sales · Qualified");
  await expect(details.getByRole("link", { name: "Fakeco Ltd" })).toHaveAttribute("href", /\/organisations\/\d+$/);
  await expect(details.getByRole("link", { name: "Abe Example" })).toHaveAttribute("href", /\/people\/\d+$/);
  await expect(details).toContainText("Grace Fake");
  await expect(details).toContainText(formatDate(new Date()));
  await expect(page.getByText("// TIMELINE")).toBeVisible();
  await expect(history(page).first()).toContainText("Added by Ada Fake");
  await expect(stageStep(page, "Qualified")).toHaveAttribute("aria-current", "step");

  await page.getByRole("link", { name: "← Sales board" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals\\?pipeline=${sales}$`));
});

test("the stage bar shows whole days per stage and moves an open deal like the board", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Proposal", createdBy: "Ada Fake" });
  const [qualified, proposal] = [await stageId("Sales", "Qualified"), await stageId("Sales", "Proposal")];
  await db()`delete from deal_stage_periods where deal_id = ${id}`;
  await db()`insert into deal_stage_periods (deal_id, stage_id, stage_name, pipeline_name, entered_at, left_at) values
    (${id}, ${qualified}, 'Qualified', 'Sales', now() - interval '8 days 1 hour', now() - interval '5 days 1 hour'),
    (${id}, ${proposal}, 'Proposal', 'Sales', now() - interval '5 days 1 hour', null)`;
  await signInAs(page, "Linus Fake", `/deals/${id}`);
  await expect(stageStep(page, "Lead in")).toContainText("0 days");
  await expect(stageStep(page, "Qualified")).toContainText("3 days");
  await expect(stageStep(page, "Proposal")).toContainText("5 days");
  await expect(stageStep(page, "Proposal")).toHaveAttribute("aria-current", "step");
  await expect(stageStep(page, "Negotiation")).not.toContainText("day");

  await page.getByRole("button", { name: "Move to Negotiation" }).click();
  await expect(stageStep(page, "Negotiation")).toHaveAttribute("aria-current", "step");
  await expect(stageStep(page, "Negotiation")).toContainText("0 days");
  await expect(stageStep(page, "Proposal")).toContainText("5 days");
  await expect(history(page).first()).toContainText("Moved from Proposal to Negotiation by Linus Fake");
  const [row] = await db()<{ n: number }[]>`select count(*)::int as n from deal_stage_periods where deal_id = ${id} and left_at is null and stage_id = ${await stageId("Sales", "Negotiation")}`;
  expect(row.n).toBe(1);
});

test("a missing deal or a private deal of someone else shows 'This deal doesn't exist or you can't see it.'", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals");
  const missing = await page.goto("/deals/999999");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This deal doesn't exist or you can't see it." })).toBeVisible();
  const [secret] = await db()<{ id: number }[]>`select id::int as id from deals where title = 'Fake secret project'`;
  for (const path of [`/deals/${secret.id}`, `/deals/${secret.id}/edit`]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: "This deal doesn't exist or you can't see it." })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("Fake secret project");
  }
});
