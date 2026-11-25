// covers SF-122 US1 scenario 8, Edge case 8, Edge case 9, FR-021, SC-005 (fix round 1): a record private to another
// owner, or put on a record the importer cannot see, is never named in the importer's report: its items have an empty
// label and args.privateKind, and nothing taken from the record itself. The same records seen by the importer keep
// their names.
import { describe, expect, it } from "vitest";
import type { PdActivity, PdDeal, PdFile, PdNote, PdPerson } from "@/server/pipedrive/api";
import { planPersonPage, type PersonLookups } from "@/server/pipedrive/page";
import { planActivityPage, planDealPage, planFileItem, planNotePage, type DealLookups, type RecordLookups } from "@/server/pipedrive/records-page";
import { itemLabel, itemText, warningLines } from "@/server/pipedrive/report";
import { emptyReport } from "@/server/pipedrive/report";
import { planFields } from "@/server/pipedrive/rules";

const NOW = new Date("2026-11-24T12:00:00Z");
const LINUS = 10;
const MARGARET = 11;
const pdUsers = { "1": { name: "Fake Person", email: "linus@barnacle.ai" }, "2": { name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" } };
const users = new Map([["linus@barnacle.ai", LINUS], ["margaret@barnacle.ai", MARGARET]]);
const SECRET = "SF122 Margaret secret";
const names = { people: new Map<number, string>(), organisations: new Map<number, string>(), deals: new Map<number, string>() };

const deal = (d: Partial<PdDeal> = {}): PdDeal => ({
  id: 7, title: `${SECRET} USD`, ownerId: 2, personId: null, orgId: null, stageId: 10, value: 10, currency: "USD", addTime: "2025-01-02 03:04:05",
  updateTime: "2025-06-01 00:00:00", stageChangeTime: "", status: "open", lostReason: "", visibleTo: 1, wonTime: "", lostTime: "", closeTime: "",
  expectedCloseDate: "", labelIds: [], archived: false, deleted: false, followersCount: 0, participantsCount: 0, custom: {}, ...d,
});
const dealLookups = (): DealLookups => ({
  importerId: LINUS, linked: new Set(), links: { deals: new Map(), persons: new Map(), organisations: new Map() }, names: new Map(), stageMap: { "10": 500 },
  users, pdUsers, labels: new Map(), fields: planFields("deal", [], []), participants: new Map(), followers: new Map(), now: NOW,
});
const person = (p: Partial<PdPerson> = {}): PdPerson => ({
  id: 1, name: "", firstName: SECRET, lastName: "Person", ownerId: 2, orgId: 40, addTime: "2025-01-02 03:04:05", emails: [], phones: [], visibleTo: 1,
  labelIds: [], jobTitle: "", marketingStatus: null, custom: {}, deleted: false, ...p,
});
const personLookups = (): PersonLookups => ({
  importerId: LINUS, links: new Map(), emails: new Map(), linkedFrom: new Map(), consents: new Map(), organisations: new Map(),
  orgsNotImported: new Map([[40, "Gone Org Fake"]]), leadSources: new Map(), labels: new Map(), users, pdUsers,
  fields: planFields("person", [], []), consent: "unsubscribed",
});
// Pipedrive deal 70 → CRM deal 700, hidden from Linus; Pipedrive deal 71 → CRM deal 701, seen by him.
const recordLookups = (): RecordLookups => ({
  importerId: LINUS, linked: new Set(), names: new Map(), users, pdUsers, now: NOW,
  links: { deals: new Map([[70, 700], [71, 701]]), persons: new Map([[80, 800]]), organisations: new Map() },
  hidden: new Set(["deal:700", "person:800"]),
});
const note = (n: Partial<PdNote> = {}): PdNote => ({ id: 3, active: true, addTime: "2025-10-16 14:45:00", content: `${SECRET} note ${"x".repeat(100_001)}`, dealId: 70, personId: null, orgId: null, leadId: "", userId: 2, ...n });
const act = (a: Partial<PdActivity> = {}): PdActivity => ({
  id: 9, subject: `${SECRET} ${"s".repeat(200)}`, type: "call", ownerId: 2, deleted: false, addTime: "2026-10-01 08:00:00", updateTime: "2026-10-02 08:00:00",
  dealId: 70, leadId: "", personId: null, orgId: null, projectId: null, dueDate: "2026-12-01", dueTime: "", duration: "", done: false, doneTime: "", note: "", ...a,
});
const file = (f: Partial<PdFile> = {}): PdFile => ({
  id: 5, active: true, addTime: "2026-01-01 00:00:00", name: `${SECRET} video.mp4`, size: 27_000_000, userId: 2, dealId: null, personId: 80, orgId: null,
  leadId: "", mailMessageId: "", remoteLocation: "", ...f,
});

const unnamed = (plan: unknown, kind: string) => {
  const text = JSON.stringify(plan);
  expect(text).not.toContain(SECRET);
  return kind;
};
const privateItems = (items: { label: string; args?: Record<string, unknown> }[], kind: string) => {
  expect(items.length).toBeGreaterThan(0);
  for (const i of items) {
    expect(i.label).toBe("");
    expect(i.args?.privateKind).toBe(kind);
  }
};

describe("planDealPage", () => {
  it("does not name a deal private to another owner in its warnings", () => {
    const plan = planDealPage([deal()], dealLookups());
    privateItems(plan.warnings, "deal");
    expect(JSON.stringify({ warnings: plan.warnings, notImported: plan.notImported })).not.toContain(SECRET);
    expect(itemLabel(plan.warnings[0])).toBe("a private deal");
    expect(warningLines({ ...emptyReport(), warnings: plan.warnings }, names)[0]).toEqual({ kind: "deal", label: "a private deal", text: "Value in USD, not GBP: left out." });
  });
  it("names the same deal when the importer owns it, or when it is shared", () => {
    expect(planDealPage([deal({ ownerId: 1 })], dealLookups()).warnings[0].label).toBe(`${SECRET} USD`);
    expect(planDealPage([deal({ visibleTo: 3 })], dealLookups()).warnings[0].label).toBe(`${SECRET} USD`);
  });
});

describe("planPersonPage", () => {
  it("does not name a person private to another owner in its warnings, nor in another person's reason", () => {
    const dup = person({ id: 2, firstName: "Dup", lastName: "Fake", ownerId: 1, visibleTo: 3, orgId: null, emails: [{ value: "same@fake.example", primary: true, label: "work" }] });
    const plan = planPersonPage([person({ emails: [{ value: "same@fake.example", primary: true, label: "work" }] }), dup], personLookups());
    privateItems(plan.warnings, "person");
    expect(itemLabel(plan.warnings[0])).toBe("a private person");
    expect(JSON.stringify({ warnings: plan.warnings, notImported: plan.notImported })).not.toContain(SECRET);
    expect(itemText(plan.notImported[0], names)).toBe("Another Pipedrive person has the same email address.");
  });
  it("names a person the importer owns", () => {
    expect(planPersonPage([person({ ownerId: 1 })], personLookups()).warnings[0].label).toBe(`${SECRET} Person`);
  });
});

describe("planNotePage", () => {
  it("does not name a note not imported from a hidden deal", () => {
    const plan = planNotePage([note()], recordLookups());
    privateItems(plan.notImported, "note");
    unnamed(plan.notImported, "note");
    expect(itemLabel(plan.notImported[0])).toBe("a private note");
  });
  it("names the same note on a deal the importer sees", () => {
    expect(planNotePage([note({ dealId: 71 })], recordLookups()).notImported[0].label).toContain(SECRET);
  });
});

describe("planActivityPage", () => {
  it("does not name an activity on a hidden deal, refused or warned", () => {
    const l = { ...recordLookups(), types: {} };
    const refused = planActivityPage([act()], l);
    privateItems(refused.notImported, "activity");
    unnamed(refused.notImported, "activity");
    expect(itemLabel(refused.notImported[0])).toBe("a private activity");
    const warned = planActivityPage([act({ subject: `${SECRET} call`, note: "n".repeat(10_001) })], l);
    privateItems(warned.warnings, "activity");
    unnamed(warned.warnings, "activity");
  });
  it("names the same activity on a deal the importer sees", () => {
    expect(planActivityPage([act({ dealId: 71 })], { ...recordLookups(), types: {} }).notImported[0].label).toContain(SECRET);
  });
});

describe("planFileItem", () => {
  it("does not name a file over 25 MB, or with a long name, on a hidden person", () => {
    const big = planFileItem(file(), recordLookups(), {});
    expect(big.kind).toBe("notImported");
    if (big.kind !== "notImported") return;
    privateItems([big.item], "file");
    unnamed(big, "file");
    expect(itemLabel(big.item)).toBe("a private file");
    const long = planFileItem(file({ size: 10, name: `${SECRET} ${"n".repeat(260)}.pdf` }), recordLookups(), {});
    if (long.kind !== "notImported") throw new Error(long.kind);
    unnamed(long, "file");
    expect(itemText(long.item, names)).toBe("a private file has a name over 255 characters.");
  });
  it("names the same file on a person the importer sees", () => {
    const r = planFileItem(file({ personId: null, dealId: 71 }), recordLookups(), {});
    expect(r.kind === "notImported" && r.item.label).toBe(`${SECRET} video.mp4`);
  });
});
