// Inline confirmation before deleting a note (SF-102 research.md §9): no JavaScript dialog.
import Link from "next/link";
import { messages } from "@/server/messages";
import { deleteNote } from "./note-actions";
import type { TargetKind } from "./note-target";

export function NoteDeleteConfirm({ target, targetId, noteId, cancelHref }: { target: TargetKind; targetId: number; noteId: number; cancelHref: string }) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm note delete">
      <p>{messages.note_delete_confirm}</p>
      <form action={deleteNote}>
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="noteId" value={noteId} />
        <button className="btn danger-solid" type="submit">
          [ DELETE ]
        </button>
      </form>
      <Link className="btn" href={cancelHref} scroll={false}>
        {messages.delete_cancel}
      </Link>
    </div>
  );
}
