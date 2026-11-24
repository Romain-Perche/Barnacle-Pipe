// "// PIPEDRIVE" on Settings (SF-117 US1, design B): not set up → one line; no token (or [ REPLACE TOKEN ]) → the
// password field (never pre-filled), the note and [ SAVE TOKEN ]; connected → who and which company, the date saved,
// [ REPLACE TOKEN ], [ REMOVE TOKEN ], [ IMPORT FROM PIPEDRIVE ], and an open import's line. The token is never shown,
// not even in part: the page gets the user name, company and date only.
import Link from "next/link";
import { formatDate } from "@/server/format";
import { messages, templates } from "@/server/messages";
import type { ConnectionState } from "@/server/pipedrive/connection";
import type { ImportView } from "@/server/pipedrive/imports";
import { saveTokenAction } from "./actions";
import { RemoveTokenConfirm } from "./RemoveTokenConfirm";

type Props = {
  state: ConnectionState;
  openImport: ImportView | null;
  replace: boolean;
  confirmRemove: boolean;
  error: string | null;
  notice: string | null;
};

export function PipedriveSection({ state, openImport, replace, confirmRemove, error, notice }: Props) {
  const connection = state.ready ? state.connection : null;
  return (
    <section aria-label="Pipedrive" className="pd-section">
      <div className="label sect">
        <span className="c">//</span> PIPEDRIVE
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!state.ready ? (
        <p className="hint">{messages.pipedrive_not_set_up}</p>
      ) : (
        <>
          {connection && (
            <>
              <p className="notice">
                {templates.pipedrive_connected(connection.userName, connection.companyName)}{" "}
                {templates.pipedrive_saved_on(formatDate(connection.savedAt))}
              </p>
              {openImport && (
                <p className="hint">
                  <Link href="/settings/pipedrive-import">{openImport.effectiveState === "paused" ? openImport.pausedText : messages.pipedrive_running}</Link>
                </p>
              )}
              <div className="form-acts">
                <Link className="btn solid" href="/settings/pipedrive-import">
                  [ IMPORT FROM PIPEDRIVE ]
                </Link>
                <Link className="btn" href="/settings?replace=1">
                  [ REPLACE TOKEN ]
                </Link>
                <Link className="btn" href="/settings?remove-token=1" scroll={false}>
                  [ REMOVE TOKEN ]
                </Link>
              </div>
            </>
          )}
          {(!connection || replace) && (
            <form action={saveTokenAction} className="pd-token">
              <label className="field">
                <span className="k">Pipedrive API token</span>
                <input className="input" type="password" name="token" autoComplete="off" spellCheck={false} maxLength={1000} />
              </label>
              <p className="hint">{messages.pipedrive_token_note}</p>
              <div className="form-acts">
                <button className="btn solid" type="submit">
                  [ SAVE TOKEN ]
                </button>
                {connection && (
                  <Link className="btn" href="/settings">
                    {messages.delete_cancel}
                  </Link>
                )}
              </div>
            </form>
          )}
          {connection && confirmRemove && <RemoveTokenConfirm />}
        </>
      )}
    </section>
  );
}
