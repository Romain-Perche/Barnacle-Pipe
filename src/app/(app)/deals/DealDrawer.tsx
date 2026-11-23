// The deal drawer (design A, contracts/routes.md § Pages), on the board and on the deal list (SF-95): details,
// "Move to" (works with a keyboard and without JavaScript), [ EDIT ], [ ARCHIVE ], [ DELETE ] for admins,
// [ OPEN DEAL PAGE ], [ CLOSE ], // NEXT ACTIVITIES (SF-109: done boxes and [ SCHEDULE ACTIVITY ], the box opens over the page) and // TIMELINE (SF-102: the newest 50 entries, read-only, no note box). A won or lost deal shows its status and no "Move to"; an archived one
// (only reachable from the list) shows "Archived" and only [ OPEN DEAL PAGE ] and [ CLOSE ].
import Link from "next/link";
import type { DealView, PipelineStages } from "@/server/deals/deals";
import { formatDate, formatMoney } from "@/server/format";
import { ownerName } from "@/server/records/common";
import { Field } from "../records/Drawer";
import { DeleteConfirm } from "../records/DeleteConfirm";
import { RecordTimeline } from "../records/RecordTimeline";
import { archiveDeal, deleteDeal, moveDeal } from "./actions";
import { day, StatusBadge } from "./DealBits";
import { NextActivities } from "../activities/NextActivities";

type Props = {
  deal: DealView;
  pipelines: PipelineStages[];
  viewerId: number;
  isAdmin: boolean;
  confirmDelete: boolean;
  // Links of the page the drawer is on: the drawer itself, closed, and with the delete confirmation.
  hereHref: string;
  closeHref: string;
  deleteHref: string;
  // "list": the drawer's forms return to the deal list; absent: to the board (SF-93).
  back?: "list";
};

export function DealDrawer({ deal, pipelines, viewerId, isAdmin, confirmDelete, hereHref, closeHref, deleteHref, back }: Props) {
  const canMove = deal.status === "open" && !deal.archived;
  return (
    <aside className="drawer deal-drawer" aria-label="Deal">
      <div className="label">
        <span className="c">//</span> DEAL
      </div>
      <h2>
        {deal.title}
        {deal.private && <span className="badge tag">Private</span>}
        <StatusBadge deal={deal} />
      </h2>
      {confirmDelete && isAdmin && <DeleteConfirm name={deal.title} id={deal.id} action={deleteDeal} cancelHref={hereHref} back={back} />}
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
      {canMove && (
        <form action={moveDeal} className="move-to">
          <input type="hidden" name="id" value={deal.id} />
          <input type="hidden" name="version" value={deal.version} />
          <input type="hidden" name="pipelineId" value={deal.pipeline.id} />
          {back && <input type="hidden" name="back" value={back} />}
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
      )}
      <div className="drawer-acts">
        {!deal.archived && (
          <>
            <Link className="btn solid" href={`/deals/${deal.id}/edit${back ? `?back=${back}` : ""}`}>
              [ EDIT ]
            </Link>
            <form action={archiveDeal}>
              <input type="hidden" name="id" value={deal.id} />
              {back && <input type="hidden" name="back" value={back} />}
              <button className="btn" type="submit">
                [ ARCHIVE ]
              </button>
            </form>
            {isAdmin && (
              <Link className="btn red" href={deleteHref} scroll={false}>
                [ DELETE ]
              </Link>
            )}
          </>
        )}
        <Link className="btn" href={`/deals/${deal.id}`}>
          [ OPEN DEAL PAGE ]
        </Link>
        <Link className="btn" href={closeHref} scroll={false}>
          [ CLOSE ]
        </Link>
      </div>
      <NextActivities viewerId={viewerId} target={{ dealId: deal.id }} archived={deal.archived} back={hereHref} />
      <RecordTimeline viewerId={viewerId} target={{ dealId: deal.id }} archived={deal.archived} readOnly />
    </aside>
  );
}
