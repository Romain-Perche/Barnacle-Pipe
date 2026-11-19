// Fake users (data-model.md § Fake data). Clearly fake names, never the real team. Idempotent.
import type { Sql } from "@/server/db";

export const fakeUsers = [
  { email: "ada@barnacle.ai", name: "Ada Fake", role: "admin", status: "active" },
  { email: "grace@barnacle.ai", name: "Grace Fake", role: "admin", status: "active" },
  { email: "linus@barnacle.ai", name: "Linus Fake", role: "user", status: "active" },
  { email: "margaret@barnacle.ai", name: "Margaret Fake", role: "user", status: "active" },
  { email: "alan@barnacle.ai", name: "Alan Fake", role: "user", status: "deactivated" },
] as const;

export async function seedUsers(sql: Sql): Promise<string[]> {
  const lines: string[] = [];
  for (const u of fakeUsers) {
    const created = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: number }[]>`
        insert into users (email, name, role, status) values (${u.email}, ${u.name}, ${u.role}, ${u.status})
        on conflict (email) do nothing returning id::int as id`;
      if (row) await tx`insert into user_changes (user_id, actor_id, action) values (${row.id}, null, 'added')`;
      return Boolean(row);
    });
    lines.push(created ? `created ${u.email} (${u.role}, ${u.status})` : `already there ${u.email}`);
  }
  return lines;
}
