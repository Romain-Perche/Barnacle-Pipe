import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { runSeeders } from "@/seed";
import { resetAppTables } from "../support/reset";

let client: postgres.Sql | null = null;
export function db() {
  client ??= postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  return client;
}
export async function closeDb() {
  await client?.end();
  client = null;
}

export async function emptyDb() {
  await resetAppTables(db());
}

// Back to the fake data team of data-model.md: Ada, Grace (admins), Linus, Margaret (users), Alan (deactivated).
export async function resetAndSeed() {
  await emptyDb();
  await runSeeders(db());
}

// Signs in through the fake Google login by picking a listed fake user.
export async function signInAs(page: Page, name: string, next?: string) {
  await page.goto(next ? `/dev/fake-google?next=${encodeURIComponent(next)}` : "/dev/fake-google");
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await leftFakeLogin(page);
}

// The fake login redirects to the app or to the sign-in page; wait until it has.
async function leftFakeLogin(page: Page) {
  await page.waitForURL((url) => !url.pathname.startsWith("/dev/fake-google"));
}

// Signs in through the fake Google login with any email and name.
export async function signInTyped(page: Page, email: string, name = "") {
  await page.goto("/dev/fake-google");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "[ CONTINUE ]" }).click();
  await leftFakeLogin(page);
}

// The Users page error box (Next.js also has an empty role=alert route announcer outside <main>).
export function pageAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

export function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Sidebar" });
}

export async function expectSignInPage(page: Page) {
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
}

export function userRow(page: Page, email: string) {
  return page.getByRole("row").filter({ hasText: email });
}
