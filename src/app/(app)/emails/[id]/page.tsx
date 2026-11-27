// The conversation page (SF-127 design B, contracts/routes.md § GET /emails/[id]): "← <RECORD>" back to the record it
// was opened from (?from=, when the viewer can see it), "CONVERSATION · N EMAILS", the subject, then // LINKED TO on
// the left and // EMAILS · OLDEST FIRST on the right, each email once, as plain text. A conversation the viewer cannot
// see answers the same 404 as a missing one (not-found.tsx). ?link= opens a link form; ?notice= maps to fixed texts.
// SF-130: each email's reply buttons (or the Settings link), `?email=reply-<id>` etc. opening the email box (the ?from=
// record's files offered only while it is visible and not archived), and "Email sent to …" after sending.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { sql } from "@/server/db";
import { readRecord } from "@/server/emails/compose";
import { fromRecordName, getConversation, linkChoices } from "@/server/emails/conversations";
import { replyState } from "@/server/emails/reply";
import { readFlash } from "@/server/records/flash";
import type { Target } from "@/server/records/timeline";
import { EmailOverlay } from "../../records/EmailOverlay";
import { fromParam, parseFrom, parseLinkKind } from "@/server/emails/rules";
import { messages, templates } from "@/server/messages";
import { parseId, type Params } from "@/server/records/list-query";
import { EmailBody } from "../EmailBody";
import { LinkedTo } from "./LinkedTo";

// SF-129's box sends from here: Gmail and Storage calls fit in 60 s (research.md §4).
export const maxDuration = 60;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Params> };

const NOTICES: Record<string, { text: string; error: boolean }> = {
  "attachment-unavailable": { text: messages.email_attachment_unavailable, error: true },
  linked: { text: messages.email_linked, error: false },
  unlinked: { text: messages.email_unlinked, error: false },
  "link-refused": { text: messages.email_link_refused, error: true },
};
const PATH = { person: "/people", organisation: "/organisations", deal: "/deals" } as const;

function first(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function ConversationPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const conversation = await getConversation(user.id, id);
  if (!conversation) notFound();
  const query = await searchParams;
  const from = parseFrom(first(query, "from"));
  const backName = await fromRecordName(user.id, from);
  const open = parseLinkKind(first(query, "link"));
  const noticeKey = first(query, "notice") ?? "";
  const notice = Object.hasOwn(NOTICES, noticeKey) ? NOTICES[noticeKey] : null;
  const shownFrom = backName !== null ? fromParam(from) : "";
  const here = `/emails/${conversation.id}${shownFrom ? `?from=${shownFrom}` : ""}`;
  const reply = { state: await replyState(user.id), base: `/emails/${conversation.id}?${shownFrom ? `from=${shownFrom}&` : ""}email=` };
  const flash = await readFlash(["email_sent"]);
  // The box's record: the ?from= record while the viewer can see it and it is not archived.
  const fromRecord = from && backName !== null ? await readRecord(sql, user.id, from) : null;
  const target: Target | null =
    from && fromRecord && !fromRecord.archived ? (from.kind === "deal" ? { dealId: from.id } : from.kind === "person" ? { personId: from.id } : { organisationId: from.id }) : null;

  return (
    <>
      {from && backName !== null && (
        <Link className="back" href={`${PATH[from.kind]}/${from.id}`}>
          ← {backName.toUpperCase()}
        </Link>
      )}
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> {templates.conversation_count(conversation.emails.length)}
          </div>
          <h1>{conversation.subject}</h1>
        </div>
      </div>
      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      {notice && (
        <p className={notice.error ? "err" : "notice"} role={notice.error ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
      <div className="recordcols">
        <div className="recordleft">
          <LinkedTo
            conversationId={conversation.id}
            links={conversation.links}
            from={shownFrom}
            open={open}
            choices={open ? await linkChoices(user.id) : null}
          />
        </div>
        <div className="recordright">
          <section aria-label="Emails">
            <div className="label sect">
              <span className="c">//</span> EMAILS · OLDEST FIRST
            </div>
            {conversation.emails.map((email) => (
              <EmailBody key={email.id} email={email} from={shownFrom} reply={reply} />
            ))}
          </section>
        </div>
      </div>
      <EmailOverlay viewerId={user.id} target={target} email={first(query, "email")} back={here} />
    </>
  );
}
