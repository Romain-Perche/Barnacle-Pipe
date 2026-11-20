// // TIMELINE of a deal, person or organisation (SF-102 design B, contracts/routes.md § Pages): the note box above
// (not on archived records, not in the drawer), then the entries newest first under one heading per UK day, each
// with a NOTE, DEAL or CHANGE tag and its time. A person's and an organisation's timeline also hold their deals'
// entries (DEAL: the deal's title links to it; read-only there). `?note=` / `?delete-note=` only pick which of the
// notes shown is in edit / confirm mode; nothing from the address is shown.
import Link from "next/link";
import { formatTime } from "@/server/format";
import { templates } from "@/server/messages";
import { parseId } from "@/server/records/list-query";
import { mentionCandidates, noteForEdit, type NoteTarget } from "@/server/records/notes";
import { parseShown } from "@/server/records/notes-rules";
import { readTimeline, type TimelineEntry } from "@/server/records/timeline";
import { entryTag, groupByDay } from "@/server/records/timeline-view";
import { addNote, editNote } from "./note-actions";
import { NoteBox } from "./NoteBox";
import { NoteDeleteConfirm } from "./NoteDeleteConfirm";
import { targetId as idOf, targetKind, targetPath } from "./note-target";
import { Line } from "./Timeline";

type Query = { timeline?: string; note?: string; deleteNote?: string };

type Props = {
  viewerId: number;
  target: NoteTarget;
  archived: boolean;
  // The deal drawer: the newest 50 entries, no note box, no [ EDIT ] / [ DELETE ]; more on the deal page.
  readOnly?: boolean;
  query?: Query;
};

function NoteText({ entry }: { entry: TimelineEntry }) {
  // Text nodes only (FR-016): no link, markup or formatting; mentions highlighted.
  return (
    <div className="notebody">
      {entry.note?.segments.map((s, i) => ("mention" in s ? <mark key={i} className="mention">@{s.mention}</mark> : s.text))}
    </div>
  );
}

export async function RecordTimeline({ viewerId, target, archived, readOnly = false, query = {} }: Props) {
  const limit = readOnly ? 50 : parseShown(query.timeline);
  const canChange = !readOnly && !archived;
  const [page, candidates] = await Promise.all([
    readTimeline(viewerId, target, limit),
    canChange ? mentionCandidates(viewerId, target) : Promise.resolve([]),
  ]);
  const path = targetPath(target);
  const kind = targetKind(target);
  const id = idOf(target);
  const keep = limit > 50 ? `timeline=${limit}` : "";
  const ownNote = (e: TimelineEntry) => e.kind === "note" && e.deal === null;
  const pick = (value: string | undefined) => {
    const n = canChange ? parseId(value) : null;
    return n !== null && page.entries.some((e) => e.id === n && ownNote(e)) ? n : null;
  };
  const editId = pick(query.note);
  const deleteId = editId === null ? pick(query.deleteNote) : null;
  const editing = editId === null ? null : await noteForEdit(viewerId, target, editId);
  const back = (entryId: number) => `${path}${keep ? `?${keep}` : ""}#entry-${entryId}`;
  const withParam = (param: string, entryId: number) => `${path}?${param}=${entryId}${keep ? `&${keep}` : ""}#entry-${entryId}`;
  const onDealPage = kind === "deal";
  const last = page.entries[page.entries.length - 1];

  return (
    <section aria-label="Timeline" className="timeline">
      <div className="label sect">
        <span className="c">//</span> TIMELINE
      </div>
      {canChange && <NoteBox action={addNote} target={kind} targetId={id} candidates={candidates} />}
      {groupByDay(page.entries, new Date()).map((group) => (
        <div key={group.key} className="daygroup">
          <div className="day">
            <span className="c">//</span> {group.heading}
          </div>
          <ul className="tl ents">
            {group.entries.map((e) => {
              const tag = entryTag(e);
              const author = e.actorName ? (e.authorActive ? e.actorName : `${e.actorName} (deactivated)`) : "";
              return (
                <li key={e.id} id={`entry-${e.id}`} className="ent">
                  <span className={`kd ${tag.toLowerCase()}`}>{tag}</span>
                  <div className="ent-body">
                    {e.deal && (
                      <div className="on-deal">
                        <Link href={`/deals/${e.deal.id}`}>{e.deal.title}</Link>
                        {e.deal.archived && <span className="badge off tag">Archived</span>}
                      </div>
                    )}
                    {e.note ? (
                      <>
                        <b className="author">{author}</b>
                        {editing && editId === e.id ? (
                          <NoteBox
                            action={editNote}
                            target={kind}
                            targetId={id}
                            candidates={candidates}
                            edit={{ noteId: e.id, version: editing.version, text: editing.text, mentions: editing.mentions, cancelHref: back(e.id), timeline: limit }}
                          />
                        ) : (
                          <NoteText entry={e} />
                        )}
                        {e.note.editedByName && <div className="edited">{templates.edited_by(e.note.editedByName)}</div>}
                        {canChange && ownNote(e) && editId !== e.id && deleteId !== e.id && (
                          <div className="note-acts">
                            <Link className="btn link" href={withParam("note", e.id)} scroll={false} aria-label="Edit note">
                              [ EDIT ]
                            </Link>
                            <Link className="btn link red" href={withParam("delete-note", e.id)} scroll={false} aria-label="Delete note">
                              [ DELETE ]
                            </Link>
                          </div>
                        )}
                        {deleteId === e.id && <NoteDeleteConfirm target={kind} targetId={id} noteId={e.id} cancelHref={back(e.id)} timeline={limit} />}
                      </>
                    ) : (
                      <div>
                        <Line e={e} onDeal={onDealPage || e.deal !== null} />
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
          <Link className="btn" href={readOnly ? `${path}?timeline=100` : `${path}?timeline=${limit + 50}#entry-${last.id}`} scroll={false}>
            [ SHOW MORE ]
          </Link>
        </div>
      )}
    </section>
  );
}
