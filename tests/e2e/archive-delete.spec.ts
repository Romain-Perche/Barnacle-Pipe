import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { actionField, details, email, expectNotFound, personId, save, timeline } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

// covers US4 scenarios 1, 2 and 5 (no button), FR-016
test("a user archives and restores a person; archived people leave the list and search", async ({ page }) => {
  await signInAs(page, "Linus Fake");
  const id = await personId("Bob Placeholder");
  await page.goto(`/people/${id}`);
  await expect(page.getByRole("link", { name: "[ DELETE ]" })).toHaveCount(0);
  await page.getByRole("button", { name: "[ ARCHIVE ]" }).click();
  await expect(page.getByRole("heading", { name: /Bob Placeholder/ })).toContainText("Archived");
  await expect(page.getByRole("button", { name: "[ RESTORE ]" })).toBeVisible();
  await expect(timeline(page).first()).toContainText("Archived by Linus Fake");
  await page.goto("/people?q=Bob Placeholder");
  await expect(page.getByText("No people match these filters.")).toBeVisible();

  await page.goto(`/people/${id}`);
  await page.getByRole("button", { name: "[ RESTORE ]" }).click();
  await expect(timeline(page).first()).toContainText("Restored by Linus Fake");
  await page.goto("/people?q=Bob Placeholder");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

// covers US4 scenarios 3 and 5 (direct request), FR-017, SC-006
test("an admin deletes Ada Example after confirming; a replayed delete from a user deletes nothing", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/people/new");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Example");
  await email(page, 1).fill("ada@example.com");
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
  const id = await personId("Ada Example");

  await page.getByRole("link", { name: "[ DELETE ]" }).click();
  await expect(page.getByText("Delete Ada Example for good? This can't be undone.")).toBeVisible();
  const field = await actionField(page, "[ DELETE FOR GOOD ]");

  // Linus replays the admin's delete form post.
  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  await linus.goto(`/people/${id}?confirm=delete`);
  await expect(linus.getByText("Delete Ada Example for good?")).toHaveCount(0);
  const res = await linus.request.post(`/people/${id}`, { multipart: { [field]: "", id: String(id) } });
  expect(await res.text()).toContain("You don&#x27;t have access to this page.");
  const [{ n }] = await db()`select count(*)::int as n from persons where id = ${id}`;
  expect(n).toBe(1);
  await ctx.close();

  await page.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByText("Ada Example was deleted.")).toBeVisible();
  await expectNotFound(page, `/people/${id}`);
});

// covers US4 scenarios 4 and 6
test("deleting an organisation leaves its people without one; an archived organisation is marked on a person", async ({ page }) => {
  await signInAs(page, "Ada Fake");
  const iris = await personId("Iris Example");
  await page.goto(`/people/${iris}`);
  await expect(details(page)).toContainText("Old Fakeco Archive");
  await expect(details(page)).toContainText("Archived");

  const cleo = await personId("Cleo Testperson");
  await page.goto(`/people/${cleo}`);
  await details(page).getByRole("link", { name: "Sample Studios Fake" }).click();
  await expect(page.getByRole("heading", { name: "Sample Studios Fake" })).toBeVisible();
  const orgUrl = page.url();
  await page.getByRole("link", { name: "[ DELETE ]" }).click();
  await page.getByRole("button", { name: "[ DELETE FOR GOOD ]" }).click();
  await expect(page).toHaveURL(/\/organisations$/);
  await expect(page.getByText("Sample Studios Fake was deleted.")).toBeVisible();
  await expectNotFound(page, new URL(orgUrl).pathname);
  await page.goto(`/people/${cleo}`);
  await expect(details(page).getByRole("link", { name: "Sample Studios Fake" })).toHaveCount(0);
});
