// The conversation page (SF-127 design B, contracts/routes.md § GET /emails/[id]): "← <RECORD>" back to the record it
// was opened from (?from=, when the viewer can see it), "CONVERSATION · N EMAILS", the subject, then // LINKED TO on
// the left and // EMAILS · OLDEST FIRST on the right, each email once, as plain text. A conversation the viewer cannot
// see answers the same 404 as a missing one (not-found.tsx). ?link= opens a link form; ?notice= maps to fixed texts.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { fromRecordName, getConversation, linkChoices } from "@/server/emails/conversations";
import { fromParam, parseFrom, parseLinkKind } from "@/server/emails/rules";
import { messages, templates } from "@/server/messages";
import { parseId, type Params } from "@/server/records/list-query";
import { EmailBody } from "../EmailBody";
import { LinkedTo } from "./LinkedTo";

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
            from={backName !== null ? fromParam(from) : ""}
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
              <EmailBody key={email.id} email={email} from={backName !== null ? fromParam(from) : ""} />
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
