// // TIMELINE (// HISTORY on deals): newest first, who and when (UK time). Later features add their own event kinds here.
import Link from "next/link";
import { formatDateTime } from "@/server/format";
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
      return (
        <>
          {e.relatedPerson ? <Link href={`/people/${e.relatedPerson.id}`}>{e.relatedPerson.name}</Link> : "Someone"}
          {e.kind === "person_linked" ? " linked" : " unlinked"}
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
              <Line e={e} />
            </span>
            <span className="when">{formatDateTime(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
