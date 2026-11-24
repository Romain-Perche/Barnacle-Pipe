// "// COUNTS" of step 3 REPORT (SF-117 FR-025, US2 scenario 16, design B): per kind, imported, linked, already imported
// and not imported. A row for each ticked kind, and for Organisations when people brought some (counts not all zero).
import type { ImportView } from "@/server/pipedrive/imports";

const n = (x: number) => x.toLocaleString("en-GB");

export function KindCounts({ view }: { view: ImportView }) {
  const { people, organisations } = view.counts;
  const any = (c: typeof people) => c.imported + c.linked + c.already + c.notImported > 0;
  const rows = [
    ...(view.wantPeople ? [{ label: "People", c: people }] : []),
    ...(view.wantOrganisations || any(organisations) ? [{ label: "Organisations", c: organisations }] : []),
  ];
  if (rows.length === 0) return null;
  return (
    <section aria-label="Counts per kind">
      <div className="label sect">
        <span className="c">//</span> COUNTS
      </div>
      <table className="users import-table">
        <thead>
          <tr>
            <th></th>
            <th>Imported</th>
            <th>Linked</th>
            <th>Already imported</th>
            <th>Not imported</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, c }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{n(c.imported)}</td>
              <td>{n(c.linked)}</td>
              <td>{n(c.already)}</td>
              <td>{n(c.notImported)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
