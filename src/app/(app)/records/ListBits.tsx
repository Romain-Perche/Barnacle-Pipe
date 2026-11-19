// Small server pieces shared by the two lists: sortable column headers, the filter row, the row preview link.
import Link from "next/link";
import { withParams, type OrganisationsQuery, type PeopleQuery } from "@/server/records/list-query";
import { AutoSubmit } from "./AutoSubmit";

export function SortHeader<Q extends PeopleQuery | OrganisationsQuery>({
  label, sort, query, path,
}: { label: string; sort: Q["sort"]; query: Q; path: string }) {
  const current = query.sort === sort;
  const dir = current && query.dir === "asc" ? "desc" : "asc";
  return (
    <th aria-sort={current ? (query.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={withParams(path, query, { sort, dir } as Partial<Q>)}>
        {label}
        {current ? (query.dir === "asc" ? " ▲" : " ▼") : ""}
      </Link>
    </th>
  );
}

export function FilterRow({ id, path, q, searchLabel, archived, children }: { id: string; path: string; q: string; searchLabel: string; archived: boolean; children: React.ReactNode }) {
  return (
    <form id={id} className="filters" action={path} method="get" role="search">
      <input className="input search" type="search" name="q" defaultValue={q} placeholder="Search…" aria-label={searchLabel} />
      {children}
      <label className="check">
        <input type="checkbox" name="archived" value="1" defaultChecked={archived} /> Show archived
      </label>
      <button className="btn" type="submit">
        [ APPLY ]
      </button>
      <AutoSubmit formId={id} />
    </form>
  );
}

export function Select({ name, label, value, options }: { name: string; label: string; value: string | number | null; options: { value: string | number; label: string }[] }) {
  return (
    <select className="input sel" name={name} aria-label={label} defaultValue={value === null ? "" : String(value)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// The rest of the row opens the drawer (research.md §6): each cell holds a link stretched over it, under the
// name and organisation links; keyboard and screen-reader users get one "Preview <name>" link per row.
export function PreviewLink({ href, name }: { href: string; name: string }) {
  return (
    <Link className="visually-hidden preview" href={href} scroll={false}>
      Preview {name}
    </Link>
  );
}

export function Cell({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <td className="cell">
      <Link className="cell-link" href={href} scroll={false} aria-hidden="true" tabIndex={-1} />
      {children}
    </td>
  );
}
