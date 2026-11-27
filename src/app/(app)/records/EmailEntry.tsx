// An EMAIL entry of a record's timeline (SF-127 design B, contracts/routes.md § EMAIL timeline entry): sender → To
// (Cc, Bcc), then a box with a blue left edge holding the subject (a link to the conversation page, back to this
// record), the start of the text and every attachment's name and size. Every string is a React text node: nothing
// from an email is ever interpreted (FR-004, FR-016).
import Link from "next/link";
import { formatFileSize, formatTime } from "@/server/format";
import { recipientsLine, subjectOrDefault } from "@/server/emails/rules";
import type { TimelineEntry } from "@/server/records/timeline";

export function EmailEntry({ entry, from }: { entry: TimelineEntry; from: string }) {
  const m = entry.email!;
  return (
    <li id={`email-${m.messageId}`} className="ent">
      <span className="kd email">EMAIL</span>
      <div className="ent-body">
        <div className="emailhead">{recipientsLine(m)}</div>
        <div className="emailbody">
          <Link className="subj" href={`/emails/${m.conversationId}?from=${from}#email-${m.messageId}`}>
            {subjectOrDefault(m.subject)}
          </Link>
          {m.preview !== null && <div className="snip">{m.preview}</div>}
          {m.attachments.length > 0 && (
            <div className="emailatts">
              {m.attachments.map((a) => (
                <span key={a.id} className="att">
                  {a.name} · {formatFileSize(a.size)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="when">{formatTime(entry.createdAt)}</span>
    </li>
  );
}
