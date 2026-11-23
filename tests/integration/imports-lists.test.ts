// covers FR-007, FR-012, FR-013, SC-004, US3 scenarios 1–5, edge case "Your account is locked" (SF-103)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImport, previewImport, runImport } from "@/server/imports/imports";
import { warningText } from "@/server/imports/text";
import { leadSourceId, makeLabel, makeUser, resetDb, type TestUser } from "./db-helpers";
import { fixture, uploaded } from "./import-helpers";

let ada: TestUser;
let linus: TestUser;
let margaret: TestUser;
let hot: number;
beforeEach(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  linus = await makeUser({ email: "linus@barnacle.ai", name: "Linus Fake" });
  margaret = await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  await makeUser({ email: "alan@barnacle.ai", name: "Alan Fake", status: "deactivated" });
  hot = await makeLabel("Hot");
  await makeLabel("Cold", true);
});
afterAll(closeDb);

const people = () =>
  sql<{ first_name: string; consent: string; owner_id: number; lead_source_id: number | null; labels: number[] }[]>`
    select p.first_name, p.consent, p.owner_id::int as owner_id, p.lead_source_id::int as lead_source_id,
           array(select label_id::int from person_labels where person_id = p.id order by label_id) as labels
    from persons p order by p.id`;

describe("lists-owners-consent.csv", () => {
  it("asks the consent for the 4 people without one; the file's consent always wins (SC-004)", async () => {
    const id = await uploaded(ada.id, "people", fixture("lists-owners-consent.csv"));
    const p = await previewImport(ada.id, id);
    if (!("adds" in p)) throw new Error();
    expect(p.needsConsent).toBe(4);
    expect(await runImport(ada.id, id, null)).toEqual({ status: "consent_required" });
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    const rows = await people();
    expect(rows.map((r) => [r.first_name, r.consent])).toEqual([
      ["Lana", "unsubscribed"], ["Leo", "subscribed"], ["Lily", "unsubscribed"], ["Luke", "subscribed"],
      ["Lena", "subscribed"], ["Lou", "subscribed"], ["Lisa", "unsubscribed"], ["Lars", "subscribed"],
    ]);
  });

  it("gives the unsubscribed choice only to the rows without a consent", async () => {
    const id = await uploaded(ada.id, "people", fixture("lists-owners-consent.csv"));
    await runImport(ada.id, id, "unsubscribed");
    expect((await people()).map((r) => r.consent)).toEqual([
      "unsubscribed", "unsubscribed", "unsubscribed", "unsubscribed", "subscribed", "unsubscribed", "unsubscribed", "unsubscribed",
    ]);
  });

  it("matches lead sources, labels and owners, adds nothing to the lists, warns about the rest", async () => {
    const sourcesBefore = await sql`select * from lead_sources order by id`;
    const labelsBefore = await sql`select * from labels order by id`;
    const id = await uploaded(ada.id, "people", fixture("lists-owners-consent.csv"));
    await runImport(ada.id, id, "subscribed");
    const referral = await leadSourceId("Referral");
    expect((await people()).map((r) => [r.first_name, r.lead_source_id, r.labels, r.owner_id])).toEqual([
      ["Lana", null, [hot], linus.id],
      ["Leo", referral, [hot], linus.id],
      ["Lily", referral, [], ada.id],
      ["Luke", null, [hot], ada.id],
      ["Lena", referral, [], ada.id],
      ["Lou", null, [hot], margaret.id],
      ["Lisa", null, [], ada.id],
      ["Lars", null, [], ada.id],
    ]);
    expect(await sql`select * from lead_sources order by id`).toEqual(sourcesBefore);
    expect(await sql`select * from labels order by id`).toEqual(labelsBefore);
    const report = (await getImport(ada.id, id))!.report!;
    expect(report.warnings.map((w) => warningText(w).text)).toEqual([
      "Lead source not on the list: 'Your account is locked' (row 2)",
      "Owner not found: 'Nobody Fake' (row 4). You are the owner.",
      "Owner not found: 'alan@barnacle.ai' (row 5). You are the owner.",
      "Label not on the list: 'Cold' (row 7)",
    ]);
    // The file's text appears only inside quotes in a warning.
    expect(JSON.stringify(report.skipped)).not.toContain("Your account is locked");
  });
});
