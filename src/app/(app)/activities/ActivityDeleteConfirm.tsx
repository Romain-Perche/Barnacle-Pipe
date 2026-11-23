// "Delete this activity? This can't be undone." (SF-109, ?delete-activity=<id>) in a box over the page, like the
// activity form (design A); no JavaScript dialog.
import Link from "next/link";
import { messages } from "@/server/messages";
import { deleteActivity } from "./actions";

export function ActivityDeleteConfirm({ id, version, back }: { id: number; version: number; back: string }) {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="activity-delete-q">
      <p id="activity-delete-q">{messages.activity_delete_confirm}</p>
      <div className="form-acts">
      <form action={deleteActivity}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="version" value={version} />
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
