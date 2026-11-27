// An organisation's page, design C: header, then (SF-127 FR-015) // DETAILS, // MORE DETAILS and // PEOPLE on the left, the
// note box, // NEXT ACTIVITIES, // FILES and // TIMELINE on the right (.recordcols, stacked under 1000 px).
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { formatDate } from "@/server/format";
import { messages } from "@/server/messages";
import { parseId, type Params } from "@/server/records/list-query";
import { getOrganisation, peopleOf } from "@/server/records/organisations";
import { DeleteConfirm } from "../../records/DeleteConfirm";
import { RecordHeader } from "../../records/RecordHeader";
import { NoteNotices } from "../../records/NoteNotices";
import { RecordTimeline } from "../../records/RecordTimeline";
import { TimelineNoteBox } from "../../records/TimelineNoteBox";
import { FileOverlays } from "../../records/FileOverlays";
import { EmailOverlay } from "../../records/EmailOverlay";
import { readFlash } from "@/server/records/flash";
import { FilesSection } from "../../records/FilesSection";
import { ActivityNotices } from "../../activities/ActivityNotices";
import { ActivityOverlays } from "../../activities/ActivityOverlays";
import { NextActivities } from "../../activities/NextActivities";
import { archiveOrganisation, deleteOrganisation, restoreOrganisation } from "../actions";
import { MoreDetails } from "../../records/MoreDetails";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Params> };

function first(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

// SF-129: sending an email with 25 MB of attachments (Storage reads, then Gmail's upload) within one function run.
export const maxDuration = 60;

export default async function OrganisationPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const org = await getOrganisation(user.id, id);
  if (!org) notFound();
  const people = await peopleOf(user.id, id);
  const query = await searchParams;
  const isAdmin = user.role === "admin";
  const confirming = isAdmin && first(query, "confirm") === "delete";
  const href = `/organisations/${id}`;
  const flash = await readFlash(["email_sent"]);
  const rows: [string, React.ReactNode][] = [
    [
      "Website",
      org.website ? (
        <a href={org.website} target="_blank" rel="noopener noreferrer">
          {org.website}
        </a>
      ) : (
        "—"
      ),
    ],
    ["Sector", org.sector ?? "—"],
    ["Size", org.size ?? "—"],
    ["Location", org.location ?? "—"],
    ["Owner", org.owner.active ? org.owner.name : `${org.owner.name} (deactivated)`],
    ["Date added", formatDate(org.createdAt)],
  ];

  return (
    <>
      <RecordHeader
        kind="ORGANISATION"
        name={org.name}
        archived={org.archived}
        editHref={`${href}/edit`}
        deleteHref={isAdmin ? `${href}?confirm=delete` : null}
        id={id}
        archive={archiveOrganisation}
        restore={restoreOrganisation}
      />
      {confirming && <DeleteConfirm name={org.name} id={id} action={deleteOrganisation} cancelHref={href} />}
      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      <NoteNotices error={first(query, "error")} />
      <ActivityNotices error={first(query, "error")} />

      <div className="recordcols">
        <div className="recordleft">
          <section aria-label="Details">
            <div className="label sect">
              <span className="c">//</span> DETAILS
        </div>
            <dl className="details">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <MoreDetails details={org.custom} />

          <section aria-label="People">
            <div className="label sect">
              <span className="c">//</span> PEOPLE
        </div>
            {people.length === 0 ? (
              <p className="muted">{messages.no_people_yet}</p>
            ) : (
              <table className="users">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/people/${p.id}`}>{p.name}</Link>
                      </td>
                      <td>{p.role ?? "—"}</td>
                      <td>{p.email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <div className="recordright">
          <TimelineNoteBox viewerId={user.id} target={{ organisationId: id }} archived={org.archived} />
          <NextActivities viewerId={user.id} target={{ organisationId: id }} archived={org.archived} back={href} />

          <FilesSection viewerId={user.id} target={{ organisationId: id }} archived={org.archived} back={href} error={first(query, "error")} />

          <RecordTimeline
            viewerId={user.id}
            target={{ organisationId: id }}
            archived={org.archived}
            query={{ timeline: first(query, "timeline"), note: first(query, "note"), deleteNote: first(query, "delete-note") }}
            emailHref={`${href}?email=new`}
          />
        </div>
      </div>
      <ActivityOverlays
        viewerId={user.id}
        target={{ organisationId: id }}
        archived={org.archived}
        back={href}
        query={{ activity: first(query, "activity"), followup: first(query, "followup"), deleteActivity: first(query, "delete-activity") }}
      />
      <EmailOverlay viewerId={user.id} target={{ organisationId: id }} email={first(query, "email")} back={href} />
      <FileOverlays
        viewerId={user.id}
        target={{ organisationId: id }}
        archived={org.archived}
        back={href}
        query={{ file: first(query, "file"), deleteFile: first(query, "delete-file") }}
      />
    </>
  );
}
