// The deal drawer on the right of the board (design A, contracts/routes.md § Pages): details, "Move to" (works with
// a keyboard and without JavaScript), [ EDIT ], [ ARCHIVE ], [ DELETE ] for admins, [ CLOSE ] and // HISTORY.
import Link from "next/link";
import type { DealView, PipelineStages } from "@/server/deals/deals";
import { boardHref } from "@/server/deals/rules";
import { formatDate, formatMoney } from "@/server/format";
import { ownerName } from "@/server/records/common";
import type { TimelineEvent } from "@/server/records/timeline";
import { Field } from "../records/Drawer";
import { DeleteConfirm } from "../records/DeleteConfirm";
import { Timeline } from "../records/Timeline";
import { archiveDeal, deleteDeal, moveDeal } from "./actions";

// A YYYY-MM-DD day as "15 Dec 2026" (noon UTC is the same day in London).
function day(date: string): string {
  return formatDate(new Date(`${date}T12:00:00Z`));
}

export function DealDrawer({
  deal, pipelines, events, isAdmin, confirmDelete,
}: { deal: DealView; pipelines: PipelineStages[]; events: TimelineEvent[]; isAdmin: boolean; confirmDelete: boolean }) {
  const here = boardHref(deal.pipeline.id, { open: deal.id });
  return (
    <aside className="drawer deal-drawer" aria-label="Deal">
      <div className="label">
        <span className="c">//</span> DEAL
      </div>
      <h2>
        {deal.title}
        {deal.private && <span className="badge tag">Private</span>}
      </h2>
      {confirmDelete && isAdmin && <DeleteConfirm name={deal.title} id={deal.id} action={deleteDeal} cancelHref={here} />}
      <dl>
        <Field k="Pipeline · Stage">
          {deal.pipeline.name} · {deal.stage.name}
        </Field>
        <Field k="Value">{formatMoney(deal.valuePence)}</Field>
        <Field k="Organisation">
          {deal.organisation ? (
            <>
              <Link href={`/organisations/${deal.organisation.id}`}>{deal.organisation.name}</Link>
              {deal.organisation.archived && <span className="badge off tag">Archived</span>}
            </>
          ) : null}
        </Field>
        <Field k="Person">
          {deal.person ? (
            <>
              <Link href={`/people/${deal.person.id}`}>{deal.person.name}</Link>
              {deal.person.archived && <span className="badge off tag">Archived</span>}
            </>
          ) : null}
        </Field>
        <Field k="Owner">{ownerName(deal.owner)}</Field>
        <Field k="Expected close">{deal.expectedClose ? day(deal.expectedClose) : null}</Field>
        <Field k="Date added">{formatDate(deal.createdAt)}</Field>
      </dl>
      <form action={moveDeal} className="move-to">
        <input type="hidden" name="id" value={deal.id} />
        <input type="hidden" name="version" value={deal.version} />
        <input type="hidden" name="pipelineId" value={deal.pipeline.id} />
        <label className="field">
          <span>Move to</span>
          <select className="input" name="toStageId" defaultValue={deal.stage.id}>
            {pipelines
              .filter((p) => p.stages.length > 0)
              .map((p) => (
                <optgroup key={p.id} label={p.name}>
                  {p.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {p.name} · {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </label>
        <button className="btn" type="submit">
          [ MOVE ]
        </button>
      </form>
      <div className="drawer-acts">
        <Link className="btn solid" href={`/deals/${deal.id}/edit`}>
          [ EDIT ]
        </Link>
        <form action={archiveDeal}>
          <input type="hidden" name="id" value={deal.id} />
          <button className="btn" type="submit">
            [ ARCHIVE ]
          </button>
        </form>
        {isAdmin && (
          <Link className="btn red" href={boardHref(deal.pipeline.id, { open: deal.id, confirm: "delete" })} scroll={false}>
            [ DELETE ]
          </Link>
        )}
        <Link className="btn" href={boardHref(deal.pipeline.id)} scroll={false}>
          [ CLOSE ]
        </Link>
      </div>
      <Timeline events={events} heading="HISTORY" />
    </aside>
  );
}
