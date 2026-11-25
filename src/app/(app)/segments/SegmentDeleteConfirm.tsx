// The delete confirmation of a segment page (?confirm=delete, SF-120 US3 scenario 3): names the segment, says it is deleted
// for the whole team; open to every user (segments are shared). The same .confirm look as records/DeleteConfirm.tsx.
import Link from "next/link";
import { messages, templates } from "@/server/messages";
import { deleteSegmentAction } from "./actions";

export function SegmentDeleteConfirm({ id, name }: { id: number; name: string }) {
  return (
    <div className="confirm" role="alertdialog" aria-label={messages.segment_delete_label}>
      <p>{templates.segment_delete_confirm(name)}</p>
      <form action={deleteSegmentAction}>
        <input type="hidden" name="id" value={id} />
        <button className="btn danger-solid" type="submit">
          {messages.delete_for_good}
        </button>
      </form>
      <Link className="btn" href={`/segments/${id}`}>
        {messages.delete_cancel}
      </Link>
    </div>
  );
}
