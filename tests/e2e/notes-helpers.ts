// Helpers for the SF-102 timeline and notes browser tests.
import { expect, type Page } from "@playwright/test";
import { db } from "./helpers";

export function timelineRegion(page: Page) {
  return page.getByRole("region", { name: "Timeline" });
}
export function entries(page: Page) {
  return timelineRegion(page).getByRole("listitem");
}
export function noteBox(page: Page) {
  return page.getByRole("form", { name: "Add a note" });
}

export async function addNote(page: Page, text: string) {
  const box = noteBox(page).getByRole("textbox", { name: "Note" });
  await box.fill(text);
  await noteBox(page).getByRole("button", { name: "[ ADD NOTE ]" }).click();
  await expect(box).toHaveValue("");
  await expect(entries(page).first()).toContainText(text.split("\n")[0]);
}

export async function userId(name: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`select id::int as id from users where name = ${name}`;
  return row.id;
}

// A person and an organisation of their own, so the seeded records do not get in the way.
export async function makeRecords(creator = "Ada Fake") {
  const uid = await userId(creator);
  const [org] = await db()<{ id: number }[]>`
    insert into organisations (name, owner_id, created_by) values ('Notetest Ltd Fake', ${uid}, ${uid}) returning id::int as id`;
  const [person] = await db()<{ id: number }[]>`
    insert into persons (first_name, last_name, organisation_id, owner_id, created_by) values ('Nora', 'Notetest', ${org.id}, ${uid}, ${uid})
    returning id::int as id`;
  await db()`insert into timeline_events (person_id, kind, actor_id) values (${person.id}, 'added', ${uid})`;
  await db()`insert into timeline_events (organisation_id, kind, actor_id) values (${org.id}, 'added', ${uid})`;
  return { org: org.id, person: person.id };
}
