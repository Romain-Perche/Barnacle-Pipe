// // TIMELINE: newest first, who and when (UK time). Later features add their own event kinds here.
import Link from "next/link";
import { formatDateTime } from "@/server/format";
import { messages, templates } from "@/server/messages";
import type { TimelineEvent } from "@/server/records/timeline";

function by(actor: string | null) {
  return actor ? ` by ${actor}` : "";
}

function Line({ e }: { e: TimelineEvent }) {
  switch (e.kind) {
    case "added":
      return <>Added{by(e.actorName)}</>;
    case "edited":
      return (
        <>
          Edited{by(e.actorName)}
          {e.fields && e.fields.length > 0 ? `: ${e.fields.join(", ")}` : ""}
        </>
      );
    case "archived":
      return <>Archived{by(e.actorName)}</>;
    case "restored":
      return <>Restored{by(e.actorName)}</>;
    case "person_linked":
    case "person_unlinked":
      // The person was deleted: the event stays, without who they were (SF-92 FR-005).
      if (!e.relatedPerson) {
        return (
          <>
            {e.kind === "person_linked" ? messages.deleted_person_linked : messages.deleted_person_unlinked}
            {by(e.actorName)}
          </>
        );
      }
      return (
        <>
          <Link href={`/people/${e.relatedPerson.id}`}>{e.relatedPerson.name}</Link>
          {e.kind === "person_linked" ? " linked" : " unlinked"}
          {by(e.actorName)}
        </>
      );
    case "handed_over":
      return (
        <>
          {templates.handed_over_event(e.relatedUserName ?? "")}
          {by(e.actorName)}
        </>
      );
  }
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section aria-label="Timeline">
      <div className="label sect">
        <span className="c">//</span> TIMELINE
      </div>
      <ul className="tl">
        {events.map((e) => (
          <li key={e.id}>
            <span>
              <Line e={e} />
            </span>
            <span className="when">{formatDateTime(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
