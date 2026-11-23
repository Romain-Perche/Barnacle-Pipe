// Inline confirmation before deleting a note (SF-102 research.md §9): no JavaScript dialog.
import Link from "next/link";
import { messages } from "@/server/messages";
import { deleteNote } from "./note-actions";
import type { TargetKind } from "./note-target";

// `timeline`: how many entries the page shows (?timeline=), kept after the delete.
export function NoteDeleteConfirm({
  target, targetId, noteId, cancelHref, timeline,
}: { target: TargetKind; targetId: number; noteId: number; cancelHref: string; timeline: number }) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm note delete">
      <p>{messages.note_delete_confirm}</p>
      <form action={deleteNote}>
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="noteId" value={noteId} />
        <input type="hidden" name="timeline" value={timeline} />
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
