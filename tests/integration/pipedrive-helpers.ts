// SF-117 test helpers: connect a user to the fake Pipedrive, run an import to its end (waits fast-forwarded in the
// database, never slept), and the spec's small account (30 people, 10 organisations: spec US2 Independent Test).
import { sql } from "@/server/db";
import type { FakePipedrive } from "@/server/pipedrive/fake-pipedrive";
import { saveToken } from "@/server/pipedrive/connection";
import { runPart, startImport } from "@/server/pipedrive/imports";

export const COMPANY = 1001;
export const OTHER_COMPANY = 1002;
export const LINUS_TOKEN = "test-token-linus";
export const MARGARET_TOKEN = "test-token-margaret";
export const OTHER_TOKEN = "test-token-other";

// Registers the company, its three Pipedrive users and the tokens in the fake (Fake Person's email is Linus Fake's).
export function fakeCompany(fake: FakePipedrive) {
  fake.addCompany({ token: LINUS_TOKEN, user: { id: 1, name: "Fake Person", email: "linus@barnacle.ai" }, companyId: COMPANY, companyName: "Fakeco Pipedrive" });
  fake.addCompany({ token: MARGARET_TOKEN, user: { id: 2, name: "Margaret Pipedrive Fake", email: "margaret@barnacle.ai" }, companyId: COMPANY, companyName: "Fakeco Pipedrive" });
  fake.addUser(COMPANY, { id: 3, name: "Jane Fake", email: "jane@fake.example" });
  fake.addCompany({ token: OTHER_TOKEN, user: { id: 50, name: "Other Person Fake", email: "other@fake.example" }, companyId: OTHER_COMPANY, companyName: "Otherco Pipedrive" });
}

export async function connect(userId: number, token: string) {
  const r = await saveToken(userId, token);
  if (!("ok" in r)) throw new Error(`connect: ${r.error}`);
}

export async function start(userId: number, o: { people?: boolean; organisations?: boolean; consent?: "subscribed" | "unsubscribed" | null } = {}) {
  const r = await startImport(userId, { people: o.people ?? true, organisations: o.organisations ?? true, consent: o.consent === undefined ? "unsubscribed" : o.consent });
  if (!("id" in r)) throw new Error(`start: ${r.error}`);
  return r.id;
}

// Calls runPart until it answers `stop`; a `wait` is fast-forwarded in the database instead of slept.
export async function runToEnd(userId: number, id: number, max = 500): Promise<{ parts: number; waits: number }> {
  let parts = 0;
  let waits = 0;
  for (; parts < max; parts++) {
    const r = await runPart(userId, id);
    if (r.next === "stop") return { parts: parts + 1, waits };
    if (r.next === "wait") {
      waits += 1;
      await skipWait(id);
    }
  }
  throw new Error(`runToEnd: still running after ${max} parts`);
}

export async function skipWait(id: number) {
  await sql`update pipedrive_imports set wait_until = now() - interval '1 second', seen_at = now() where id = ${id} and state = 'waiting'`;
}

export async function importRow(id: number) {
  const [row] = await sql<{ state: string; pause_reason: string | null; step: string; people_done: number; organisations_done: number; people_total: number | null; organisations_total: number | null; wait_until: Date | null }[]>`
    select state, pause_reason, step, people_done, organisations_done, people_total, organisations_total, wait_until from pipedrive_imports where id = ${id}`;
  return row;
}

export const FIELD = {
  job: "fake_field_job",
  source: "fake_field_source",
  linkedin: "fake_field_linkedin",
  budget: "fake_field_budget",
  colour: "fake_field_colour",
  region: "fake_field_region",
} as const;

// The spec's 30 people and 10 organisations (US2 Independent Test). The CRM side (labels "Hot", lead source "Referral",
// custom field "Budget", the existing person and organisation) is set up by the tests.
export function smallAccount(fake: FakePipedrive) {
  fakeCompany(fake);
  fake.addField(COMPANY, "person", { field_code: "label_ids", field_name: "Labels", field_type: "set", is_custom_field: false, options: [{ id: 1, label: "Hot" }, { id: 2, label: "Cold" }] });
  fake.addField(COMPANY, "person", { field_code: FIELD.job, field_name: "Job title", field_type: "varchar", is_custom_field: true });
  fake.addField(COMPANY, "person", { field_code: FIELD.source, field_name: "Lead source", field_type: "enum", is_custom_field: true, options: [{ id: 11, label: "Referral" }, { id: 12, label: "Webinar" }] });
  fake.addField(COMPANY, "person", { field_code: FIELD.linkedin, field_name: "LinkedIn", field_type: "varchar", is_custom_field: true });
  fake.addField(COMPANY, "person", { field_code: FIELD.budget, field_name: "Budget", field_type: "double", is_custom_field: true });
  fake.addField(COMPANY, "person", { field_code: FIELD.colour, field_name: "Favourite colour", field_type: "varchar", is_custom_field: true });
  fake.addField(COMPANY, "organization", { field_code: "industry", field_name: "Industry", field_type: "enum", is_custom_field: false, options: [{ id: 21, label: "Software" }, { id: 22, label: "Retail" }] });
  fake.addField(COMPANY, "organization", { field_code: FIELD.region, field_name: "Region", field_type: "address", is_custom_field: true });

  const org = {
    fakeco: fake.addOrganization(COMPANY, { name: "FAKECO LTD", owner_id: 1 }),
    sample: fake.addOrganization(COMPANY, {
      name: "Sample Studios Fake", owner_id: 2, address: { value: "1 Fake Street, London" }, website: "samplestudios.example", industry: 21, employee_count: 12,
      custom_fields: { [FIELD.region]: { value: "London" } },
    }),
    ownerOnly: fake.addOrganization(COMPANY, { name: "Owner Only Org Fake", owner_id: 3, visible_to: 1 }),
    badSize: fake.addOrganization(COMPANY, { name: "Zero Staff Fake", owner_id: 1, employee_count: 0 }),
    others: [] as number[],
  };
  for (let i = 5; i <= 10; i++) org.others.push(fake.addOrganization(COMPANY, { name: `Org ${i} Fake`, owner_id: 1, industry: 22 }));

  const e = (value: string, label = "work", primary = true) => ({ value, primary, label });
  const person = {
    // Already in the CRM by email (the test adds the CRM person): linked, not changed.
    existing: fake.addPerson(COMPANY, { first_name: "Ada", last_name: "Example", owner_id: 1, emails: [e("ada.example@fake.example")] }),
    full: fake.addPerson(COMPANY, {
      first_name: "Grace", last_name: "Fulldata", owner_id: 2, org_id: org.sample, add_time: "2024-05-06 07:08:09",
      emails: [e("home.grace@fake.example", "home", false), e("grace@fake.example", "work", true)],
      phones: [e("020 7946 0001", "work", false), e("07700 900001", "mobile", false), e("01632 960001", "home", false)],
      label_ids: [1, 2], job_title: "", marketing_status: "subscribed",
      custom_fields: { [FIELD.job]: "Fake CTO", [FIELD.source]: 11, [FIELD.linkedin]: "https://www.linkedin.com/in/grace-fake", [FIELD.budget]: 1500, [FIELD.colour]: "Teal" },
    }),
    unsubscribed: fake.addPerson(COMPANY, { first_name: "Una", last_name: "Unsubfake", owner_id: 1, org_id: org.fakeco, marketing_status: "unsubscribed", emails: [e("una@fake.example")] }),
    ownerOnlyMargaret: fake.addPerson(COMPANY, { first_name: "Priya", last_name: "Privatefake", owner_id: 2, visible_to: 1, emails: [e("priya@fake.example")] }),
    ownerOnlyJane: fake.addPerson(COMPANY, { first_name: "Jo", last_name: "Janefake", owner_id: 3, visible_to: 1 }),
    jane: fake.addPerson(COMPANY, { first_name: "Jack", last_name: "Janefake", owner_id: 3 }),
    dupFirst: fake.addPerson(COMPANY, { first_name: "Dot", last_name: "Firstfake", owner_id: 1, emails: [e("dup@fake.example")] }),
    dupSecond: fake.addPerson(COMPANY, { first_name: "Dan", last_name: "Secondfake", owner_id: 1, emails: [e("DUP@fake.example")] }),
    webinar: fake.addPerson(COMPANY, { first_name: "Wes", last_name: "Webinarfake", owner_id: 1, custom_fields: { [FIELD.source]: 12 } }),
    fullName: fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "Ada May Example", owner_id: 1 }),
    noName: fake.addPerson(COMPANY, { first_name: "", last_name: "", name: "", owner_id: 1, emails: [e("noname@fake.example")] }),
    badEmail: fake.addPerson(COMPANY, { first_name: "Bea", last_name: "Bademail", owner_id: 1, emails: [e("bea@"), e("bea@fake.example", "home", false)] }),
    others: [] as number[],
  };
  for (let i = 13; i <= 30; i++) {
    person.others.push(
      fake.addPerson(COMPANY, {
        first_name: `Person${i}`, last_name: "Fake", owner_id: 1, org_id: org.others[i % 6], emails: [e(`person${i}@fake.example`)],
        custom_fields: i % 6 === 0 ? { [FIELD.source]: 12 } : {}, label_ids: i % 5 === 0 ? [2] : [],
      }),
    );
  }
  return { org, person };
}
