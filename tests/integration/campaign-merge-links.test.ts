// covers SF-119 FR-009, FR-009a, US2 scenarios 3–5 (T021): a custom field tag is linked to its field on save, follows the
// field's renames on open (subject, blocks, HTML, the list's Subject) while the stored text stays, keeps its last name and
// reads as unknown once the field is deleted (a new field of that name does not take it), until the tag is changed.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { createCampaign, getCampaignById, listCampaigns, saveCampaign, type CampaignForm } from "@/server/campaigns/campaigns";
import { addField, deleteField, updateField } from "@/server/custom-fields/fields";
import { mergeFields, unknownTags } from "@/server/campaigns/merge";
import { contentTexts } from "@/server/campaigns/content";
import { listFields } from "@/server/custom-fields/fields";
import { makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, linus: TestUser, dietId: number;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  const f = await addField(ada.id, "person", { name: "Diet", type: "text", choices: "", inList: false });
  if (!f.ok) throw new Error(f.code);
  dietId = f.id;
});
afterAll(closeDb);

const form = (over: Partial<CampaignForm> = {}): CampaignForm => ({
  name: "Event recap (fake)", senderName: "Linus Fake", replyTo: "", subject: "", previewText: "", contentKind: "none", blocks: "", html: "", ...over,
});
async function draft(over: Partial<CampaignForm>) {
  const c = await createCampaign(linus.id, form().name);
  if (!c.ok) throw new Error(c.error);
  const r = await saveCampaign(linus.id, c.id, 1, form(over));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return c.id;
}
const stored = async (id: number) => (await sql`select subject, blocks, html, merge_links from campaigns where id = ${id}`)[0];
async function unknownOf(id: number) {
  const v = (await getCampaignById(id))!;
  return unknownTags([v.subject, v.previewText, ...contentTexts(v.content)], v.links, mergeFields(await listFields("person")));
}

describe("custom field tags follow the field", () => {
  it("links on save and shows the new name everywhere after a rename, the stored text unchanged", async () => {
    const blocksJson = JSON.stringify([{ type: "text", text: "Diet: {{Diet | none given}}" }]);
    const a = await draft({ subject: "{{Diet | none given}} for you", contentKind: "blocks", blocks: blocksJson });
    const b = await draft({ contentKind: "html", html: "<p>{{ Diet | none given }}</p>" });
    expect((await stored(a)).merge_links).toEqual([{ field: dietId, name: "Diet" }]);
    expect((await stored(b)).merge_links).toEqual([{ field: dietId, name: "Diet" }]);

    expect((await updateField(ada.id, dietId, { name: "Dietary needs", inList: false })).ok).toBe(true);
    const va = (await getCampaignById(a))!;
    expect(va.subject).toBe("{{Dietary needs | none given}} for you");
    expect(va.content).toEqual({ kind: "blocks", blocks: [{ type: "text", text: "Diet: {{Dietary needs | none given}}" }] });
    expect(va.links).toEqual([{ field: dietId, name: "Dietary needs", live: true }]);
    expect((await getCampaignById(b))!.content).toEqual({ kind: "html", html: "<p>{{ Dietary needs | none given }}</p>" });
    expect((await listCampaigns()).find((c) => c.id === a)?.subject).toBe("{{Dietary needs | none given}} for you");
    expect((await stored(a)).subject).toBe("{{Diet | none given}} for you");
    expect(await unknownOf(a)).toEqual([]);

    // Saving what the page shows stores the new name.
    expect((await saveCampaign(linus.id, a, 2, form({ subject: va.subject, contentKind: "blocks", blocks: JSON.stringify((va.content as { blocks: unknown }).blocks) }))).ok).toBe(true);
    expect((await stored(a)).merge_links).toEqual([{ field: dietId, name: "Dietary needs" }]);
  });

  it("keeps the last name of a deleted field as an unknown tag; a new field of that name does not take it; changing the tag drops it", async () => {
    const id = await draft({ subject: "{{Diet}} and {{Favourite colour}}" });
    expect(await unknownOf(id)).toEqual(["{{Favourite colour}}"]);
    expect((await deleteField(ada.id, dietId)).ok).toBe(true);
    expect((await getCampaignById(id))!.subject).toBe("{{Diet}} and {{Favourite colour}}");
    expect(await unknownOf(id)).toEqual(["{{Diet}}", "{{Favourite colour}}"]);

    const again = await addField(ada.id, "person", { name: "Diet", type: "text", choices: "", inList: false });
    if (!again.ok) throw new Error(again.code);
    expect(await unknownOf(id)).toEqual(["{{Diet}}", "{{Favourite colour}}"]);
    // A save that keeps the tag keeps the dead link.
    expect((await saveCampaign(linus.id, id, 2, form({ subject: "{{Diet}} and {{Favourite colour}}" }))).ok).toBe(true);
    expect((await stored(id)).merge_links).toEqual([{ field: dietId, name: "Diet" }]);
    // Changing the tag removes it; typing it again links the live field.
    expect((await saveCampaign(linus.id, id, 3, form({ subject: "No tag" }))).ok).toBe(true);
    expect((await stored(id)).merge_links).toEqual([]);
    expect((await saveCampaign(linus.id, id, 4, form({ subject: "{{diet}}" }))).ok).toBe(true);
    expect((await stored(id)).merge_links).toEqual([{ field: again.id, name: "Diet" }]);
    expect(await unknownOf(id)).toEqual([]);
  });

  it("links a hand-typed tag on save and saves an unknown tag", async () => {
    const id = await draft({ previewText: "{{ DIET | x }} {{Favourite colour}}" });
    expect((await stored(id)).merge_links).toEqual([{ field: dietId, name: "Diet" }]);
    expect(await unknownOf(id)).toEqual(["{{Favourite colour}}"]);
  });
});
