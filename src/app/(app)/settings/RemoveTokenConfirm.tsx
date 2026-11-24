// The confirmation before removing the Pipedrive token (SF-117 US1 scenario 5, ?remove-token=1), in a box over the page.
import Link from "next/link";
import { messages } from "@/server/messages";
import { removeTokenAction } from "./actions";

export function RemoveTokenConfirm() {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="pd-remove-q">
        <p id="pd-remove-q">{messages.pipedrive_remove_confirm}</p>
        <div className="form-acts">
          <form action={removeTokenAction}>
            <button className="btn danger-solid" type="submit">
              [ REMOVE TOKEN ]
            </button>
          </form>
          <Link className="btn" href="/settings" scroll={false}>
            {messages.delete_cancel}
          </Link>
        </div>
      </div>
    </div>
  );
}
