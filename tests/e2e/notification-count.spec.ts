// covers SF-108 FR-001–FR-007, SC-001–SC-003: the sidebar's "Notifications (n)" is right on every page opened inside
// the app (sidebar link, link inside a page, form result, back and forward), with no full reload.
// "Bob" of the spec is Linus Fake, "Ada" is Ada Fake.
import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, resetAndSeed, sidebar, signInAs } from "./helpers";
import { insertDeal } from "./deals";
import { addNote, userId } from "./notes-helpers";
import { expectCount, expectNoReload, markNoReload, mention } from "./notification-count-helpers";

const BOB = "Linus Fake";
const ADA = "Ada Fake";

test.beforeEach(async () => {
  await resetAndSeed();
  // Start every user at zero notifications (the fake data has some).
  await db()`delete from note_mentions`;
});
test.afterAll(closeDb);

const nav = (page: Page, name: string) => sidebar(page).getByRole("link", { name, exact: true });
const rowLinks = (page: Page) => page.locator("tbody tr td:first-child a.nm");

async function shared(title: string, organisation?: string) {
  return insertDeal({ title, pipeline: "Sales", stage: "Lead in", createdBy: ADA, organisation });
}

test("sidebar links, the same page's link and quick clicks show the count at that moment", async ({ page }) => {
  // covers SF-108 FR-001, FR-006, FR-007, SC-002, US1 scenarios 1 and 3, Edge Case "People then quickly Deals"
  const deal = await shared("Count deal one");
  await signInAs(page, BOB, "/deals");
  await expectCount(page, 0);
  await markNoReload(page);

  await mention(ADA, BOB, { deal });
  await nav(page, "People").click();
  await expect(page).toHaveURL(/\/people$/);
  await expectCount(page, 1);
  await expect(nav(page, "People")).toHaveAttribute("aria-current", "page");
  await expectNoReload(page);

  // US1 scenario 3: the link of the page already open.
  await mention(ADA, BOB, { deal });
  await nav(page, "People").click();
  await expectCount(page, 2);
  await expectNoReload(page);

  await mention(ADA, BOB, { deal });
  await nav(page, "Deals").click();
  await nav(page, "Organisations").click();
  await expect(page).toHaveURL(/\/organisations$/);
  await expectCount(page, 3);
  await expect(nav(page, "Organisations")).toHaveAttribute("aria-current", "page");
  await expectNoReload(page);
});

test("links inside pages show the current count", async ({ page }) => {
  // covers SF-108 FR-001, US1 scenario 2
  const deal = await shared("Count deal linked", "Fakeco Ltd");
  await signInAs(page, BOB, "/people");
  await markNoReload(page);

  // A person in the people list.
  await mention(ADA, BOB, { deal });
  await rowLinks(page).first().click();
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expectCount(page, 1);
  await expectNoReload(page);

  // A deal on the board (opens the drawer).
  await nav(page, "Deals").click();
  await expect(page.locator("a.card").first()).toBeVisible();
  await mention(ADA, BOB, { deal });
  await page.locator("a.card").filter({ hasText: "Count deal linked" }).click();
  await expect(page.getByRole("complementary", { name: "Deal" })).toBeVisible();
  await expectCount(page, 2);
  await expectNoReload(page);

  // A deal in the deal list, then a linked record on the deal page.
  await page.getByRole("link", { name: "[ LIST ]" }).click();
  await expect(page).toHaveURL(/\/deals\/list/);
  await mention(ADA, BOB, { deal });
  await rowLinks(page).filter({ hasText: "Count deal linked" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${deal}$`));
  await expectCount(page, 3);
  await mention(ADA, BOB, { deal });
  await page.getByRole("main").getByRole("link", { name: "Fakeco Ltd" }).click();
  await expect(page).toHaveURL(/\/organisations\/\d+$/);
  await expectCount(page, 4);
  await expectNoReload(page);

  // An organisation in the organisations list.
  await nav(page, "Organisations").click();
  await expect(rowLinks(page).first()).toBeVisible();
  await mention(ADA, BOB, { deal });
  await rowLinks(page).first().click();
  await expect(page).toHaveURL(/\/organisations\/\d+$/);
  await expectCount(page, 5);
  await expectNoReload(page);
});

test("the count goes down, never shows 0, reaches 13, and follows a deleted deal and a lost session", async ({ page }) => {
  // covers SF-108 FR-002, US1 scenarios 4–5, Edge Cases "never 0", "13", "deleted deal", "signed out"
  const one = await shared("Count deal kept");
  const two = await shared("Count deal hidden");
  const first = await mention(ADA, BOB, { deal: one });
  await mention(ADA, BOB, { deal: two });
  await signInAs(page, BOB, "/deals");
  await expectCount(page, 2);
  await markNoReload(page);

  // US1 scenario 4: one note deleted.
  await db()`delete from timeline_events where id = ${first}`;
  await nav(page, "People").click();
  await expectCount(page, 1);

  // US1 scenario 5: the other record made private to Ada.
  await db()`update deals set private = true where id = ${two}`;
  await nav(page, "Organisations").click();
  await expectCount(page, 0);
  await expectNoReload(page);

  // 13 unread.
  for (let i = 0; i < 13; i++) await mention(ADA, BOB, { deal: one });
  await nav(page, "Deals").click();
  await expectCount(page, 13);

  // A deal deleted after its link was shown: the not-found page, inside the layout, with the current count.
  const doomed = await shared("Count deal doomed");
  await page.goto("/deals/list");
  await markNoReload(page);
  await db()`delete from deals where id = ${doomed}`;
  await mention(ADA, BOB, { deal: one });
  await rowLinks(page).filter({ hasText: "Count deal doomed" }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${doomed}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectCount(page, 14);
  await expectNoReload(page);

  // Signed out in another tab: the sign-in page, no sidebar.
  await db()`delete from sessions where user_id = ${await userId(BOB)}`;
  // (A client navigation keeps /auth/end in the address bar while showing the sign-in page it redirects to.)
  await nav(page, "People").click();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
});

test("opening a notification and [ MARK ALL AS READ ] change the count; other pages do not", async ({ page }) => {
  // covers SF-108 US2 scenarios 1–2, FR-004
  const deal = await shared("Count deal opened");
  const other = await shared("Count deal other");
  await mention(ADA, BOB, { deal });
  await signInAs(page, BOB, "/deals");
  await mention(ADA, BOB, { deal: other });
  await markNoReload(page);
  await nav(page, "People").click();
  await expectCount(page, 2);
  await nav(page, "Notifications (2)").click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expectCount(page, 2);

  await page.getByRole("list", { name: "Notifications" }).getByRole("button", { name: /Count deal opened/ }).click();
  await expect(page).toHaveURL(new RegExp(`/deals/${deal}$`));
  await expectCount(page, 1);
  await nav(page, "Organisations").click();
  await nav(page, "People").click();
  await expectCount(page, 1);
  await expectNoReload(page);

  await nav(page, "Notifications (1)").click();
  await page.getByRole("button", { name: "[ MARK ALL AS READ ]" }).click();
  await expectCount(page, 0);
  await expectNoReload(page);
});

test("the page after Bob saves a note shows a mention saved meanwhile", async ({ page }) => {
  // covers SF-108 US2 scenario 3, FR-001 "result of a form"
  const deal = await shared("Count deal noted");
  await mention(ADA, BOB, { deal });
  await signInAs(page, BOB, `/deals/${deal}`);
  await expectCount(page, 1);
  await markNoReload(page);
  await mention(ADA, BOB, { deal });
  await addNote(page, "Call back");
  await expectCount(page, 2);
  await expectNoReload(page);
});

test("back and forward show the current count and keep the scroll position", async ({ page }) => {
  // covers SF-108 US3 scenario 1, FR-001 "back and forward", FR-007, SC-001
  const deal = await shared("Count deal history");
  await page.setViewportSize({ width: 1280, height: 400 });
  await signInAs(page, BOB, "/deals");
  await nav(page, "People").click();
  await expect(rowLinks(page).first()).toBeVisible();
  await markNoReload(page);
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await rowLinks(page).nth(10).click();
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expectCount(page, 0);

  await mention(ADA, BOB, { deal });
  await page.goBack();
  await expect(page).toHaveURL(/\/people$/);
  await expectCount(page, 1);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await mention(ADA, BOB, { deal });
  await page.goForward();
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expectCount(page, 2);
  await expectNoReload(page);
});
