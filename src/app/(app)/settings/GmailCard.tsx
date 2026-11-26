// The Gmail card on Settings (SF-118 contracts/routes.md § Gmail card, design B): a heading with a green or red dot and
// the buttons on the right, then label/value lines. Only the user's own connection; never the key. Times in UK time.
// SF-124 (design A): one more line, "Calendar: …", and while Calendar access is missing the reconnect message and
// [ RECONNECT GMAIL ] beside [ SEND ME A TEST EMAIL ].
// SF-128 (design B, data-model.md § Card state): the "// PAST EMAILS" part after the lines: [ FETCH PAST EMAILS ] or
// FETCHING…, then its lines; PastFetchRunner moves a running fetch on while the page is open.
import Link from "next/link";
import { formatDateTime } from "@/server/format";
import type { GmailSettings } from "@/server/gmail/connections";
import { messages, templates } from "@/server/messages";
import { sendTestEmail, startGmailConnect, startPastFetchAction } from "./actions";
import { PastFetchRunner } from "./PastFetchRunner";
import { GmailDisconnectConfirm } from "./GmailDisconnectConfirm";

type Props = { gmail: GmailSettings; notice: string | null; error: string | null; confirmDisconnect: boolean };

export function GmailCard({ gmail, notice, error, confirmDisconnect }: Props) {
  const on = gmail.mode !== "off";
  const connected = gmail.state !== "not_connected";
  const heading =
    gmail.state === "working" ? (
      <>
        <span className="dot" aria-hidden="true" />
        Gmail · connected
      </>
    ) : gmail.state === "needs_reconnect" ? (
      <>
        <span className="dot bad" aria-hidden="true" />
        Gmail · needs reconnecting
      </>
    ) : (
      <>Gmail</>
    );
  return (
    <section aria-label="Gmail" className="gm-section">
      <div className="label sect">
        <span className="c">//</span> GMAIL
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
      <div className="gm-card">
        <div className="gm-hd">
          <h2>{heading}</h2>
          {on && (
            <div className="gm-acts">
              {gmail.state === "not_connected" && (
                <form action={startGmailConnect}>
                  <button className="btn solid" type="submit">
                    [ CONNECT GMAIL ]
                  </button>
                </form>
              )}
              {(gmail.state === "needs_reconnect" || gmail.calendar === "missing") && (
                <form action={startGmailConnect}>
                  <button className="btn solid" type="submit">
                    [ RECONNECT GMAIL ]
                  </button>
                </form>
              )}
              {gmail.state === "working" && (
                <form action={sendTestEmail}>
                  <button className="btn" type="submit">
                    [ SEND ME A TEST EMAIL ]
                  </button>
                </form>
              )}
              {connected && (
                <Link className="btn red" href="/settings?disconnect=1" scroll={false}>
                  [ DISCONNECT ]
                </Link>
              )}
            </div>
          )}
        </div>
        {!connected ? (
          <p className="hint">{on ? messages.gmail_not_connected : messages.gmail_unavailable}</p>
        ) : (
          <>
            {gmail.state === "needs_reconnect" && <p className="err">{templates.gmail_needs_reconnect(gmail.email ?? "")}</p>}
            {gmail.calendar === "missing" && <p className="err">{messages.calendar_reconnect}</p>}
            <ul className="gm-lines">
              {gmail.state === "working" && <li>{templates.gmail_connected_as(gmail.email ?? "")}</li>}
              <li>{templates.gmail_last_sync(gmail.lastSyncedAt ? formatDateTime(gmail.lastSyncedAt) : messages.gmail_not_synced)}</li>
              <li>{templates.gmail_conversations(gmail.conversations)}</li>
              {gmail.connectedAt && <li>{templates.gmail_copying_since(formatDateTime(gmail.connectedAt))}</li>}
              {gmail.calendar !== "off" && (
                <li>{templates.calendar_line(gmail.calendar === "syncing" ? messages.calendar_syncing : messages.calendar_missing)}</li>
              )}
            </ul>
            {on && <PastEmails gmail={gmail} />}
          </>
        )}
      </div>
      {on && connected && confirmDisconnect && <GmailDisconnectConfirm />}
    </section>
  );
}

function PastEmails({ gmail }: { gmail: GmailSettings }) {
  const f = gmail.pastFetch;
  const working = gmail.state === "working";
  return (
    <>
      <div className="gm-sub" aria-label="Past emails">
        <span className="label">
          <span className="c">//</span> PAST EMAILS
        </span>
        {f.state === "running" ? (
          <span className="gm-run" role="status">
            <span className="spin" aria-hidden="true" />
            {messages.past_emails_fetching}
          </span>
        ) : (
          working && (
            <form action={startPastFetchAction}>
              <button className="btn" type="submit">
                [ FETCH PAST EMAILS ]
              </button>
            </form>
          )
        )}
        {f.state === "running" && working && <PastFetchRunner waitSeconds={f.waitSeconds} />}
      </div>
      {f.state === "none" && <p className="gm-pd hint">{messages.past_emails_explain}</p>}
      {f.state === "running" && (
        <>
          <p className="gm-pd">{templates.past_emails_progress(f.copied)}</p>
          {f.paused ? (
            <p className="gm-pd err">{messages.past_emails_paused}</p>
          ) : (
            <>
              {f.unreachable && <p className="gm-pd err">{messages.past_emails_unreachable}</p>}
              <p className="gm-pd hint">{messages.past_emails_leave}</p>
            </>
          )}
        </>
      )}
      {f.state === "ended" && (
        <>
          <p className="gm-pd">{templates.past_emails_done(f.copied)}</p>
          <p className="gm-pd hint">{templates.past_emails_last(formatDateTime(f.endedAt))}</p>
        </>
      )}
    </>
  );
}
