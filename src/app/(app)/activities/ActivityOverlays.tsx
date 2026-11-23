// What a page's address opens over it (SF-109 research.md §12): `activity=new` (schedule, links pre-filled from the
// record), `activity=<id>` (edit), `followup=<id>` (after a tick) and `delete-activity=<id>` (confirm). An id only
// counts when it is an activity the viewer can see and, on a record page, linked to that record; anything else is
// ignored. Nothing opens on an archived record or for an activity with an archived link.
import {
  activityFormChoices, activityToForm, followupPrefill, pageActivity, prefillLinks, type ActivityTarget, type Links,
} from "@/server/activities/activities";
import type { ActivityForm } from "@/server/activities/rules";
import { ActivityBox } from "./ActivityBox";
import { ActivityDeleteConfirm } from "./ActivityDeleteConfirm";
import { editActivity, scheduleActivity } from "./actions";

export type OverlayQuery = { activity?: string; followup?: string; deleteActivity?: string };

const str = (n: number | null) => (n === null ? "" : String(n));
const linksOf = (f: ActivityForm): Links => ({
  dealId: f.dealId ? Number(f.dealId) : null, personId: f.personId ? Number(f.personId) : null, organisationId: f.organisationId ? Number(f.organisationId) : null,
});

export async function ActivityOverlays({
  viewerId, target, query, back, archived = false,
}: { viewerId: number; target: ActivityTarget | null; query: OverlayQuery; back: string; archived?: boolean }) {
  if (archived) return null;
  if (query.deleteActivity) {
    const a = await pageActivity(viewerId, query.deleteActivity, target);
    if (a && !a.archived) return <ActivityDeleteConfirm id={a.id} version={a.version} back={back} />;
  }
  if (query.activity === "new") {
    const links = await prefillLinks(viewerId, target);
    const initial: ActivityForm = {
      type: "call", subject: "", dueOn: "", dueTime: "", duration: "", assigneeId: String(viewerId), note: "",
      dealId: str(links.dealId), personId: str(links.personId), organisationId: str(links.organisationId),
    };
    const choices = await activityFormChoices(viewerId, links);
    return <ActivityBox mode="new" action={scheduleActivity} initial={initial} back={back} choices={choices} />;
  }
  if (query.activity) {
    const a = await pageActivity(viewerId, query.activity, target);
    if (!a || a.archived) return null;
    const initial = activityToForm(a);
    const choices = await activityFormChoices(viewerId, linksOf(initial), a.assignee.id);
    return <ActivityBox mode="edit" action={editActivity} initial={initial} id={a.id} version={a.version} back={back} choices={choices} />;
  }
  if (query.followup) {
    const a = await pageActivity(viewerId, query.followup, target);
    if (!a || a.archived) return null;
    const initial = followupPrefill(a);
    const choices = await activityFormChoices(viewerId, linksOf(initial));
    // A deactivated assignee (or one who can no longer see the records) is not offered: the viewer instead.
    if (!choices.assignees.some((u) => String(u.id) === initial.assigneeId)) initial.assigneeId = String(viewerId);
    return <ActivityBox mode="followup" action={scheduleActivity} initial={initial} back={back} choices={choices} />;
  }
  return null;
}
