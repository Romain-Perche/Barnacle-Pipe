// Pipelines (US5, contracts/routes.md § Pages): admins add, rename, reorder and delete pipelines. Deleting one that
// holds deals asks which stage of another pipeline they move to.
import { requireAdmin } from "@/server/auth/session";
import { listPipelines, pipelineDealCount, stageChoices } from "@/server/deals/pipelines";
import { messageFor, messages } from "@/server/messages";
import { parseId } from "@/server/records/list-query";
import { Forbidden } from "../../Forbidden";
import { addPipeline, deletePipeline, movePipeline, renamePipeline } from "./actions";
import { AddRow, DeleteBlock, OrderRows } from "./Rows";

const PAGE = "/admin/pipelines";
const PAGE_ERRORS = new Set(["pipeline_name_required", "pipeline_name_exists", "pipeline_delete_no_target", "pipeline_target_invalid"]);
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PipelinesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return <Forbidden />;
  const params = await searchParams;
  const error = one(params.error);
  const message = PAGE_ERRORS.has(error) ? messageFor(error) : undefined;
  const pipelines = await listPipelines();
  const deleting = pipelines.find((p) => p.id === parseId(one(params.delete)));
  const [deals, targets] = deleting ? await Promise.all([pipelineDealCount(deleting.id), stageChoices()]) : [0, []];
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> ADMIN
          </div>
          <h1>Pipelines</h1>
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
          deals={deals}
          targets={targets.filter((t) => t.id !== deleting.id)}
          action={deletePipeline}
          cancelHref={PAGE}
          noTarget={messages.pipeline_delete_no_target}
        />
      )}
      <AddRow label="New pipeline" button="[ ADD PIPELINE ]" action={addPipeline} />
      <OrderRows
        rows={pipelines.map((p) => ({ ...p, href: `${PAGE}/${p.id}` }))}
        rename={renamePipeline}
        move={movePipeline}
        deleteHref={(id) => `${PAGE}?delete=${id}`}
      />
    </>
  );
}
