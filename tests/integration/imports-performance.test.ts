// covers SC-002: a 5,000-row file is previewed and imported, each in under 60 seconds, with 2,000 people in the CRM
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/server/db";
import { getImport, previewImport, runImport } from "@/server/imports/imports";
import { count, makeOrganisation, makeUser, resetDb, type TestUser } from "./db-helpers";
import { uploaded, utf8 } from "./import-helpers";

let ada: TestUser;
beforeAll(async () => {
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake" });
  await makeOrganisation({ name: "Fakeco Ltd", ownerId: ada.id });
  await sql`
    with p as (
      insert into persons (first_name, last_name, owner_id, created_by)
      select 'Existing', 'Fake ' || i, ${ada.id}, ${ada.id} from generate_series(1, 2000) i returning id)
    insert into person_emails (person_id, email, position) select id, 'existing' || id || '@fakeco.example', 0 from p`;
});
afterAll(closeDb);

describe("5,000 rows", () => {
  it("previews and imports each in under 60 seconds", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) =>
      [`First${i}`, `Fake${i}`, i % 10 === 0 ? `existing${(i % 2000) + 1}@fakeco.example` : `p${i}@fakeco.example`, "+44 20 7946 0000", i % 3 === 0 ? "Fakeco Ltd" : `Org Fake ${i % 50}`, "COO", "Referral", "Hot"].join(","),
    );
    const id = await uploaded(ada.id, "people", utf8(`First name,Last name,Email,Phone,Organisation,Job title,Lead source,Labels\n${lines.join("\n")}\n`));
    let t = Date.now();
    const preview = await previewImport(ada.id, id);
    expect(Date.now() - t).toBeLessThan(60_000);
    if (!("adds" in preview)) throw new Error();
    expect(preview.adds).toBe(4500);
    t = Date.now();
    expect(await runImport(ada.id, id, "subscribed")).toEqual({ status: "done" });
    expect(Date.now() - t).toBeLessThan(60_000);
    expect(await count("persons")).toBe(6500);
    const added = (await getImport(ada.id, id))?.report?.organisationsAdded ?? 0;
    expect(added).toBeGreaterThan(40);
    expect(await count("organisations")).toBe(1 + added);
  });
});
