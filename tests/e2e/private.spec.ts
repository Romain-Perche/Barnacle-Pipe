import { expect, test } from "@playwright/test";
import { templates } from "@/server/messages";
import { closeDb, resetAndSeed, signInAs } from "./helpers";
import { drawer, email, expectNotFound, organisationId, personId, pickOrganisation, save } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

// covers US5 scenarios 1–4, FR-018, FR-019, FR-028, SC-005
test("a private person with no other owner is seen only by their creator, admins included", async ({ page, browser }) => {
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

// covers SF-92 US1 scenarios 1, 2, 4, 6, FR-001, FR-002, FR-003, SC-001
test("the owner of a private person sees them; giving them away hides them with a notice", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/people/new");
  await page.getByLabel("First name").fill("Owned");
  await page.getByLabel("Last name").fill("Contact");
  await email(page, 1).fill("owned@example.com");
  await pickOrganisation(page, "Fakeco", "Fakeco Ltd");
  await page.locator('select[name="ownerId"]').selectOption({ label: "Linus Fake" });
  await page.getByLabel("Private (only the creator and the owner can see this person)").check();
  await save(page);
  await expect(page.getByRole("heading", { name: /Owned Contact/ })).toContainText("Private");
  const id = await personId("Owned Contact");
  const org = await organisationId("Fakeco Ltd");

  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake", "/people?q=owned");
  await expect(linus.locator("tbody tr")).toHaveCount(1);
  await linus.goto(`/organisations/${org}`);
  await expect(linus.getByRole("region", { name: "People" })).toContainText("Owned Contact");
  await linus.goto(`/people/${id}`);
  await expect(linus.getByRole("heading", { name: /Owned Contact/ })).toContainText("Private");
  await linus.goto(`/people/${id}/edit`);
  await expect(linus.getByLabel("Private (only the creator and the owner can see this person)")).toBeChecked();
  await linus.locator('select[name="ownerId"]').selectOption({ label: "Margaret Fake" });
  await save(linus);
  await expect(linus).toHaveURL(/\/people$/);
  await expect(linus.getByRole("status")).toHaveText(templates.person_no_longer_visible("Owned Contact"));
  await linus.goto("/people?q=owned");
  await expect(linus.getByText("No people match these filters.")).toBeVisible();
  await expectNotFound(linus, `/people/${id}`);
  await ctx.close();

  const gctx = await browser.newContext();
  const grace = await gctx.newPage();
  await signInAs(grace, "Grace Fake");
  await expectNotFound(grace, `/people/${id}`);
  await gctx.close();

  // The creator still sees them, now owned by Margaret.
  await page.goto(`/people/${id}`);
  await expect(page.getByRole("region", { name: "Details" })).toContainText("Margaret Fake");
});
