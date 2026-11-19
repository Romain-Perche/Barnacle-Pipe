import { sql } from "@/server/db";
import { resetAppTables } from "../support/reset";

export async function resetDb() {
  await resetAppTables(sql);
}

export type TestUser = { id: number; email: string; name: string; role: "admin" | "user"; status: "active" | "deactivated" };

export async function makeUser(u: { email: string; name?: string; role?: "admin" | "user"; status?: "active" | "deactivated" }): Promise<TestUser> {
  const [row] = await sql<TestUser[]>`
    insert into users (email, name, role, status)
    values (${u.email}, ${u.name ?? u.email.split("@")[0]}, ${u.role ?? "user"}, ${u.status ?? "active"})
    returning id::int as id, email, name, role, status`;
  return row;
}

export async function getUser(email: string) {
  const [row] = await sql<(TestUser & { last_sign_in_at: Date | null; added_by: number | null })[]>`
    select id::int as id, email, name, role, status, last_sign_in_at, added_by::int as added_by from users where email = ${email}`;
  return row;
}

type Table =
  | "users" | "sessions" | "user_changes" | "persons" | "organisations" | "person_emails" | "person_phones"
  | "person_labels" | "timeline_events" | "lead_sources" | "labels";

export async function count(table: Table): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
  return row.n;
}

// Direct inserts, for setting up a test without going through the code under test.
export async function makeOrganisation(o: { name: string; ownerId: number; archived?: boolean; sector?: string; size?: string; website?: string }) {
  const [row] = await sql<{ id: number }[]>`
    insert into organisations (name, owner_id, created_by, archived_at, sector, size, website)
    values (${o.name}, ${o.ownerId}, ${o.ownerId}, ${o.archived ? new Date() : null}, ${o.sector ?? null}, ${o.size ?? null}, ${o.website ?? null})
    returning id::int as id`;
  return row.id;
}

export async function makePerson(p: {
  firstName?: string; lastName?: string; createdBy: number; ownerId?: number; emails?: string[]; phones?: string[];
  organisationId?: number | null; role?: string; private?: boolean; archived?: boolean; leadSourceId?: number | null;
  labelIds?: number[]; consent?: "subscribed" | "unsubscribed"; createdAt?: Date; lastContactedAt?: Date | null;
}) {
  const [row] = await sql<{ id: number }[]>`
    insert into persons (first_name, last_name, created_by, owner_id, organisation_id, role, private, archived_at,
                         lead_source_id, consent, created_at, last_contacted_at)
    values (${p.firstName ?? "Test"}, ${p.lastName ?? "Person"}, ${p.createdBy}, ${p.ownerId ?? p.createdBy},
            ${p.organisationId ?? null}, ${p.role ?? null}, ${p.private ?? false}, ${p.archived ? new Date() : null},
            ${p.leadSourceId ?? null}, ${p.consent ?? "subscribed"}, ${p.createdAt ?? new Date()}, ${p.lastContactedAt ?? null})
    returning id::int as id`;
  for (const [i, email] of (p.emails ?? []).entries()) {
    await sql`insert into person_emails (person_id, email, position) values (${row.id}, ${email}, ${i})`;
  }
  for (const [i, phone] of (p.phones ?? []).entries()) {
    await sql`insert into person_phones (person_id, phone, position) values (${row.id}, ${phone}, ${i})`;
  }
  for (const labelId of p.labelIds ?? []) await sql`insert into person_labels (person_id, label_id) values (${row.id}, ${labelId})`;
  return row.id;
}

export async function makeLabel(name: string, removed = false) {
  const [row] = await sql<{ id: number }[]>`
    insert into labels (name, removed_at) values (${name}, ${removed ? new Date() : null}) returning id::int as id`;
  return row.id;
}

export async function leadSourceId(name: string) {
  const [row] = await sql<{ id: number }[]>`select id::int as id from lead_sources where name = ${name}`;
  return row.id;
}
