// covers SF-95 US5 scenarios 1–6, FR-016–FR-018, Edge Cases (a removed deal label stays on its deal and in the filter)
import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, pageAlert, resetAndSeed, signInAs } from "./helpers";
import { history, insertDeal } from "./deals";
import { save } from "./records";

test.beforeEach(async () => {
  await resetAndSeed();
  await db()`delete from deals where title in ('Fakeco website', 'Mock Labs audit')`;
  await db()`delete from deal_label_links`;
  await db()`delete from deal_labels`;
});
test.afterAll(closeDb);

const ADMIN = "/admin/lead-sources-and-labels";
const dealLabels = (page: Page) => page.getByRole("region", { name: "Deal labels" });
const details = (page: Page) => page.getByRole("region", { name: "Details" });

// Adds and waits for the page to come back (the form is a server action that redirects to the page).
async function addDealLabel(page: Page, name: string) {
  await dealLabels(page).getByLabel("New deal label").fill(name);
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), dealLabels(page).getByRole("button", { name: "[ ADD ]" }).click()]);
  await expect(dealLabels(page).getByLabel("New deal label")).toHaveValue("");
}

test("admins keep a separate deal label list; labels on a deal; a removed one stays where it is", async ({ page }) => {
  const a = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake" });
  const b = await insertDeal({ title: "Mock Labs audit", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake" });
  await signInAs(page, "Ada Fake", ADMIN);
  await addDealLabel(page, "Hot");
  await expect(dealLabels(page).getByLabel("Name of Hot")).toBeVisible();
  await addDealLabel(page, "Big fake ticket");
  await addDealLabel(page, " hot ");
  await expect(pageAlert(page)).toHaveText("This name is already used.");
  // The people labels are a list of their own (the seed has a people label "Hot" too).
  await expect(page.getByRole("region", { name: "Labels", exact: true }).getByLabel("Name of Big fake ticket")).toHaveCount(0);

  await page.goto("/people/new");
  await expect(page.getByRole("checkbox", { name: "Investor" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Big fake ticket" })).toHaveCount(0);

  await page.goto(`/deals/${a}`);
  await page.getByRole("link", { name: "[ EDIT ]" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${a}/edit\\?back=page$`));
  await expect(page.getByRole("checkbox", { name: "Investor" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Hot" }).check();
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/deals/${a}$`));
  await expect(details(page)).toContainText("Hot");
  await expect(history(page).first()).toContainText("Edited by Ada Fake: Labels");

  await page.goto("/deals/list");
  await page.getByLabel("Label", { exact: true }).selectOption({ label: "Hot" });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Fakeco website");
  await expect(page.locator("tbody tr")).toContainText("Hot");

  // The admin removes "Hot": deal A keeps it everywhere; deal B's form no longer offers it.
  await page.goto(ADMIN);
  await dealLabels(page).getByRole("button", { name: "Remove Hot" }).click();
  await expect(dealLabels(page).getByLabel("Name of Hot")).toHaveCount(0);
  await page.goto(`/deals/${a}`);
  await expect(details(page)).toContainText("Hot");
  await page.goto("/deals/list");
  await page.getByLabel("Label", { exact: true }).selectOption({ label: "Hot" });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Fakeco website");
  await page.goto(`/deals/${b}/edit?back=page`);
  await expect(page.getByRole("checkbox", { name: "Big fake ticket" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Hot" })).toHaveCount(0);
  await page.goto(`/deals/${a}/edit?back=page`);
  await expect(page.getByRole("checkbox", { name: "Hot" })).toBeChecked();
});

test("link and unlink other people, refuse the main person, follow and unfollow", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", person: "Abe Example" });
  await signInAs(page, "Ada Fake", `/deals/${id}`);
  await page.getByRole("combobox", { name: "Person" }).fill("Bob Pla");
  await page.getByRole("listbox", { name: "People" }).getByRole("button", { name: "Bob Placeholder", exact: true }).click();
  await page.getByRole("button", { name: "[ LINK PERSON ]" }).click();
  const others = page.getByRole("list", { name: "Other people" });
  await expect(others.getByRole("link", { name: "Bob Placeholder" })).toHaveAttribute("href", /\/people\/\d+$/);
  await expect(history(page).first()).toContainText("Linked Bob Placeholder by Ada Fake");

  await page.getByRole("combobox", { name: "Person" }).fill("Abe Example");
  await page.getByRole("button", { name: "[ LINK PERSON ]" }).click();
  await expect(pageAlert(page)).toHaveText("This person is already linked to this deal.");
  await expect(others.getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "Unlink Bob Placeholder" }).click();
  await expect(others.getByRole("listitem")).toHaveCount(0);
  await expect(history(page).first()).toContainText("Unlinked Bob Placeholder by Ada Fake");

  await page.getByRole("button", { name: "[ FOLLOW ]" }).click();
  await expect(page.getByRole("button", { name: "[ UNFOLLOW ]" })).toBeVisible();
  await expect(details(page)).toContainText("Ada Fake");
  await page.getByRole("button", { name: "[ UNFOLLOW ]" }).click();
  await expect(page.getByRole("button", { name: "[ FOLLOW ]" })).toBeVisible();
  const events = await db()`select 1 from timeline_events where deal_id = ${id} and kind not in ('added', 'person_linked', 'person_unlinked')`;
  expect(events.length).toBe(0);
});

test("a linked person private to someone else is never shown; non-admins cannot open the labels page", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake" });
  await db()`insert into deal_people (deal_id, person_id) select ${id}, id from persons where first_name = 'Gus' and last_name = 'Lorem'`;
  await db()`insert into timeline_events (deal_id, kind, actor_id, related_person_id)
             select ${id}, 'person_linked', (select id from users where name = 'Ada Fake'), id from persons where first_name = 'Gus' and last_name = 'Lorem'`;
  await signInAs(page, "Linus Fake", `/deals/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fakeco website");
  expect(await page.locator("main").innerText()).not.toContain("Gus Lorem");
  await expect(page.getByRole("list", { name: "Other people" }).getByRole("listitem")).toHaveCount(0);

  await page.goto(ADMIN);
  await expect(page.getByText("You don't have access to this page.")).toBeVisible();
  await expect(dealLabels(page)).toHaveCount(0);
});
