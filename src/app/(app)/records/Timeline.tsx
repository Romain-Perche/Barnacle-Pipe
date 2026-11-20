// // TIMELINE (// HISTORY on deals): newest first, who and when (UK time). Later features add their own event kinds here.
import Link from "next/link";
import { formatDateTime } from "@/server/format";
import { messages, templates } from "@/server/messages";
import type { TimelineEvent } from "@/server/records/timeline";

function by(actor: string | null) {
  return actor ? ` by ${actor}` : "";
}

function Line({ e, onDeal }: { e: TimelineEvent; onDeal: boolean }) {
  switch (e.kind) {
    case "added":
      return <>Added{by(e.actorName)}</>;
    case "imported":
      return <>{templates.imported_event(e.actorName ?? "")}</>;
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
    case "won":
      return <>Marked as won{by(e.actorName)}</>;
    case "lost":
      // The reason is plain text from the database (a text node, never markup or a link).
      return (
        <>
          Marked as lost{by(e.actorName)}
          {e.reason ? `: ${e.reason}` : ""}
        </>
      );
    case "reopened":
      return <>Reopened{by(e.actorName)}</>;
    case "moved":
      return (
        <>
          Moved from {e.fromStage} to {e.toStage}
          {by(e.actorName)}
          {e.cause === "stage_deleted" ? " (stage deleted)" : e.cause === "pipeline_deleted" ? " (pipeline deleted)" : ""}
        </>
      );
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
      // On a deal (SF-95): "Linked <person> by <name>".
      if (onDeal) {
        return (
          <>
            {e.kind === "person_linked" ? "Linked " : "Unlinked "}
            <Link href={`/people/${e.relatedPerson.id}`}>{e.relatedPerson.name}</Link>
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

// `heading` is "TIMELINE" on people and organisations, "HISTORY" on deals (design A).
export function Timeline({ events, heading = "TIMELINE" }: { events: TimelineEvent[]; heading?: "TIMELINE" | "HISTORY" }) {
  const name = heading === "HISTORY" ? "History" : "Timeline";
  return (
    <section aria-label={name}>
      <div className="label sect">
        <span className="c">//</span> {heading}
      </div>
      <ul className="tl">
        {events.map((e) => (
          <li key={e.id}>
            <span>
              <Line e={e} onDeal={heading === "HISTORY"} />
            </span>
            <span className="when">{formatDateTime(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
