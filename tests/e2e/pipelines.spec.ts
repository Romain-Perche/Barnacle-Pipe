import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, resetAndSeed, sidebar, signInAs } from "./helpers";
import { column, dealDrawer, history, insertDeal, pipelineId } from "./deals";
import { actionField } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

async function addStage(page: Page, name: string) {
  await page.getByLabel("New stage").fill(name);
  await page.getByRole("button", { name: "[ ADD STAGE ]" }).click();
  await expect(page.getByRole("textbox", { name: `Name of ${name}`, exact: true })).toBeVisible();
}

function stageRows(page: Page) {
  return page.locator("table.order td.nm");
}

// covers US5 scenarios 1, 2, 6, FR-001, FR-002, FR-003 (the independent test of US5)
test("an admin creates a pipeline with stages, renames, reorders and deletes them; the board follows", async ({ page }) => {
  await signInAs(page, "Ada Fake");
  await sidebar(page).getByRole("link", { name: "Pipelines" }).click();
  await expect(page).toHaveURL("/admin/pipelines");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pipelines");
  await page.getByLabel("New pipeline").fill("Partners");
  await page.getByRole("button", { name: "[ ADD PIPELINE ]" }).click();
  await expect(page.locator("table.order td.nm").last()).toHaveText("Partners");

  // A new pipeline is in the picker and its board has no stages yet.
  const partners = await pipelineId("Partners");
  await page.goto("/deals");
  await expect(page.getByLabel("Pipeline", { exact: true }).locator("option")).toContainText(["Partners"]);
  await page.goto(`/deals?pipeline=${partners}`);
  await expect(page.getByText("This pipeline has no stages yet.")).toBeVisible();

  // A name already used (ignoring case and spaces) is refused.
  await page.goto("/admin/pipelines");
  await page.getByLabel("New pipeline").fill("  sales ");
  await page.getByRole("button", { name: "[ ADD PIPELINE ]" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This name is already used.");
  expect((await db()`select 1 from pipelines where lower(name) = 'sales'`).length).toBe(1);

  await page.getByRole("link", { name: "Partners", exact: true }).click();
  await expect(page).toHaveURL(`/admin/pipelines/${partners}`);
  await addStage(page, "Intro");
  await addStage(page, "Talking");
  await addStage(page, "Signed");
  await page.getByLabel("New stage").fill("intro");
  await page.getByRole("button", { name: "[ ADD STAGE ]" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This name is already used.");

  await page.getByRole("textbox", { name: "Name of Talking" }).fill("In talks");
  await page.getByRole("button", { name: "Rename Talking" }).click();
  await expect(stageRows(page)).toHaveText(["Intro", "In talks", "Signed"]);
  await page.getByRole("button", { name: "Move Signed up" }).click();
  await expect(stageRows(page)).toHaveText(["Intro", "Signed", "In talks"]);
  await page.getByRole("button", { name: "Move Signed up" }).click();
  await expect(stageRows(page)).toHaveText(["Signed", "Intro", "In talks"]);
  await page.getByRole("link", { name: "Delete Intro" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete Intro? This can't be undone.");
  await page.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click();
  await expect(stageRows(page)).toHaveText(["Signed", "In talks"]);

  await page.goto(`/deals?pipeline=${partners}`);
  await expect(page.getByRole("region").locator("h2")).toHaveText(["Signed", "In talks"]);
});

// covers US5 scenario 3
test("reordering pipelines changes the picker and the default board", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/admin/pipelines");
  await page.getByRole("button", { name: "Move Ambassadors up" }).click();
  await expect(page.locator("table.order td.nm").first()).toHaveText("Ambassadors");
  await page.goto("/deals");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ambassadors");
  await expect(page.getByLabel("Pipeline", { exact: true }).locator("option")).toHaveText([
    "Ambassadors", "Sales", "Fractional CTO", "Exec Dinner", "Ada Fake's pipeline",
  ]);
});

// covers US5 scenarios 4, 5, FR-004, SC-007
test("deleting a stage or a pipeline with deals asks where they go and moves them, never losing one", async ({ page }) => {
  const deal = await insertDeal({ title: "Fake moved deal", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  const archived = await insertDeal({ title: "Fake archived deal", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  await db()`update deals set archived_at = now() where id = ${archived}`;
  const total = async () => (await db()<{ n: number }[]>`select count(*)::int as n from deals`)[0].n;
  const before = await total();
  const [{ n }] = await db()<{ n: number }[]>`
    select count(*)::int as n from deals d join stages s on s.id = d.stage_id where s.name = 'Qualified' and s.pipeline_id = ${await pipelineId("Sales")}`;

  const sales = await pipelineId("Sales");
  await signInAs(page, "Ada Fake", `/admin/pipelines/${sales}`);
  await page.getByRole("link", { name: "Delete Qualified" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(`Qualified has ${n} deals. Move them to:`);
  await page.getByLabel("Move the deals to").selectOption({ label: "Sales · Proposal" });
  await page.getByRole("button", { name: "[ MOVE DEALS AND DELETE ]" }).click();
  await expect(stageRows(page)).toHaveText(["Lead in", "Proposal", "Negotiation", "Closing"]);
  expect(await total()).toBe(before);
  const [row] = await db()<{ stage: string }[]>`select s.name as stage from deals d join stages s on s.id = d.stage_id where d.id = ${archived}`;
  expect(row.stage).toBe("Proposal");
  await page.goto(`/deals?pipeline=${sales}&open=${deal}`);
  await expect(column(page, "Proposal")).toContainText("Fake moved deal");
  await expect(history(page).first()).toContainText("Moved from Qualified to Proposal by Ada Fake (stage deleted)");

  // A pipeline with deals: its deals go to a stage of another pipeline.
  await page.goto("/admin/pipelines");
  await page.getByRole("link", { name: "Delete Sales" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(/Sales has \d+ deals\. Move them to:/);
  await page.getByLabel("Move the deals to").selectOption({ label: "Ambassadors · Talking" });
  await page.getByRole("button", { name: "[ MOVE DEALS AND DELETE ]" }).click();
  await expect(page.locator("table.order td.nm")).not.toContainText(["Sales"]);
  expect(await total()).toBe(before);
  await page.goto(`/deals?pipeline=${await pipelineId("Ambassadors")}&open=${deal}`);
  await expect(dealDrawer(page)).toContainText("Ambassadors · Talking");
  await expect(history(page).first()).toContainText("Moved from Sales · Proposal to Ambassadors · Talking by Ada Fake (pipeline deleted)");

  // A pipeline with no deals: a plain confirmation.
  await page.goto("/admin/pipelines");
  await page.getByLabel("New pipeline").fill("Empty fake pipeline");
  await page.getByRole("button", { name: "[ ADD PIPELINE ]" }).click();
  await page.getByRole("link", { name: "Delete Empty fake pipeline" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete Empty fake pipeline? This can't be undone.");
  await page.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click();
  await expect(page.locator("table.order td.nm")).not.toContainText(["Empty fake pipeline"]);
});

// covers US5 scenario 7, FR-003, SC-006
test("a non-admin has no Pipelines link, sees the forbidden page, and a direct change request changes nothing", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/admin/pipelines");
  const field = await actionField(page, "[ ADD PIPELINE ]");
  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  await expect(sidebar(linus).getByRole("link", { name: "Pipelines" })).toHaveCount(0);
  await linus.goto("/admin/pipelines");
  await expect(linus.getByText("You don't have access to this page.")).toBeVisible();
  await linus.goto(`/admin/pipelines/${await pipelineId("Sales")}`);
  await expect(linus.getByText("You don't have access to this page.")).toBeVisible();
  const post = await linus.request.post("/admin/pipelines", { multipart: { [field]: "", name: "Linus's pipeline" } });
  expect(await post.text()).toContain("You don&#x27;t have access to this page.");
  expect((await db()`select 1 from pipelines where name = 'Linus''s pipeline'`).length).toBe(0);
  await ctx.close();
});
