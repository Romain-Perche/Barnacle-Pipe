// "// NEXT ACTIVITIES" above the timeline of a deal, person or organisation page and in the deal drawer (SF-109
// FR-003, design A): [ SCHEDULE ACTIVITY ] and the planned activities linked to the record, earliest first, each with
// its done box, type, subject, due date and time, assignee and Overdue / Today mark, [ EDIT ] and [ DELETE ]. An
// archived record (or an activity with an archived link) shows its activities with no buttons.
import Link from "next/link";
import { nextActivities, type ActivityTarget } from "@/server/activities/activities";
import { activityState, addParam } from "@/server/activities/rules";
import { messages } from "@/server/messages";
import { ownerName } from "@/server/records/common";
import { DueText, StateMark, TypeTag } from "./ActivityBits";
import { DoneBox } from "./DoneBox";

// `back`: the page address the section is on, without box parameters (the record page, or the drawer's address).
export async function NextActivities({ viewerId, target, archived, back }: { viewerId: number; target: ActivityTarget; archived: boolean; back: string }) {
  const rows = await nextActivities(viewerId, target);
  const now = new Date();
  return (
    <section aria-label="Next activities" className="nextacts">
      <div className="label sect sect-row">
        <span>
          <span className="c">//</span> NEXT ACTIVITIES
        </span>
        {!archived && (
          <Link className="btn" href={addParam(back, "activity", "new")} scroll={false}>
            [ SCHEDULE ACTIVITY ]
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted">{messages.activities_none_planned}</p>
      ) : (
        <ul className="arows">
          {rows.map((a) => {
            const locked = archived || a.archived;
            return (
              <li key={a.id} id={`activity-${a.id}`} className="arow">
                {locked ? <span className="box off" aria-hidden="true" /> : <DoneBox id={a.id} done={false} back={back} followup />}
                <TypeTag type={a.type} />
                <div className="asubj">
                  <span className="subj">{a.subject}</span>
                  <span className="ameta">
                    <DueText due={a} /> · {ownerName(a.assignee)} <StateMark state={activityState({ ...a, done: false }, now)} />
                  </span>
                </div>
                {!locked && (
                  <span className="aacts">
                    <Link className="btn link" href={addParam(back, "activity", a.id)} scroll={false} aria-label={`Edit ${a.subject}`}>
                      [ EDIT ]
                    </Link>
                    <Link className="btn link red" href={addParam(back, "delete-activity", a.id)} scroll={false} aria-label={`Delete ${a.subject}`}>
                      [ DELETE ]
                    </Link>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
