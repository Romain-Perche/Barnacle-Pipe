// Step 3 REPORT (SF-117 US2 scenario 16, FR-025, design B): the counts, "Already imported: n", "Stopped by you before
// the end." when stopped, "// NOT IMPORTED" (Pipedrive record, reason), the report's lines, the warnings on single
// records, links to People and Organisations, and [ NEW IMPORT ]. Pipedrive names are text nodes only; CRM people are
// named only when the viewer can see them (names come from namesForReport).
import Link from "next/link";
import { messages, templates } from "@/server/messages";
import type { ImportView } from "@/server/pipedrive/imports";
import { itemText, reportLines, warningLines, type Names } from "@/server/pipedrive/report";
import { Counts } from "./Counts";

const KIND_WORD = { person: "Person", organisation: "Organisation" } as const;

export function ReportStep({ view, names }: { view: ImportView; names: Names }) {
  const lines = reportLines(view.report, names);
  const warnings = warningLines(view.report, names);
  return (
    <>
      <Counts totals={view.totals} />
      <p className="hint">{templates.pipedrive_already(view.totals.already)}</p>
      {view.stoppedByUser && (
        <p className="notice" role="status">
          {messages.pipedrive_stopped_by_you}
        </p>
      )}
      {view.report.notImported.length > 0 && (
        <section aria-label="Not imported">
          <div className="label sect">
            <span className="c">//</span> NOT IMPORTED
          </div>
          <table className="users import-table">
            <thead>
              <tr>
                <th>Pipedrive record</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {view.report.notImported.map((r) => (
                <tr key={`${r.kind}:${r.pipedriveId}`}>
                  <td>
                    {KIND_WORD[r.kind]} · {r.label}
                  </td>
                  <td>{itemText(r, names)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {lines.length > 0 && (
        <section aria-label="Report">
          <ul className="import-warnings">
            {lines.map((l, i) => (
              <li key={i} className="err">
                {l.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section aria-label="Warnings">
          <div className="label sect">
            <span className="c">//</span> WARNINGS
          </div>
          <table className="users import-table">
            <thead>
              <tr>
                <th>Pipedrive record</th>
                <th>Warning</th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((w, i) => (
                <tr key={i}>
                  <td>
                    {KIND_WORD[w.kind]} · {w.label}
                  </td>
                  <td>{w.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="import-acts">
        <Link className="btn solid" href="/people">
          Go to people
        </Link>
        <Link className="btn" href="/organisations">
          Go to organisations
        </Link>
        <Link className="btn" href="/settings/pipedrive-import?new=1">
          [ NEW IMPORT ]
        </Link>
      </div>
    </>
  );
}
