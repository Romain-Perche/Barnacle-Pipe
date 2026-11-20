// "Why was this deal lost?" in a box over the deal page (design C, SF-95 US2 scenario 2, ?confirm=lost). Server
// rendered, so it works without JavaScript, like DeleteConfirm. The error (empty or too long) shows inside the box.
import Link from "next/link";
import { MAX_LOST_REASON } from "@/server/deals/rules";
import { messages } from "@/server/messages";
import { markLost } from "../actions";

export function LostBox({ dealId, version, error }: { dealId: number; version: number; error: "lost_reason_required" | "lost_reason_too_long" | null }) {
  return (
    <div className="overlay">
      <div className="lostbox" role="dialog" aria-modal="true" aria-labelledby="lost-q">
        <form action={markLost}>
          <input type="hidden" name="id" value={dealId} />
          <input type="hidden" name="version" value={version} />
          <label className="field">
            <span id="lost-q">{messages.lost_question}</span>
            <textarea className="input" name="reason" rows={3} maxLength={MAX_LOST_REASON} autoFocus aria-invalid={error ? true : undefined} />
          </label>
          {error && (
            <p className="ferr" role="alert">
              {messages[error]}
            </p>
          )}
          <div className="form-acts">
            <button className="btn lost-solid" type="submit">
              [ MARK AS LOST ]
            </button>
            <Link className="btn" href={`/deals/${dealId}`}>
              [ CANCEL ]
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
