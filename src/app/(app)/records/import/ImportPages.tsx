// The four import screens (design B, SF-103 contracts/routes.md § Pages), shared by /people/import and
// /organisations/import. Each calls requireUser() first and shows only the viewer's own import ("Page not found."
// otherwise). Values from the file are React text only; ?error= codes go through an allow-list per step.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { fieldLabel, fieldsFor, type ImportKind } from "@/server/imports/columns";
import { getColumns, getImport, namesForReport, previewImport, type ImportInfo } from "@/server/imports/imports";
import { skipReason, warningText, type Names } from "@/server/imports/text";
import type { Skip, Warning } from "@/server/imports/plan";
import { messages, templates } from "@/server/messages";
import { KIND_LABELS, KINDS, toId } from "@/server/records/rules";
import { FileStep } from "./FileStep";
import { ImportHeader } from "./ImportHeader";
import { importPath, KIND } from "./kinds";
import { StepBar } from "./StepBar";
import { runImport, saveColumns } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;
type Params = Promise<{ id: string }>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
// A fixed message from the allow-list, never the URL's text.
function allowed<T extends string>(code: string, list: readonly T[]): T | null {
  return (list as readonly string[]).includes(code) ? (code as T) : null;
}

// The viewer's own import of this kind, else "Page not found."
async function ownImport(kind: ImportKind, params: Params): Promise<{ userId: number; info: ImportInfo }> {
  const user = await requireUser();
  const id = toId((await params).id);
  const info = id === null ? null : await getImport(user.id, id);
  if (!info || info.kind !== kind) notFound();
  return { userId: user.id, info };
}

const FILE_ERRORS = ["import_not_csv", "import_not_utf8", "import_no_rows", "import_too_large", "import_too_many_rows", "import_upload_failed"] as const;

export async function FilePage({ kind, searchParams }: { kind: ImportKind; searchParams: Search }) {
  const user = await requireUser();
  const query = await searchParams;
  const id = toId(one(query.id));
  const info = id === null ? null : await getImport(user.id, id);
  const chosen =
    info && info.kind === kind && info.status === "ready"
      ? { id: info.id, fileName: info.fileName, rowCount: info.rowCount ?? 0, next: importPath(kind, info.id, "columns") }
      : null;
  return (
    <div className="import">
      <ImportHeader kind={kind} file={chosen ? { name: chosen.fileName, rows: chosen.rowCount } : undefined} />
      <StepBar step={1} />
      <FileStep kind={kind} chosen={chosen} initialError={allowed(one(query.error), FILE_ERRORS)} />
    </div>
  );
}

// The select's options: "Don't import", each field, email and phone once per kind (Work, Personal, Other).
function fieldOptions(kind: ImportKind): { value: string; label: string }[] {
  return [
    { value: "skip", label: messages.import_skip },
    ...fieldsFor(kind).flatMap((f) =>
      f.key === "email" || f.key === "phone"
        ? KINDS.map((k) => ({ value: `${f.key}:${k}`, label: `${f.label} (${KIND_LABELS[k]})` }))
        : [{ value: f.key, label: f.label }],
    ),
  ];
}

const COLUMN_ERRORS = ["import_one_column", "import_person_name_column", "import_organisation_name_column"] as const;

export async function ColumnsPage({ kind, params, searchParams }: { kind: ImportKind; params: Params; searchParams: Search }) {
  const { userId, info } = await ownImport(kind, params);
  if (info.status === "done") redirect(importPath(kind, info.id, "report"));
  const columns = info.status === "ready" ? await getColumns(userId, info.id) : null;
  if (!columns) notFound();
  const query = await searchParams;
  const code = allowed(one(query.error), COLUMN_ERRORS);
  const label = code === "import_one_column" ? fieldLabel(kind, one(query.field)) : undefined;
  const error = code === "import_one_column" ? (label ? templates.import_one_column(label) : null) : code ? messages[code] : null;
  const options = fieldOptions(kind);
  const fullNameIgnored =
    kind === "people" && columns.some((c) => c.field === "full_name") && columns.some((c) => c.field === "first_name" || c.field === "last_name");
  return (
    <div className="import">
      <ImportHeader kind={kind} file={{ name: info.fileName, rows: info.rowCount }} />
      <StepBar step={2} />
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <form action={saveColumns}>
        <input type="hidden" name="id" value={info.id} />
        <table className="users import-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>First values</th>
              <th>Field</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => {
              const name = c.heading.trim() === "" ? `Column ${c.index + 1}` : c.heading;
              const value = c.field === "email" || c.field === "phone" ? `${c.field}:${c.kind}` : c.field;
              return (
                <tr key={c.index}>
                  <td className="nm">{name}</td>
                  <td>
                    {c.samples[0] || "—"}
                    <span className="m">{c.samples[1] || "—"}</span>
                  </td>
                  <td>
                    <select className="input sel" name={`field.${c.index}`} defaultValue={value} aria-label={`Field for ${name}`}>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {fullNameIgnored && <p className="hint">{messages.import_full_name_ignored}</p>}
        <div className="import-acts">
          <Link className="btn" href={`${importPath(kind)}?id=${info.id}`}>
            [ BACK ]
          </Link>
          <button className="btn solid" type="submit">
            [ PREVIEW ]
          </button>
        </div>
      </form>
    </div>
  );
}

function NotImported({ skipped, names }: { skipped: Skip[]; names: Names }) {
  if (skipped.length === 0) return null;
  return (
    <section aria-label="Rows not imported">
      <div className="label sect">
        <span className="c">//</span> ROWS NOT IMPORTED
      </div>
      <table className="users import-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>From the row</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {skipped.map((s) => {
            const reason = skipReason(s, names);
            return (
              <tr key={s.row}>
                <td>{s.row}</td>
                <td>{s.label || "—"}</td>
                <td>{reason.href ? <Link href={reason.href}>{reason.text}</Link> : reason.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Warnings({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Warnings">
      <div className="label sect">
        <span className="c">//</span> WARNINGS
      </div>
      <ul className="import-warnings">
        {warnings.map((w) => (
          <li key={`${w.code}:${w.value}`} className="err">
            {warningText(w).text}
          </li>
        ))}
      </ul>
    </section>
  );
}

const PREVIEW_ERRORS = ["import_consent_required", "import_failed"] as const;

export async function PreviewPage({ kind, params, searchParams }: { kind: ImportKind; params: Params; searchParams: Search }) {
  const { userId, info } = await ownImport(kind, params);
  if (info.status === "done") redirect(importPath(kind, info.id, "report"));
  const preview = await previewImport(userId, info.id);
  if (!("adds" in preview)) notFound();
  const code = allowed(one((await searchParams).error), PREVIEW_ERRORS);
  const people = kind === "people";
  return (
    <div className="import">
      <ImportHeader kind={kind} file={{ name: info.fileName, rows: info.rowCount }} />
      <StepBar step={3} />
      {code && (
        <p className="err" role="alert">
          {messages[code]}
        </p>
      )}
      <div className="tiles">
        <div>
          <div className="big">{preview.adds}</div>
          <div className="k">{people ? "People will be added" : "Organisations will be added"}</div>
        </div>
        {people && (
          <div>
            <div className="big">{preview.newOrganisations.length}</div>
            <div className="k">New organisations</div>
            {preview.newOrganisations.length > 0 && <div className="v">{preview.newOrganisations.join(", ")}</div>}
          </div>
        )}
        <div>
          <div className={preview.skipped.length > 0 ? "big o" : "big"}>{preview.skipped.length}</div>
          <div className="k">Rows not imported</div>
        </div>
      </div>
      {people && preview.withoutEmail > 0 && <p className="notice">{templates.import_without_email(preview.withoutEmail)}</p>}
      <NotImported skipped={preview.skipped} names={preview.names} />
      <Warnings warnings={preview.warnings} />
      <section aria-label={people ? "First people" : "First organisations"}>
        <div className="label sect">
          <span className="c">//</span> {people ? "FIRST PEOPLE AS SAVED" : "FIRST ORGANISATIONS AS SAVED"}
        </div>
        <div className="listmain">
          <table className="users import-table">
            <thead>
              <tr>
                {preview.sample.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form action={runImport}>
        <input type="hidden" name="id" value={info.id} />
        {people && preview.needsConsent > 0 && (
          <fieldset className="consent">
            <legend className="label sect">
              <span className="c">//</span> CONSENT
            </legend>
            <p className="hint">{templates.import_needs_consent(preview.needsConsent)} Choose theirs:</p>
            <div className="radios">
              <label className="check">
                <input type="radio" name="consent" value="subscribed" required /> Subscribed
              </label>
              <label className="check">
                <input type="radio" name="consent" value="unsubscribed" required /> Unsubscribed
              </label>
            </div>
          </fieldset>
        )}
        <div className="import-acts">
          <Link className="btn" href={importPath(kind, info.id, "columns")}>
            [ BACK ]
          </Link>
          <button className="btn solid" type="submit">
            [ IMPORT ]
          </button>
        </div>
      </form>
    </div>
  );
}

export async function ReportPage({ kind, params }: { kind: ImportKind; params: Params }) {
  const { userId, info } = await ownImport(kind, params);
  if (info.status === "ready") redirect(importPath(kind, info.id, "preview"));
  const report = info.report;
  if (!report) notFound();
  const names = await namesForReport(userId, report.skipped);
  return (
    <div className="import">
      <ImportHeader kind={kind} file={{ name: info.fileName, rows: info.rowCount }} />
      <StepBar step={4} />
      <p className="notice" role="status">
        {kind === "people"
          ? templates.import_summary_people(report.imported, report.organisationsAdded, report.skipped.length)
          : templates.import_summary_organisations(report.imported, report.skipped.length)}
      </p>
      {report.organisationsAddedNames.length > 0 && <p className="hint">{report.organisationsAddedNames.join(", ")}</p>}
      <NotImported skipped={report.skipped} names={names} />
      <Warnings warnings={report.warnings} />
      <div className="import-acts">
        <Link className="btn solid" href={KIND[kind].path}>
          Go to {KIND[kind].records}
        </Link>
      </div>
    </div>
  );
}
