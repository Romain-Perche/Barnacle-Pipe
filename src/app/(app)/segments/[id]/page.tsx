// A segment's own page (SF-120 design C, US1 scenario 4): name, "Last changed by <user> · <d Mon yyyy HH:mm>", [ EDIT ]
// and [ DELETE ], the count strip (Reaches now · Archived · Unsubscribed · No email address) worked out now for the
// viewer, the note, // WHO and // CONDITIONS. Only `confirm=delete` is read from the address; nothing is shown from it.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { formatDate, formatTime } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { parseId, type Params } from "@/server/records/list-query";
import { getSegment } from "@/server/segments/segments";
import { SegmentDeleteConfirm } from "../SegmentDeleteConfirm";

export default async function SegmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const confirmDelete = (await searchParams).confirm === "delete";
  const segment = await getSegment(user.id, id);
  if (!segment) notFound();
  const { description: d, reach } = segment;
  return (
    <div className="segment-page">
      <div className="page-head">
        <div>
          <div className="label">SEGMENT</div>
          <h1>{segment.name}</h1>
          <div className="sub">{templates.segment_last_changed(segment.updatedBy, `${formatDate(segment.updatedAt)} ${formatTime(segment.updatedAt)}`)}</div>
        </div>
        <div className="head-acts">
          <Link className="btn" href={`/segments/${segment.id}/edit`}>
            [ EDIT ]
          </Link>
          <Link className="btn danger" href={`/segments/${segment.id}?confirm=delete`}>
            [ DELETE ]
          </Link>
        </div>
      </div>
      {confirmDelete && <SegmentDeleteConfirm id={segment.id} name={segment.name} />}
      {d.broken && (
        <p className="err" role="status">
          {messages.segment_broken}
        </p>
      )}

      <dl className="strip" aria-label="Reach">
        <div>
          <dt>{messages.segment_strip_reaches}</dt>
          <dd>{reach.reaches}</dd>
        </div>
        <div>
          <dt>{messages.segment_strip_archived}</dt>
          <dd>{reach.archived}</dd>
        </div>
        <div>
          <dt>{messages.segment_strip_unsubscribed}</dt>
          <dd>{reach.unsubscribed}</dd>
        </div>
        <div>
          <dt>{messages.segment_strip_no_email}</dt>
          <dd>{reach.noEmail}</dd>
        </div>
      </dl>
      <p className="reach-note">{messages.segment_count_note}</p>

      <section aria-label="Who">
        <div className="label sect">
          <span className="c">//</span> WHO
        </div>
        <dl className="details">
          {d.who.map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Conditions">
        <div className="label sect">
          <span className="c">//</span> CONDITIONS
        </div>
        {d.conditions.length === 0 ? (
          <p className="hint">{messages.segment_no_conditions}</p>
        ) : (
          <dl className="details">
            {d.conditions.map((l, i) => (
              <div key={i}>
                <dt>{l.label}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
