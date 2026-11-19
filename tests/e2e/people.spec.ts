import { expect, test } from "@playwright/test";
import { formatDate } from "@/server/format";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { countPeople, details, email, personId, phone, row, save, timeline } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

// covers US1 scenarios 1, 2 and 3, FR-001, FR-002, FR-003, FR-011
test("add Ada Example, find her by her second address, edit her and see the edit on the timeline", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people");
  await page.getByRole("link", { name: "[ ADD PERSON ]" }).click();
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Example");
  await email(page, 1).fill("ada@example.com");
  await page.getByRole("button", { name: "[ ADD EMAIL ADDRESS ]" }).click();
  await email(page, 2).fill("ada.home@example.net");
  await page.getByLabel("Kind of email address 2").selectOption("personal");
  await phone(page, 1).fill("+44 20 7946 0000");
  await page.getByLabel("Role or job title").fill("COO");
  await page.getByLabel("Lead source").selectOption({ label: "Referral" });
  await save(page);

  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expect(page.getByRole("heading", { name: "Ada Example" })).toBeVisible();
  const d = details(page);
  for (const text of ["ada@example.com", "ada.home@example.net", "+44 20 7946 0000", "COO", "Referral", "Ada Fake", "Subscribed", formatDate(new Date()), "Never"]) {
    await expect(d).toContainText(text);
  }
  await expect(timeline(page).first()).toContainText("Added by Ada Fake");

  await page.getByRole("link", { name: "People", exact: true }).click();
  await page.getByLabel("Search people").fill("ada.home@example.net");
  await page.getByLabel("Search people").press("Enter");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await row(page, "Ada Example").getByRole("link", { name: "Ada Example", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ada Example" })).toBeVisible();

  await page.getByRole("link", { name: "[ EDIT ]" }).click();
  await page.getByLabel("Role or job title").fill("CEO");
  await page.getByRole("button", { name: "[ ADD PHONE NUMBER ]" }).click();
  await phone(page, 2).fill("07700 900123");
  await page.getByRole("button", { name: "Remove email address 2" }).click();
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expect(details(page)).toContainText("CEO");
  await expect(details(page)).toContainText("07700 900123");
  await expect(details(page)).not.toContainText("ada.home@example.net");
  await expect(timeline(page).first()).toContainText("Edited by Ada Fake: Role, Email addresses, Phone numbers");
  await expect(timeline(page).first()).toContainText(/\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
});

// covers US1 scenario 4
test("invalid fields show their message next to the field, keep the typed values, and save nothing", async ({ page }) => {
  const before = await countPeople();
  await signInAs(page, "Linus Fake", "/people/new");
  await email(page, 1).fill("not an email");
  await page.getByLabel("LinkedIn profile").fill("https://example.com/ada");
  await save(page);
  await expect(page.getByText("Enter a first or last name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Enter a LinkedIn profile link (linkedin.com/…).")).toBeVisible();
  await expect(email(page, 1)).toHaveValue("not an email");
  await expect(page.getByLabel("LinkedIn profile")).toHaveValue("https://example.com/ada");
  await expect(page).toHaveURL(/\/people\/new$/);
  expect(await countPeople()).toBe(before);
});

// covers US1 scenario 5, FR-004
test("another person with ADA@example.com is refused, naming and linking Ada Example", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people/new");
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Example");
  await email(page, 1).fill("ada@example.com");
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
  const id = await personId("Ada Example");
  const before = await countPeople();

  await page.goto("/people/new");
  await page.getByLabel("First name").fill("Other");
  await email(page, 1).fill(" ADA@example.com ");
  await save(page);
  const link = page.getByRole("link", { name: "Ada Example already has this email address." });
  await expect(link).toHaveAttribute("href", `/people/${id}`);
  expect(await countPeople()).toBe(before);
  await link.click();
  await expect(page.getByRole("heading", { name: "Ada Example" })).toBeVisible();
});

// covers FR-008, Fix round 1 (the organisation field saves what it shows)
test("typed organisation text is saved without choosing an option; Enter keeps a new name; CLEAR saves none", async ({ page }) => {
  const field = () => page.getByRole("combobox", { name: "Organisation" });
  await signInAs(page, "Linus Fake", "/people/new");
  await page.getByLabel("First name").fill("Nell");
  await field().fill("Brand New Org");
  await expect(page.getByText("A new organisation \u201cBrand New Org\u201d will be added.")).toBeVisible();
  await save(page);
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expect(details(page).getByRole("link", { name: "Brand New Org" })).toBeVisible();

  // Editing a person linked to Sample Studios Fake: the typed "Fake" replaces it.
  const cleo = await personId("Cleo Testperson");
  await page.goto(`/people/${cleo}/edit`);
  await expect(field()).toHaveValue("Sample Studios Fake");
  await field().fill("Fake");
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/people/${cleo}$`));
  await expect(details(page).getByRole("link", { name: "Fake", exact: true })).toBeVisible();

  // Enter on a partial match keeps the typed text as a new name.
  await page.goto(`/people/${cleo}/edit`);
  await field().fill("Sample");
  await field().press("Enter");
  await expect(field()).toHaveValue("Sample");
  await expect(page.getByText("A new organisation \u201cSample\u201d will be added.")).toBeVisible();

  // CLEAR then save: no organisation.
  await page.getByRole("button", { name: "[ CLEAR ]" }).click();
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/people/${cleo}$`));
  await expect(details(page).getByRole("link", { name: "Fake", exact: true })).toHaveCount(0);
  const [c] = await db()<{ org: number | null }[]>`select organisation_id::int as org from persons where id = ${cleo}`;
  expect(c.org).toBeNull();

  // An existing name typed with other case and spaces links that organisation; no hint, no copy.
  await page.goto(`/people/${cleo}/edit`);
  await field().fill("  sample studios fake  ");
  await expect(page.getByText(/will be added/)).toHaveCount(0);
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/people/${cleo}$`));
  await expect(details(page).getByRole("link", { name: "Sample Studios Fake" })).toBeVisible();
  await page.goto("/organisations?q=Sample Studios Fake");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
