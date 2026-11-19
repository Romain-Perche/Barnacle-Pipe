import { expect, test } from "@playwright/test";
import { closeDb, expectSignInPage, resetAndSeed, sidebar, signInAs } from "./helpers";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

// covers US4 scenario 1, FR-001
test("signed out, every app address leads to sign-in", async ({ page }) => {
  for (const path of ["/", "/admin/users", "/anything", "/deals/42"]) {
    await page.goto(path);
    await expectSignInPage(page);
  }
});

// covers US4 scenario 2, FR-019, FR-020, FR-021
test("home and Users share the sidebar; the current link is highlighted", async ({ page }) => {
  await signInAs(page, "Ada Fake");
  for (const [path, current] of [
    ["/", "Home"],
    ["/admin/users", "Users"],
  ] as const) {
    await page.goto(path);
    const side = sidebar(page);
    await expect(side.getByText("BARNACLE_LABS")).toBeVisible();
    await expect(side.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(side.getByText(/\/\/\s*Admin/i)).toBeVisible();
    await expect(side.getByText("Ada Fake")).toBeVisible();
    await expect(side.getByRole("button", { name: /sign out/i })).toBeVisible();
    await expect(side.getByRole("link", { name: current })).toHaveAttribute("aria-current", "page");
    const other = current === "Home" ? "Users" : "Home";
    await expect(side.getByRole("link", { name: other })).not.toHaveAttribute("aria-current", "page");
  }
});

// covers edge case "unknown address while signed in"
test("an unknown address shows Page not found. inside the sidebar, with a link to Home", async ({ page }) => {
  await signInAs(page, "Linus Fake");
  const res = await page.goto("/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Page not found.")).toBeVisible();
  await expect(sidebar(page)).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: /home/i }).click();
  await expect(page.getByRole("heading", { name: "Hello, Linus" })).toBeVisible();
});

// covers FR-009 (no open redirect)
test("an outside next address signs in to home", async ({ page }) => {
  await page.goto("/sign-in?next=//evil.com");
  await page.getByRole("link", { name: "[ FAKE GOOGLE LOGIN ]" }).click();
  await page.getByRole("button", { name: /^Ada Fake/ }).click();
  await expect(page).toHaveURL("http://localhost:3000/");
});

// covers FR-023 (look of the sign-in page)
test("the sign-in page uses the app's design", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByText("BARNACLE_LABS")).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(250, 246, 241)");
});
