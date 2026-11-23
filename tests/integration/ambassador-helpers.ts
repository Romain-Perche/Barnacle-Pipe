// SF-114 setup helpers: direct SQL (setup without the code under test).
import { sql } from "@/server/db";
import { makePerson } from "./db-helpers";

type PersonInput = Parameters<typeof makePerson>[0];

export async function makeAmbassador(p: PersonInput): Promise<number> {
  const id = await makePerson(p);
  await sql`update persons set is_ambassador = true where id = ${id}`;
  return id;
}

// Sets "Referred by" directly, with `referred_at` (default now).
export async function refer(kind: "person" | "deal", id: number, ambassadorId: number | null, at: Date = new Date()) {
  if (kind === "person") await sql`update persons set referred_by_id = ${ambassadorId}, referred_at = ${ambassadorId ? at : null} where id = ${id}`;
  else await sql`update deals set referred_by_id = ${ambassadorId}, referred_at = ${ambassadorId ? at : null} where id = ${id}`;
}

export async function setDeal(id: number, status: "open" | "won" | "lost") {
  await sql`update deals set status = ${status}, closed_at = ${status === "open" ? null : new Date()},
                             lost_reason = ${status === "lost" ? "Fake reason" : null} where id = ${id}`;
}

export async function events(target: { personId: number } | { dealId: number }) {
  const where = "personId" in target ? sql`person_id = ${target.personId}` : sql`deal_id = ${target.dealId}`;
  return sql<{ kind: string; actor_id: number | null; related_person_id: number | null; from_person_id: number | null; cause: string | null }[]>`
    select kind, actor_id::int as actor_id, related_person_id::int as related_person_id, from_person_id::int as from_person_id, cause
    from timeline_events where ${where} order by id`;
}

export async function referral(kind: "person" | "deal", id: number) {
  const [row] =
    kind === "person"
      ? await sql<{ referred_by_id: number | null; referred_at: Date | null; is_ambassador: boolean; version: number }[]>`
          select referred_by_id::int as referred_by_id, referred_at, is_ambassador, version from persons where id = ${id}`
      : await sql<{ referred_by_id: number | null; referred_at: Date | null; is_ambassador: boolean; version: number }[]>`
          select referred_by_id::int as referred_by_id, referred_at, false as is_ambassador, version from deals where id = ${id}`;
  return row;
}
