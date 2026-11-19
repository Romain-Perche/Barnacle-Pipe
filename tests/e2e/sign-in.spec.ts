import { expect, test } from "@playwright/test";
import { closeDb, emptyDb, expectSignInPage, resetAndSeed, sidebar, signInAs, signInTyped } from "./helpers";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

// covers US1 scenario 1, FR-001, FR-009
test("signed out, the asked page leads to sign-in and back to that page after signing in", async ({ page }) => {
  await page.goto("/admin/users");
  await expectSignInPage(page);
  await expect(page).toHaveURL(/next=%2Fadmin%2Fusers/);
  await page.getByRole("link", { name: "[ FAKE GOOGLE LOGIN ]" }).click();
  await page.getByRole("button", { name: /^Ada Fake/ }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
});

// covers US1 scenario 1 (no page asked → home)
test("signing in with no page asked lands on home", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "[ FAKE GOOGLE LOGIN ]" }).click();
  await page.getByRole("button", { name: /^Linus Fake/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

// covers US1 scenario 2, FR-022
test("home greets by first name and the sidebar shows the full name above Sign out", async ({ page }) => {
  await signInAs(page, "Linus Fake");
  await expect(page.getByRole("heading", { name: "Hello, Linus" })).toBeVisible();
  await expect(sidebar(page).getByText("Linus Fake")).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: /sign out/i })).toBeVisible();
  await expect(sidebar(page).getByText("// Admin", { exact: false })).toHaveCount(0);
});

// covers US1 scenario 3, FR-004
test("the first admin signs in on an empty system and gets the Admin group", async ({ page }) => {
  await emptyDb();
  await signInTyped(page, "Boss@Barnacle.ai", "Boss Fake");
  await expect(page.getByRole("heading", { name: "Hello, Boss" })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Users" })).toBeVisible();
  await sidebar(page).getByRole("link", { name: "Users" }).click();
  const row = page.getByRole("row").filter({ hasText: "boss@barnacle.ai" });
  await expect(row).toContainText("Admin");
  // covers US2 scenario 1 (singular header for one user and one admin)
  await expect(page.getByText("1 USER · 1 ADMIN", { exact: true })).toBeVisible();
});

// covers US1 scenario 4
test("an unlisted barnacle.ai account is refused", async ({ page }) => {
  await signInTyped(page, "someone@barnacle.ai", "Some One");
  await expectSignInPage(page);
  await expect(page.getByText("This account doesn't have access yet. Ask an admin to add you.")).toBeVisible();
  await page.goto("/");
  await expectSignInPage(page);
});

// covers US1 scenario 5
test("a non-barnacle.ai account is refused", async ({ page }) => {
  await signInTyped(page, "me@gmail.com", "Me");
  await expect(page.getByText("Only barnacle.ai Google accounts can sign in.")).toBeVisible();
  await page.goto("/");
  await expectSignInPage(page);
});

// covers edge case "sign-in cancelled"
test("cancelling the Google login shows the cancelled message with the Google button", async ({ page }) => {
  await page.goto("/dev/fake-google");
  await page.getByRole("button", { name: "[ CANCEL ]" }).click();
  await expectSignInPage(page);
  await expect(page.getByText("Sign-in was cancelled or failed. Please try again.")).toBeVisible();
});

// covers US1 scenario 6, FR-007
test("sign out ends the session: home and Users lead to sign-in", async ({ page }) => {
  await signInAs(page, "Ada Fake");
  await sidebar(page).getByRole("button", { name: /sign out/i }).click();
  await expectSignInPage(page);
  await page.goto("/");
  await expectSignInPage(page);
  await page.goto("/admin/users");
  await expectSignInPage(page);
});

// covers US1 scenario 7, FR-006
test("the session survives a browser restart (30-day cookie)", async ({ page, browser }) => {
  await signInAs(page, "Margaret Fake");
  const cookie = (await page.context().cookies()).find((c) => c.name === "crm_session")!;
  expect(cookie.httpOnly).toBe(true);
  const days = (cookie.expires - Date.now() / 1000) / 86400;
  expect(days).toBeGreaterThan(29);
  expect(days).toBeLessThanOrEqual(30.01);
  const state = await page.context().storageState();
  const reopened = await browser.newContext({ storageState: state });
  const again = await reopened.newPage();
  await again.goto("/");
  await expect(again.getByRole("heading", { name: "Hello, Margaret" })).toBeVisible();
  await reopened.close();
});

// covers edge cases "Mikey@Barnacle.ai" and "new Google name"
test("email case is ignored and a new Google name replaces the old one", async ({ page }) => {
  await signInTyped(page, "LINUS@Barnacle.ai", "Linus Renamed");
  await expect(page.getByRole("heading", { name: "Hello, Linus" })).toBeVisible();
  await expect(sidebar(page).getByText("Linus Renamed")).toBeVisible();
});

// covers edge case "already signed in opens /sign-in"
test("a signed-in user opening /sign-in goes to the app", async ({ page }) => {
  await signInAs(page, "Ada Fake");
  await page.goto("/sign-in?next=%2Fadmin%2Fusers");
  await expect(page).toHaveURL(/\/admin\/users$/);
});
