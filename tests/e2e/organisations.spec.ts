import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { details, organisationId, pickOrganisation, row, save } from "./records";

test.beforeEach(async () => {
  await resetAndSeed();
  // Scenario 1 adds "Fakeco Ltd" itself.
  await db()`delete from organisations where name = 'Fakeco Ltd'`;
});
test.afterAll(closeDb);

async function addPerson(page: import("@playwright/test").Page, first: string, role: string, org?: [string, string]) {
  await page.goto("/people/new");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill("Orgtest");
  await page.getByLabel("Role or job title").fill(role);
  if (org) await pickOrganisation(page, org[0], org[1]);
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
}

// covers US2 scenarios 1, 2, 4 and 5, FR-007, FR-008, FR-009
test("add Fakeco Ltd, link two people, refuse a second Fakeco Ltd, unlink a person", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/organisations");
  await page.getByRole("link", { name: "[ ADD ORGANISATION ]" }).click();
  await page.getByLabel("Name").fill("Fakeco Ltd");
  await page.getByLabel("Website").fill("fakeco.example");
  await page.getByLabel("Sector").fill("Fitness");
  await page.getByLabel("Size").selectOption("201–1,000");
  await page.getByLabel("Location").fill("London");
  await save(page);
  await expect(page.getByRole("heading", { name: "Fakeco Ltd" })).toBeVisible();
  await expect(details(page).getByRole("link", { name: "https://fakeco.example" })).toHaveAttribute("href", "https://fakeco.example");
  await expect(details(page).getByRole("link", { name: "https://fakeco.example" })).toHaveAttribute("rel", "noopener noreferrer");
  for (const t of ["Fitness", "201–1,000", "London", "Ada Fake"]) await expect(details(page)).toContainText(t);
  await expect(page.getByText("No people yet.")).toBeVisible();
  const orgUrl = page.url();

  await addPerson(page, "Una", "COO", ["fakeco", "Fakeco Ltd"]);
  await expect(details(page).getByRole("link", { name: "Fakeco Ltd" })).toBeVisible();
  await addPerson(page, "Vera", "CFO", ["Fakeco L", "Fakeco Ltd"]);
  await details(page).getByRole("link", { name: "Fakeco Ltd" }).click();
  await expect(page).toHaveURL(orgUrl);
  const people = page.getByRole("region", { name: "People" });
  await expect(people.locator("tbody tr")).toHaveCount(2);
  await expect(row(page, "Una Orgtest")).toContainText("COO");
  await expect(row(page, "Vera Orgtest")).toContainText("CFO");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Una Orgtest linked by Ada Fake");

  await page.goto("/organisations/new");
  await page.getByLabel("Name").fill(" fakeco ltd ");
  await save(page);
  await expect(page.getByRole("link", { name: "Fakeco Ltd already exists." })).toHaveAttribute("href", `/organisations/${await organisationId("Fakeco Ltd")}`);

  // Unlink Una: clear her organisation.
  await page.goto(orgUrl);
  await people.getByRole("link", { name: "Una Orgtest" }).click();
  await page.getByRole("link", { name: "[ EDIT ]" }).click();
  await page.getByRole("button", { name: "[ CLEAR ]" }).click();
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expect(details(page).getByRole("link", { name: "Fakeco Ltd" })).toHaveCount(0);
  await page.goto(orgUrl);
  await expect(people.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Una Orgtest unlinked by Ada Fake");
});

// covers US2 scenario 3, FR-008
test("typing a new organisation name and choosing Add organisation creates it with the person", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/people/new");
  await page.getByLabel("First name").fill("Nell");
  await page.getByRole("combobox", { name: "Organisation" }).fill("New Org");
  await page.getByRole("button", { name: "Add organisation 'New Org'" }).click();
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await details(page).getByRole("link", { name: "New Org" }).click();
  await expect(page.getByRole("heading", { name: "New Org" })).toBeVisible();
  await expect(details(page)).toContainText("Linus Fake");
  await expect(page.getByRole("region", { name: "People" })).toContainText("Nell");
});

// covers US3 scenarios 4 and 7 (Organisations list and drawer)
test("the Organisations list shows its columns, filters by sector and opens a drawer", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/organisations");
  for (const h of ["Name", "Website", "Sector", "Size", "Location", "Owner", "People"]) await expect(page.getByRole("columnheader", { name: h })).toBeVisible();
  await page.getByLabel("Sector").selectOption("Fitness");
  await expect(page).toHaveURL(/sector=Fitness/);
  await expect(page.locator("tbody tr")).toHaveCount(2); // Example Gyms Fake, Dummy Leisure Fake (the archived one is hidden)
  await row(page, "Example Gyms Fake").getByRole("cell").nth(4).click();
  await expect(page).toHaveURL(/open=\d+/);
  const d = page.getByRole("complementary", { name: "Preview" });
  for (const t of ["Example Gyms Fake", "examplegyms.example", "Fitness", "1,000+", "Manchester", "Grace Fake"]) await expect(d).toContainText(t);
  await d.getByRole("link", { name: "[ OPEN PAGE ]" }).click();
  await expect(page.getByRole("heading", { name: "Example Gyms Fake" })).toBeVisible();
});
