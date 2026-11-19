// Helpers for the people and organisation browser tests.
import { expect, type Page } from "@playwright/test";
import { db } from "./helpers";

export async function personId(name: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`
    select id::int as id from persons where btrim(first_name || ' ' || last_name) = ${name} order by id desc limit 1`;
  if (!row) throw new Error(`no person ${name}`);
  return row.id;
}

export async function organisationId(name: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from organisations where name = ${name}`;
  if (!row) throw new Error(`no organisation ${name}`);
  return row.id;
}

export async function countPeople(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`select count(*)::int as n from persons`;
  return row.n;
}

export function email(page: Page, n: number) {
  return page.getByLabel(`Email address ${n}`, { exact: true });
}
export function phone(page: Page, n: number) {
  return page.getByLabel(`Phone number ${n}`, { exact: true });
}

export async function save(page: Page) {
  await page.getByRole("button", { name: "[ SAVE ]" }).click();
}

export async function pickOrganisation(page: Page, typed: string, option: string) {
  await page.getByRole("combobox", { name: "Organisation" }).fill(typed);
  await page.getByRole("listbox", { name: "Organisations" }).getByRole("button", { name: option, exact: true }).click();
}

export function details(page: Page) {
  return page.getByRole("region", { name: "Details" });
}
export function timeline(page: Page) {
  return page.getByRole("region", { name: "Timeline" }).getByRole("listitem");
}
export function drawer(page: Page) {
  return page.getByRole("complementary", { name: "Preview" });
}
export function row(page: Page, text: string) {
  return page.locator("tbody tr").filter({ hasText: text });
}
export async function expectNotFound(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found." })).toBeVisible();
}

// The hidden action field of the form holding `button` (a server action form also works without JavaScript).
// Only the server-rendered page has it, so the page is loaded again first.
export async function actionField(page: Page, button: string): Promise<string> {
  await page.goto(page.url());
  const name = await page
    .getByRole("button", { name: button })
    .locator("xpath=ancestor::form")
    .locator('input[name^="$ACTION_ID_"]')
    .getAttribute("name");
  if (!name) throw new Error(`no action field for ${button}`);
  return name;
}
