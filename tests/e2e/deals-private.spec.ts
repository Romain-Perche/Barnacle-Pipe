import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { card, columnTotal, dealDrawer, dealId, expectHeader, insertDeal, pipelineId } from "./deals";
import { save } from "./records";

test.beforeEach(async () => {
  await resetAndSeed();
  await db()`delete from deals where title = 'Fakeco website'`;
});
test.afterAll(closeDb);

async function as(browser: import("@playwright/test").Browser, name: string, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAs(page, name, path);
  return page;
}

// covers US6 scenarios 1, 2, 5, FR-015, FR-016, SC-005
test("a private deal is seen and counted only by its creator and its owner, admins included", async ({ page, browser }) => {
  // Linus (A) adds a private deal and makes Margaret (B) its owner.
  await signInAs(page, "Linus Fake", "/deals/new");
  await page.getByLabel("Title").fill("Fakeco website");
  await page.getByLabel("Value (£)").fill("4000");
  await page.locator('select[name="ownerId"]').selectOption({ label: "Margaret Fake" });
  await page.getByRole("checkbox", { name: /Private/ }).check();
  await save(page);
  await expect(page).toHaveURL(/open=\d+$/);
  const id = await dealId("Fakeco website");
  await expect(card(page, "Fakeco website").locator(".badge")).toHaveText("Private");
  await expect(dealDrawer(page).getByRole("heading")).toContainText("Private");
  await expectHeader(page, "Sales", "Lead in", "Linus Fake");

  const margaret = await as(browser, "Margaret Fake", `/deals?open=${id}`);
  await expect(card(margaret, "Fakeco website").locator(".badge")).toHaveText("Private");
  await expect(dealDrawer(margaret)).toContainText("Fakeco website");
  await expectHeader(margaret, "Sales", "Lead in", "Margaret Fake");

  for (const name of ["Grace Fake", "Ada Fake"]) {
    const other = await as(browser, name, `/deals?pipeline=${await pipelineId("Sales")}&open=${id}`);
    await expect(other.getByRole("heading", { level: 1 })).toHaveText("Sales");
    await expect(card(other, "Fakeco website")).toHaveCount(0);
    await expect(dealDrawer(other)).toHaveCount(0);
    await expectHeader(other, "Sales", "Lead in", name);
    const linusHeader = await columnTotal(page, "Lead in").textContent();
    await expect(columnTotal(other, "Lead in")).not.toHaveText(linusHeader!);
    await other.context().close();
  }
  await margaret.context().close();
});

// covers US6 scenario 3 (no "Private" for someone who is neither creator nor owner)
test("the edit form offers Private only to the creator and the owner", async ({ browser }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake", owner: "Margaret Fake" });
  const grace = await as(browser, "Grace Fake", `/deals/${id}/edit`);
  await expect(grace.getByLabel("Title")).toHaveValue("Fakeco website");
  await expect(grace.getByRole("checkbox", { name: /Private/ })).toHaveCount(0);
  const margaret = await as(browser, "Margaret Fake", `/deals/${id}/edit`);
  await expect(margaret.getByRole("checkbox", { name: /Private/ })).toHaveCount(1);
  const linus = await as(browser, "Linus Fake", `/deals/${id}/edit`);
  await expect(linus.getByRole("checkbox", { name: /Private/ })).toHaveCount(1);
  for (const p of [grace, margaret, linus]) await p.context().close();
});

// covers US6 scenario 4 (a private person on a deal is never named)
test("a main person private to someone else is not shown on the card or in the drawer", async ({ browser }) => {
  // Gus Lorem is the fake data's private person, created by Ada Fake.
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", person: "Gus Lorem" });
  const linus = await as(browser, "Linus Fake", `/deals?open=${id}`);
  await expect(card(linus, "Fakeco website")).not.toContainText("Gus Lorem");
  await expect(dealDrawer(linus)).not.toContainText("Gus Lorem");
  const ada = await as(browser, "Ada Fake", `/deals?open=${id}`);
  await expect(card(ada, "Fakeco website")).toContainText("Gus Lorem");
  await expect(dealDrawer(ada)).toContainText("Gus Lorem");
  // Linus edits the deal: the hidden person is kept.
  await linus.goto(`/deals/${id}/edit`);
  await expect(linus.getByRole("combobox", { name: "Person" })).toHaveValue("");
  await linus.getByLabel("Value (£)").fill("10");
  await save(linus);
  await expect(linus).toHaveURL(/open=\d+$/);
  const [row] = await db()<{ kept: boolean }[]>`
    select person_id = (select id from persons where first_name = 'Gus' and last_name = 'Lorem') as kept from deals where id = ${id}`;
  expect(row.kept).toBe(true);
  for (const p of [linus, ada]) await p.context().close();
});

// covers US6 scenario 6, FR-016
test("an owner who hands a private deal on is told they can no longer see it", async ({ browser }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake", owner: "Margaret Fake", private: true });
  const margaret = await as(browser, "Margaret Fake", `/deals/${id}/edit`);
  await margaret.locator('select[name="ownerId"]').selectOption({ label: "Grace Fake" });
  await save(margaret);
  await expect(margaret).toHaveURL(new RegExp(`/deals\\?pipeline=${await pipelineId("Sales")}$`));
  await expect(margaret.getByRole("status")).toHaveText("You can no longer see Fakeco website: only its creator and owner can.");
  await expect(card(margaret, "Fakeco website")).toHaveCount(0);
  for (const name of ["Linus Fake", "Grace Fake"]) {
    const p = await as(browser, name, "/deals");
    await expect(card(p, "Fakeco website")).toBeVisible();
    await p.context().close();
  }
  const ada = await as(browser, "Ada Fake", "/deals");
  await expect(card(ada, "Fakeco website")).toHaveCount(0);
  await ada.context().close();
  await margaret.context().close();
});
