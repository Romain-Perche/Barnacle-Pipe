// Small server pieces shared by the Activities list, // NEXT ACTIVITIES, the timeline entry and the board card (SF-109
// design A): the type tag, the due text and the Overdue / Today mark (text, not colour alone).
import { formatDue, TYPE_LABELS, type ActivityState, type ActivityType, type Due } from "@/server/activities/rules";
import { messages } from "@/server/messages";

export function TypeTag({ type }: { type: ActivityType }) {
  return <span className="ty">{TYPE_LABELS[type].toUpperCase()}</span>;
}

export function DueText({ due }: { due: Due }) {
  return <span className="due">{formatDue(due)}</span>;
}

export function StateMark({ state }: { state: ActivityState }) {
  if (state === "overdue") return <span className="od">{messages.overdue}</span>;
  if (state === "today") return <span className="td">{messages.today}</span>;
  return null;
}

