// // LINKED TO of the conversation page (SF-127 design B, US4): each linked person, organisation and deal with its
// kind, its name linking to its page and [ UNLINK ]; then [ LINK DEAL ] / [ LINK PERSON ] / [ LINK ORGANISATION ]
// (`?link=`), which open the matching form: a picker of the records the user can see, not archived (FR-013).
import Link from "next/link";
import type { ConversationLink, linkChoices } from "@/server/emails/conversations";
import type { RecordKind } from "@/server/emails/rules";
import { messages } from "@/server/messages";
import { PersonPicker } from "../../records/PersonPicker";
import { linkRecord, unlinkRecord } from "../actions";

const KIND: Record<RecordKind, string> = { person: "PERSON", organisation: "ORG", deal: "DEAL" };
const PATH: Record<RecordKind, string> = { person: "/people", organisation: "/organisations", deal: "/deals" };
const FIELD: Record<RecordKind, { name: string; label: string; button: string }> = {
  deal: { name: "dealId", label: "Deal", button: "[ LINK DEAL ]" },
  person: { name: "personId", label: "Person", button: "[ LINK PERSON ]" },
  organisation: { name: "organisationId", label: "Organisation", button: "[ LINK ORGANISATION ]" },
};

type Props = {
  conversationId: number;
  links: ConversationLink[];
  from: string;
  open: RecordKind | null;
  choices: Awaited<ReturnType<typeof linkChoices>> | null;
};

export function LinkedTo({ conversationId, links, from, open, choices }: Props) {
  const page = (extra: string) => `/emails/${conversationId}?${[from ? `from=${from}` : "", extra].filter(Boolean).join("&")}`;
  const hidden = (
    <>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="from" value={from} />
    </>
  );
  return (
    <section aria-label="Linked to">
      <div className="label sect">
        <span className="c">//</span> LINKED TO
      </div>
      {links.length === 0 ? (
        <p className="muted">{messages.email_no_links}</p>
      ) : (
        <ul className="conv-links">
          {links.map((l) => (
            <li key={l.id}>
              <span>
                <span className="kind">{KIND[l.kind]}</span>
                <Link href={`${PATH[l.kind]}/${l.recordId}`}>{l.name}</Link>
                {l.archived && <span className="badge off tag">Archived</span>}
              </span>
              <form action={unlinkRecord}>
                {hidden}
                <input type="hidden" name="linkId" value={l.id} />
                <button className="btn link red" type="submit" aria-label={`Unlink ${l.name}`}>
                  [ UNLINK ]
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <div className="conv-acts">
        {(["deal", "person", "organisation"] as const).map((k) => (
          <Link key={k} className="btn" href={page(`link=${k}`)} scroll={false}>
            {FIELD[k].button}
          </Link>
        ))}
      </div>
      {open && choices && (
        <form action={linkRecord} className="conv-linkform">
          {hidden}
          <input type="hidden" name="kind" value={open} />
          <PersonPicker
            people={open === "deal" ? choices.deals : open === "person" ? choices.people : choices.organisations}
            initialId=""
            name={FIELD[open].name}
            label={FIELD[open].label}
          />
          <div className="row">
            <button className="btn solid" type="submit">
              [ LINK ]
            </button>
            <Link className="btn" href={page("")} scroll={false}>
              [ CANCEL ]
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
