// One email of the conversation page (SF-127 design B): sender and address, Gmail's date and time, To / Cc / Bcc, the
// full text as plain text in a pre-wrap block, and its attachments with [ DOWNLOAD ] (a plain <a>: the route answers a
// download or a redirect, never a page to prefetch). Text nodes only: no email HTML is ever put in the page (FR-004).
import { formatDateTime, formatFileSize } from "@/server/format";
import type { ConversationEmail } from "@/server/emails/conversations";
import { addressText } from "@/server/emails/rules";
import { messages } from "@/server/messages";

const list = (xs: ConversationEmail["to"]) => xs.map(addressText).join(", ");

// `from`: the page's back-link record (fromParam of a parsed ?from=, or ""), kept on the download link so a redirect
// back to the conversation keeps the "← <RECORD>" link.
export function EmailBody({ email, from = "" }: { email: ConversationEmail; from?: string }) {
  return (
    <article id={`email-${email.id}`} className="msg">
      <div className="who">
        <b>{email.from ? addressText(email.from) : messages.email_unknown_sender}</b>
        <span className="when">{formatDateTime(email.receivedAt).toUpperCase()}</span>
      </div>
      {email.to.length > 0 && <div className="hd">To {list(email.to)}</div>}
      {email.cc.length > 0 && <div className="hd">Cc {list(email.cc)}</div>}
      {email.bcc.length > 0 && <div className="hd">Bcc {list(email.bcc)}</div>}
      {email.text !== null && <div className="emailtext">{email.text}</div>}
      {email.attachments.length > 0 && (
        <div className="emailatts">
          {email.attachments.map((a) => (
            <span key={a.id} className="att">
              {a.name} · {formatFileSize(a.size)}
              <a href={`/emails/attachments/${a.id}/download${from ? `?from=${from}` : ""}`} aria-label={`Download ${a.name}`}>
                [ DOWNLOAD ]
              </a>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
