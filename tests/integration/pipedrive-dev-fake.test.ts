// covers SF-117 FR-030, contracts/pipedrive-api.md § The fake: the development fake's own data (tokens
// fake-pipedrive-token / fake-pipedrive-other) passes the schema checks and imports end to end, covering the spec's cases
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/server/db";
import { buildDevFake, DEV_OTHER_TOKEN, DEV_TOKEN } from "@/server/pipedrive/fake-pipedrive";
import { getImportView } from "@/server/pipedrive/imports";
import { namesForReport, reportLines } from "@/server/pipedrive/report";
import { installFakePipedrive, TEST_PIPEDRIVE_KEY } from "../fakes/pipedrive";
import { makeUser, resetDb } from "./db-helpers";
import { connect, runToEnd, start } from "./pipedrive-helpers";

let ada: { id: number };
beforeEach(async () => {
  vi.stubEnv("PIPEDRIVE_TOKEN_KEY", TEST_PIPEDRIVE_KEY);
  vi.stubEnv("PIPEDRIVE_URL", "");
  await resetDb();
  ada = await makeUser({ email: "ada@barnacle.ai", name: "Ada Fake", role: "admin" });
  await makeUser({ email: "margaret@barnacle.ai", name: "Margaret Fake" });
  await sql`insert into labels (name) values ('Hot'), ('Investor')`;
  installFakePipedrive(buildDevFake());
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("the development fake Pipedrive", () => {
  it("imports its 60 organisations and 300 people, with the spec's cases in the report", async () => {
    await connect(ada.id, DEV_TOKEN);
    await runToEnd(ada.id, await start(ada.id, { consent: "unsubscribed" }));
    const view = (await getImportView(ada.id))!;
    expect(view.state).toBe("finished");
    expect(view.progress).toEqual([{ kind: "organisations", done: 60, total: 60 }, { kind: "people", done: 300, total: 300 }]);
    // Organisation 60's name is over 200 characters; person 99 has no name; person 17 shares person001's email.
    expect(view.counts.organisations.notImported).toBe(1);
    expect(view.report.notImported.filter((n) => n.kind === "person").map((n) => n.code).sort()).toEqual(["pipedrive_email_other_person", "pipedrive_no_name"]);
    const lines = reportLines(view.report, await namesForReport(ada.id, view.report)).map((l) => l.text);
    expect(lines).toContain("No CRM field named 'Favourite colour'.");
    expect(lines).toContain("'Region' is an address field in Pipedrive: not imported.");
    expect(lines.some((l) => l.startsWith("Owner 'Jane Fake' (jane@fake.example) has no CRM user:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Lead source not on the list: 'Webinar'"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Label not on the list: 'Cold'"))).toBe(true);
    expect(view.report.privateOthers).toBeGreaterThan(0);
  });
  it("accepts the other company's token and refuses any other", async () => {
    await connect(ada.id, DEV_OTHER_TOKEN);
    const { saveToken, getConnection } = await import("@/server/pipedrive/connection");
    expect(await getConnection(ada.id)).toMatchObject({ connection: { companyName: "Otherco Pipedrive" } });
    expect(await saveToken(ada.id, "wrong")).toEqual({ error: "pipedrive_token_refused" });
  });
});
