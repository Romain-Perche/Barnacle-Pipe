// The arrow-shaped stage bar of design C (SF-95 FR-002, FR-003): every stage of the deal's pipeline in order with the
// whole days spent there (nothing after the current one). On an open, non-archived deal each other stage is a
// button of one form that moves the deal there, exactly as a board move; otherwise the bar is plain text.
import { formatDays } from "@/server/format";
import type { StageBarItem } from "@/server/deals/rules";
import { moveDealFromPage } from "../actions";

function Inside({ s }: { s: StageBarItem }) {
  return (
    <>
      <span className="nm">{s.name}</span>
      <span className="days">{s.days === null ? " " : formatDays(s.days)}</span>
    </>
  );
}

export function StageBar({ items, dealId, version, stageId, canMove }: { items: StageBarItem[]; dealId: number; version: number; stageId: number; canMove: boolean }) {
  const steps = items.map((s) =>
    canMove && s.state !== "now" ? (
      <li key={s.id} className={s.state}>
        <button type="submit" name="toStageId" value={s.id} aria-label={`Move to ${s.name}`}>
          <Inside s={s} />
        </button>
      </li>
    ) : (
      <li key={s.id} className={s.state} aria-current={s.state === "now" ? "step" : undefined}>
        <span className="step">
          <Inside s={s} />
        </span>
      </li>
    ),
  );
  if (!canMove) {
    return (
      <ol className="stagebar" aria-label="Stages">
        {steps}
      </ol>
    );
  }
  return (
    <form action={moveDealFromPage} className="stagebar-form">
      <input type="hidden" name="id" value={dealId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="fromStageId" value={stageId} />
      <ol className="stagebar" aria-label="Stages">
        {steps}
      </ol>
    </form>
  );
}
