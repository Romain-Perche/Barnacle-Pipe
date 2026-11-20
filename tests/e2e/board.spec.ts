import { expect, test } from "@playwright/test";
import { messages } from "@/server/messages";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { card, column, columnTotal, dealDrawer, dealId, expectHeader, history, insertDeal, pipelineId } from "./deals";

test.beforeEach(async () => {
  await resetAndSeed();
  // The scenarios add their own "Fakeco website"; the fake data has one too.
  await db()`delete from deals where title = 'Fakeco website'`;
});
test.afterAll(closeDb);

const SALES = ["Lead in", "Qualified", "Proposal", "Negotiation", "Closing"];

// covers US1 scenarios 1–4, FR-009, FR-010, FR-013, FR-020, edge case "address naming an unknown pipeline"
test("the board shows the first pipeline's stages with counts, totals and cards; the picker is kept in the address", async ({ page }) => {
  await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 400000, organisation: "Fakeco Ltd", person: "Abe Example" });
  await signInAs(page, "Linus Fake");
  await page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Deals" }).click();
  await expect(page).toHaveURL(/\/deals$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales");
  await expect(page.getByLabel("Pipeline", { exact: true })).toHaveValue(String(await pipelineId("Sales")));
  await expect(page.getByRole("region").locator("h2")).toHaveText(SALES);
  for (const stage of SALES) await expectHeader(page, "Sales", stage, "Linus Fake");
  await expect(columnTotal(page, "Closing")).toHaveText("0 deals · £0");
  await expect(column(page, "Closing")).toContainText("No deals in this stage.");

  const c = card(page, "Fakeco website");
  await expect(c.locator(".t")).toHaveText("Fakeco website");
  await expect(c).toContainText("Fakeco Ltd");
  await expect(c).toContainText("Abe Example");
  await expect(c.locator(".val")).toHaveText("£4,000");
  await expect(page.getByText("No next activity")).toHaveCount(0);
  // Cards are rounded (the one rounded surface).
  expect(await c.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("8px");

  const ambassadors = await pipelineId("Ambassadors");
  await page.getByLabel("Pipeline", { exact: true }).selectOption({ label: "Ambassadors" });
  await expect(page).toHaveURL(new RegExp(`/deals\\?pipeline=${ambassadors}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ambassadors");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ambassadors");
  await expect(page.getByRole("region").locator("h2")).toHaveText(["Introduced", "Talking", "Active"]);

  await page.goto("/deals?pipeline=abc&open=xyz&error=Hello%20there");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales");
  await expect(page.getByText("abc")).toHaveCount(0);
  await expect(page.getByText("Hello there")).toHaveCount(0);
  await expect(dealDrawer(page)).toHaveCount(0);
});

// covers US1 scenario 5
test("with no pipelines the board says so; only admins get a link to add one", async ({ page, browser }) => {
  await db()`truncate deal_stage_periods, deals, stages, pipelines restart identity cascade`;
  await signInAs(page, "Ada Fake", "/deals");
  await expect(page.getByText("No pipelines yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "[ ADD PIPELINE ]" })).toHaveAttribute("href", "/admin/pipelines");
  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake", "/deals");
  await expect(linus.getByText("No pipelines yet.")).toBeVisible();
  await expect(linus.getByRole("link", { name: "[ ADD PIPELINE ]" })).toHaveCount(0);
  await ctx.close();
});

// covers US3 scenarios 1, 2, 4, FR-007, FR-011, SC-002
test("dragging a card to another column moves it at once and records the move", async ({ page }) => {
  await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 400000 });
  await signInAs(page, "Ada Fake", "/deals");
  const before = { q: await columnTotal(page, "Qualified").textContent(), p: await columnTotal(page, "Proposal").textContent() };

  // A drop back on its own column sends nothing.
  const posts: string[] = [];
  page.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
  await card(page, "Fakeco website").dragTo(column(page, "Qualified"));
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);
  await expect(columnTotal(page, "Qualified")).toHaveText(before.q!);

  await card(page, "Fakeco website").dragTo(column(page, "Proposal"));
  await expect(column(page, "Proposal").locator("a.card").first()).toContainText("Fakeco website", { timeout: 1000 });
  await expect(column(page, "Qualified")).not.toContainText("Fakeco website");
  await expect(columnTotal(page, "Proposal")).not.toHaveText(before.p!);
  await expectHeader(page, "Sales", "Proposal", "Ada Fake");
  await expectHeader(page, "Sales", "Qualified", "Ada Fake");
  await page.reload();
  await expect(column(page, "Proposal")).toContainText("Fakeco website");
  await expectHeader(page, "Sales", "Proposal", "Ada Fake");

  await card(page, "Fakeco website").click();
  await expect(page).toHaveURL(new RegExp(`open=${await dealId("Fakeco website")}`));
  await expect(history(page).first()).toContainText("Moved from Qualified to Proposal by Ada Fake");
  // SF-102 design B: the date is the day heading above the entry, the entry shows its UK time.
  await expect(history(page).first()).toContainText(/\d{2}:\d{2}/);
  await expect(dealDrawer(page).getByText(/TODAY · \d{2} [A-Z]{3} \d{4}/)).toBeVisible();
});

// covers US3 scenario 3, FR-011 (keyboard users move a deal from the drawer)
test("the drawer's Move to form moves a deal, also to another pipeline, with the keyboard only", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 100 });
  await signInAs(page, "Linus Fake", `/deals?pipeline=${await pipelineId("Sales")}&open=${id}`);
  await expect(dealDrawer(page)).toContainText("Sales · Qualified");
  await page.getByLabel("Move to").focus();
  await page.getByLabel("Move to").selectOption({ label: "Sales · Negotiation" });
  await page.getByRole("button", { name: "[ MOVE ]" }).focus();
  await page.keyboard.press("Enter");
  await expect(dealDrawer(page)).toContainText("Sales · Negotiation");
  await expect(column(page, "Negotiation")).toContainText("Fakeco website");
  await expect(history(page).first()).toContainText("Moved from Qualified to Negotiation by Linus Fake");

  await page.getByLabel("Move to").selectOption({ label: "Ambassadors · Talking" });
  await page.getByRole("button", { name: "[ MOVE ]" }).click();
  await expect(page).toHaveURL(new RegExp(`pipeline=${await pipelineId("Ambassadors")}&open=${id}`));
  await expect(column(page, "Talking")).toContainText("Fakeco website");
  await expect(history(page).first()).toContainText("Moved from Sales · Negotiation to Ambassadors · Talking by Linus Fake");
});

// covers US3 scenario 5, FR-012, edge case "a drag that fails puts the card back"
test("a deal changed since the board was loaded is refused with a refreshed board; a failed drag puts the card back", async ({ page }) => {
  const id = await insertDeal({ title: "Fakeco website", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 400000 });
  await insertDeal({ title: "Fake lighthouse deal", pipeline: "Sales", stage: "Qualified", createdBy: "Ada Fake", valuePence: 100 });
  await signInAs(page, "Linus Fake", "/deals");
  await expect(card(page, "Fakeco website")).toBeVisible();
  // Someone else archives it meanwhile.
  await db()`update deals set archived_at = now(), version = version + 1 where id = ${id}`;
  await card(page, "Fakeco website").dragTo(column(page, "Proposal"));
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(messages.deal_changed);
  await expect(card(page, "Fakeco website")).toHaveCount(0);
  await expectHeader(page, "Sales", "Qualified", "Linus Fake");
  await expectHeader(page, "Sales", "Proposal", "Linus Fake");
  const [row] = await db()<{ stage: string }[]>`select s.name as stage from deals d join stages s on s.id = d.stage_id where d.id = ${id}`;
  expect(row.stage).toBe("Qualified");

  // The connection drops during a drag.
  await page.route("**/deals**", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await card(page, "Fake lighthouse deal").dragTo(column(page, "Proposal"));
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(messages.deal_move_failed);
  await expect(column(page, "Qualified")).toContainText("Fake lighthouse deal");
  await expect(column(page, "Proposal")).not.toContainText("Fake lighthouse deal");
  await expectHeader(page, "Sales", "Qualified", "Linus Fake");
});
