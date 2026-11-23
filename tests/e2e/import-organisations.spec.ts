// covers SF-103 US2 scenarios 1–4, FR-002, FR-019, FR-022
import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { details, organisationId, timeline } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

const current = (page: Page) => page.getByRole("list", { name: "Steps" }).locator('[aria-current="step"]');
const countOrganisations = async () => (await db()<{ n: number }[]>`select count(*)::int as n from organisations`)[0].n;

test("import organisations-10.csv from the Organisations list", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/organisations");
  const before = await countOrganisations();
  await page.getByRole("link", { name: "[ IMPORT CSV ]" }).click();
  await expect(page.getByRole("heading", { name: "Import organisations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Organisations" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "[ DOWNLOAD EXAMPLE FILE ]" }).click()]);
  expect(download.suggestedFilename()).toBe("organisations-example.csv");
  expect((await (await download.createReadStream()).toArray()).join("")).toContain("Name,Website,Sector,Size,Location,Owner");

  await page.getByLabel("CSV file").setInputFiles("tests/fixtures/csv/organisations-10.csv");
  await page.getByRole("button", { name: "[ NEXT ]" }).click();
  await expect(current(page)).toHaveText("2 COLUMNS");
  await expect(page.getByLabel("Field for Size")).toHaveValue("size");
  await page.getByRole("button", { name: "[ PREVIEW ]" }).click();

  await expect(current(page)).toHaveText("3 PREVIEW");
  await expect(page.getByText("// CONSENT")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Rows not imported" })).toContainText("Fakeco Ltd already exists.");
  await expect(page.getByRole("region", { name: "Warnings" })).toContainText("Size not recognised: 'medium' (row 5)");
  expect(await countOrganisations()).toBe(before);
  await page.getByRole("button", { name: "[ IMPORT ]" }).click();

  await expect(current(page)).toHaveText("4 REPORT");
  await expect(page.getByText("9 organisations imported. 1 row not imported.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fakeco Ltd already exists." })).toHaveAttribute("href", `/organisations/${await organisationId("Fakeco Ltd")}`);
  await expect(page.getByRole("region", { name: "Warnings" })).toContainText("Size not recognised: 'medium' (row 5)");
  expect(await countOrganisations()).toBe(before + 9);

  await page.getByRole("link", { name: "Go to Organisations" }).click();
  await page.goto(`/organisations/${await organisationId("Imaginary Gyms Fake")}`);
  for (const text of ["https://fakeco.example", "Fitness", "11–50", "London", "Ada Fake"]) await expect(details(page)).toContainText(text);
  await expect(timeline(page).first()).toContainText("Imported from CSV by Ada Fake");
});
