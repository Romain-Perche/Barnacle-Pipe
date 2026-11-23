// Organisations (data-model.md): read, add, edit, archive, restore, delete, list. Organisations are always
// shared; the people shown on them go through the visibility rule.
import { sql, type Sql } from "@/server/db";
import {
  direction,
  isActiveAdmin,
  isUniqueViolation,
  ownerOptions,
  refuse,
  Refused,
  resolveOwner,
  type DeleteResult,
  type Option,
  type SaveResult,
  type UserRef,
} from "@/server/records/common";
import { PAGE_SIZE, type OrganisationsQuery } from "@/server/records/list-query";
import {
  changedOrganisationFields,
  escapeLike,
  validateOrganisation,
  type FieldError,
  type OrganisationFields,
  type OrganisationForm,
  type Size,
} from "@/server/records/rules";
import { recordEvent } from "@/server/records/timeline";
import { visiblePerson } from "@/server/records/visibility";

export type OrganisationView = {
  id: number;
  name: string;
  website: string | null;
  sector: string | null;
  size: Size | null;
  location: string | null;
  owner: UserRef;
  createdAt: Date;
  archived: boolean;
  version: number;
  peopleCount: number;
};

export type OrganisationRow = Omit<OrganisationView, "version" | "peopleCount" | "createdAt"> & { people: number };

const NAME_KEY = "organisations_name_key";

// Visible, non-archived people of an organisation (clarification: archived people are not counted).
function peopleCount(viewerId: number) {
  return sql`(select count(*)::int from persons p
              where p.organisation_id = o.id and p.archived_at is null and ${visiblePerson(sql, viewerId)})`;
}

async function findByName(db: Sql, name: string): Promise<{ id: number; name: string; archived: boolean } | undefined> {
  const [row] = await db<{ id: number; name: string; archived: boolean }[]>`
    select id::int as id, name, archived_at is not null as archived from organisations where lower(name) = lower(${name})`;
  return row;
}

export function exists(org: { id: number; name: string }): FieldError {
  return { code: "organisation_exists", name: org.name, href: `/organisations/${org.id}` };
}

// After a unique-index refusal (two saves at once), name the organisation that won.
async function existsAfterRace(name: string): Promise<FieldError> {
  const org = await findByName(sql, name);
  return org ? exists(org) : { code: "organisation_name_required" };
}

// The organisation a person is saved with (research.md §7): a picked id (an archived one only if it is
// already the person's), or a new one created by name in the same transaction, owned by the actor.
export async function resolveOrganisation(
  db: Sql,
  actorId: number,
  choice: { organisationId: number | null; newOrganisationName: string | null },
  currentId: number | null,
): Promise<{ ok: true; id: number | null } | { ok: false; error: FieldError }> {
  if (choice.organisationId !== null) {
    const [row] = await db<{ archived: boolean }[]>`
      select archived_at is not null as archived from organisations where id = ${choice.organisationId}`;
    if (!row || (row.archived && choice.organisationId !== currentId)) return { ok: true, id: null };
    return { ok: true, id: choice.organisationId };
  }
  const newName = choice.newOrganisationName?.trim();
  if (newName) {
    // A typed name that an organisation already has (ignoring case) links it; an archived one is refused.
    const existing = await findByName(db, newName);
    if (existing && !existing.archived) return { ok: true, id: existing.id };
    if (existing) return { ok: false, error: exists(existing) };
    const [row] = await db<{ id: number }[]>`
      insert into organisations (name, owner_id, created_by) values (${newName}, ${actorId}, ${actorId})
      returning id::int as id`;
    await recordEvent(db, { organisationId: row.id, kind: "added", actorId });
    return { ok: true, id: row.id };
  }
  return { ok: true, id: null };
}

export { existsAfterRace as organisationExistsAfterRace };

export async function getOrganisation(viewerId: number, id: number): Promise<OrganisationView | null> {
  const [r] = await sql<
    (Omit<OrganisationView, "owner"> & { owner_id: number; owner_name: string; owner_active: boolean })[]
  >`
    select o.id::int as id, o.name, o.website, o.sector, o.size, o.location, o.created_at as "createdAt",
           o.archived_at is not null as archived, o.version, ${peopleCount(viewerId)} as "peopleCount",
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active
    from organisations o join users u on u.id = o.owner_id
    where o.id = ${id}`;
  if (!r) return null;
  const { owner_id, owner_name, owner_active, ...rest } = r;
  return { ...rest, owner: { id: owner_id, name: owner_name, active: owner_active } };
}

export async function peopleOf(
  viewerId: number,
  organisationId: number,
): Promise<{ id: number; name: string; role: string | null; email: string | null }[]> {
  return sql`
    select p.id::int as id, btrim(p.first_name || ' ' || p.last_name) as name, p.role,
           (select e.email from person_emails e where e.person_id = p.id order by e.position limit 1) as email
    from persons p
    where p.organisation_id = ${organisationId} and p.archived_at is null and ${visiblePerson(sql, viewerId)}
    order by lower(btrim(p.first_name || ' ' || p.last_name)), p.id`;
}

export async function createOrganisation(actorId: number, form: OrganisationForm): Promise<SaveResult> {
  const v = validateOrganisation(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const existing = await findByName(db, value.name);
      if (existing) refuse({ name: exists(existing) });
      const ownerId = await resolveOwner(db, value.ownerId, actorId, null);
      const [row] = await db<{ id: number }[]>`
        insert into organisations (name, website, sector, size, location, owner_id, created_by)
        values (${value.name}, ${value.website}, ${value.sector}, ${value.size}, ${value.location}, ${ownerId}, ${actorId})
        returning id::int as id`;
      await recordEvent(db, { organisationId: row.id, kind: "added", actorId });
      return { status: "saved" as const, id: row.id };
    });
  } catch (err) {
    if (err instanceof Refused) return err.result as SaveResult;
    if (isUniqueViolation(err, NAME_KEY)) return { status: "invalid", errors: { name: await existsAfterRace(value.name) } };
    throw err;
  }
}

export async function updateOrganisation(actorId: number, id: number, version: number, form: OrganisationForm): Promise<SaveResult> {
  const v = validateOrganisation(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const [cur] = await db<{ version: number; name: string; website: string | null; sector: string | null; size: Size | null; location: string | null; owner_id: number }[]>`
        select version, name, website, sector, size, location, owner_id::int as owner_id
        from organisations where id = ${id} for update`;
      if (!cur) throw new Refused({ status: "not_found" });
      if (cur.version !== version) refuse({ form: { code: "edit_conflict_organisation" } });
      const existing = await findByName(db, value.name);
      if (existing && existing.id !== id) refuse({ name: exists(existing) });
      const ownerId = await resolveOwner(db, value.ownerId, cur.owner_id, cur.owner_id);
      const before: OrganisationFields = { name: cur.name, website: cur.website, sector: cur.sector, size: cur.size, location: cur.location, ownerId: cur.owner_id };
      const after: OrganisationFields = { ...value, ownerId };
      await db`
        update organisations set name = ${after.name}, website = ${after.website}, sector = ${after.sector}, size = ${after.size},
               location = ${after.location}, owner_id = ${ownerId}, version = version + 1
        where id = ${id}`;
      const fields = changedOrganisationFields(before, after);
      if (fields.length > 0) await recordEvent(db, { organisationId: id, kind: "edited", actorId, fields });
      return { status: "saved" as const, id };
    });
  } catch (err) {
    if (err instanceof Refused) return err.result as SaveResult;
    if (isUniqueViolation(err, NAME_KEY)) return { status: "invalid", errors: { name: await existsAfterRace(value.name) } };
    throw err;
  }
}

async function setArchived(actorId: number, id: number, archived: boolean): Promise<"ok" | "not_found"> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [cur] = await db<{ archived: boolean }[]>`
      select archived_at is not null as archived from organisations where id = ${id} for update`;
    if (!cur) return "not_found" as const;
    if (cur.archived !== archived) {
      await db`update organisations set archived_at = ${archived ? db`now()` : null} where id = ${id}`;
      await recordEvent(db, { organisationId: id, kind: archived ? "archived" : "restored", actorId });
    }
    return "ok" as const;
  });
}

export const archiveOrganisation = (actorId: number, id: number) => setArchived(actorId, id, true);
export const restoreOrganisation = (actorId: number, id: number) => setArchived(actorId, id, false);

// Admins only, re-checked here; its people stay, with no organisation (on delete set null).
export async function deleteOrganisation(actorId: number, id: number): Promise<DeleteResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    if (!(await isActiveAdmin(db, actorId))) return { status: "forbidden" as const };
    // SF-109 FR-014: its activities linked to nothing else go with it; the others lose the organisation.
    await db`delete from activities where organisation_id = ${id} and deal_id is null and person_id is null`;
    const [row] = await db<{ name: string }[]>`delete from organisations where id = ${id} returning name`;
    return row ? { status: "deleted" as const, name: row.name } : { status: "not_found" as const };
  });
}

export async function listOrganisations(
  viewerId: number,
  query: OrganisationsQuery,
): Promise<{ rows: OrganisationRow[]; total: number; page: number; pages: number }> {
  const pattern = `%${escapeLike(query.q)}%`;
  const where = sql`
    true
    ${query.archived ? sql`` : sql`and o.archived_at is null`}
    ${query.q ? sql`and (o.name ilike ${pattern} or coalesce(o.website, '') ilike ${pattern})` : sql``}
    ${query.owner !== null ? sql`and o.owner_id = ${query.owner}` : sql``}
    ${query.sector !== null ? sql`and lower(o.sector) = lower(${query.sector})` : sql``}
    ${query.size !== null ? sql`and o.size = ${query.size}` : sql``}`;
  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from organisations o where ${where}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const dir = direction(sql, query.dir);
  const order = {
    name: sql`lower(o.name) ${dir}, o.id ${dir}`,
    people: sql`people ${dir}, lower(o.name) asc, o.id asc`,
    added: sql`o.created_at ${dir}, o.id ${dir}`,
  }[query.sort];
  const rows = await sql<(Omit<OrganisationRow, "owner"> & { owner_id: number; owner_name: string; owner_active: boolean })[]>`
    select o.id::int as id, o.name, o.website, o.sector, o.size, o.location, o.archived_at is not null as archived,
           ${peopleCount(viewerId)} as people,
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active
    from organisations o join users u on u.id = o.owner_id
    where ${where}
    order by ${order}
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  return {
    rows: rows.map(({ owner_id, owner_name, owner_active, ...r }) => ({ ...r, owner: { id: owner_id, name: owner_name, active: owner_active } })),
    total,
    page,
    pages,
  };
}

export async function organisationFilterOptions(): Promise<{ owners: Option[]; sectors: string[] }> {
  const owners = await ownerOptions(sql, sql`exists (select 1 from organisations o where o.owner_id = u.id)`);
  const sectors = await sql<{ sector: string }[]>`
    select (array_agg(sector order by id))[1] as sector from organisations
    where sector is not null group by lower(sector) order by lower(sector)`;
  return { owners, sectors: sectors.map((s) => s.sector) };
}

export async function organisationFormChoices(org: OrganisationView | null): Promise<{ owners: Option[] }> {
  return { owners: await ownerOptions(sql, org ? sql`u.id = ${org.owner.id}` : null) };
}

export function organisationToForm(o: OrganisationView): OrganisationForm {
  return {
    name: o.name,
    website: o.website ?? "",
    sector: o.sector ?? "",
    size: o.size ?? "",
    location: o.location ?? "",
    ownerId: String(o.owner.id),
  };
}
