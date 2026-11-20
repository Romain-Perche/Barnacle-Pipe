// Organisations list, design C: same layout as People with its own columns and filters.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { countLabel } from "@/server/format";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { hasFilters, knownSector, parseOrganisationsQuery, withParams, type Params } from "@/server/records/list-query";
import { getOrganisation, listOrganisations, organisationFilterOptions } from "@/server/records/organisations";
import { SIZES, websiteHost } from "@/server/records/rules";
import { Drawer, Field } from "../records/Drawer";
import { Cell, FilterRow, PreviewLink, Select, SortHeader } from "../records/ListBits";
import { Pager } from "../records/Pager";

const PATH = "/organisations";

function Website({ url }: { url: string | null }) {
  if (!url) return <>—</>;
  return (
    <a className="nm" href={url} target="_blank" rel="noopener noreferrer">
      {websiteHost(url)}
    </a>
  );
}

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const parsed = parseOrganisationsQuery(await searchParams);
  const options = await organisationFilterOptions();
  // An unknown sector is dropped before it is used or shown (FR-025): it filters nothing.
  const query = { ...parsed, sector: knownSector(parsed.sector, options.sectors) };
  const [list, flash, open] = await Promise.all([
    listOrganisations(user.id, query),
    readFlash(["organisation_deleted"]),
    query.open ? getOrganisation(user.id, query.open) : null,
  ]);
  const shown = { ...query, page: list.page };
  const link = (changes: Partial<typeof query>) => withParams(PATH, shown, changes);
  const preview = (id: number) => link({ open: id });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CONTACTS
          </div>
          <h1>Organisations</h1>
        </div>
        <div className="head-r">
          <Link className="btn solid" href="/organisations/new">
            [ ADD ORGANISATION ]
          </Link>
          <div className="label count">// {countLabel(list.total, "ORGANISATION")}</div>
        </div>
      </div>

      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}

      <FilterRow id="organisation-filters" path={PATH} q={query.q} searchLabel="Search organisations" archived={query.archived}>
        <Select name="owner" label="Owner" value={query.owner} options={[{ value: "", label: "Any owner" }, ...options.owners.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="sector" label="Sector" value={query.sector} options={[{ value: "", label: "Any sector" }, ...options.sectors.map((s) => ({ value: s, label: s }))]} />
        <Select name="size" label="Size" value={query.size} options={[{ value: "", label: "Any size" }, ...SIZES.map((s) => ({ value: s, label: s }))]} />
        <Select
          name="sort"
          label="Sort by"
          value={query.sort}
          options={[
            { value: "name", label: "Sort: name" },
            { value: "people", label: "Sort: number of people" },
            { value: "added", label: "Sort: date added" },
          ]}
        />
        <Select name="dir" label="Order" value={query.dir} options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} />
      </FilterRow>

      <div className={open ? "listwrap open" : "listwrap"}>
        <div className="listmain">
          {list.rows.length === 0 ? (
            <div className="empty">
              <p>{messages.no_organisations_match}</p>
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
                  <th>Website</th>
                  <th>Sector</th>
                  <th>Size</th>
                  <th>Location</th>
                  <th>Owner</th>
                  <SortHeader label="People" sort="people" query={shown} path={PATH} />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className={open?.id === r.id ? "sel" : undefined} aria-selected={open?.id === r.id ? true : undefined}>
                    <Cell href={preview(r.id)}>
                      <Link className="nm" href={`/organisations/${r.id}`}>
                        {r.name}
                      </Link>
                      {r.archived && <span className="badge off tag">Archived</span>}
                      <PreviewLink href={preview(r.id)} name={r.name} />
                    </Cell>
                    <Cell href={preview(r.id)}>
                      <Website url={r.website} />
                    </Cell>
                    <Cell href={preview(r.id)}>{r.sector ?? "—"}</Cell>
                    <Cell href={preview(r.id)}>{r.size ?? "—"}</Cell>
                    <Cell href={preview(r.id)}>{r.location ?? "—"}</Cell>
                    <Cell href={preview(r.id)}>{r.owner.active ? r.owner.name : `${r.owner.name} (deactivated)`}</Cell>
                    <Cell href={preview(r.id)}>{r.people}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={list.page} pages={list.pages} prevHref={link({ page: list.page - 1 })} nextHref={link({ page: list.page + 1 })} />
        </div>
        {open && (
          <Drawer kind="ORGANISATION" name={open.name} openHref={`/organisations/${open.id}`} closeHref={link({ open: null })}>
            <Field k="Website">{open.website ? <Website url={open.website} /> : null}</Field>
            <Field k="Sector">{open.sector}</Field>
            <Field k="Size">{open.size}</Field>
            <Field k="Location">{open.location}</Field>
            <Field k="Owner">{open.owner.active ? open.owner.name : `${open.owner.name} (deactivated)`}</Field>
            <Field k="People">{open.peopleCount}</Field>
          </Drawer>
        )}
      </div>
    </>
  );
}
