// The confirmation before stopping an import (SF-117 US3 scenario 6, ?stop=1), in a box over the page.
import Link from "next/link";
import { messages } from "@/server/messages";
import { stopPipedriveImportAction } from "./actions";

export function StopConfirm() {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="pd-stop-q">
        <p id="pd-stop-q">{messages.pipedrive_stop_confirm}</p>
        <div className="form-acts">
          <form action={stopPipedriveImportAction}>
            <button className="btn danger-solid" type="submit">
              [ STOP IMPORT ]
            </button>
          </form>
          <Link className="btn" href="/settings/pipedrive-import" scroll={false}>
            {messages.delete_cancel}
          </Link>
        </div>
      </div>
    </div>
  );
}
