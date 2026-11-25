// The count block of the segment form (SF-120 design C, contracts/routes.md § Form fields): "Reaches <n> people now", the
// people left out by reason, and the note that recipients are worked out at send time (FR-008, FR-011). No hooks: used
// by the client form, worked out on the server.
import { messages, templates } from "@/server/messages";
import type { Reach } from "@/server/segments/rules";

export function ReachBlock({ reach }: { reach: Reach | null }) {
  return (
    <div className="reach" aria-live="polite">
      {reach && (
        <>
          <div className="reach-big">{templates.segment_reaches(reach.reaches)}</div>
          <div className="reach-out">{templates.segment_left_out(reach.archived, reach.unsubscribed, reach.noEmail)}</div>
        </>
      )}
      <p className="reach-note">{messages.segment_count_note}</p>
    </div>
  );
}
