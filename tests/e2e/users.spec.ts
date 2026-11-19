import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, expectSignInPage, pageAlert, resetAndSeed, sidebar, signInAs, userRow } from "./helpers";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

const FORBIDDEN = "You don't have access to this page.";
const LAST_ADMIN = "The CRM must always have at least one active admin.";

async function rows(page: Page) {
  return page.locator("tbody tr").count();
}

// covers US2 scenario 1, FR-012
test("the Users page lists every user with name, email, role, status and last sign-in", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  await expect(page.getByText("5 USERS · 2 ADMINS")).toBeVisible();
  for (const h of ["Name", "Role", "Status", "Last sign-in"]) await expect(page.getByRole("columnheader", { name: h })).toBeVisible();
  expect(await rows(page)).toBe(5);
  await expect(userRow(page, "ada@barnacle.ai")).toContainText("Ada Fake");
  await expect(userRow(page, "ada@barnacle.ai")).toContainText("Admin");
  await expect(userRow(page, "ada@barnacle.ai")).toContainText("Active");
  // UK time, "19 Nov 2026, 09:12"
  await expect(userRow(page, "ada@barnacle.ai")).toContainText(/\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
  await expect(userRow(page, "linus@barnacle.ai")).toContainText("User");
  await expect(userRow(page, "linus@barnacle.ai")).toContainText("Never");
  await expect(userRow(page, "alan@barnacle.ai")).toContainText("Deactivated");
});

// covers US2 scenario 2, edge case "spaces trimmed", "never signed in"
test("an admin adds a user who can then sign in", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  await page.getByPlaceholder("name@barnacle.ai").fill("  New.Person@barnacle.ai  ");
  await page.getByRole("button", { name: "[ ADD USER ]" }).click();
  const row = userRow(page, "new.person@barnacle.ai");
  await expect(row).toContainText("new.person");
  await expect(row).toContainText("User");
  await expect(row).toContainText("Active");
  await expect(row).toContainText("Never");
  expect(await rows(page)).toBe(6);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto("/dev/fake-google");
  await other.getByLabel("Email").fill("new.person@barnacle.ai");
  await other.getByLabel("Name").fill("New Person");
  await other.getByRole("button", { name: "[ CONTINUE ]" }).click();
  await expect(other.getByRole("heading", { name: "Hello, New" })).toBeVisible();
  await ctx.close();
});

// covers US2 scenario 3
test("adding an outside or existing address shows the message and changes nothing", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  await page.getByPlaceholder("name@barnacle.ai").fill("x@gmail.com");
  await page.getByRole("button", { name: "[ ADD USER ]" }).click();
  await expect(pageAlert(page)).toHaveText("Only barnacle.ai addresses can be added.");
  expect(await rows(page)).toBe(5);
  await page.getByPlaceholder("name@barnacle.ai").fill("ADA@barnacle.ai");
  await page.getByRole("button", { name: "[ ADD USER ]" }).click();
  await expect(pageAlert(page)).toHaveText("This person is already a user.");
  expect(await rows(page)).toBe(5);
});

// covers US2 scenario 4, FR-014, FR-017
test("make admin: the user's next page load shows the Admin group", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  await expect(sidebar(linus).getByRole("link", { name: "Users" })).toHaveCount(0);

  await signInAs(page, "Ada Fake", "/admin/users");
  await userRow(page, "linus@barnacle.ai").getByRole("button", { name: "[ MAKE ADMIN ]" }).click();
  await expect(userRow(page, "linus@barnacle.ai")).toContainText("Admin");

  await linus.reload();
  await sidebar(linus).getByRole("link", { name: "Users" }).click();
  await expect(linus.getByRole("heading", { name: "Users" })).toBeVisible();
  await ctx.close();
});

// covers US2 scenario 5
test("remove admin: that person loses the Admin group and the Users page", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const grace = await ctx.newPage();
  await signInAs(grace, "Grace Fake");

  await signInAs(page, "Ada Fake", "/admin/users");
  await userRow(page, "grace@barnacle.ai").getByRole("button", { name: "[ REMOVE ADMIN ]" }).click();
  await expect(userRow(page, "grace@barnacle.ai")).toContainText("User");
  await expect(userRow(page, "grace@barnacle.ai")).not.toContainText("Admin");

  await grace.reload();
  await expect(sidebar(grace).getByRole("link", { name: "Users" })).toHaveCount(0);
  await grace.goto("/admin/users");
  await expect(grace.getByText(FORBIDDEN)).toBeVisible();
  await ctx.close();
});

// covers US2 scenario 5 (self) and edge case "admin removes own rights"
test("an admin removes their own rights while another admin exists", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  await userRow(page, "ada@barnacle.ai").getByRole("button", { name: "[ REMOVE ADMIN ]" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Hello, Ada" })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Users" })).toHaveCount(0);
});

// covers US2 scenario 6, FR-007, SC-005
test("deactivate: the signed-in user is removed on the next page load and cannot sign in", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  await expect(linus.getByRole("heading", { name: "Hello, Linus" })).toBeVisible();

  await signInAs(page, "Ada Fake", "/admin/users");
  await userRow(page, "linus@barnacle.ai").getByRole("button", { name: "[ DEACTIVATE ]" }).click();
  await expect(userRow(page, "linus@barnacle.ai")).toContainText("Deactivated");

  const REMOVED = "Your access has been removed. Ask an admin if this is a mistake.";
  await linus.reload();
  await expectSignInPage(linus);
  await expect(linus.getByText(REMOVED)).toBeVisible();
  await signInAs(linus, "Linus Fake");
  await expect(linus.getByText(REMOVED)).toBeVisible();
  await ctx.close();
});

// covers US2 scenario 7
test("reactivate restores the previous role and the user can sign in", async ({ page, browser }) => {
  await db()`update users set role = 'admin' where email = 'alan@barnacle.ai'`;
  await signInAs(page, "Ada Fake", "/admin/users");
  await userRow(page, "alan@barnacle.ai").getByRole("button", { name: "[ REACTIVATE ]" }).click();
  await expect(userRow(page, "alan@barnacle.ai")).toContainText("Active");
  await expect(userRow(page, "alan@barnacle.ai")).toContainText("Admin");
  const ctx = await browser.newContext();
  const alan = await ctx.newPage();
  await signInAs(alan, "Alan Fake");
  await expect(alan.getByRole("heading", { name: "Hello, Alan" })).toBeVisible();
  await ctx.close();
});

// covers US2 scenario 8, FR-016, SC-008
test("the last active admin cannot lose rights", async ({ page }) => {
  await db()`update users set role = 'user' where email = 'grace@barnacle.ai'`;
  await signInAs(page, "Ada Fake", "/admin/users");
  await userRow(page, "ada@barnacle.ai").getByRole("button", { name: "[ REMOVE ADMIN ]" }).click();
  await expect(pageAlert(page)).toHaveText(LAST_ADMIN);
  await expect(userRow(page, "ada@barnacle.ai")).toContainText("Admin");
  await expect(userRow(page, "ada@barnacle.ai")).toContainText("Active");
});

// covers edge case "own row: REMOVE ADMIN but no DEACTIVATE", FR-012 row buttons
test("row buttons follow design A", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  const own = userRow(page, "ada@barnacle.ai");
  await expect(own.getByRole("button", { name: "[ REMOVE ADMIN ]" })).toBeVisible();
  await expect(own.getByRole("button", { name: "[ DEACTIVATE ]" })).toHaveCount(0);
  await expect(userRow(page, "grace@barnacle.ai").getByRole("button", { name: "[ DEACTIVATE ]" })).toBeVisible();
  await expect(userRow(page, "linus@barnacle.ai").getByRole("button", { name: "[ MAKE ADMIN ]" })).toBeVisible();
  const off = userRow(page, "alan@barnacle.ai");
  await expect(off.getByRole("button", { name: "[ REACTIVATE ]" })).toBeVisible();
  await expect(off.getByRole("button", { name: "[ MAKE ADMIN ]" })).toHaveCount(0);
});

// covers US2 scenario 9, FR-011, SC-003
test("a non-admin gets the forbidden page and no Admin group", async ({ page }) => {
  await signInAs(page, "Margaret Fake", "/admin/users");
  await expect(page.getByText(FORBIDDEN)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(sidebar(page).getByText(/\/\/\s*Admin/i)).toHaveCount(0);
});

// covers US2 scenario 9 (direct action request), SC-003
test("a non-admin's direct action request is refused and changes no row", async ({ page, browser }) => {
  // Margaret's session cookie.
  const ctx = await browser.newContext();
  const margaret = await ctx.newPage();
  await signInAs(margaret, "Margaret Fake");
  const margaretCookie = (await ctx.cookies()).find((c) => c.name === "crm_session")!;
  await ctx.close();

  // Ada's page with the action forms, then the request is sent with Margaret's session.
  await signInAs(page, "Ada Fake", "/admin/users");
  await page.context().addCookies([{ ...margaretCookie }]);
  await userRow(page, "linus@barnacle.ai").getByRole("button", { name: "[ DEACTIVATE ]" }).click();
  await expect(page.getByText(FORBIDDEN)).toBeVisible();
  const [linus] = await db()`select status from users where email = 'linus@barnacle.ai'`;
  expect(linus.status).toBe("active");
  expect((await db()`select count(*)::int as n from user_changes where action <> 'added'`)[0].n).toBe(0);
});

// covers edge case "admins A and B, A demotes B, B (no reload) demotes A"
test("a demoted admin's stale page cannot demote the other admin", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const grace = await ctx.newPage();
  await signInAs(grace, "Grace Fake", "/admin/users");
  await signInAs(page, "Ada Fake", "/admin/users");

  await userRow(page, "grace@barnacle.ai").getByRole("button", { name: "[ REMOVE ADMIN ]" }).click();
  await expect(userRow(page, "grace@barnacle.ai")).not.toContainText("Admin");

  await userRow(grace, "ada@barnacle.ai").getByRole("button", { name: "[ REMOVE ADMIN ]" }).click();
  await expect(grace.getByText(FORBIDDEN)).toBeVisible();
  await page.reload();
  await expect(userRow(page, "ada@barnacle.ai")).toContainText("Admin");
  await ctx.close();
});

// covers FR-001 for the Users page when signed out
test("signed out, the Users page leads to sign-in", async ({ page }) => {
  await page.goto("/admin/users");
  await expectSignInPage(page);
});
