// A person's page, design C: header, // DETAILS in two columns, // TIMELINE.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { formatDate } from "@/server/format";
import { parseId } from "@/server/records/list-query";
import { getPerson } from "@/server/records/people";
import { CONSENT_LABELS, KIND_LABELS } from "@/server/records/rules";
import { readTimeline } from "@/server/records/timeline";
import { DeleteConfirm } from "../../records/DeleteConfirm";
import { RecordHeader } from "../../records/RecordHeader";
import { Timeline } from "../../records/Timeline";
import { archivePerson, deletePerson, restorePerson } from "../actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ confirm?: string }> };

export default async function PersonPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const person = await getPerson(user.id, id);
  if (!person) notFound();
  const events = await readTimeline(user.id, { personId: id });
  const isAdmin = user.role === "admin";
  const confirming = isAdmin && (await searchParams).confirm === "delete";
  const href = `/people/${id}`;

  return (
    <>
      <RecordHeader
        kind="PERSON"
        name={person.name}
        sub={
          person.role || person.organisation ? (
            <>
              {person.role}
              {person.role && person.organisation ? " at " : ""}
              {person.organisation && <Link href={`/organisations/${person.organisation.id}`}>{person.organisation.name}</Link>}
            </>
          ) : undefined
        }
        archived={person.archived}
        isPrivate={person.private}
        editHref={`${href}/edit`}
        deleteHref={isAdmin ? `${href}?confirm=delete` : null}
        id={id}
        archive={archivePerson}
        restore={restorePerson}
      />
      {confirming && <DeleteConfirm name={person.name} id={id} action={deletePerson} cancelHref={href} />}

      <section aria-label="Details">
        <div className="label sect">
          <span className="c">//</span> DETAILS
        </div>
        <dl className="details">
          <div>
            <dt>Email addresses</dt>
            <dd>
              {person.emails.length === 0
                ? "—"
                : person.emails.map((e) => (
                    <span key={e.email} className="multi">
                      {e.email} <span className="kind">{KIND_LABELS[e.kind]}</span>
                    </span>
                  ))}
            </dd>
          </div>
          <div>
            <dt>Phone numbers</dt>
            <dd>
              {person.phones.length === 0
                ? "—"
                : person.phones.map((p, i) => (
                    <span key={i} className="multi">
                      {p.phone} <span className="kind">{KIND_LABELS[p.kind]}</span>
                    </span>
                  ))}
            </dd>
          </div>
          <div>
            <dt>Organisation</dt>
            <dd>
              {person.organisation ? (
                <>
                  <Link href={`/organisations/${person.organisation.id}`}>{person.organisation.name}</Link>
                  {person.organisation.archived && <span className="badge off tag">Archived</span>}
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{person.role ?? "—"}</dd>
          </div>
          <div>
            <dt>Lead source</dt>
            <dd>{person.leadSource?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>LinkedIn</dt>
            <dd>
              {person.linkedin ? (
                <a href={person.linkedin} target="_blank" rel="noopener noreferrer">
                  {person.linkedin}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{person.owner.active ? person.owner.name : `${person.owner.name} (deactivated)`}</dd>
          </div>
          <div>
            <dt>Labels</dt>
            <dd>{person.labels.length > 0 ? person.labels.map((l) => l.name).join(", ") : "—"}</dd>
          </div>
          <div>
            <dt>Consent</dt>
            <dd>{CONSENT_LABELS[person.consent]}</dd>
          </div>
          <div>
            <dt>Date added</dt>
            <dd>{formatDate(person.createdAt)}</dd>
          </div>
          <div>
            <dt>Last contacted</dt>
            <dd>{person.lastContactedAt ? formatDate(person.lastContactedAt) : "Never"}</dd>
          </div>
        </dl>
      </section>

      <Timeline events={events} />
    </>
  );
}
