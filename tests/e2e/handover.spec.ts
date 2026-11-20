import { expect, test } from "@playwright/test";
import { messages, templates } from "@/server/messages";
import { closeDb, db, pageAlert, resetAndSeed, signInAs, userRow } from "./helpers";
import { card, dealDrawer, dealId, expectHeader, history, pipelineId } from "./deals";
import { actionField, details, personId, timeline } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

async function alanId(): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from users where email = 'alan@barnacle.ai'`;
  return row.id;
}

async function dealOwners(): Promise<string[]> {
  const rows = await db()<{ name: string }[]>`
    select u.name from deals d join users u on u.id = d.owner_id where d.title like 'Fake leaver%' order by d.title`;
  return rows.map((r) => r.name);
}

async function owners(): Promise<string[]> {
  const rows = await db()<{ name: string }[]>`
    select u.name from persons p join users u on u.id = p.owner_id
    where p.first_name in ('Robin', 'Sam') and p.last_name = 'Leftfake' order by p.first_name`;
  return rows.map((r) => r.name);
}

// covers SF-92 US3 scenarios 1–4, 6, FR-009, FR-010, FR-011, SC-003; SF-97 US1 independent test, scenarios 1–6, SC-003, SC-005
// (the fake data gives Alan Fake 2 private people and 2 private deals, one archived)
test("an admin hands Alan Fake's private people and private deals to Margaret Fake", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  const alan = userRow(page, "alan@barnacle.ai");
  await expect(alan).toContainText("2 private people · 2 private deals");
  await expect(page.getByRole("link", { name: "[ HAND OVER ]" })).toHaveCount(1);
  await expect(userRow(page, "linus@barnacle.ai")).not.toContainText("private");

  await alan.getByRole("link", { name: "[ HAND OVER ]" }).click();
  await expect(page).toHaveURL(/\/admin\/users\?handover=\d+$/);
  const panel = page.locator("form.handover");
  await expect(panel).toContainText(
    "They stay private. The user you choose becomes their owner and can see them. You will not see what they are.",
  );
  const select = page.getByRole("combobox", { name: "Hand over to" });
  const choices = await select.locator("option").allTextContents();
  expect(choices).toEqual(["Choose a user", "Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"]);
  // Never which people or deals they are (SC-005).
  for (const hidden of ["Leftfake", "Fake leaver", "£"]) expect(await page.locator("main").innerText()).not.toContain(hidden);

  // No choice: asked to choose.
  await panel.getByRole("button", { name: "[ HAND OVER ]" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Choose an active user.");
  expect(await owners()).toEqual(["Alan Fake", "Alan Fake"]);

  // Cancel: nothing changes.
  await panel.getByRole("link", { name: "[ CANCEL ]" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.locator("form.handover")).toHaveCount(0);
  await expect(alan).toContainText("2 private people · 2 private deals");
  expect(await owners()).toEqual(["Alan Fake", "Alan Fake"]);
  expect(await dealOwners()).toEqual(["Alan Fake", "Alan Fake"]);

  await alan.getByRole("link", { name: "[ HAND OVER ]" }).click();
  await select.selectOption({ label: "Margaret Fake" });
  await expect(page.locator("form.handover .q")).toHaveText("Hand Alan Fake's 2 private people and 2 private deals to Margaret Fake?");
  await expect(page.locator("form.handover")).toContainText(templates.handover_explain("Margaret Fake", 2));
  await page.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("2 private people and 2 private deals handed to Margaret Fake.");
  await expect(alan).not.toContainText("private");
  await expect(page.getByRole("link", { name: "[ HAND OVER ]" })).toHaveCount(0);
  expect(await owners()).toEqual(["Margaret Fake", "Margaret Fake"]);
  expect(await dealOwners()).toEqual(["Margaret Fake", "Margaret Fake"]);

  const ctx = await browser.newContext();
  const margaret = await ctx.newPage();
  await signInAs(margaret, "Margaret Fake", "/people?q=Leftfake");
  await expect(margaret.locator("tbody tr")).toHaveCount(2);
  await margaret.goto(`/people/${await personId("Sam Leftfake")}`);
  await expect(margaret.getByRole("heading", { name: /Sam Leftfake/ })).toContainText("Private");
  await expect(details(margaret)).toContainText("Margaret Fake");
  await expect(timeline(margaret).first()).toContainText("Handed to Margaret Fake by Ada Fake");

  // The open deal is on Margaret's board, private, counted in its column; the drawer names her owner and the hand-over.
  const sales = await pipelineId("Sales");
  const open = await dealId("Fake leaver deal");
  await margaret.goto(`/deals?pipeline=${sales}&open=${open}`);
  await expect(card(margaret, "Fake leaver deal").locator(".badge")).toHaveText("Private");
  await expect(card(margaret, "Fake leaver old deal")).toHaveCount(0); // archived: off the board
  await expectHeader(margaret, "Sales", "Lead in", "Margaret Fake");
  await expect(dealDrawer(margaret)).toContainText("Margaret Fake");
  await expect(history(margaret).first()).toContainText("Handed to Margaret Fake by Ada Fake");
  await ctx.close();

  // Neither Linus nor the admin sees the deals.
  for (const name of ["Linus Fake", "Ada Fake"]) {
    const other = await (await browser.newContext()).newPage();
    await signInAs(other, name, `/deals?pipeline=${sales}&open=${open}`);
    await expect(other.getByRole("heading", { level: 1 })).toHaveText("Sales");
    await expect(card(other, "Fake leaver deal")).toHaveCount(0);
    await expect(dealDrawer(other)).toHaveCount(0);
    await expectHeader(other, "Sales", "Lead in", name);
    await other.context().close();
  }
});

// covers SF-97 US2 independent test, scenarios 1–3: a deactivated user with only private deals
test("an admin hands over a deactivated user who owns only a private deal", async ({ page, browser }) => {
  await db()`update persons set private = false where owner_id = ${await alanId()}`;
  await db()`delete from deals where title = 'Fake leaver old deal'`;
  await signInAs(page, "Ada Fake", "/admin/users");
  const alan = userRow(page, "alan@barnacle.ai");
  await expect(alan.locator(".pp")).toHaveText("1 private deal");
  await alan.getByRole("link", { name: "[ HAND OVER ]" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users\\?handover=${await alanId()}$`));
  const panel = page.locator("form.handover");
  await expect(panel).toContainText(messages.handover_explain_unchosen_records);
  await page.getByRole("combobox", { name: "Hand over to" }).selectOption({ label: "Margaret Fake" });
  await expect(panel.locator(".q")).toHaveText("Hand Alan Fake's 1 private deal to Margaret Fake?");
  await expect(panel).toContainText("You will not see what they are.");
  await panel.getByRole("button", { name: "[ HAND OVER ]" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("1 private deal handed to Margaret Fake.");
  await expect(page.getByRole("link", { name: "[ HAND OVER ]" })).toHaveCount(0);

  const margaret = await (await browser.newContext()).newPage();
  await signInAs(margaret, "Margaret Fake", `/deals?pipeline=${await pipelineId("Sales")}`);
  await expect(card(margaret, "Fake leaver deal").locator(".badge")).toHaveText("Private");
  await margaret.context().close();
});

// covers SF-92 US3 scenario 7, FR-012, SC-005
test("a user posting the hand-over form directly is refused and nothing changes", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", `/admin/users?handover=${await alanId()}`);
  const field = await actionField(page, "[ HAND OVER ]");
  const [margaret] = await db()<{ id: number }[]>`select id::int as id from users where email = 'margaret@barnacle.ai'`;

  const ctx = await browser.newContext();
  const linus = await ctx.newPage();
  await signInAs(linus, "Linus Fake");
  const res = await linus.request.post("/admin/users", {
    multipart: { [field]: "", userId: String(await alanId()), toUserId: String(margaret.id) },
  });
  expect(await res.text()).toContain("You don&#x27;t have access to this page.");
  expect(await owners()).toEqual(["Alan Fake", "Alan Fake"]);
  await ctx.close();
});

// covers SF-92 FR-009, SF-97 US2: the panel opens for private people or private deals, not for an active user, a
// deactivated user with neither or a made-up id
test("the panel opens only for a deactivated user with private people or private deals", async ({ page }) => {
  const [linus] = await db()<{ id: number }[]>`select id::int as id from users where email = 'linus@barnacle.ai'`;
  await signInAs(page, "Ada Fake", `/admin/users?handover=${linus.id}`);
  await expect(page.locator("form.handover")).toHaveCount(0);
  const alan = await alanId();
  await db()`update persons set private = false where owner_id = ${alan}`;
  await page.goto(`/admin/users?handover=${alan}`);
  await expect(page.locator("form.handover")).toHaveCount(1); // private deals only
  await db()`update deals set private = false where owner_id = ${alan}`;
  await page.goto(`/admin/users?handover=${alan}`);
  await expect(page.locator("form.handover")).toHaveCount(0); // neither
  await expect(userRow(page, "alan@barnacle.ai").getByRole("link", { name: "[ HAND OVER ]" })).toHaveCount(0);
  await page.goto("/admin/users?handover=abc&error=handover_not_deactivated");
  await expect(page.locator("form.handover")).toHaveCount(0);
  await expect(pageAlert(page)).toHaveText("Only a deactivated user's private records can be handed over.");
});
