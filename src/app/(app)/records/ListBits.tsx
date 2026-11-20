// Small server pieces shared by the lists (people, organisations, deals): sortable column headers, the filter row, the row preview link.
import Link from "next/link";
import { withParams, type DealsQuery, type OrganisationsQuery, type PeopleQuery } from "@/server/records/list-query";
import { AutoSubmit } from "./AutoSubmit";

export function SortHeader<Q extends PeopleQuery | OrganisationsQuery | DealsQuery>({
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

type Toggle = { name: string; label: string; checked: boolean };

// `toggles`: the checkboxes after the filters (each posts `<name>=1`); by default "Show archived" (people,
// organisations). `clearHref`: a [ CLEAR ] link shown when anything is set (deals).
export function FilterRow({
  id, path, q, searchLabel, archived, toggles, clearHref, children,
}: { id: string; path: string; q: string; searchLabel: string; archived: boolean; toggles?: Toggle[]; clearHref?: string; children: React.ReactNode }) {
  const boxes = toggles ?? [{ name: "archived", label: "Show archived", checked: archived }];
  return (
    <form id={id} className="filters" action={path} method="get" role="search">
      <input className="input search" type="search" name="q" defaultValue={q} placeholder="Search…" aria-label={searchLabel} />
      {children}
      {boxes.map((t) => (
        <label key={t.name} className="check">
          <input type="checkbox" name={t.name} value="1" defaultChecked={t.checked} /> {t.label}
        </label>
      ))}
      <button className="btn" type="submit">
        [ APPLY ]
      </button>
      {clearHref && (
        <Link className="btn" href={clearHref}>
          [ CLEAR ]
        </Link>
      )}
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
