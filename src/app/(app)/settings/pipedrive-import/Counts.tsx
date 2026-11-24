// The three counts of steps 2 and 3 (design B): Imported, Linked to CRM records, Not imported.
import type { ImportView } from "@/server/pipedrive/imports";

const n = (x: number) => x.toLocaleString("en-GB");

export function Counts({ totals }: { totals: ImportView["totals"] }) {
  return (
    <div className="tiles">
      <div>
        <div className="big">{n(totals.imported)}</div>
        <div className="k">Imported</div>
      </div>
      <div>
        <div className="big">{n(totals.linked)}</div>
        <div className="k">Linked to CRM records</div>
      </div>
      <div>
        <div className={totals.notImported > 0 ? "big o" : "big"}>{n(totals.notImported)}</div>
        <div className="k">Not imported</div>
      </div>
    </div>
  );
}
