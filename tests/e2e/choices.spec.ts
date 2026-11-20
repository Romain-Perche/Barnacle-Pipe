import { expect, test } from "@playwright/test";
import { seedUsers } from "@/seed/users";
import { closeDb, db, emptyDb, resetAndSeed, sidebar, signInAs } from "./helpers";
import { actionField, details, personId } from "./records";

test.afterAll(closeDb);

const PAGE = "/admin/lead-sources-and-labels";

// covers US6 scenario 1, FR-021
test("a fresh CRM lists the six lead sources and no labels", async ({ page }) => {
  await emptyDb();
  await seedUsers(db());
  await signInAs(page, "Ada Fake", PAGE);
  const sources = page.getByRole("region", { name: "Lead sources" });
  for (const n of ["Duncan's LinkedIn", "Referral", "Exec dinner", "Inbound", "Event", "Ambassador"]) {
    await expect(sources.getByLabel(`Name of ${n}`)).toHaveValue(n);
  }
  const labels = page.getByRole("region", { name: "Labels", exact: true });
  await expect(labels.getByLabel("New label")).toBeVisible();
  await expect(labels.locator("tbody tr")).toHaveCount(0);
});

// covers US6 scenarios 2–4, FR-020, FR-022
test("an admin renames Event, adds a label, removes Inbound; users see the effects", async ({ page, browser }) => {
  await resetAndSeed();
  await signInAs(page, "Ada Fake", PAGE);
  await page.getByLabel("Name of Event").fill("Events");
  await page.getByRole("button", { name: "Rename Event" }).click();
  await expect(page.getByLabel("Name of Events")).toBeVisible();
  await page.getByLabel("New label").fill(" VIP ");
  await page.getByRole("region", { name: "Labels", exact: true }).getByRole("button", { name: "[ ADD ]" }).click();
  await expect(page.getByLabel("Name of VIP")).toBeVisible();
  await page.getByRole("button", { name: "Remove Inbound" }).click();
  await expect(page.getByLabel("Name of Inbound")).toHaveCount(0);
  await page.getByLabel("New lead source").fill("referral");
  await page.getByRole("region", { name: "Lead sources" }).getByRole("button", { name: "[ ADD ]" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("This name is already on the list.");

  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  await linus.goto(`/people/${await personId("Eve Dummy")}`);
  await expect(details(linus)).toContainText("Events");
  await linus.goto(`/people/${await personId("Dev Sample")}`);
  await expect(details(linus)).toContainText("Inbound");
  await linus.goto("/people/new");
  await expect(linus.getByLabel("Lead source").locator("option", { hasText: "Inbound" })).toHaveCount(0);
  await expect(linus.getByLabel("VIP")).toBeVisible();
  await linus.goto("/people");
  await expect(linus.getByRole("combobox", { name: "Lead source" }).locator("option", { hasText: "Inbound" })).toHaveCount(1);
  await ctx.close();
});

// covers US6 scenario 5, FR-023, SC-006
test("a user cannot open the page, has no sidebar link, and a replayed change does nothing", async ({ page, browser }) => {
  await resetAndSeed();
  await signInAs(page, "Ada Fake", PAGE);
  const field = await actionField(page, "Remove Inbound");
  const inbound = (await db()`select id::int as id from lead_sources where name = 'Inbound'`)[0].id;

  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake", PAGE);
  await expect(linus.getByRole("heading", { name: "You don't have access to this page." })).toBeVisible();
  await expect(sidebar(linus).getByRole("link", { name: "Lead sources and labels" })).toHaveCount(0);
  const res = await linus.request.post(PAGE, { multipart: { [field]: "", id: String(inbound) } });
  expect(await res.text()).toContain("You don&#x27;t have access to this page.");
  const [{ removed }] = await db()`select removed_at is not null as removed from lead_sources where id = ${inbound}`;
  expect(removed).toBe(false);
  await ctx.close();
});
