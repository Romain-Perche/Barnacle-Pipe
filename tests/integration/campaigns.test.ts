// covers SF-119 FR-001–FR-006, US1 scenarios 1–5, US3 scenario 3, US4 scenario 1, US6 scenarios 1–3, SC-006, Edge Cases
// "two users", "deactivated user", "empty draft", "not valid HTML", "100 characters" (T011, T027, T034, T045): drafts are
// created, listed, saved with every check (a refusal or an old version writes nothing), duplicated and deleted by anyone.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import {
  createCampaign, deleteCampaign, duplicateCampaign, getCampaignById, listCampaigns, saveCampaign, type CampaignForm,
} from "@/server/campaigns/campaigns";
import { makeUser, resetDb, type TestUser } from "./db-helpers";

let ada: TestUser, margaret: TestUser, alan: TestUser;

beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
});
afterAll(closeDb);

const form = (over: Partial<CampaignForm> = {}): CampaignForm => ({
  name: "Exec dinner – March (fake)", senderName: "Ada Fake", replyTo: "ada.fake@barnacle.ai", subject: "A seat for you",
  previewText: "Thursday 12 March (fake)", contentKind: "none", blocks: "", html: "", ...over,
});
const row = async (id: number) => (await sql`select * from campaigns where id = ${id}`)[0];
async function created(actorId: number, name = "Exec dinner – March (fake)") {
  const r = await createCampaign(actorId, name);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

describe("create and list (US1 scenarios 1–2)", () => {
  it("creates a draft with the user's name as sender and every other field empty", async () => {
    const id = await created(ada.id);
    expect(await row(id)).toMatchObject({
      name: "Exec dinner – March (fake)", sender_name: "Ada Fake", reply_to: "", subject: "", preview_text: "", content_kind: null,
      blocks: null, html: null, merge_links: [], status: "draft", version: 1, updated_by: String(ada.id), created_by: String(ada.id),
    });
    expect(await createCampaign(ada.id, "  ")).toEqual({ ok: false, error: "Give the campaign a name." });
    expect(await createCampaign(ada.id, "n".repeat(101))).toEqual({ ok: false, error: "A campaign name can be at most 100 characters." });
  });

  it("lists every draft, most recently edited first, with created-by and last-edited names (a deactivated user kept)", async () => {
    expect(await listCampaigns()).toEqual([]);
    const old = await created(alan.id, "Old one (fake)");
    const recent = await created(margaret.id, "Recent (fake)");
    await sql`update campaigns set updated_at = now() - interval '1 day' where id = ${old}`;
    const list = await listCampaigns();
    expect(list.map((c) => [c.id, c.name, c.createdBy, c.lastEditedBy])).toEqual([
      [recent, "Recent (fake)", "Margaret Fake", "Margaret Fake"],
      [old, "Old one (fake)", "Alan Fake", "Alan Fake"],
    ]);
    const r = await saveCampaign(ada.id, old, 1, form({ name: "Old one (fake)" }));
    expect(r.ok).toBe(true);
    expect((await listCampaigns()).map((c) => [c.name, c.subject, c.createdBy, c.lastEditedBy])).toEqual([
      ["Old one (fake)", "A seat for you", "Alan Fake", "Ada Fake"],
      ["Recent (fake)", "", "Margaret Fake", "Margaret Fake"],
    ]);
  });
});

describe("save (US1 scenarios 3–5, SC-006)", () => {
  it("keeps valid values, returns version 2, the last-edited line and Draft saved.", async () => {
    const id = await created(ada.id);
    const r = await saveCampaign(margaret.id, id, 1, form({ replyTo: " Ada.Fake@Barnacle.AI " }));
    expect(r).toMatchObject({ ok: true, version: 2, message: "Draft saved.", links: [] });
    expect(r.ok && r.lastEdited).toMatch(/^Last edited by Margaret Fake · \d{2} \w{3} \d{4}, \d{2}:\d{2}$/);
    const view = await getCampaignById(id);
    expect(view).toMatchObject({
      name: "Exec dinner – March (fake)", senderName: "Ada Fake", replyTo: "ada.fake@barnacle.ai", subject: "A seat for you",
      previewText: "Thursday 12 March (fake)", content: null, version: 2,
    });
    expect(await row(id)).toMatchObject({ updated_by: String(margaret.id), created_by: String(ada.id) });
  });

  it("saves an empty draft (only a name)", async () => {
    const id = await created(ada.id);
    const r = await saveCampaign(ada.id, id, 1, form({ senderName: "", replyTo: "", subject: "", previewText: "" }));
    expect(r).toMatchObject({ ok: true, message: "Draft saved." });
  });

  it("refuses every limit with nothing written", async () => {
    const id = await created(ada.id);
    const before = await row(id);
    const refusals: [Partial<CampaignForm>, Record<string, string>][] = [
      [{ name: "" }, { name: "Give the campaign a name." }],
      [{ name: "n".repeat(101) }, { name: "A campaign name can be at most 100 characters." }],
      [{ senderName: "s".repeat(101) }, { senderName: "Sender name: at most 100 characters." }],
      [{ replyTo: "not-an-email" }, { replyTo: "Reply-to: enter one valid email address." }],
      [{ replyTo: "a@x.test, b@x.test" }, { replyTo: "Reply-to: enter one valid email address." }],
      [{ subject: "s".repeat(256) }, { subject: "Subject: at most 255 characters." }],
      [{ previewText: "p".repeat(256) }, { previewText: "Preview text: at most 255 characters." }],
      [{ subject: `{{First name | ${"x".repeat(101)}}}` }, { fallback: "If empty, show: at most 100 characters." }],
      [{ contentKind: "html", html: "x".repeat(500_001) }, { content: "The HTML can be at most 500,000 characters." }],
      [{ contentKind: "blocks", blocks: JSON.stringify([{ type: "button", label: "Go", url: "javascript:alert(1)" }]) }, { "block.0": "Button: enter a web address starting with https://." }],
      [{ contentKind: "blocks", blocks: "{nope" }, { content: "The content couldn't be read. Reload and try again." }],
    ];
    for (const [over, errors] of refusals) {
      expect(await saveCampaign(ada.id, id, 1, form(over)), JSON.stringify(over).slice(0, 60)).toEqual({ ok: false, errors });
      expect(await row(id)).toEqual(before);
    }
  });

  it("refuses a save from an older version, naming who saved first; nothing written (Edge Case: two users)", async () => {
    const id = await created(margaret.id);
    expect((await saveCampaign(ada.id, id, 1, form({ subject: "First save" }))).ok).toBe(true);
    const before = await row(id);
    expect(await saveCampaign(margaret.id, id, 1, form({ subject: "Second save" }))).toEqual({
      ok: false, errors: { form: "Ada Fake changed this campaign since you opened it. Reload to see their changes." },
    });
    expect(await row(id)).toEqual(before);
  });

  it("refuses a save of a deleted draft", async () => {
    const id = await created(ada.id);
    await deleteCampaign(margaret.id, id);
    expect(await saveCampaign(ada.id, id, 1, form())).toEqual({ ok: false, gone: true, errors: { form: "This campaign no longer exists." } });
    expect(await getCampaignById(id)).toBeNull();
  });
});

describe("content (US3 scenario 3, US4 scenario 1)", () => {
  it("keeps blocks in the order saved; a refused block save leaves the stored content unchanged", async () => {
    const id = await created(ada.id);
    const blocks = [
      { type: "heading", text: "Our March exec dinner" },
      { type: "text", text: "Hi {{First name | there}}," },
      { type: "button", label: "Book a seat", url: "https://example.test/dinner" },
      { type: "text", text: "See you there." },
    ];
    const moved = [blocks[0], blocks[1], blocks[3], blocks[2]];
    expect((await saveCampaign(ada.id, id, 1, form({ contentKind: "blocks", blocks: JSON.stringify(blocks) }))).ok).toBe(true);
    expect((await saveCampaign(ada.id, id, 2, form({ contentKind: "blocks", blocks: JSON.stringify(moved) }))).ok).toBe(true);
    expect((await getCampaignById(id))?.content).toEqual({ kind: "blocks", blocks: moved });
    const before = await row(id);
    const bad = [...moved, { type: "image", src: "http://x.test/a.png", alt: "", url: "" }];
    expect((await saveCampaign(ada.id, id, 3, form({ contentKind: "blocks", blocks: JSON.stringify(bad) }))).ok).toBe(false);
    expect(await row(id)).toEqual(before);
  });

  it("stores no blocks or blank HTML as no content", async () => {
    const id = await created(ada.id);
    expect((await saveCampaign(ada.id, id, 1, form({ contentKind: "blocks", blocks: "[]" }))).ok).toBe(true);
    expect(await row(id)).toMatchObject({ content_kind: null, blocks: null, html: null });
    expect((await saveCampaign(ada.id, id, 2, form({ contentKind: "html", html: "  \n" }))).ok).toBe(true);
    expect(await row(id)).toMatchObject({ content_kind: null, blocks: null, html: null });
  });

  it("keeps pasted HTML byte for byte, not valid HTML included", async () => {
    const id = await created(ada.id);
    const html = "  <table><tr><td>Hi {{Unknown}}\r\n<p>unclosed <b>bold\r\n<script>document.title='x'</script>  ";
    expect((await saveCampaign(ada.id, id, 1, form({ contentKind: "html", html }))).ok).toBe(true);
    expect(await getCampaignById(id)).toMatchObject({ content: { kind: "html", html } });
    expect((await row(id)).html).toBe(html);
  });
});

describe("duplicate and delete (US6)", () => {
  it("copies the stored draft as Copy of <name> by the user who duplicates; the original is unchanged", async () => {
    const id = await created(ada.id, "n".repeat(100));
    const blocks = JSON.stringify([{ type: "text", text: "Hi {{First name}}" }]);
    expect((await saveCampaign(ada.id, id, 1, form({ name: "n".repeat(100), contentKind: "blocks", blocks }))).ok).toBe(true);
    const before = await row(id);
    const r = await duplicateCampaign(margaret.id, id);
    if (!r.ok) throw new Error("not duplicated");
    const copy = await row(r.id);
    expect(copy).toMatchObject({
      name: ("Copy of " + "n".repeat(100)).slice(0, 100), sender_name: before.sender_name, reply_to: before.reply_to, subject: before.subject,
      preview_text: before.preview_text, content_kind: "blocks", blocks: before.blocks, html: null, merge_links: before.merge_links,
      created_by: String(margaret.id), updated_by: String(margaret.id), version: 1,
    });
    expect(await row(id)).toEqual(before);
  });

  it("lets any user delete any draft; a gone draft cannot be duplicated, deleted or saved", async () => {
    const id = await created(ada.id);
    expect(await deleteCampaign(margaret.id, id)).toEqual({ ok: true, name: "Exec dinner – March (fake)" });
    expect(await duplicateCampaign(ada.id, id)).toEqual({ ok: false, code: "campaign_gone" });
    expect(await deleteCampaign(ada.id, id)).toEqual({ ok: false, code: "campaign_gone" });
    expect((await saveCampaign(ada.id, id, 1, form())).ok).toBe(false);
    const [{ n }] = await sql`select count(*)::int as n from campaigns`;
    expect(n).toBe(0);
  });
});
