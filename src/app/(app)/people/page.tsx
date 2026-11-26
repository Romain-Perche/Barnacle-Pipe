// People list, design C: search and a filter row above a Users-style table, preview drawer on the right.
// Everything is in the page address (contracts/list-query.md).
import OpenOnDoubleClick from "../records/OpenOnDoubleClick";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { countLabel, formatDate } from "@/server/format";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { listShownFields } from "@/server/custom-fields/fields";
import { customColumns, customFilterOptions } from "@/server/custom-fields/values";
import { hasFilters, knownCustomQuery, knownPeopleQuery, parsePeopleQuery, withParams, type Params } from "@/server/records/list-query";
import { getPerson, listPeople, peopleFilterOptions } from "@/server/records/people";
import { CONSENT_LABELS, KIND_LABELS } from "@/server/records/rules";
import { Drawer, Field } from "../records/Drawer";
import { CustomCells, CustomFilters, CustomHeaders, customSortOptions } from "../records/CustomFilters";
import { Cell, FilterRow, PreviewLink, Select, SortHeader } from "../records/ListBits";
import { Pager } from "../records/Pager";

const PATH = "/people";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const parsed = parsePeopleQuery(await searchParams);
  const [options, fields] = await Promise.all([peopleFilterOptions(user.id, parsed.org), listShownFields("person")]);
  // SF-115: only filters and a sort of the custom fields shown in the list, with valid values.
  const query = knownCustomQuery(knownPeopleQuery(parsed, options), fields);
  const [list, flash, open, choiceOptions] = await Promise.all([
    listPeople(user.id, query, fields),
    readFlash(["person_deleted", "person_no_longer_visible", "note_not_found", "file_not_found"]),
    query.open ? getPerson(user.id, query.open) : null,
    customFilterOptions(user.id, "person", fields),
  ]);
  const cells = await customColumns("person", fields, list.rows.map((r) => r.id));
  const shown = { ...query, page: list.page };
  const link = (changes: Partial<typeof query>) => withParams(PATH, shown, changes);
  const preview = (id: number) => link({ open: id });

  return (
    <>
      <OpenOnDoubleClick />
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CONTACTS
          </div>
          <h1>People</h1>
        </div>
        <div className="head-r">
          <div className="head-acts">
            <Link className="btn" href="/people/import">
              [ IMPORT CSV ]
            </Link>
            <Link className="btn solid" href="/people/new">
              [ ADD PERSON ]
            </Link>
          </div>
          <div className="label count">// {countLabel(list.total, "PERSON", "PEOPLE")}</div>
        </div>
      </div>

      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}

      <FilterRow id="people-filters" path={PATH} q={query.q} searchLabel="Search people" archived={query.archived}>
        <Select name="owner" label="Owner" value={query.owner} options={[{ value: "", label: "Any owner" }, ...options.owners.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="label" label="Label" value={query.label} options={[{ value: "", label: "Any label" }, ...options.labels.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="source" label="Lead source" value={query.source} options={[{ value: "", label: "Any lead source" }, ...options.sources.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="org" label="Organisation" value={query.org} options={[{ value: "", label: "Any organisation" }, ...options.organisations.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="ref" label="Referred by" value={query.ref} options={[{ value: "", label: "Any referrer" }, ...options.referrers.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="consent" label="Consent" value={query.consent} options={[{ value: "", label: "Any consent" }, { value: "subscribed", label: "Subscribed" }, { value: "unsubscribed", label: "Unsubscribed" }]} />
        <CustomFilters fields={fields} options={choiceOptions} custom={query.custom} />
        <Select
          name="sort"
          label="Sort by"
          value={query.sort}
          options={[
            { value: "name", label: "Sort: name" },
            { value: "organisation", label: "Sort: organisation" },
            { value: "added", label: "Sort: date added" },
            { value: "contacted", label: "Sort: last contacted" },
            ...customSortOptions(fields),
          ]}
        />
        <Select name="dir" label="Order" value={query.dir} options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} />
      </FilterRow>

      <div className={open ? "listwrap open" : "listwrap"}>
        <div className="listmain">
          {list.rows.length === 0 ? (
            <div className="empty">
              <p>{messages.no_people_match}</p>
              {(hasFilters(query) || query.archived) && (
                <Link className="btn" href={PATH}>
                  [ CLEAR FILTERS ]
                </Link>
              )}
            </div>
          ) : (
            <table className="users list">
              <thead>
                <tr>
                  <SortHeader label="Name" sort="name" query={shown} path={PATH} />
                  <SortHeader label="Organisation" sort="organisation" query={shown} path={PATH} />
                  <th>Role</th>
                  <th>Owner</th>
                  <th>Labels</th>
                  <th>Lead source</th>
                  <th>Consent</th>
                  <SortHeader label="Last contacted" sort="contacted" query={shown} path={PATH} />
                  <CustomHeaders fields={fields} query={shown} path={PATH} />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} data-page={`/people/${r.id}`} className={open?.id === r.id ? "sel" : undefined} aria-selected={open?.id === r.id ? true : undefined}>
                    <Cell href={preview(r.id)}>
                      <Link className="nm" href={`/people/${r.id}`}>
                        {r.name}
                      </Link>
                      {r.archived && <span className="badge off tag">Archived</span>}
                      <span className="em">{r.email ?? ""}</span>
                      <PreviewLink href={preview(r.id)} name={r.name} />
                    </Cell>
                    <Cell href={preview(r.id)}>
                      {r.organisation ? (
                        <>
                          <Link className="nm" href={`/organisations/${r.organisation.id}`}>
                            {r.organisation.name}
                          </Link>
                          {r.organisation.archived && <span className="badge off tag">Archived</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </Cell>
                    <Cell href={preview(r.id)}>{r.role ?? "—"}</Cell>
                    <Cell href={preview(r.id)}>{r.owner.active ? r.owner.name : `${r.owner.name} (deactivated)`}</Cell>
                    <Cell href={preview(r.id)}>{r.labels.length > 0 ? r.labels.join(", ") : "—"}</Cell>
                    <Cell href={preview(r.id)}>{r.leadSource ?? "—"}</Cell>
                    <Cell href={preview(r.id)}>{CONSENT_LABELS[r.consent]}</Cell>
                    <Cell href={preview(r.id)}>{r.lastContactedAt ? formatDate(r.lastContactedAt) : "Never"}</Cell>
                    <CustomCells fields={fields} cells={cells.get(r.id)} href={preview(r.id)} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={list.page} pages={list.pages} prevHref={link({ page: list.page - 1 })} nextHref={link({ page: list.page + 1 })} />
        </div>
        {open && (
          <Drawer kind="PERSON" name={open.name} openHref={`/people/${open.id}`} closeHref={link({ open: null })}>
            <Field k="Organisation">
              {open.organisation || open.role ? (
                <>
                  {open.organisation && <Link href={`/organisations/${open.organisation.id}`}>{open.organisation.name}</Link>}
                  {open.organisation && open.role ? " · " : ""}
                  {open.role}
                </>
              ) : null}
            </Field>
            <Field k="Email">{open.emails[0] ? `${open.emails[0].email} (${KIND_LABELS[open.emails[0].kind]})` : null}</Field>
            <Field k="Phone">{open.phones[0] ? `${open.phones[0].phone} (${KIND_LABELS[open.phones[0].kind]})` : null}</Field>
            <Field k="Lead source">{open.leadSource?.name ?? null}</Field>
            <Field k="Consent">{CONSENT_LABELS[open.consent]}</Field>
          </Drawer>
        )}
      </div>
    </>
  );
}
