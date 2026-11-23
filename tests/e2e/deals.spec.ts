import { expect, test } from "@playwright/test";
import { templates } from "@/server/messages";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { card, column, columnTotal, dealDrawer, dealId, expectHeader, history, insertDeal, pipelineId, stageId } from "./deals";
import { actionField, pickOrganisation, save } from "./records";

test.beforeEach(async () => {
  await resetAndSeed();
  // The scenarios add their own "Fakeco website"; the fake data has one too.
  await db()`delete from deals where title = 'Fakeco website'`;
});
test.afterAll(closeDb);

// Saves and waits for the server's answer (the form is rebuilt with the typed values on a refusal).
async function submit(page: import("@playwright/test").Page) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), save(page)]);
}

async function pickPerson(page: import("@playwright/test").Page, typed: string, option: string) {
  await page.getByRole("combobox", { name: "Person" }).fill(typed);
  await page.getByRole("listbox", { name: "People" }).getByRole("button", { name: option, exact: true }).click();
}

// covers US2 scenarios 1, 2, 4, FR-005, FR-006
test("a user adds a deal from the board; + on a column picks its stage", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals");
  const before = await columnTotal(page, "Proposal").textContent();
  await page.getByRole("link", { name: "Add a deal to Qualified" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/new\\?pipeline=${await pipelineId("Sales")}&stage=${await stageId("Sales", "Qualified")}`));
  await expect(page.getByLabel("Pipeline")).toHaveValue(String(await pipelineId("Sales")));
  await expect(page.getByLabel("Stage")).toHaveValue(String(await stageId("Sales", "Qualified")));
  await expect(page.locator('select[name="ownerId"]')).toHaveValue(String((await db()`select id::int as id from users where name = 'Linus Fake'`)[0].id));

  await page.getByLabel("Title").fill("Fakeco website");
  await page.getByLabel("Value (£)").fill("4000");
  await pickOrganisation(page, "Fakeco", "Fakeco Ltd");
  await pickPerson(page, "Abe Ex", "Abe Example");
  await page.getByLabel("Stage").selectOption({ label: "Proposal" });
  await save(page);
  await expect(page).toHaveURL(/open=\d+$/);
  const id = await dealId("Fakeco website");
  await expect(page).toHaveURL(new RegExp(`/deals\\?pipeline=${await pipelineId("Sales")}&open=${id}$`));
  const first = column(page, "Proposal").locator("a.card").first();
  await expect(first).toContainText("Fakeco website");
  await expect(first).toContainText("Fakeco Ltd");
  await expect(first).toContainText("Abe Example");
  await expect(first).toContainText("£4,000");
  await expect(columnTotal(page, "Proposal")).not.toHaveText(before!);
  await expectHeader(page, "Sales", "Proposal", "Linus Fake");
  await expect(dealDrawer(page)).toContainText("Linus Fake");
  await expect(history(page).first()).toContainText("Added by Linus Fake");

  // FR-006: a person with an organisation and no organisation chosen → the person's organisation.
  await page.goto("/deals/new");
  await page.getByLabel("Title").fill("Person's organisation deal");
  await pickPerson(page, "Bob", "Bob Placeholder");
  await save(page);
  await expect(page).toHaveURL(/open=\d+$/);
  const [row] = await db()<{ match: boolean }[]>`
    select d.organisation_id = p.organisation_id and d.organisation_id is not null as match
    from deals d join persons p on p.id = d.person_id where d.title = 'Person''s organisation deal'`;
  expect(row.match).toBe(true);
});

// covers US2 scenario 3, US2 scenario 5
test("an empty title or a value that is not money is refused next to the field, keeping what was typed", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals/new");
  const deals = async () => (await db()<{ n: number }[]>`select count(*)::int as n from deals`)[0].n;
  const n = await deals();
  await page.getByLabel("Value (£)").fill("-5");
  await page.getByRole("combobox", { name: "Organisation" }).fill("Brand New Fakeco");
  await submit(page);
  await expect(page.getByText("Enter a deal title.")).toBeVisible();
  await expect(page.getByText("Enter a value in pounds, for example 4000 or 4000.50.")).toBeVisible();
  await expect(page.getByLabel("Value (£)")).toHaveValue("-5");
  await expect(page.getByRole("combobox", { name: "Organisation" })).toHaveValue("Brand New Fakeco");
  expect(await deals()).toBe(n);
  for (const value of ["abc", "4.001"]) {
    await page.getByLabel("Title").fill("Fakeco website");
    await page.getByLabel("Value (£)").fill(value);
    await submit(page);
    await expect(page.getByText("Enter a value in pounds, for example 4000 or 4000.50.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Fakeco website");
  }
  // A new organisation name typed in the field is created, as on the person form.
  await page.getByLabel("Value (£)").fill("£4,000.50");
  await submit(page);
  await expect(card(page, "Fakeco website")).toContainText("£4,000.50");
  await expect(card(page, "Fakeco website")).toContainText("Brand New Fakeco");
  expect((await db()`select 1 from organisations where name = 'Brand New Fakeco'`).length).toBe(1);
});

// covers US4 scenarios 1–4, FR-014, FR-008
test("selecting a card opens the drawer; edit, archive and delete from it", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 400000, organisation: "Fakeco Ltd", person: "Abe Example" });
  await signInAs(page, "Ada Fake", "/deals");
  await card(page, "Fakeco website").click();
  await expect(page).toHaveURL(new RegExp(`open=${id}`));
  const drawer = dealDrawer(page);
  await expect(drawer.getByRole("heading", { name: "Fakeco website" })).toBeVisible();
  await expect(drawer).toContainText("Sales · Qualified");
  await expect(drawer).toContainText("£4,000");
  await expect(drawer.getByRole("link", { name: "Fakeco Ltd" })).toHaveAttribute("href", `/organisations/${(await db()`select id::int as id from organisations where name = 'Fakeco Ltd'`)[0].id}`);
  await expect(drawer.getByRole("link", { name: "Abe Example" })).toHaveAttribute("href", /\/people\/\d+$/);
  await expect(drawer).toContainText("Ada Fake");
  await expect(drawer).toContainText("// TIMELINE");
  await expect(card(page, "Fakeco website")).toHaveClass(/sel/);
  // The drawer is in the address: a reload keeps it.
  await page.reload();
  await expect(dealDrawer(page)).toBeVisible();

  await drawer.getByRole("link", { name: "[ EDIT ]" }).click();
  await expect(page).toHaveURL(`/deals/${id}/edit`);
  await expect(page.getByLabel("Pipeline")).toHaveCount(0);
  await page.getByLabel("Value (£)").fill("5000");
  await page.getByLabel("Expected close date").fill("2026-12-15");
  await save(page);
  await expect(page).toHaveURL(new RegExp(`open=${id}$`));
  await expect(card(page, "Fakeco website")).toContainText("£5,000");
  await expect(dealDrawer(page)).toContainText("£5,000");
  await expect(dealDrawer(page)).toContainText("15 Dec 2026");
  await expectHeader(page, "Sales", "Qualified", "Ada Fake");
  await expect(history(page).first()).toContainText("Edited by Ada Fake: Value, Expected close date");

  const total = await columnTotal(page, "Qualified").textContent();
  await dealDrawer(page).getByRole("button", { name: "[ ARCHIVE ]" }).click();
  await expect(dealDrawer(page)).toHaveCount(0);
  await expect(card(page, "Fakeco website")).toHaveCount(0);
  await expect(columnTotal(page, "Qualified")).not.toHaveText(total!);
  await expectHeader(page, "Sales", "Qualified", "Ada Fake");
  const [ev] = await db()<{ kind: string }[]>`select kind from timeline_events where deal_id = ${id} order by id desc limit 1`;
  expect(ev.kind).toBe("archived");
  // The archived deal's address shows the board with no drawer.
  await page.goto(`/deals?open=${id}`);
  await expect(dealDrawer(page)).toHaveCount(0);
  await page.goto("/deals?open=99999999");
  await expect(dealDrawer(page)).toHaveCount(0);

  const other = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Lead in", createdBy: "Linus Fake" });
  await page.goto(`/deals?open=${other}`);
  await dealDrawer(page).getByRole("link", { name: "[ DELETE ]" }).click();
  await expect(page.getByRole("alertdialog", { name: "Confirm delete" }).locator("p")).toHaveText(templates.delete_confirm("Fakeco website"));
  await expect(page.getByRole("alertdialog")).toHaveText(/Delete Fakeco website for good\? This can't be undone\./);
  await page.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click();
  await expect(page.getByRole("status")).toHaveText("Fakeco website was deleted.");
  expect((await db()`select 1 from deals where id = ${other}`).length).toBe(0);
  // One-shot: the page's own follow-up requests drop the cookie; then a reload shows no notice.
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === "crm_flash")).toBe(false);
  await page.reload();
  await expect(page.getByText("Fakeco website was deleted.")).toHaveCount(0);
});

// covers US4 scenario 5, FR-008, SC-006
test("a non-admin sees no DELETE, and a direct delete request is refused with nothing deleted", async ({ page, browser }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Linus Fake" });
  await signInAs(page, "Ada Fake", `/deals?open=${id}&confirm=delete`);
  const field = await actionField(page, "[ DELETE FOR GOOD ]");

  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake", `/deals?open=${id}&confirm=delete`);
  await expect(dealDrawer(linus)).toBeVisible();
  await expect(dealDrawer(linus).getByRole("link", { name: "[ DELETE ]" })).toHaveCount(0);
  await expect(linus.getByText("Delete Fakeco website for good?")).toHaveCount(0);
  const res = await linus.request.post("/deals", { multipart: { [field]: "", id: String(id) } });
  expect(await res.text()).toContain("You don&#x27;t have access to this page.");
  expect((await db()`select 1 from deals where id = ${id}`).length).toBe(1);
  await ctx.close();
});

// covers edge case "two users edit the same deal at the same time"
test("the second of two edits at once is refused and does not overwrite the first", async ({ page, browser }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 400000 });
  await signInAs(page, "Ada Fake", `/deals/${id}/edit`);
  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake", `/deals/${id}/edit`);
  await page.getByLabel("Value (£)").fill("4500");
  await save(page);
  await expect(page).toHaveURL(/open=/);
  await linus.getByLabel("Value (£)").fill("9000");
  await save(linus);
  await expect(linus.getByRole("main").getByRole("alert")).toHaveText("Someone else changed this deal while you were editing. Reload to see their changes.");
  const [row] = await db()<{ v: string }[]>`select value_pence as v from deals where id = ${id}`;
  expect(Number(row.v)).toBe(450000);
  await ctx.close();
});
