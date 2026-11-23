// The Activities list (SF-109 design A, contracts/routes.md § /activities): a table like the People list. Quick filters
// Overdue / Today / This week / Planned / Done, then Assignee and Type, all in the address; "// <n> ACTIVITIES"; 50
// per page; overdue rows with a red left edge. The box over the page opens from `activity` / `delete-activity`.
// Ticking here never asks for a follow-up (spec Clarifications). Nothing typed in the address is shown.
import Link from "next/link";
import { listActivities, activityFilterOptions } from "@/server/activities/list";
import { addParam } from "@/server/activities/rules";
import { requireUser } from "@/server/auth/session";
import { countLabel, formatDateTime } from "@/server/format";
import { messages } from "@/server/messages";
import { ownerName } from "@/server/records/common";
import { parseActivitiesQuery, withParams, type ActivitiesQuery, type Params } from "@/server/records/list-query";
import { AutoSubmit } from "../records/AutoSubmit";
import { Select } from "../records/ListBits";
import { Pager } from "../records/Pager";
import { DueText, StateMark, TypeTag } from "./ActivityBits";
import { ActivityNotices } from "./ActivityNotices";
import { ActivityOverlays } from "./ActivityOverlays";
import { DoneBox } from "./DoneBox";

const PATH = "/activities";
const TABS: { when: ActivitiesQuery["when"]; label: string }[] = [
  { when: "overdue", label: "Overdue" },
  { when: "today", label: "Today" },
  { when: "week", label: "This week" },
  { when: "planned", label: "Planned" },
  { when: "done", label: "Done" },
];

function first(params: Params, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;
  const parsed = parseActivitiesQuery(params);
  const users = await activityFilterOptions();
  // An unknown assignee id falls back to the viewer (never shown back).
  const query: ActivitiesQuery = { ...parsed, assignee: typeof parsed.assignee === "number" && !users.some((u) => u.id === parsed.assignee) ? null : parsed.assignee };
  const list = await listActivities(user.id, query);
  const shown = { ...query, page: list.page };
  const here = withParams(PATH, shown, {});
  const link = (changes: Partial<ActivitiesQuery>) => withParams(PATH, shown, changes);
  const assigneeValue = query.assignee === "all" ? "all" : (query.assignee ?? user.id);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ACTIVITIES
          </div>
          <h1>Activities</h1>
        </div>
        <div className="head-acts">
          <Link className="btn solid" href={addParam(here, "activity", "new")} scroll={false}>
            [ SCHEDULE ACTIVITY ]
          </Link>
        </div>
      </div>

      <ActivityNotices error={first(params, "error")} />

      <form id="activity-filters" className="filters" action={PATH} method="get" role="search">
        <nav className="tabs" aria-label="Show">
          {TABS.map((t) => (
            <Link key={t.when} href={link({ when: t.when })} className={query.when === t.when ? "on" : undefined} aria-current={query.when === t.when ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        {query.when !== "planned" && <input type="hidden" name="when" value={query.when} />}
        <Select
          name="assignee"
          label="Assignee"
          value={assigneeValue}
          options={[{ value: "all", label: "Assignee: Everyone" }, ...users.map((u) => ({ value: u.id, label: `Assignee: ${u.name}` }))]}
        />
        <Select
          name="type"
          label="Type"
          value={query.type}
          options={[{ value: "", label: "Type: All" }, { value: "call", label: "Type: Call" }, { value: "meeting", label: "Type: Meeting" }, { value: "task", label: "Type: Task" }]}
        />
        <noscript>
          <button className="btn" type="submit">
            [ APPLY ]
          </button>
        </noscript>
        <AutoSubmit formId="activity-filters" />
      </form>

      <div className="label count-line">
        <span className="c">//</span> {countLabel(list.count, "ACTIVITY", "ACTIVITIES")}
      </div>

      {list.rows.length === 0 ? (
        <div className="empty">
          <p>{messages.activities_empty}</p>
          <Link className="btn" href={addParam(here, "activity", "new")} scroll={false}>
            [ SCHEDULE ACTIVITY ]
          </Link>
        </div>
      ) : (
        <table className="users list activities-list">
          <thead>
            <tr>
              <th>
                <span className="visually-hidden">Done</span>
              </th>
              <th>Type</th>
              <th>Subject</th>
              <th>Due</th>
              <th>Assignee</th>
              <th>Deal</th>
              <th>Person · Organisation</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((a) => (
              <tr key={a.id} id={`activity-${a.id}`} className={a.state === "overdue" ? "over" : undefined}>
                <td>{a.archived ? <span className="box off" aria-hidden="true" /> : <DoneBox id={a.id} done={a.doneAt !== null} back={here} />}</td>
                <td>
                  <TypeTag type={a.type} />
                </td>
                <td className="subj-cell">
                  <span className="subj">{a.subject}</span>
                  {a.doneAt && a.doneBy && <span className="em">Done {formatDateTime(a.doneAt)} by {ownerName(a.doneBy)}</span>}
                  {!a.archived && (
                    <span className="aacts">
                      <Link className="btn link" href={addParam(here, "activity", a.id)} scroll={false} aria-label={`Edit ${a.subject}`}>
                        [ EDIT ]
                      </Link>
                      <Link className="btn link red" href={addParam(here, "delete-activity", a.id)} scroll={false} aria-label={`Delete ${a.subject}`}>
                        [ DELETE ]
                      </Link>
                    </span>
                  )}
                </td>
                <td className={a.state === "overdue" ? "due-cell red" : "due-cell"}>
                  <DueText due={a} /> <StateMark state={a.state} />
                </td>
                <td>{ownerName(a.assignee)}</td>
                <td>
                  {a.deal ? (
                    <>
                      <Link className="nm" href={`/deals/${a.deal.id}`}>
                        {a.deal.name}
                      </Link>
                      {a.deal.archived && <span className="badge off tag">Archived</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {a.person || a.organisation ? (
                    <>
                      {a.person && (
                        <span className="ln">
                          <Link className="nm" href={`/people/${a.person.id}`}>
                            {a.person.name}
                          </Link>
                          {a.person.archived && <span className="badge off tag">Archived</span>}
                        </span>
                      )}
                      {a.organisation && (
                        <span className="ln em">
                          <Link href={`/organisations/${a.organisation.id}`}>{a.organisation.name}</Link>
                          {a.organisation.archived && <span className="badge off tag">Archived</span>}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={list.page} pages={list.pages} prevHref={link({ page: list.page - 1 })} nextHref={link({ page: list.page + 1 })} />

      <ActivityOverlays
        viewerId={user.id}
        target={null}
        query={{ activity: first(params, "activity"), deleteActivity: first(params, "delete-activity") }}
        back={here}
      />
    </>
  );
}

