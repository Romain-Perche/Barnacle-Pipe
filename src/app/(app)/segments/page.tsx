// The Segments page (SF-120 design C, FR-001): every saved segment, shared by the whole team, ordered by name — Name (a
// link to its page), Who (its summary; a broken one says so), Reaches now (worked out now for the viewer), Last changed.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { formatDate } from "@/server/format";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { listSegments } from "@/server/segments/segments";

// "Ada Fake · 24 Nov" (the year only when it is not this year's).
function shortDate(date: Date): string {
  const full = formatDate(date);
  return full.endsWith(String(new Date().getFullYear())) ? full.slice(0, -5) : full;
}

export default async function SegmentsPage() {
  const user = await requireUser();
  const [rows, flash] = await Promise.all([listSegments(user.id), readFlash(["segment_deleted", "segment_not_found"])]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CAMPAIGNS
          </div>
          <h1>{messages.segments_title}</h1>
        </div>
        <div className="head-acts">
          <Link className="btn solid" href="/segments/new">
            [ NEW SEGMENT ]
          </Link>
        </div>
      </div>
      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="empty">
          <p>{messages.segments_none}</p>
        </div>
      ) : (
        <table className="users list segments">
          <thead>
            <tr>
              <th>Name</th>
              <th>Who</th>
              <th className="num">Reaches now</th>
              <th>Last changed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="nm" href={`/segments/${r.id}`}>
                    {r.name}
                  </Link>
                </td>
                <td>
                  {r.summary}
                  {r.broken && <span className="seg-broken">{messages.segment_broken}</span>}
                </td>
                <td className="num">{r.reaches}</td>
                <td>
                  {r.updatedBy} · {shortDate(r.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 0 && <p className="hint seg-note">{messages.segment_count_note}</p>}
    </>
  );
}
