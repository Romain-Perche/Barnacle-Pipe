// The campaign preview's person (SF-119 research.md §6, §7): the picker's search and one person's merge values. Both go
// through visiblePerson (getPerson applies it) and skip archived people, so a private person's values or name never reach
// a user the private rule hides them from (FR-015). Nothing about the person is stored on the draft.
import { sql } from "@/server/db";
import type { PreviewValues } from "@/server/campaigns/merge";
import { getPerson } from "@/server/records/people";
import { escapeLike } from "@/server/records/rules";
import { visiblePerson } from "@/server/records/visibility";

export type PreviewPerson = { id: number; name: string; detail: string };
export const PICKER_LIMIT = 20;
export const QUERY_MAX = 100;

// Part of a name or of any email address, case-insensitive; `%` and `_` typed literally. At most 20, by name.
export async function searchPreviewPeople(viewerId: number, query: string): Promise<PreviewPerson[]> {
  const q = query.trim();
  if (q === "" || Array.from(q).length > QUERY_MAX) return [];
  const like = `%${escapeLike(q)}%`;
  const rows = await sql<{ id: number; name: string; org: string | null; email: string | null }[]>`
    select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name, o.name as org,
           (select e.email from person_emails e where e.person_id = p.id order by e.position limit 1) as email
    from persons p
    left join organisations o on o.id = p.organisation_id
    where ${visiblePerson(sql, viewerId)} and p.archived_at is null
      and (btrim(p.first_name || ' ' || p.last_name) ilike ${like}
           or exists (select 1 from person_emails pe where pe.person_id = p.id and pe.email ilike ${like}))
    order by lower(btrim(p.first_name || ' ' || p.last_name)), p.id
    limit ${PICKER_LIMIT}`;
  return rows.map((r) => ({ id: r.id, name: r.name, detail: [r.org, r.email].filter(Boolean).join(" · ") }));
}

const orNull = (s: string | null | undefined) => (s ? s : null);

// The values of every merge field for one person, as the person page shows them; null for an empty field. Null when the
// person does not exist, is hidden from the viewer or is archived.
export async function previewValues(viewerId: number, personId: number): Promise<PreviewValues | null> {
  const p = await getPerson(viewerId, personId);
  if (!p || p.archived) return null;
  const values: PreviewValues = {
    first_name: orNull(p.firstName),
    last_name: orNull(p.lastName),
    full_name: orNull(p.name),
    email: orNull(p.emails[0]?.email),
    phone: orNull(p.phones[0]?.phone),
    organisation: orNull(p.organisation?.name),
    role: orNull(p.role),
    lead_source: orNull(p.leadSource?.name),
    linkedin: orNull(p.linkedin),
    owner: orNull(p.owner.name),
    labels: orNull(p.labels.map((l) => l.name).join(", ")),
  };
  for (const d of p.custom) values[`cf:${d.field.id}`] = d.value === null ? null : orNull(d.text);
  return values;
}
