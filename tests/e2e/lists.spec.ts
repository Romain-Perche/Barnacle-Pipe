import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { drawer, personId, row } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

async function names(page: import("@playwright/test").Page) {
  return page.locator("tbody tr td:first-child a.nm").allTextContents();
}

// covers US3 scenarios 1, 2 and 3, FR-012, FR-014
test("filters and sort change rows and count; the address reproduces the view; no match offers CLEAR FILTERS", async ({ page, context }) => {
  await signInAs(page, "Ada Fake", "/people");
  // Filter row above the table.
  const search = page.getByRole("search");
  const table = page.locator("table.list");
  expect((await search.boundingBox())!.y).toBeLessThan((await table.boundingBox())!.y);
  for (const h of ["Name", "Organisation", "Role", "Owner", "Labels", "Lead source", "Consent", "Last contacted"]) {
    await expect(page.getByRole("columnheader", { name: h })).toBeVisible();
  }
  const [{ n }] = await db()`select count(*)::int as n from persons p join users u on u.id = p.created_by
                              where p.archived_at is null and (not p.private or u.name = 'Ada Fake')`;
  await expect(page.getByText(`// ${n} PEOPLE`)).toBeVisible();
  // Name A–Z with the main email beneath.
  const all = await names(page);
  expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
  await expect(row(page, "Abe Example")).toContainText("abe.example@example.com");

  await page.getByLabel("Lead source").selectOption({ label: "Exec dinner" });
  await expect(page).toHaveURL(/source=\d+/);
  await page.getByLabel("Owner").selectOption({ label: "Ada Fake" });
  await expect(page).toHaveURL(/owner=\d+/);
  await page.getByLabel("Sort by").selectOption("added");
  await expect(page).toHaveURL(/sort=added/);
  const expected = await db()<{ name: string }[]>`
    select p.first_name || ' ' || p.last_name as name from persons p
    join lead_sources s on s.id = p.lead_source_id join users u on u.id = p.owner_id
    where s.name = 'Exec dinner' and u.name = 'Ada Fake' and p.archived_at is null order by p.created_at, p.id`;
  expect(expected.length).toBeGreaterThan(0);
  expect(await names(page)).toEqual(expected.map((r) => r.name));
  await expect(page.getByText(`// ${expected.length} ${expected.length === 1 ? "PERSON" : "PEOPLE"}`)).toBeVisible();
  for (const r of await page.locator("tbody tr").all()) {
    await expect(r).toContainText("Exec dinner");
    await expect(r).toContainText("Ada Fake");
  }

  const copy = await context.newPage();
  await copy.goto(page.url());
  expect(await names(copy)).toEqual(expected.map((r) => r.name));
  await copy.close();

  await page.getByLabel("Search people").fill("zz-nobody-zz");
  await page.getByLabel("Search people").press("Enter");
  await expect(page.getByText("No people match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "[ CLEAR FILTERS ]" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByText(`// ${n} PEOPLE`)).toBeVisible();
});

// covers US3 scenario 5, FR-015
test("Show archived shows archived people marked Archived; unticked they are hidden from list and search", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/people?q=Fay");
  await expect(page.getByText("No people match these filters.")).toBeVisible();
  await page.getByLabel("Show archived").check();
  await expect(page).toHaveURL(/archived=1/);
  await expect(row(page, "Fay Mockup")).toContainText("Archived");
  await page.getByLabel("Show archived").uncheck();
  await expect(page.getByText("No people match these filters.")).toBeVisible();
});

// covers US3 scenarios 6 and 8, FR-014, FR-028
test("selecting a row opens the preview drawer; CLOSE keeps filters and sort; reload keeps the drawer", async ({ page }) => {
  await signInAs(page, "Ada Fake", "/people?consent=subscribed&sort=organisation");
  await row(page, "Bob Placeholder").getByRole("cell").nth(2).click();
  await expect(page).toHaveURL(/open=\d+/);
  await expect(row(page, "Bob Placeholder")).toHaveAttribute("aria-selected", "true");
  const d = drawer(page);
  for (const t of ["Bob Placeholder", "Example Gyms Fake", "CEO", "bob.placeholder@example.net", "Referral", "Subscribed"]) await expect(d).toContainText(t);
  await page.reload();
  await expect(drawer(page)).toContainText("Bob Placeholder");
  await d.getByRole("link", { name: "[ CLOSE ]" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/consent=subscribed/);
  await expect(page).toHaveURL(/sort=organisation/);
  await expect(page).not.toHaveURL(/open=/);

  await row(page, "Abe Example").getByRole("cell").nth(6).click();
  await drawer(page).getByRole("link", { name: "[ OPEN PAGE ]" }).click();
  await expect(page).toHaveURL(`/people/${await personId("Abe Example")}`);
  await page.goBack();
  await row(page, "Abe Example").getByRole("link", { name: "Abe Example", exact: true }).click();
  await expect(page).toHaveURL(`/people/${await personId("Abe Example")}`);
});

// covers edge cases "more than 50 matches" and "page beyond the last"
test("more than 50 people: 50 rows, the total and a next page; a page beyond the last shows the last", async ({ page }) => {
  const [ada] = await db()`select id from users where name = 'Ada Fake'`;
  await db()`insert into persons (first_name, last_name, owner_id, created_by)
             select 'Zz', 'Bulk ' || lpad(g::text, 2, '0'), ${ada.id}, ${ada.id} from generate_series(1, 40) g`;
  await signInAs(page, "Ada Fake", "/people");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await page.getByRole("link", { name: "[ NEXT ]" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  const second = await page.locator("tbody tr").count();
  await page.goto("/people?page=999");
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(second);
});
