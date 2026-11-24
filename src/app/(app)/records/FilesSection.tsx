// "// FILES (<n>)" of a deal, person or organisation page and of the deal drawer (SF-116 design A, contracts/routes.md
// § Record pages): [ ADD FILE ] in the heading (not on archived records), the notices of a file delete, then a table of
// the record's own files the viewer can see, newest first: Name | Kind | Size | Added by | Added | [ PREVIEW ] (images
// and PDFs) [ DOWNLOAD ] [ DELETE ] (not on archived records). "No files yet." when there are none.
import Link from "next/link";
import { addParam } from "@/server/activities/rules";
import { listFiles, type FileTarget } from "@/server/files/files";
import { isPreviewable, kindLabel } from "@/server/files/rules";
import { formatDate, formatFileSize } from "@/server/format";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { AddFiles } from "./AddFiles";
import { FileLink } from "./FileLink";
import { targetId, targetKind } from "./note-target";

export const FILE_ERRORS = ["file_not_found", "file_gone", "files_archived", "files_unreachable", "file_record_not_found"] as const;

// `back`: the page the section is on, without box parameters (the record page, or the drawer's address).
export async function FilesSection({ viewerId, target, archived, back, error }: {
  viewerId: number; target: FileTarget; archived: boolean; back: string; error?: string;
}) {
  const [rows, flash] = await Promise.all([listFiles(viewerId, target), readFlash(["file_deleted"])]);
  const code = FILE_ERRORS.find((c) => c === error);
  return (
    <section aria-label="Files" className="files">
      <div className="label sect sect-row">
        <span>
          <span className="c">//</span> FILES ({rows.length})
        </span>
        {!archived && <AddFiles kind={targetKind(target)} id={targetId(target)} />}
      </div>
      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      {code && (
        <p className="err" role="alert">
          {messages[code]}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">{messages.no_files}</p>
      ) : (
        <table className="list files-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th className="num">Size</th>
              <th>Added by</th>
              <th>Added</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} id={`file-${f.id}`}>
                <td className="fname">
                  <FileLink file={f} page={back} className="nm">
                    {f.name}
                  </FileLink>
                </td>
                <td>
                  <span className="ft">{kindLabel(f.name, f.kind)}</span>
                </td>
                <td className="num">{formatFileSize(f.size)}</td>
                <td>{f.addedByActive ? f.addedByName : `${f.addedByName} (deactivated)`}</td>
                <td className="nowrap">{formatDate(f.addedAt)}</td>
                <td className="num facts">
                  {isPreviewable(f.kind) && (
                    <FileLink file={f} page={back} className="btn link" label={`Preview ${f.name}`}>
                      [ PREVIEW ]
                    </FileLink>
                  )}
                  <a className="btn link" href={`/files/${f.id}/download`} aria-label={`Download ${f.name}`}>
                    [ DOWNLOAD ]
                  </a>
                  {!archived && (
                    <Link className="btn link red" href={addParam(back, "delete-file", f.id)} scroll={false} aria-label={`Delete ${f.name}`}>
                      [ DELETE ]
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
