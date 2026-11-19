import { sql } from "@/server/db";

export async function resetDb() {
  await sql`truncate user_changes, sessions, users restart identity cascade`;
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

export async function count(table: "users" | "sessions" | "user_changes"): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
  return row.n;
}
