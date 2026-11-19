// Stages of one pipeline (US5, contracts/routes.md § Pages): admins add, rename, reorder and delete stages.
// Deleting a stage that holds deals asks which other stage of this pipeline they move to.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { getPipelineWithStages } from "@/server/deals/pipelines";
import { messageFor, messages } from "@/server/messages";
import { parseId } from "@/server/records/list-query";
import { Forbidden } from "../../../Forbidden";
import { addStage, deleteStage, moveStage, renameStage } from "../actions";
import { AddRow, DeleteBlock, OrderRows } from "../Rows";

const PAGE_ERRORS = new Set(["pipeline_name_required", "pipeline_name_exists", "stage_last_with_deals", "stage_target_invalid"]);
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PipelineStagesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return <Forbidden />;
  const id = parseId((await params).id);
  if (id === null) notFound();
  const pipeline = await getPipelineWithStages(id);
  if (!pipeline) notFound();
  const query = await searchParams;
  const error = one(query.error);
  const message = PAGE_ERRORS.has(error) ? messageFor(error) : undefined;
  const page = `/admin/pipelines/${pipeline.id}`;
  const deleting = pipeline.stages.find((s) => s.id === parseId(one(query.delete)));
  const extra = { pipelineId: pipeline.id };
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ADMIN · PIPELINES
          </div>
          <h1>{pipeline.name}</h1>
        </div>
        <div className="head-acts">
          <Link className="btn" href="/admin/pipelines">
            [ ALL PIPELINES ]
          </Link>
          <Link className="btn" href={`/deals?pipeline=${pipeline.id}`}>
            [ OPEN BOARD ]
          </Link>
        </div>
      </div>
      {message && (
        <p className="err" role="alert">
          {message}
        </p>
      )}
      {deleting && (
        <DeleteBlock
          name={deleting.name}
          id={deleting.id}
          deals={deleting.deals}
          targets={[{ id: pipeline.id, name: pipeline.name, stages: pipeline.stages.filter((s) => s.id !== deleting.id) }]}
          action={deleteStage}
          cancelHref={page}
          extra={extra}
          noTarget={messages.stage_last_with_deals}
        />
      )}
      <AddRow label="New stage" button="[ ADD STAGE ]" action={addStage} extra={extra} />
      {pipeline.stages.length === 0 && <p className="muted">{messages.no_stages_yet}</p>}
      <OrderRows rows={pipeline.stages} rename={renameStage} move={moveStage} deleteHref={(sid) => `${page}?delete=${sid}`} extra={extra} />
    </>
  );
}
