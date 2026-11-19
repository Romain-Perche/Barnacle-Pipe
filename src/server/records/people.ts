// People (data-model.md): read, add, edit, archive, restore, delete, list, filter options.
// Every read of `persons` goes through visiblePerson() (a private person: their creator and owner only); every
// change loads the person through it first, inside its transaction, so a private person the actor cannot see
// behaves exactly like a missing one.
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
import { PAGE_SIZE, type PeopleQuery } from "@/server/records/list-query";
import { organisationExistsAfterRace, resolveOrganisation } from "@/server/records/organisations";
import {
  changedPersonFields,
  escapeLike,
  normaliseEmail,
  validatePerson,
  type Consent,
  type FieldError,
  type Kind,
  type PersonFields,
  type PersonForm,
} from "@/server/records/rules";
import { recordEvent } from "@/server/records/timeline";
import { visiblePerson } from "@/server/records/visibility";

export type PersonView = {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  emails: { email: string; kind: Kind }[];
  phones: { phone: string; kind: Kind }[];
  organisation: { id: number; name: string; archived: boolean } | null;
  role: string | null;
  leadSource: Option | null;
  linkedin: string | null;
  owner: UserRef;
  labels: Option[];
  consent: Consent;
  private: boolean;
  createdBy: number;
  createdAt: Date;
  lastContactedAt: Date | null;
  archived: boolean;
  version: number;
};

export type PersonRow = {
  id: number;
  name: string;
  email: string | null;
  organisation: { id: number; name: string; archived: boolean } | null;
  role: string | null;
  owner: UserRef;
  labels: string[];
  leadSource: string | null;
  consent: Consent;
  lastContactedAt: Date | null;
  archived: boolean;
};

const EMAIL_KEY = "person_emails_email_key";
const ORG_NAME_KEY = "organisations_name_key";
// The display name, as SQL (a function: no query is built at import time, so builds never connect).
const NAME = () => sql`btrim(p.first_name || ' ' || p.last_name)`;

export async function getPerson(viewerId: number, id: number, db: Sql = sql): Promise<PersonView | null> {
  const [r] = await db<
    {
      id: number; first_name: string; last_name: string; role: string | null; linkedin_url: string | null; consent: Consent;
      private: boolean; created_by: number; created_at: Date; last_contacted_at: Date | null; archived: boolean; version: number;
      org_id: number | null; org_name: string | null; org_archived: boolean | null; ls_id: number | null; ls_name: string | null;
      owner_id: number; owner_name: string; owner_active: boolean;
    }[]
  >`
    select p.id::int as id, p.first_name, p.last_name, p.role, p.linkedin_url, p.consent, p.private, p.created_by::int as created_by,
           p.created_at, p.last_contacted_at, p.archived_at is not null as archived, p.version,
           o.id::int as org_id, o.name as org_name, o.archived_at is not null as org_archived,
           ls.id::int as ls_id, ls.name as ls_name,
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active
    from persons p
    join users u on u.id = p.owner_id
    left join organisations o on o.id = p.organisation_id
    left join lead_sources ls on ls.id = p.lead_source_id
    where p.id = ${id} and ${visiblePerson(db, viewerId)}`;
  if (!r) return null;
  const emails = await db<{ email: string; kind: Kind }[]>`
    select email, kind from person_emails where person_id = ${id} order by position`;
  const phones = await db<{ phone: string; kind: Kind }[]>`
    select phone, kind from person_phones where person_id = ${id} order by position`;
  const labels = await db<Option[]>`
    select l.id::int as id, l.name from person_labels pl join labels l on l.id = pl.label_id
    where pl.person_id = ${id} order by lower(l.name), l.id`;
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    name: `${r.first_name} ${r.last_name}`.trim(),
    emails: [...emails],
    phones: [...phones],
    organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "", archived: r.org_archived === true },
    role: r.role,
    leadSource: r.ls_id === null ? null : { id: r.ls_id, name: r.ls_name ?? "" },
    linkedin: r.linkedin_url,
    owner: { id: r.owner_id, name: r.owner_name, active: r.owner_active },
    labels: [...labels],
    consent: r.consent,
    private: r.private,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lastContactedAt: r.last_contacted_at,
    archived: r.archived,
    version: r.version,
  };
}

function fieldsOf(p: PersonView): PersonFields {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    emails: p.emails,
    phones: p.phones,
    organisationId: p.organisation?.id ?? null,
    newOrganisationName: null,
    role: p.role,
    leadSourceId: p.leadSource?.id ?? null,
    linkedin: p.linkedin,
    ownerId: p.owner.id,
    labelIds: p.labels.map((l) => l.id).sort((a, b) => a - b),
    consent: p.consent,
    private: p.private,
  };
}

// The first address (in form order) that another person already has, named only if the viewer can see them.
async function emailConflict(db: Sql, viewerId: number, form: PersonForm, excludeId: number | null): Promise<Record<string, FieldError> | null> {
  const wanted = form.emails.map((e) => normaliseEmail(e.value ?? "")).filter((e) => e !== "");
  if (wanted.length === 0) return null;
  const rows = await db<{ email: string; id: number; name: string; visible: boolean }[]>`
    select e.email, p.id::int as id, ${NAME()} as name, ${visiblePerson(db, viewerId)} as visible
    from person_emails e join persons p on p.id = e.person_id
    where e.email in ${db(wanted)} and p.id <> ${excludeId ?? 0}`;
  if (rows.length === 0) return null;
  for (const [i, row] of form.emails.entries()) {
    const hit = rows.find((r) => r.email === normaliseEmail(row.value ?? ""));
    if (hit) {
      return {
        [`emails.${i}`]: hit.visible ? { code: "duplicate_email", name: hit.name, href: `/people/${hit.id}` } : { code: "duplicate_email_hidden" },
      };
    }
  }
  return null;
}

async function allowedLeadSource(db: Sql, requested: number | null, current: number | null): Promise<number | null> {
  if (requested === null || requested === current) return requested;
  const rows = await db`select 1 from lead_sources where id = ${requested} and removed_at is null`;
  return rows.length === 1 ? requested : null;
}

async function allowedLabels(db: Sql, requested: number[], current: number[]): Promise<number[]> {
  if (requested.length === 0) return [];
  const rows = await db<{ id: number }[]>`
    select id::int as id from labels where id = any(${requested}::bigint[]) and (removed_at is null or id = any(${current}::bigint[]))`;
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

async function writeChildren(db: Sql, id: number, value: PersonFields) {
  await db`delete from person_emails where person_id = ${id}`;
  await db`delete from person_phones where person_id = ${id}`;
  await db`delete from person_labels where person_id = ${id}`;
  for (const [position, e] of value.emails.entries()) {
    await db`insert into person_emails (person_id, email, kind, position) values (${id}, ${e.email}, ${e.kind}, ${position})`;
  }
  for (const [position, ph] of value.phones.entries()) {
    await db`insert into person_phones (person_id, phone, kind, position) values (${id}, ${ph.phone}, ${ph.kind}, ${position})`;
  }
  for (const labelId of value.labelIds) await db`insert into person_labels (person_id, label_id) values (${id}, ${labelId})`;
}

// Turns a database refusal from a save racing another one into the same message as the checks above.
async function raceErrors(err: unknown, viewerId: number, form: PersonForm, excludeId: number | null, newOrg: string | null): Promise<SaveResult | null> {
  if (isUniqueViolation(err, EMAIL_KEY)) {
    return { status: "invalid", errors: (await emailConflict(sql, viewerId, form, excludeId)) ?? { "emails.0": { code: "duplicate_email_hidden" } } };
  }
  if (isUniqueViolation(err, ORG_NAME_KEY) && newOrg) {
    return { status: "invalid", errors: { organisation: await organisationExistsAfterRace(newOrg) } };
  }
  return null;
}

export async function createPerson(actorId: number, form: PersonForm): Promise<SaveResult> {
  const v = validatePerson(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const duplicate = await emailConflict(db, actorId, form, null);
      if (duplicate) refuse(duplicate);
      const org = await resolveOrganisation(db, actorId, value, null);
      if (!org.ok) refuse({ organisation: org.error });
      const ownerId = await resolveOwner(db, value.ownerId, actorId, null);
      const leadSourceId = await allowedLeadSource(db, value.leadSourceId, null);
      const labelIds = await allowedLabels(db, value.labelIds, []);
      const [row] = await db<{ id: number }[]>`
        insert into persons (first_name, last_name, organisation_id, role, lead_source_id, linkedin_url, owner_id, consent, private, created_by)
        values (${value.firstName}, ${value.lastName}, ${org.id}, ${value.role}, ${leadSourceId}, ${value.linkedin}, ${ownerId},
                ${value.consent}, ${value.private}, ${actorId})
        returning id::int as id`;
      await writeChildren(db, row.id, { ...value, labelIds });
      await recordEvent(db, { personId: row.id, kind: "added", actorId });
      if (org.id !== null) await recordEvent(db, { organisationId: org.id, kind: "person_linked", actorId, relatedPersonId: row.id });
      return { status: "saved" as const, id: row.id };
    });
  } catch (err) {
    if (err instanceof Refused) return err.result as SaveResult;
    const race = await raceErrors(err, actorId, form, null, value.newOrganisationName);
    if (race) return race;
    throw err;
  }
}

export async function updatePerson(actorId: number, id: number, version: number, form: PersonForm): Promise<SaveResult> {
  const v = validatePerson(form);
  if (!v.ok) return { status: "invalid", errors: v.errors };
  const value = v.value;
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const locked = await db`select id from persons p where p.id = ${id} and ${visiblePerson(db, actorId)} for update`;
      if (locked.length === 0) throw new Refused({ status: "not_found" });
      const current = (await getPerson(actorId, id, db))!;
      if (current.version !== version) refuse({ form: { code: "edit_conflict" } });
      const duplicate = await emailConflict(db, actorId, form, id);
      if (duplicate) refuse(duplicate);
      const before = fieldsOf(current);
      const org = await resolveOrganisation(db, actorId, value, before.organisationId);
      if (!org.ok) refuse({ organisation: org.error });
      const after: PersonFields = {
        ...value,
        newOrganisationName: null,
        organisationId: org.id,
        ownerId: await resolveOwner(db, value.ownerId, current.owner.id, current.owner.id),
        leadSourceId: await allowedLeadSource(db, value.leadSourceId, before.leadSourceId),
        labelIds: await allowedLabels(db, value.labelIds, before.labelIds),
        // The creator or the owner (as before the save) may change the private flag (SF-92 FR-002).
        private: current.createdBy === actorId || current.owner.id === actorId ? value.private : current.private,
      };
      await db`
        update persons set first_name = ${after.firstName}, last_name = ${after.lastName}, organisation_id = ${after.organisationId},
               role = ${after.role}, lead_source_id = ${after.leadSourceId}, linkedin_url = ${after.linkedin}, owner_id = ${after.ownerId},
               consent = ${after.consent}, private = ${after.private}, version = version + 1
        where id = ${id}`;
      await writeChildren(db, id, after);
      const fields = changedPersonFields(before, after);
      if (fields.length > 0) await recordEvent(db, { personId: id, kind: "edited", actorId, fields });
      if (before.organisationId !== after.organisationId) {
        if (before.organisationId !== null) {
          await recordEvent(db, { organisationId: before.organisationId, kind: "person_unlinked", actorId, relatedPersonId: id });
        }
        if (after.organisationId !== null) {
          await recordEvent(db, { organisationId: after.organisationId, kind: "person_linked", actorId, relatedPersonId: id });
        }
      }
      // The save may hide the person from the actor (private, now neither creator nor owner): SF-92 FR-003.
      const [still] = await db<{ name: string; visible: boolean }[]>`
        select ${NAME()} as name, ${visiblePerson(db, actorId)} as visible from persons p where p.id = ${id}`;
      if (!still.visible) return { status: "saved" as const, id, visible: false as const, name: still.name };
      return { status: "saved" as const, id };
    });
  } catch (err) {
    if (err instanceof Refused) return err.result as SaveResult;
    const race = await raceErrors(err, actorId, form, id, value.newOrganisationName);
    if (race) return race;
    throw err;
  }
}

async function setArchived(actorId: number, id: number, archived: boolean): Promise<"ok" | "not_found"> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    const [cur] = await db<{ archived: boolean }[]>`
      select p.archived_at is not null as archived from persons p where p.id = ${id} and ${visiblePerson(db, actorId)} for update`;
    if (!cur) return "not_found" as const;
    if (cur.archived !== archived) {
      await db`update persons set archived_at = ${archived ? db`now()` : null} where id = ${id}`;
      await recordEvent(db, { personId: id, kind: archived ? "archived" : "restored", actorId });
    }
    return "ok" as const;
  });
}

export const archivePerson = (actorId: number, id: number) => setArchived(actorId, id, true);
export const restorePerson = (actorId: number, id: number) => setArchived(actorId, id, false);

// Admins only, re-checked here (SF-92 data-model.md § Deleting a person). Emails, phones, labels and the
// person's own events go with it (on delete cascade). Events about the person on other records stay, with
// related_person_id set to null ("A deleted person …"), unless the person was private: then they go too
// (FR-007). No "unlinked" event is written.
export async function deletePerson(actorId: number, id: number): Promise<DeleteResult> {
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    if (!(await isActiveAdmin(db, actorId))) return { status: "forbidden" as const };
    const [cur] = await db<{ private: boolean }[]>`
      select p.private from persons p where p.id = ${id} and ${visiblePerson(db, actorId)} for update`;
    if (!cur) return { status: "not_found" as const };
    if (cur.private) await db`delete from timeline_events where related_person_id = ${id}`;
    const [row] = await db<{ name: string }[]>`delete from persons p where p.id = ${id} returning ${NAME()} as name`;
    return { status: "deleted" as const, name: row.name };
  });
}

export async function listPeople(
  viewerId: number,
  query: PeopleQuery,
): Promise<{ rows: PersonRow[]; total: number; page: number; pages: number }> {
  const pattern = `%${escapeLike(query.q)}%`;
  const where = sql`
    ${visiblePerson(sql, viewerId)}
    ${query.archived ? sql`` : sql`and p.archived_at is null`}
    ${query.q
      ? sql`and ((p.first_name || ' ' || p.last_name) ilike ${pattern}
                 or (p.last_name || ' ' || p.first_name) ilike ${pattern}
                 or exists (select 1 from person_emails e where e.person_id = p.id and e.email ilike ${pattern})
                 or o.name ilike ${pattern})`
      : sql``}
    ${query.owner !== null ? sql`and p.owner_id = ${query.owner}` : sql``}
    ${query.label !== null ? sql`and exists (select 1 from person_labels pl where pl.person_id = p.id and pl.label_id = ${query.label})` : sql``}
    ${query.source !== null ? sql`and p.lead_source_id = ${query.source}` : sql``}
    ${query.org !== null ? sql`and p.organisation_id = ${query.org}` : sql``}
    ${query.consent !== null ? sql`and p.consent = ${query.consent}` : sql``}`;
  const [{ total }] = await sql<{ total: number }[]>`
    select count(*)::int as total from persons p left join organisations o on o.id = p.organisation_id where ${where}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const dir = direction(sql, query.dir);
  const order = {
    name: sql`lower(${NAME()}) ${dir}, p.id ${dir}`,
    organisation: sql`lower(o.name) ${dir} nulls last, lower(${NAME()}) asc, p.id asc`,
    added: sql`p.created_at ${dir}, p.id ${dir}`,
    contacted: sql`p.last_contacted_at ${dir} nulls last, lower(${NAME()}) asc, p.id asc`,
  }[query.sort];
  const rows = await sql<
    {
      id: number; name: string; email: string | null; org_id: number | null; org_name: string | null; org_archived: boolean | null;
      role: string | null; owner_id: number; owner_name: string; owner_active: boolean; labels: string[]; lead_source: string | null;
      consent: Consent; last_contacted_at: Date | null; archived: boolean;
    }[]
  >`
    select p.id::int as id, ${NAME()} as name,
           (select e.email from person_emails e where e.person_id = p.id order by e.position limit 1) as email,
           o.id::int as org_id, o.name as org_name, o.archived_at is not null as org_archived, p.role,
           u.id::int as owner_id, u.name as owner_name, u.status = 'active' as owner_active,
           array(select l.name from person_labels pl join labels l on l.id = pl.label_id
                 where pl.person_id = p.id order by lower(l.name)) as labels,
           ls.name as lead_source, p.consent, p.last_contacted_at, p.archived_at is not null as archived
    from persons p
    join users u on u.id = p.owner_id
    left join organisations o on o.id = p.organisation_id
    left join lead_sources ls on ls.id = p.lead_source_id
    where ${where}
    order by ${order}
    limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      organisation: r.org_id === null ? null : { id: r.org_id, name: r.org_name ?? "", archived: r.org_archived === true },
      role: r.role,
      owner: { id: r.owner_id, name: r.owner_name, active: r.owner_active },
      labels: r.labels,
      leadSource: r.lead_source,
      consent: r.consent,
      lastContactedAt: r.last_contacted_at,
      archived: r.archived,
    })),
    total,
    page,
    pages,
  };
}

// Filter options (contracts/list-query.md): values offered plus those still used by a person the viewer can see.
export async function peopleFilterOptions(
  viewerId: number,
  selectedOrg: number | null,
): Promise<{ owners: Option[]; labels: Option[]; sources: Option[]; organisations: Option[] }> {
  const visible = visiblePerson(sql, viewerId);
  const owners = await ownerOptions(sql, sql`exists (select 1 from persons p where p.owner_id = u.id and ${visible})`);
  const labels = await sql<Option[]>`
    select l.id::int as id, l.name from labels l
    where l.removed_at is null
       or exists (select 1 from person_labels pl join persons p on p.id = pl.person_id where pl.label_id = l.id and ${visible})
    order by lower(l.name), l.id`;
  const sources = await sql<Option[]>`
    select ls.id::int as id, ls.name from lead_sources ls
    where ls.removed_at is null or exists (select 1 from persons p where p.lead_source_id = ls.id and ${visible})
    order by ls.id`;
  const organisations = await sql<Option[]>`
    select o.id::int as id, o.name from organisations o
    where exists (select 1 from persons p where p.organisation_id = o.id and ${visible}) or o.id = ${selectedOrg ?? 0}
    order by lower(o.name), o.id`;
  return { owners, labels: [...labels], sources: [...sources], organisations: [...organisations] };
}

// What the person form offers: active owners, non-removed lead sources and labels, non-archived
// organisations, plus whatever the person already has.
export async function personFormChoices(
  _viewerId: number,
  person: PersonView | null,
): Promise<{ owners: Option[]; leadSources: Option[]; labels: Option[]; organisations: { id: number; name: string; archived: boolean }[] }> {
  const owners = await ownerOptions(sql, person ? sql`u.id = ${person.owner.id}` : null);
  const leadSources = await sql<Option[]>`
    select id::int as id, name from lead_sources where removed_at is null or id = ${person?.leadSource?.id ?? 0} order by id`;
  const labels = await sql<Option[]>`
    select id::int as id, name from labels where removed_at is null or id = any(${person?.labels.map((l) => l.id) ?? []}::bigint[])
    order by lower(name), id`;
  const organisations = await sql<{ id: number; name: string; archived: boolean }[]>`
    select id::int as id, name, archived_at is not null as archived from organisations
    where archived_at is null or id = ${person?.organisation?.id ?? 0} order by lower(name), id`;
  return { owners, leadSources: [...leadSources], labels: [...labels], organisations: [...organisations] };
}

export function personToForm(p: PersonView): PersonForm {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    emails: p.emails.map((e) => ({ value: e.email, kind: e.kind })),
    phones: p.phones.map((e) => ({ value: e.phone, kind: e.kind })),
    organisationId: p.organisation ? String(p.organisation.id) : "",
    newOrganisationName: "",
    role: p.role ?? "",
    leadSourceId: p.leadSource ? String(p.leadSource.id) : "",
    linkedin: p.linkedin ?? "",
    ownerId: String(p.owner.id),
    labelIds: p.labels.map((l) => String(l.id)),
    consent: p.consent,
    private: p.private,
  };
}

