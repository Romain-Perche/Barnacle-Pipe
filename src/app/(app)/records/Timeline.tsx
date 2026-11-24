// The line of a change on a timeline (SF-102: RecordTimeline.tsx shows the entries). Later features add their own
// event kinds here. SF-116: "<name> added <file> (<size>)" (the file name links while the file exists) and
// "<name> deleted <file>"; names are text nodes only.
import Link from "next/link";
import { messages, templates } from "@/server/messages";
import { formatFileSize } from "@/server/format";
import type { EventPerson, TimelineEvent, TimelineFile } from "@/server/records/timeline";
import { FileLink } from "./FileLink";

function by(actor: string | null) {
  return actor ? ` by ${actor}` : "";
}

// SF-114: a referrer's name (a text node) linking to their ambassador page, or their person page when they have none
// for the viewer; "a deleted person" once deleted.
function Referrer({ p }: { p: EventPerson | null }) {
  if (!p) return <>a deleted person</>;
  return <Link href={p.ambassadorPage ? `/ambassadors/${p.id}` : `/people/${p.id}`}>{p.name}</Link>;
}

// `filePage`: the page of the file's record, where an image's preview box opens.
export function Line({ e, onDeal, filePage }: { e: TimelineEvent & { file?: TimelineFile | null }; onDeal: boolean; filePage?: string }) {
  switch (e.kind) {
    case "file_added": {
      const f = e.file;
      if (!f) return null;
      return (
        <>
          <b>{e.actorName}</b> added{" "}
          {f.id !== null && f.kind !== null && filePage ? (
            <FileLink file={{ id: f.id, kind: f.kind }} page={filePage}>
              {f.name}
            </FileLink>
          ) : (
            f.name
          )}
          {f.size !== null ? ` (${formatFileSize(f.size)})` : ""}
        </>
      );
    }
    case "file_deleted":
      return (
        <>
          <b>{e.actorName}</b> deleted {e.file?.name}
        </>
      );
    case "added":
      return <>Added{by(e.actorName)}</>;
    case "imported":
      return <>{templates.imported_event(e.actorName ?? "")}</>;
    // SF-117
    case "pipedrive_imported":
      return <>{templates.pipedrive_imported_by(e.actorName ?? "")}</>;
    case "pipedrive_unsubscribed":
      return <>{templates.pipedrive_unsubscribed_by(e.actorName ?? "")}</>;
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
    case "note":
      return null;
    case "ambassador_added":
      return <>Made an ambassador{by(e.actorName)}</>;
    case "ambassador_removed":
      return (
        <>
          {messages.no_longer_ambassador}
          {by(e.actorName)}
        </>
      );
    case "referrer_set": {
      // The template's text around the name: "Referred by set to <name>".
      const [before] = templates.referrer_set_event("\u0000").split("\u0000");
      return (
        <>
          {before}
          <Referrer p={e.relatedPerson} />
          {by(e.actorName)}
        </>
      );
    }
    case "referrer_changed": {
      const [start, middle] = templates.referrer_changed_event("\u0000", "\u0000").split("\u0000");
      return (
        <>
          {start}
          <Referrer p={e.fromPerson} />
          {middle}
          <Referrer p={e.relatedPerson} />
          {by(e.actorName)}
        </>
      );
    }
    case "referrer_cleared":
      return (
        <>
          {e.cause === "person_deleted" ? messages.referrer_cleared_deleted : "Referred by cleared"}
          {by(e.actorName)}
        </>
      );
    // SF-115: field names and values are the text of the time (React text nodes).
    case "custom_set":
      return (
        <>
          {templates.custom_set_event(e.fieldName ?? "", e.newValue ?? "")}
          {by(e.actorName)}
        </>
      );
    case "custom_changed":
      return (
        <>
          {e.oldValue === null && e.newValue === null
            ? templates.custom_changed_plain(e.fieldName ?? "")
            : templates.custom_changed_event(e.fieldName ?? "", e.oldValue ?? "", e.newValue ?? "")}
          {by(e.actorName)}
        </>
      );
    case "custom_cleared":
      return (
        <>
          {templates.custom_cleared_event(e.fieldName ?? "")}
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
