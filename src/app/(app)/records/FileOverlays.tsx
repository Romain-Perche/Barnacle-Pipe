// What a page's address opens over it for files (SF-116 contracts/routes.md § Query parameters): `file=<id>` the image
// preview box, `delete-file=<id>` the delete confirmation. An id only counts when it is a file of this record the viewer
// can see (pageFile): an image for the box; and a record that is not archived for the confirmation. A confirmation for
// a file that is not there sends back to the page with file_gone (deleted meanwhile) or file_not_found. The box makes the
// image's 60-second read address before it opens: Storage unreachable → back to the page with files_unreachable.
import Link from "next/link";
import { redirect } from "next/navigation";
import { addParam } from "@/server/activities/rules";
import { fileAccess, pageFile, type FileTarget } from "@/server/files/files";
import { signedUrl, StorageUnreachable } from "@/server/files/storage";
import { parseId } from "@/server/records/list-query";
import { isImage } from "@/server/files/rules";
import { formatFileSize } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { deleteFileAction } from "./file-actions";
import { targetId, targetKind } from "./note-target";

export type FileQuery = { file?: string; deleteFile?: string };

export async function FileOverlays({ viewerId, target, archived, back, query }: {
  viewerId: number; target: FileTarget; archived: boolean; back: string; query: FileQuery;
}) {
  if (query.deleteFile && !archived) {
    const f = await pageFile(viewerId, query.deleteFile, target);
    if (f) {
      return (
        <div className="overlay">
          <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="file-delete-q">
            <p id="file-delete-q">{templates.file_delete_confirm(f.name)}</p>
            <div className="form-acts">
              <form action={deleteFileAction}>
                <input type="hidden" name="target" value={targetKind(target)} />
                <input type="hidden" name="targetId" value={targetId(target)} />
                <input type="hidden" name="fileId" value={f.id} />
                <input type="hidden" name="back" value={back} />
                <button className="btn danger-solid" type="submit">
                  [ DELETE ]
                </button>
              </form>
              <Link className="btn" href={back} scroll={false}>
                {messages.delete_cancel}
              </Link>
            </div>
          </div>
        </div>
      );
    }
    const access = await fileAccess(viewerId, parseId(query.deleteFile));
    redirect(addParam(back, "error", access.status === "gone" ? "file_gone" : "file_not_found"));
  }
  if (query.file) {
    const f = await pageFile(viewerId, query.file, target);
    if (f && isImage(f.kind)) {
      const access = await fileAccess(viewerId, f.id);
      if (access.status !== "ok") return null;
      let src: string;
      try {
        src = await signedUrl(access.file.storagePath);
      } catch (e) {
        if (!(e instanceof StorageUnreachable)) throw e;
        redirect(addParam(back, "error", "files_unreachable"));
      }
      return (
        <div className="overlay">
          <div className="lostbox filebox" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
            <div className="filebox-head">
              <span id="file-preview-title">
                <b>{f.name}</b> <span className="muted">· {formatFileSize(f.size)}</span>
              </span>
              <span className="filebox-acts">
                <a className="btn" href={`/files/${f.id}/download`}>
                  [ DOWNLOAD ]
                </a>
                <Link className="btn" href={back} scroll={false}>
                  [ CLOSE ]
                </Link>
              </span>
            </div>
            {/* The image comes straight from Storage (a 60-second address made above); no next/image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={f.name} referrerPolicy="no-referrer" />
          </div>
        </div>
      );
    }
  }
  return null;
}
