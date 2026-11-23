// covers SF-103 US1 scenarios 1–7, US3 scenarios 2 and 5, FR-002, FR-007, FR-016, FR-018, FR-020, FR-022, FR-023, and the
// edge cases "not a CSV file", "not valid UTF-8", "[ IMPORT ] twice / reload", "text from the file shown as text"
import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, expectSignInPage, resetAndSeed, signInAs } from "./helpers";
import { countPeople, details, personId, timeline } from "./records";

const CSV = "tests/fixtures/csv";

test.beforeEach(async () => {
  await resetAndSeed();
  const users = await db()<{ id: number; name: string }[]>`select id::int as id, name from users`;
  const linus = users.find((u) => u.name === "Linus Fake")!.id;
  // Two of people-20.csv's addresses are already in the CRM: one visible to Ada, one private person of Linus.
  for (const [first, email, isPrivate] of [["Dupe", "dup.one@fakeco.example", false], ["Hidden", "dup.two@fakeco.example", true]] as const) {
    const [p] = await db()<{ id: number }[]>`
      insert into persons (first_name, last_name, owner_id, created_by, private) values (${first}, 'Visiblefake', ${linus}, ${linus}, ${isPrivate}) returning id::int as id`;
    await db()`insert into person_emails (person_id, email, position) values (${p.id}, ${email}, 0)`;
  }
});
test.afterAll(closeDb);

const steps = (page: Page) => page.getByRole("list", { name: "Steps" });
const current = (page: Page) => steps(page).locator('[aria-current="step"]');
const alert = (page: Page) => page.getByRole("main").getByRole("alert");

async function chooseFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByLabel(/CSV file|Choose another file/).setInputFiles(typeof file === "string" ? `${CSV}/${file}` : file);
  await page.getByRole("button", { name: "[ NEXT ]" }).click();
}

async function toPreview(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/people/import");
  await chooseFile(page, file);
  await expect(page).toHaveURL(/\/people\/import\/\d+\/columns$/);
  await page.getByRole("button", { name: "[ PREVIEW ]" }).click();
  await expect(page).toHaveURL(/\/preview$/);
}

test("[ IMPORT CSV ] opens step 1 with the note and the example file", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people");
  await page.getByRole("link", { name: "[ IMPORT CSV ]" }).click();
  await expect(page).toHaveURL(/\/people\/import$/);
  await expect(page.getByRole("heading", { name: "Import people" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← People" })).toBeVisible();
  await expect(current(page)).toHaveText("1 FILE");
  await expect(page.getByText("A CSV file saved as UTF-8, with column headings on the first row, up to 5,000 rows.")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "[ DOWNLOAD EXAMPLE FILE ]" }).click()]);
  expect(download.suggestedFilename()).toBe("people-example.csv");
  const text = (await (await download.createReadStream()).toArray()).join("");
  expect(text).toContain("First name,Last name,Email,Phone,Organisation,Job title,Lead source,Labels,LinkedIn,Owner,Consent");
  expect(text).toContain("ada@fakeco.example");
});

test("import people-20.csv: columns, preview, back, consent, report, person page", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people/import");
  const before = await countPeople();
  await chooseFile(page, "people-20.csv");

  await expect(page).toHaveURL(/\/people\/import\/\d+\/columns$/);
  await expect(current(page)).toHaveText("2 COLUMNS");
  await expect(steps(page).getByText("1 FILE ✓")).toBeVisible();
  await expect(page.getByText("people-20.csv · 20 ROWS")).toBeVisible();
  const jobTitle = page.locator("tbody tr").filter({ has: page.locator("td.nm", { hasText: /^Job title$/ }) });
  await expect(jobTitle).toContainText("COO");
  await expect(jobTitle).toContainText("Head of Ops");
  await expect(page.getByLabel("Field for Job title")).toHaveValue("role");
  await expect(page.getByLabel("Field for Job title").locator("option:checked")).toHaveText("Role or job title");
  await expect(page.getByLabel("Field for Email")).toHaveValue("email:work");
  await page.getByLabel("Field for Job title").selectOption("skip");
  await page.getByRole("button", { name: "[ PREVIEW ]" }).click();

  await expect(current(page)).toHaveText("3 PREVIEW");
  await expect(steps(page).getByText("2 COLUMNS ✓")).toBeVisible();
  const tiles = page.locator(".tiles");
  await expect(tiles).toContainText("17");
  await expect(tiles).toContainText("Imaginary Rowing Fake, Notreal Pilates Fake");
  const notImported = page.getByRole("region", { name: "Rows not imported" });
  await expect(notImported.locator("tbody tr")).toHaveCount(3);
  await expect(notImported).toContainText("Dupe Visiblefake already has this email address.");
  await expect(notImported.getByRole("link", { name: "Dupe Visiblefake already has this email address." })).toHaveAttribute("href", /\/people\/\d+$/);
  await expect(notImported).toContainText("Enter a valid email address.");
  await expect(notImported).toContainText("Another person already has this email address.");
  await expect(page.getByRole("main")).not.toContainText("Hidden");
  const first = page.getByRole("region", { name: "First people" });
  await expect(first.locator("tbody tr")).toHaveCount(5);
  await expect(first).not.toContainText("COO");
  expect(await countPeople()).toBe(before);

  // [ BACK ] keeps the column choices.
  await page.getByRole("link", { name: "[ BACK ]" }).click();
  await expect(current(page)).toHaveText("2 COLUMNS");
  await expect(page.getByLabel("Field for Job title")).toHaveValue("skip");
  await page.getByRole("button", { name: "[ PREVIEW ]" }).click();
  await expect(current(page)).toHaveText("3 PREVIEW");

  // No consent chosen in advance: [ IMPORT ] does nothing until one is.
  await expect(page.getByText("17 people have no consent in the file.")).toBeVisible();
  await expect(page.getByLabel("Subscribed", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Unsubscribed", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "[ IMPORT ]" }).click();
  await expect(page).toHaveURL(/\/preview$/);
  expect(await countPeople()).toBe(before);
  await page.getByLabel("Subscribed", { exact: true }).check();
  await page.getByRole("button", { name: "[ IMPORT ]" }).click();

  await expect(page).toHaveURL(/\/report$/);
  await expect(current(page)).toHaveText("4 REPORT");
  await expect(steps(page).getByText("3 PREVIEW ✓")).toBeVisible();
  await expect(page.getByText("17 people imported. 2 organisations added. 3 rows not imported.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Rows not imported" }).locator("tbody tr")).toHaveCount(3);
  expect(await countPeople()).toBe(before + 17);
  // A reload adds nothing.
  await page.reload();
  await expect(page.getByText("17 people imported. 2 organisations added. 3 rows not imported.")).toBeVisible();
  expect(await countPeople()).toBe(before + 17);

  await page.getByRole("link", { name: "Go to People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await page.goto(`/people/${await personId("Brian Importfake")}`);
  const d = details(page);
  for (const text of ["brian.importfake@fakeco.example", "+44 20 7946 0002", "Fakeco Ltd", "Exec dinner", "Hot", "Investor", "Subscribed", "Never"]) {
    await expect(d).toContainText(text);
  }
  await expect(page.locator("h1 .badge", { hasText: "Private" })).toHaveCount(0);
  await expect(timeline(page).first()).toContainText("Imported from CSV by Ada Fake");
});

test("[ IMPORT ] pressed twice quickly imports once", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people/import");
  const before = await countPeople();
  await toPreview(page, "people-20.csv");
  await page.getByLabel("Unsubscribed", { exact: true }).check();
  await page.getByRole("button", { name: "[ IMPORT ]" }).dblclick();
  await expect(page.getByText("17 people imported. 2 organisations added. 3 rows not imported.")).toBeVisible();
  expect(await countPeople()).toBe(before + 17);
  const [{ n }] = await db()`select count(*)::int as n from person_emails where email = 'ada.importfake@fakeco.example'`;
  expect(n).toBe(1);
});

test("an .xlsx file and a Windows-1252 file are refused with a fixed message", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people/import");
  for (const file of ["not-csv.xlsx", "people-cp1252.csv"]) {
    await page.goto("/people/import");
    await chooseFile(page, file);
    await expect(alert(page)).toHaveText("Save the file as CSV (UTF-8) and try again.");
    await expect(page).toHaveURL(/\/people\/import$/);
  }
  const [{ n }] = await db()`select count(*)::int as n from csv_imports`;
  expect(n).toBe(0);
});

test("text from the file is shown as text, never as a link or a message of the CRM", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people/import");
  const buffer = Buffer.from('First name,Last name,Lead source,Consent\n<a href="https://evil.example">Click</a>,Fake,Your account is locked,yes\n');
  await toPreview(page, { name: "tricky.csv", mimeType: "text/csv", buffer });
  await expect(page.getByRole("link", { name: "Click" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "First people" })).toContainText('<a href="https://evil.example">Click</a> Fake');
  await expect(page.getByRole("region", { name: "Warnings" })).toHaveText(/Lead source not on the list: 'Your account is locked' \(row 2\)/);
  await page.getByRole("button", { name: "[ IMPORT ]" }).click();
  await expect(page.getByText("1 person imported. 0 organisations added. 0 rows not imported.")).toBeVisible();
  await page.goto(`/people/${await personId('<a href="https://evil.example">Click</a> Fake')}`);
  await expect(page.getByRole("heading", { name: '<a href="https://evil.example">Click</a> Fake' })).toBeVisible();
  await expect(page.getByRole("link", { name: "Click" })).toHaveCount(0);
});

// covers US3 scenarios 2, 3 and 5
test("lists, owners and consent: warnings and the consent count", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people/import");
  await toPreview(page, "lists-owners-consent.csv");
  await expect(page.getByText("4 people have no consent in the file.")).toBeVisible();
  await expect(page.getByLabel("Subscribed", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Unsubscribed", { exact: true })).not.toBeChecked();
  const warnings = page.getByRole("region", { name: "Warnings" });
  await expect(warnings).toContainText("Label not on the list: 'Cold' (row 7)");
  await page.getByLabel("Unsubscribed", { exact: true }).check();
  await page.getByRole("button", { name: "[ IMPORT ]" }).click();
  await expect(page.getByText("8 people imported. 0 organisations added. 0 rows not imported.")).toBeVisible();
  const report = page.getByRole("region", { name: "Warnings" });
  await expect(report).toContainText("Owner not found: 'Nobody Fake' (row 4). You are the owner.");
  await expect(report).toContainText("Owner not found: 'alan@barnacle.ai' (row 5). You are the owner.");
  await expect(report).toContainText("Label not on the list: 'Cold' (row 7)");
});

test("signed out, the import pages show the sign-in page", async ({ page }) => {
  await page.goto("/people/import");
  await expectSignInPage(page);
  await page.goto("/people/import/1/preview");
  await expectSignInPage(page);
  const res = await page.request.get("/people/import/example", { maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
});

test("another user's import is not found", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/people/import");
  await chooseFile(page, "people-20.csv");
  await expect(page).toHaveURL(/\/columns$/);
  const id = /\/import\/(\d+)\//.exec(page.url())![1];
  const other = await browser.newPage();
  await signInAs(other, "Linus Fake", "/people");
  for (const step of ["columns", "preview", "report"]) {
    const res = await other.goto(`/people/import/${id}/${step}`);
    expect(res?.status()).toBe(404);
  }
  await other.close();
});
