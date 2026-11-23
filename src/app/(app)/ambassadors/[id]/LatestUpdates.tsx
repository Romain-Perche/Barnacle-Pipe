// // LATEST UPDATES of an ambassador page (SF-114 FR-009, research.md §10): the newest notes and changes on the
// ambassador and on the people and deals they referred, grouped by UK day like the timeline (SF-102 design B), each with
// a NOTE / CHANGE / PERSON / DEAL tag and its time; an entry of a referred record names it with a link. Read-only.
import Link from "next/link";
import { formatTime } from "@/server/format";
import { templates } from "@/server/messages";
import type { TimelinePage } from "@/server/records/timeline";
import { entryTag, groupByDay } from "@/server/records/timeline-view";
import { NoteText } from "../../records/RecordTimeline";
import { Line } from "../../records/Timeline";

export function LatestUpdates({ page, moreHref }: { page: TimelinePage; moreHref: (lastId: number) => string }) {
  const last = page.entries[page.entries.length - 1];
  return (
    <section aria-label="Latest updates" className="timeline">
      <div className="label sect">
        <span className="c">//</span> LATEST UPDATES
      </div>
      {groupByDay(page.entries, new Date()).map((group) => (
        <div key={group.key} className="daygroup">
          <div className="day">
            <span className="c">//</span> {group.heading}
          </div>
          <ul className="tl ents">
            {group.entries.map((e) => {
              const tag = entryTag(e);
              const author = e.actorName ? (e.authorActive ? e.actorName : `${e.actorName} (deactivated)`) : "";
              const on = e.person
                ? { href: `/people/${e.person.id}`, name: e.person.name, archived: e.person.archived }
                : e.deal
                  ? { href: `/deals/${e.deal.id}`, name: e.deal.title, archived: e.deal.archived }
                  : null;
              return (
                <li key={e.id} id={`entry-${e.id}`} className="ent">
                  <span className={`kd ${tag.toLowerCase()}`}>{tag}</span>
                  <div className="ent-body">
                    {on && (
                      <div className="on-deal">
                        <Link href={on.href}>{on.name}</Link>
                        {on.archived && <span className="badge off tag">Archived</span>}
                      </div>
                    )}
                    {e.note ? (
                      <>
                        <b className="author">{author}</b>
                        <NoteText entry={e} />
                        {e.note.editedByName && <div className="edited">{templates.edited_by(e.note.editedByName)}</div>}
                      </>
                    ) : (
                      <div>
                        <Line e={e} onDeal={e.deal !== null} />
                      </div>
                    )}
                  </div>
                  <span className="when">{formatTime(e.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {page.more && last && (
        <div className="more">
          <Link className="btn" href={moreHref(last.id)} scroll={false}>
            [ SHOW MORE ]
          </Link>
        </div>
      )}
    </section>
  );
}
