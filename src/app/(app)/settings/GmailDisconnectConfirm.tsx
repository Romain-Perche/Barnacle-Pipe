// The confirmation before disconnecting Gmail (SF-118 US4 scenario 1, ?disconnect=1), in a box over the page, with the
// same look as the other delete confirmations.
import Link from "next/link";
import { messages } from "@/server/messages";
import { disconnectGmail } from "./actions";

export function GmailDisconnectConfirm() {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="gm-disconnect-q">
        <p id="gm-disconnect-q">{messages.gmail_disconnect_confirm}</p>
        <div className="form-acts">
          <form action={disconnectGmail}>
            <button className="btn danger-solid" type="submit">
              [ DISCONNECT ]
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
