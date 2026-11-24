// The filter controls of the custom fields shown in a list (SF-115 contracts/routes.md § Pages), in the look of the
// built-in filters: text "<name> contains"; from / to inputs for numbers, money and dates; "Any <name>" + choices
// (+ "Empty") for choices; Yes / No / Empty. Values come from knownCustomQuery: choice ids and fixed words select
// among the options; typed words and ranges go back only into their own input. Plus the sort options and the column
// headers and cells of those fields.
import type { CustomField } from "@/server/custom-fields/rules";
import { SORTABLE_TYPES } from "@/server/custom-fields/rules";
import type { CustomQuery, DealsQuery, OrganisationsQuery, PeopleQuery } from "@/server/records/list-query";
import { Cell, Select, SortHeader } from "./ListBits";

type Choices = Record<number, { id: number; name: string }[]>;

export function CustomFilters({ fields, options, custom }: { fields: CustomField[]; options: Choices; custom: CustomQuery }) {
  return (
    <>
      {fields.map((f) => {
        const key = `cf${f.id}`;
        switch (f.type) {
          case "text":
          case "long_text":
            return (
              <input key={f.id} className="input sel" type="search" name={key} defaultValue={custom[key] ?? ""} placeholder={`${f.name} contains`} aria-label={`${f.name} contains`} />
            );
          case "number":
          case "money":
          case "date": {
            const type = f.type === "date" ? "date" : "text";
            const mode = f.type === "date" ? undefined : ("decimal" as const);
            return (
              <span key={f.id} className="cf-range" role="group" aria-label={f.name}>
                <input className="input sel" type={type} inputMode={mode} name={`${key}_from`} defaultValue={custom[`${key}_from`] ?? ""} placeholder={`${f.name} from`} aria-label={`${f.name} from`} />
                <input className="input sel" type={type} inputMode={mode} name={`${key}_to`} defaultValue={custom[`${key}_to`] ?? ""} placeholder="to" aria-label={`${f.name} to`} />
              </span>
            );
          }
          case "single_choice":
          case "multiple_choice":
            return (
              <Select key={f.id} name={key} label={f.name} value={custom[key] ?? ""}
                options={[{ value: "", label: `Any ${f.name}` }, ...(options[f.id] ?? []).map((c) => ({ value: c.id, label: c.name })),
                  ...(f.type === "single_choice" ? [{ value: "empty", label: "Empty" }] : [])]} />
            );
          case "yes_no":
            return (
              <Select key={f.id} name={key} label={f.name} value={custom[key] ?? ""}
                options={[{ value: "", label: `Any ${f.name}` }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "empty", label: "Empty" }]} />
            );
        }
      })}
    </>
  );
}

const sortable = (f: CustomField) => SORTABLE_TYPES.includes(f.type);

// "Sort: <name>" options for the sortable shown fields (the filter row's sort select).
export function customSortOptions(fields: CustomField[]): { value: string; label: string }[] {
  return fields.filter(sortable).map((f) => ({ value: `cf${f.id}`, label: `Sort: ${f.name}` }));
}

// The column headers: a sort link for sortable types.
export function CustomHeaders<Q extends PeopleQuery | OrganisationsQuery | DealsQuery>({ fields, query, path }: { fields: CustomField[]; query: Q; path: string }) {
  return (
    <>
      {fields.map((f) => (sortable(f) ? <SortHeader key={f.id} label={f.name} sort={`cf${f.id}` as Q["sort"]} query={query} path={path} /> : <th key={f.id}>{f.name}</th>))}
    </>
  );
}

// A row's cells: the list text or "—".
export function CustomCells({ fields, cells, href }: { fields: CustomField[]; cells: Record<number, string> | undefined; href?: string }) {
  return (
    <>
      {fields.map((f) =>
        href ? (
          <Cell key={f.id} href={href}>
            {cells?.[f.id] ?? "—"}
          </Cell>
        ) : (
          <td key={f.id}>{cells?.[f.id] ?? "—"}</td>
        ),
      )}
    </>
  );
}
