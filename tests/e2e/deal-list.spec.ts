// covers SF-95 US3 scenarios 1–6, FR-009–FR-013, Edge Cases (page past the last; unknown values; empty list)
import { expect, test, type Page } from "@playwright/test";
import type postgres from "postgres";
import { templates } from "@/server/messages";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { dealDrawer, pipelineId } from "./deals";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

const titleLinks = (page: Page) => page.locator("tbody tr td:first-child a.nm");

// What the list should show for Linus, from the database: open (or every status), non-archived, visible deals.
type Fragment = postgres.PendingQuery<postgres.Row[]>;
async function expected(where: Fragment, order: Fragment) {
  const rows = await db()<{ title: string; value: string | null }[]>`
    select d.title, d.value_pence as value from deals d join stages s on s.id = d.stage_id join pipelines p on p.id = s.pipeline_id
    where d.archived_at is null and (not d.private or d.created_by = (select id from users where name = 'Linus Fake')
          or d.owner_id = (select id from users where name = 'Linus Fake')) and ${where}
    order by ${order}`;
  const total = rows.reduce((n, r) => n + Number(r.value ?? 0), 0);
  return { titles: rows.map((r) => r.title), count: templates.deal_list_count(rows.length, total) };
}

test("Board ⇄ List; filter by pipeline and owner, sort by value, count and total; reload keeps it; closed deals; clear", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals");
  await page.getByRole("link", { name: "[ LIST ]" }).click();
  await expect(page).toHaveURL(/\/deals\/list$/);
  await expect(page.getByRole("link", { name: "[ LIST ]" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deals");
  const all = await expected(db()`d.status = 'open'`, db()`d.created_at desc, d.id desc`);
  await expect(page.locator(".head-r .count")).toHaveText(all.count);
  await expect(titleLinks(page)).toHaveText(all.titles.slice(0, 50));
  for (const h of ["Title", "Value", "Organisation", "Main person", "Pipeline · Stage", "Owner", "Expected close", "Date added"]) {
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${h}`) })).toBeVisible();
  }

  await page.getByLabel("Pipeline", { exact: true }).selectOption({ label: "Sales" });
  await expect(page).toHaveURL(/pipeline=\d+/);
  await page.getByLabel("Owner", { exact: true }).selectOption({ label: "Ada Fake" });
  await expect(page).toHaveURL(/owner=\d+/);
  await page.getByLabel("Sort by").selectOption({ label: "Sort: value" });
  await expect(page).toHaveURL(/sort=value/);
  const sales = await pipelineId("Sales");
  const filtered = await expected(
    db()`d.status = 'open' and p.id = ${sales} and d.owner_id = (select id from users where name = 'Ada Fake')`,
    db()`d.value_pence desc nulls last, d.id desc`,
  );
  expect(filtered.titles.length).toBeGreaterThan(1);
  await expect(titleLinks(page)).toHaveText(filtered.titles);
  await expect(page.locator(".head-r .count")).toHaveText(filtered.count);
  await page.reload();
  await expect(titleLinks(page)).toHaveText(filtered.titles);
  await expect(page.getByLabel("Pipeline", { exact: true })).toHaveValue(String(sales));

  await page.getByLabel("Show closed deals").check();
  await expect(page).toHaveURL(/closed=1/);
  const withClosed = await expected(
    db()`p.id = ${sales} and d.owner_id = (select id from users where name = 'Ada Fake')`,
    db()`d.value_pence desc nulls last, d.id desc`,
  );
  await expect(titleLinks(page)).toHaveText(withClosed.titles);
  await expect(page.locator(".head-r .count")).toHaveText(withClosed.count);
  await expect(page.locator("tbody tr").filter({ hasText: "Fakeco newsletter (won)" }).locator(".badge.won")).toHaveText("Won");
  await expect(page.locator("tbody tr").filter({ hasText: "Lorem Logistics pilot (lost)" }).locator(".badge.lost")).toHaveText("Lost");
  await page.getByLabel("Status").selectOption({ label: "Lost" });
  await expect(page).toHaveURL(/status=lost/);
  await expect(titleLinks(page)).toHaveText(["Lorem Logistics pilot (lost)"]);

  await page.getByRole("link", { name: "[ CLEAR ]" }).click();
  await expect(page).toHaveURL(/\/deals\/list$/);
  await expect(page.locator(".head-r .count")).toHaveText(all.count);
  await page.getByRole("link", { name: "[ BOARD ]" }).click();
  await expect(page).toHaveURL(/\/deals$/);
  await expect(page.getByRole("link", { name: "[ BOARD ]" })).toHaveAttribute("aria-current", "page");
});

test("a row opens the drawer; the title opens the deal page; a closed deal's drawer has its status and no Move to", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals/list?closed=1&q=newsletter");
  const row = page.locator("tbody tr").filter({ hasText: "Fakeco newsletter (won)" });
  await row.locator("td").nth(1).click();
  await expect(page).toHaveURL(/open=\d+/);
  await expect(dealDrawer(page)).toContainText("Fakeco newsletter (won)");
  await expect(dealDrawer(page)).toContainText("Won ·");
  await expect(dealDrawer(page).getByText("Move to")).toHaveCount(0);
  await row.getByRole("link", { name: "Fakeco newsletter (won)", exact: true }).click();
  await expect(page).toHaveURL(/\/deals\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fakeco newsletter (won)");
});

test("invalid address values are ignored and never shown; a page past the last shows the last; empty results", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals/list?sort=evil&stage=abc&dir=sideways&status=hacked&page=999&q=");
  await expect(page.getByLabel("Sort by")).toHaveValue("added");
  const text = await page.locator("main").innerText();
  for (const bad of ["evil", "sideways", "hacked"]) expect(text).not.toContain(bad);
  const [{ n }] = await db()<{ n: number }[]>`
    select count(*)::int as n from deals d where d.status = 'open' and d.archived_at is null
      and (not d.private or d.created_by = (select id from users where name = 'Linus Fake') or d.owner_id = (select id from users where name = 'Linus Fake'))`;
  if (n <= 50) await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(n <= 50 ? n : n - 50);

  await page.goto("/deals/list?q=zzzz-no-such-deal");
  await expect(page.getByText("No deals match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "[ CLEAR FILTERS ]" }).click();
  await expect(page).toHaveURL(/\/deals\/list$/);

  await db()`delete from deals`;
  await page.goto("/deals/list");
  await expect(page.getByText("No deals yet.")).toBeVisible();
});

// covers SF-95 FR-013, US3 scenario 5, Edge Cases (unknown owner or label)
test("an unknown owner or label in the address is ignored", async ({ page }) => {
  await signInAs(page, "Linus Fake", "/deals/list");
  const count = (await page.locator(".head-r .count").textContent()) ?? "";
  const firstRows = await titleLinks(page).allInnerTexts();
  for (const [param, label, any] of [["owner", "Owner", "Any owner"], ["label", "Label", "Any label"]]) {
    await page.goto(`/deals/list?${param}=99999`);
    await expect(page.locator(".head-r .count")).toHaveText(count);
    expect(await titleLinks(page).allInnerTexts()).toEqual(firstRows);
    await expect(page.getByLabel(label).locator("option:checked")).toHaveText(any);
    await expect(page.getByText("No deals match these filters.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "[ CLEAR ]", exact: true })).toHaveCount(0);
  }
});
