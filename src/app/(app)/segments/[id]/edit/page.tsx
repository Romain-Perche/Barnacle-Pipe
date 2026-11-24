// The edit form of a segment on its own page (SF-120 US3 scenario 1): any user, any segment; the stored definition, its
// version (FR-012) and its count now. A deleted segment shows "This segment no longer exists.".
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { messages } from "@/server/messages";
import { parseId } from "@/server/records/list-query";
import { formToValues } from "@/server/segments/rules";
import { getSegment, segmentFormOptions } from "@/server/segments/segments";
import { saveSegmentAction } from "../../actions";
import { SegmentForm } from "../../SegmentForm";

export default async function EditSegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const segment = await getSegment(user.id, id);
  if (!segment) notFound();
  const options = await segmentFormOptions(segment.definition);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CAMPAIGNS
          </div>
          <h1>{messages.segment_edit}</h1>
          <div className="sub">{segment.name}</div>
        </div>
      </div>
      {segment.description.broken && (
        <p className="err" role="status">
          {messages.segment_broken}
        </p>
      )}
      <SegmentForm action={saveSegmentAction} options={options} initial={formToValues(segment.definition, segment.name)} reach={segment.reach}
        id={segment.id} version={segment.version} cancelHref={`/segments/${segment.id}`} />
    </>
  );
}
