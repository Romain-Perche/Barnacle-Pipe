import { expect, test } from "@playwright/test";
import { templates } from "@/server/messages";
import { closeDb, db, pageAlert, resetAndSeed, signInAs, userRow } from "./helpers";
import { actionField, details, personId, timeline } from "./records";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

async function alanId(): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from users where email = 'alan@barnacle.ai'`;
  return row.id;
}

async function owners(): Promise<string[]> {
  const rows = await db()<{ name: string }[]>`
    select u.name from persons p join users u on u.id = p.owner_id
    where p.first_name in ('Robin', 'Sam') and p.last_name = 'Leftfake' order by p.first_name`;
  return rows.map((r) => r.name);
}

// covers SF-92 US3 scenarios 1–4, 6, FR-009, FR-010, FR-011, SC-003
test("an admin hands Alan Fake's private people to Margaret Fake", async ({ page, browser }) => {
  await signInAs(page, "Ada Fake", "/admin/users");
  const alan = userRow(page, "alan@barnacle.ai");
  await expect(alan).toContainText("2 private people");
  await expect(page.getByRole("link", { name: "[ HAND OVER ]" })).toHaveCount(1);
  await expect(userRow(page, "linus@barnacle.ai")).not.toContainText("private");

  await alan.getByRole("link", { name: "[ HAND OVER ]" }).click();
  await expect(page).toHaveURL(/\/admin\/users\?handover=\d+$/);
  const panel = page.locator("form.handover");
  await expect(panel).toContainText(
    "They stay private. The user you choose becomes their owner and can see them. You will not see who they are.",
  );
  const select = page.getByRole("combobox", { name: "Hand over to" });
  const choices = await select.locator("option").allTextContents();
  expect(choices).toEqual(["Choose a user", "Ada Fake", "Grace Fake", "Linus Fake", "Margaret Fake"]);
  await expect(panel).not.toContainText("Leftfake");

  // No choice: asked to choose.
  await panel.getByRole("button", { name: "[ HAND OVER ]" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Choose an active user.");
  expect(await owners()).toEqual(["Alan Fake", "Alan Fake"]);

  // Cancel: nothing changes.
  await panel.getByRole("link", { name: "[ CANCEL ]" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.locator("form.handover")).toHaveCount(0);
  expect(await owners()).toEqual(["Alan Fake", "Alan Fake"]);

  await alan.getByRole("link", { name: "[ HAND OVER ]" }).click();
  await select.selectOption({ label: "Margaret Fake" });
  await expect(page.locator("form.handover .q")).toHaveText("Hand Alan Fake's 2 private people to Margaret Fake?");
  await expect(page.locator("form.handover")).toContainText(templates.handover_explain("Margaret Fake"));
  await page.locator("form.handover").getByRole("button", { name: "[ HAND OVER ]" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("2 private people handed to Margaret Fake.");
  await expect(alan).not.toContainText("private");
  await expect(page.getByRole("link", { name: "[ HAND OVER ]" })).toHaveCount(0);
  expect(await owners()).toEqual(["Margaret Fake", "Margaret Fake"]);

  const ctx = await browser.newContext();
  const margaret = await ctx.newPage();
  await signInAs(margaret, "Margaret Fake", "/people?q=Leftfake");
  await expect(margaret.locator("tbody tr")).toHaveCount(2);
  await margaret.goto(`/people/${await personId("Sam Leftfake")}`);
  await expect(margaret.getByRole("heading", { name: /Sam Leftfake/ })).toContainText("Private");
  await expect(details(margaret)).toContainText("Margaret Fake");
  await expect(timeline(margaret).first()).toContainText("Handed to Margaret Fake by Ada Fake");
  await ctx.close();
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

// covers SF-92 FR-009: no panel for an active user or for a made-up id
test("the panel opens only for a deactivated user with private people", async ({ page }) => {
  const [linus] = await db()<{ id: number }[]>`select id::int as id from users where email = 'linus@barnacle.ai'`;
  await signInAs(page, "Ada Fake", `/admin/users?handover=${linus.id}`);
  await expect(page.locator("form.handover")).toHaveCount(0);
  await page.goto("/admin/users?handover=abc&error=handover_not_deactivated");
  await expect(page.locator("form.handover")).toHaveCount(0);
  await expect(pageAlert(page)).toHaveText("Only a deactivated user's private people can be handed over.");
});
