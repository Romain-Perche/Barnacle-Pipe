// The new segment form on its own page (SF-120 design C, US1 scenario 1): everyone, open deals first, and the count of
// "Everyone in the CRM" for the viewer.
import { requireUser } from "@/server/auth/session";
import { messages } from "@/server/messages";
import { countReach } from "@/server/segments/reach";
import { EVERYONE, formToValues } from "@/server/segments/rules";
import { segmentFormOptions } from "@/server/segments/segments";
import { saveSegmentAction } from "../actions";
import { SegmentForm } from "../SegmentForm";

export default async function NewSegmentPage() {
  const user = await requireUser();
  const [options, reach] = await Promise.all([segmentFormOptions(null), countReach(user.id, EVERYONE)]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CAMPAIGNS
          </div>
          <h1>{messages.segment_new}</h1>
        </div>
      </div>
      <SegmentForm action={saveSegmentAction} options={options} initial={formToValues(EVERYONE)} reach={reach} cancelHref="/segments" />
    </>
  );
}
