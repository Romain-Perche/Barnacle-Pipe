// "← People", "Import people", and once a file is chosen its name and row count (as text).
import Link from "next/link";
import type { ImportKind } from "@/server/imports/columns";
import { templates } from "@/server/messages";
import { KIND } from "./kinds";

export function ImportHeader({ kind, file }: { kind: ImportKind; file?: { name: string; rows: number | null } }) {
  const k = KIND[kind];
  return (
    <>
      <Link className="back" href={k.path}>
        ← {k.list}
      </Link>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> {k.section}
          </div>
          <h1>{k.title}</h1>
        </div>
        {file && (
          <div className="head-r">
            <div className="import-file-name">
              {file.name}
              {file.rows !== null ? ` · ${templates.import_rows(file.rows).toUpperCase()}` : ""}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
