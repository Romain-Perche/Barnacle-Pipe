// covers SF-119 FR-018, FR-019 (T012): with no session, or a deactivated user's session, every campaign action refuses
// before touching the database (nothing created, changed or deleted; no person data returned). Signed in, the actions
// save, duplicate and delete, with the notices of the Campaigns page.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-pathname": "/campaigns" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));

const { createSession, SESSION_COOKIE } = await import("@/server/auth/session");
const { closeDb, sql } = await import("@/server/db");
const { readFlash } = await import("@/server/records/flash");
const actions = await import("@/app/(app)/campaigns/actions");
const { createCampaign } = await import("@/server/campaigns/campaigns");
const { makePerson, makeUser, resetDb } = await import("./db-helpers");

let ada: { id: number }, alan: { id: number }, campaignId: number, personId: number;

beforeEach(async () => {
  await resetDb();
  jar.clear();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  alan = await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  const c = await createCampaign(ada.id, "Exec dinner (fake)");
  if (!c.ok) throw new Error(c.error);
  campaignId = c.id;
  personId = await makePerson({ firstName: "Fakey", lastName: "McFake", createdBy: ada.id });
});
afterAll(closeDb);

const as = async (id: number) => jar.set(SESSION_COOKIE, (await createSession(id)).token);
const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const to = (e as { to?: string }).to;
    if (to) return to;
    throw e;
  }
  throw new Error("no redirect");
}
const snapshot = async () => [...(await sql`select id, name, subject, version from campaigns order by id`)];
const saveForm = () => form({ id: String(campaignId), version: "1", name: "Changed (fake)", senderName: "", replyTo: "", subject: "Hi", previewText: "", contentKind: "none", previewPersonId: String(personId) });

describe("campaign actions without a valid session", () => {
  for (const who of ["no session", "deactivated user"] as const) {
    it(`refuses every action for ${who}, before any change or read`, async () => {
      if (who === "deactivated user") await as(alan.id);
      const before = await snapshot();
      const calls: (() => Promise<unknown>)[] = [
        () => actions.createCampaignAction(null, form({ name: "Sneaky (fake)" })),
        () => actions.saveCampaignAction(null, saveForm()),
        () => actions.duplicateCampaignAction(form({ id: String(campaignId) })),
        () => actions.deleteCampaignAction(form({ id: String(campaignId) })),
        () => actions.findPreviewPeople("Fakey"),
        () => actions.previewPerson(personId),
      ];
      for (const call of calls) expect(await redirectOf(call())).toMatch(/^\/auth\/end/);
      expect(await snapshot()).toEqual(before);
    });
  }
});

describe("campaign actions signed in", () => {
  it("creates and opens a draft; a refused name comes back with the typed name", async () => {
    await as(ada.id);
    expect(await actions.createCampaignAction(null, form({ name: " " }))).toMatchObject({ error: "Give the campaign a name.", name: " " });
    const to = await redirectOf(actions.createCampaignAction(null, form({ name: "New one (fake)" })));
    expect(to).toMatch(/^\/campaigns\/\d+$/);
  });

  it("saves and returns the chosen person's values; a person the user cannot see gives null", async () => {
    await as(ada.id);
    const r = await actions.saveCampaignAction(null, saveForm());
    expect(r).toMatchObject({ ok: true, version: 2, message: "Draft saved.", previewPersonId: personId, preview: { first_name: "Fakey" } });
    const hidden = await makePerson({ firstName: "Pat", lastName: "Privatefake", createdBy: alan.id, private: true });
    const fd = saveForm();
    fd.set("version", "2");
    fd.set("previewPersonId", String(hidden));
    expect(await actions.saveCampaignAction(null, fd)).toMatchObject({ ok: true, previewPersonId: hidden, preview: null });
    expect(await actions.findPreviewPeople("Privatefake")).toEqual([]);
    expect(await actions.previewPerson(hidden)).toBeNull();
    expect(await actions.findPreviewPeople("fakey")).toEqual([{ id: personId, name: "Fakey McFake", detail: "" }]);
  });

  it("duplicates to the copy's page, deletes with the notice, and a gone draft gives This campaign no longer exists.", async () => {
    await as(ada.id);
    expect(await redirectOf(actions.duplicateCampaignAction(form({ id: String(campaignId) })))).toMatch(/^\/campaigns\/\d+$/);
    expect(await redirectOf(actions.deleteCampaignAction(form({ id: String(campaignId) })))).toBe("/campaigns");
    expect(await readFlash(["campaign_deleted", "campaign_gone"])).toEqual({ text: 'Campaign "Exec dinner (fake)" deleted.' });
    expect(await redirectOf(actions.deleteCampaignAction(form({ id: String(campaignId) })))).toBe("/campaigns");
    expect(await readFlash(["campaign_deleted", "campaign_gone"])).toEqual({ text: "This campaign no longer exists." });
    expect(await redirectOf(actions.duplicateCampaignAction(form({ id: String(campaignId) })))).toBe("/campaigns");
    expect(await actions.saveCampaignAction(null, saveForm())).toMatchObject({ ok: false, errors: { form: "This campaign no longer exists." } });
  });
});
