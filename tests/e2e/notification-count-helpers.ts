// Helpers for the SF-108 browser tests: the sidebar's Notifications link, a "no full reload" marker and mentions
// saved straight in the database (the UI path of a mention is covered by mentions.spec.ts).
import { expect, type Page } from "@playwright/test";
import { db, sidebar } from "./helpers";
import { userId } from "./notes-helpers";

// Set on `window` before a navigation; a full reload would drop it.
export async function markNoReload(page: Page) {
  await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));
}
export async function expectNoReload(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1);
}

export function notificationsLink(page: Page) {
  return sidebar(page).getByRole("link", { name: /^Notifications( \(\d+\))?$/ });
}

// The Notifications link shows `n` (badge and accessible name), or no badge from 0.
export async function expectCount(page: Page, n: number) {
  const link = notificationsLink(page);
  await expect(link).toHaveAccessibleName(n > 0 ? `Notifications (${n})` : "Notifications");
  if (n > 0) await expect(link.locator(".cnt")).toHaveText(String(n));
  else await expect(link.locator(".cnt")).toHaveCount(0);
}

export type Target = { deal: number } | { person: number } | { organisation: number };

// A note by `byName` on the record mentioning `forName`, as src/server/records/notes.ts writes it. Returns its id.
export async function mention(byName: string, forName: string, target: Target): Promise<number> {
  const by = await userId(byName);
  const to = await userId(forName);
  const deal = "deal" in target ? target.deal : null;
  const person = "person" in target ? target.person : null;
  const org = "organisation" in target ? target.organisation : null;
  const [n] = await db()<{ id: number }[]>`
    insert into timeline_events (deal_id, person_id, organisation_id, kind, actor_id, body)
    values (${deal}, ${person}, ${org}, 'note', ${by}, ${`@[user:${to}] please look`}) returning id::int as id`;
  await db()`insert into note_mentions (event_id, user_id, mentioned_by) values (${n.id}, ${to}, ${by})`;
  return n.id;
}
