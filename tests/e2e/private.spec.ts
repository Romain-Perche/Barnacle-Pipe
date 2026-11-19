import { expect, test } from "@playwright/test";
import { closeDb, resetAndSeed, signInAs } from "./helpers";
import { drawer, email, expectNotFound, organisationId, personId, pickOrganisation, save } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

// covers US5 scenarios 1–4, FR-018, FR-019, FR-028, SC-005
test("a private person is seen only by their creator, admins included", async ({ page, browser }) => {
  await signInAs(page, "Linus Fake", "/people/new");
  await page.getByLabel("First name").fill("Secret");
  await page.getByLabel("Last name").fill("Contact");
  await email(page, 1).fill("secret@example.com");
  await pickOrganisation(page, "Fakeco", "Fakeco Ltd");
  await page.getByLabel(/Private \(only/).check();
  await save(page);
  await expect(page.getByRole("heading", { name: /Secret Contact/ })).toContainText("Private");
  const id = await personId("Secret Contact");
  const org = await organisationId("Fakeco Ltd");
  await page.goto("/people?q=secret");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.goto(`/organisations/${org}`);
  await expect(page.getByRole("region", { name: "People" })).toContainText("Secret Contact");

  const ctx = await browser.newContext();
  const ada = await ctx.newPage();
  await signInAs(ada, "Ada Fake", "/people?q=secret");
  await expect(ada.getByText("No people match these filters.")).toBeVisible();
  await ada.goto(`/organisations/${org}`);
  await expect(ada.getByRole("region", { name: "People" })).not.toContainText("Secret Contact");
  await expect(ada.getByRole("region", { name: "Timeline" })).not.toContainText("Secret");
  const visibleAtOrg = await ada.getByRole("region", { name: "People" }).locator("tbody tr").count();
  await ada.goto("/organisations?q=Fakeco Ltd");
  await expect(ada.locator("tbody tr").filter({ hasText: "Fakeco Ltd" }).locator("td").last()).toHaveText(String(visibleAtOrg));
  await expectNotFound(ada, `/people/${id}`);
  await ada.goto(`/people?open=${id}`);
  await expect(drawer(ada)).toHaveCount(0);

  // An admin editing another of Linus's people is not offered "Private".
  await ada.goto(`/people/${await personId("Cleo Testperson")}/edit`);
  await expect(ada.getByLabel("First name")).toBeVisible();
  await expect(ada.getByLabel(/Private \(only/)).toHaveCount(0);

  await ada.goto("/people/new");
  await ada.getByLabel("First name").fill("Copy");
  await email(ada, 1).fill("secret@example.com");
  await save(ada);
  await expect(ada.getByText("Another person already has this email address.")).toBeVisible();
  await expect(ada.getByRole("link", { name: /already has this email/ })).toHaveCount(0);
  await ctx.close();
});
