// A person's page, design C: header, // DETAILS in two columns, // TIMELINE.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { formatDate } from "@/server/format";
import { parseId, type Params } from "@/server/records/list-query";
import { getPerson } from "@/server/records/people";
import { CONSENT_LABELS, KIND_LABELS } from "@/server/records/rules";
import { DeleteConfirm } from "../../records/DeleteConfirm";
import { RecordHeader } from "../../records/RecordHeader";
import { NoteNotices } from "../../records/NoteNotices";
import { RecordTimeline } from "../../records/RecordTimeline";
import { FileOverlays } from "../../records/FileOverlays";
import { FilesSection } from "../../records/FilesSection";
import { ReferredBy } from "../../records/ReferredBy";
import { ActivityNotices } from "../../activities/ActivityNotices";
import { ActivityOverlays } from "../../activities/ActivityOverlays";
import { NextActivities } from "../../activities/NextActivities";
import { archivePerson, deletePerson, restorePerson } from "../actions";
import { MoreDetails } from "../../records/MoreDetails";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Params> };

function first(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function PersonPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const person = await getPerson(user.id, id);
  if (!person) notFound();
  const query = await searchParams;
  const isAdmin = user.role === "admin";
  const confirming = isAdmin && first(query, "confirm") === "delete";
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
        ambassadorId={person.ambassador ? id : null}
        editHref={`${href}/edit`}
        deleteHref={isAdmin ? `${href}?confirm=delete` : null}
        id={id}
        archive={archivePerson}
        restore={restorePerson}
      />
      {confirming && <DeleteConfirm name={person.name} id={id} action={deletePerson} cancelHref={href} />}
      <NoteNotices error={first(query, "error")} />
      <ActivityNotices error={first(query, "error")} />

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
            <dt>Referred by</dt>
            <dd>
              <ReferredBy referrer={person.referredBy} />
            </dd>
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
      <MoreDetails details={person.custom} />

      <NextActivities viewerId={user.id} target={{ personId: id }} archived={person.archived} back={href} />

      <FilesSection viewerId={user.id} target={{ personId: id }} archived={person.archived} back={href} error={first(query, "error")} />

      <RecordTimeline
        viewerId={user.id}
        target={{ personId: id }}
        archived={person.archived}
        query={{ timeline: first(query, "timeline"), note: first(query, "note"), deleteNote: first(query, "delete-note") }}
      />
      <ActivityOverlays
        viewerId={user.id}
        target={{ personId: id }}
        archived={person.archived}
        back={href}
        query={{ activity: first(query, "activity"), followup: first(query, "followup"), deleteActivity: first(query, "delete-activity") }}
      />
      <FileOverlays
        viewerId={user.id}
        target={{ personId: id }}
        archived={person.archived}
        back={href}
        query={{ file: first(query, "file"), deleteFile: first(query, "delete-file") }}
      />
    </>
  );
}
