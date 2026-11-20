// covers SF-102 US1 scenarios 1–5, 7, 8, FR-005–FR-009, FR-016, FR-017
import { expect, test } from "@playwright/test";
import { closeDb, db, resetAndSeed, signInAs } from "./helpers";
import { insertDeal } from "./deals";
import { addNote, entries, makeRecords, noteBox, timelineRegion } from "./notes-helpers";

test.beforeEach(resetAndSeed);
test.afterAll(closeDb);

async function records() {
  const { org, person } = await makeRecords();
  const deal = await insertDeal({ title: "Notetest deal", pipeline: "Sales", stage: "Lead in", createdBy: "Ada Fake" });
  return { deal, person, org, paths: [`/deals/${deal}`, `/people/${person}`, `/organisations/${org}`] };
}

test("a note is added on a deal, a person and an organisation; an empty one is refused (US1-1, US1-2, US1-3)", async ({ page }) => {
  const { paths } = await records();
  await signInAs(page, "Ada Fake");
  for (const path of paths) {
    await page.goto(path);
    const box = noteBox(page).getByRole("textbox", { name: "Note" });
    await expect(box).toHaveAttribute("maxlength", "10000");
    await noteBox(page).getByRole("button", { name: "[ ADD NOTE ]" }).click();
    await expect(noteBox(page).getByRole("alert")).toHaveText("Write something before adding the note.");
    await box.fill("  Called Ada,\nwants a proposal by Friday  ");
    await noteBox(page).getByRole("button", { name: "[ ADD NOTE ]" }).click();
    await expect(box).toHaveValue("");
    const first = entries(page).first();
    await expect(first.locator(".kd")).toHaveText("NOTE");
    await expect(first).toContainText("Ada Fake");
    await expect(first.locator(".notebody")).toHaveText("Called Ada,\nwants a proposal by Friday");
    await expect(first.locator(".when")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(timelineRegion(page).locator(".day").first()).toHaveText(/^\/\/ TODAY · \d{2} [A-Z]{3} \d{4}$/);
    await page.reload();
    await expect(entries(page).first().locator(".notebody")).toHaveText("Called Ada,\nwants a proposal by Friday");
  }
});

test("a note is edited (edited by), cancel keeps it, and it is deleted after confirming (US1-4, US1-5)", async ({ page }) => {
  const { person } = await records();
  await signInAs(page, "Linus Fake", `/people/${person}`);
  await addNote(page, "first text");
  const first = entries(page).first();
  await first.getByRole("link", { name: "Edit note" }).click();
  const edit = page.getByRole("form", { name: "Edit note" });
  await expect(edit.getByRole("textbox", { name: "Note" })).toHaveValue("first text");
  await edit.getByRole("textbox", { name: "Note" }).fill("not kept");
  await edit.getByRole("link", { name: "[ CANCEL ]" }).click();
  await expect(edit).toHaveCount(0);
  await expect(first.locator(".notebody")).toHaveText("first text");

  // Ada edits Linus's note.
  await signInAs(page, "Ada Fake", `/people/${person}`);
  await entries(page).first().getByRole("link", { name: "Edit note" }).click();
  await page.getByRole("form", { name: "Edit note" }).getByRole("textbox", { name: "Note" }).fill("second text");
  await page.getByRole("form", { name: "Edit note" }).getByRole("button", { name: "[ SAVE ]" }).click();
  await expect(page.getByRole("form", { name: "Edit note" })).toHaveCount(0);
  await expect(entries(page).first().locator(".notebody")).toHaveText("second text");
  await expect(entries(page).first()).toContainText("Linus Fake");
  await expect(entries(page).first()).toContainText("edited by Ada Fake");

  await entries(page).first().getByRole("link", { name: "Delete note" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Confirm note delete" });
  await expect(confirm).toContainText("Delete this note? This can't be undone.");
  await confirm.getByRole("button", { name: "[ DELETE ]" }).click();
  await expect(page.locator("p.notice")).toHaveText("Note deleted.");
  // The notice shows once: the page's own follow-up requests drop the cookie (as for the other notices); then reload.
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === "crm_flash")).toBe(false);
  await page.reload();
  await expect(timelineRegion(page).locator(".notebody")).toHaveCount(0);
  await expect(page.locator("p.notice")).toHaveCount(0);
});

test("a second editor saving a stale note is told someone else changed it (US1-7)", async ({ page, browser }) => {
  const { deal } = await records();
  await signInAs(page, "Ada Fake", `/deals/${deal}`);
  await addNote(page, "shared text");
  const id = await db()<{ id: number }[]>`select id::int as id from timeline_events where kind = 'note' and deal_id = ${deal}`;
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signInAs(other, "Grace Fake", `/deals/${deal}?note=${id[0].id}`);
  await page.goto(`/deals/${deal}?note=${id[0].id}`);
  await page.getByRole("form", { name: "Edit note" }).getByRole("textbox", { name: "Note" }).fill("Ada's change");
  await page.getByRole("form", { name: "Edit note" }).getByRole("button", { name: "[ SAVE ]" }).click();
  await expect(entries(page).first().locator(".notebody")).toHaveText("Ada's change");
  const box = other.getByRole("form", { name: "Edit note" });
  await box.getByRole("textbox", { name: "Note" }).fill("Grace's change");
  await box.getByRole("button", { name: "[ SAVE ]" }).click();
  await expect(box.getByRole("alert")).toHaveText("Someone else changed this note while you were editing. Reload to see their changes.");
  await expect(box.getByRole("textbox", { name: "Note" })).toHaveValue("Grace's change");
  await ctx.close();
});

test("an archived record shows its notes with no note box, [ EDIT ] or [ DELETE ] (US1-8)", async ({ page }) => {
  const { paths, deal, person, org } = await records();
  await signInAs(page, "Ada Fake");
  for (const path of paths) {
    await page.goto(path);
    await addNote(page, "kept while archived");
  }
  await db()`update deals set archived_at = now() where id = ${deal}`;
  await db()`update persons set archived_at = now() where id = ${person}`;
  await db()`update organisations set archived_at = now() where id = ${org}`;
  for (const path of paths) {
    await page.goto(path);
    await expect(timelineRegion(page).locator(".notebody").first()).toHaveText("kept while archived");
    await expect(noteBox(page)).toHaveCount(0);
    await expect(timelineRegion(page).getByRole("link", { name: "Edit note" })).toHaveCount(0);
    await expect(timelineRegion(page).getByRole("link", { name: "Delete note" })).toHaveCount(0);
  }
});

test("unknown note ids in the address leave the page as it is", async ({ page }) => {
  const { deal } = await records();
  await signInAs(page, "Ada Fake", `/deals/${deal}?note=999999&delete-note=abc`);
  await expect(page.getByRole("heading", { name: /Notetest deal/ })).toBeVisible();
  await expect(page.getByRole("form", { name: "Edit note" })).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("999999");
});
