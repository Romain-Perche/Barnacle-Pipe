// Add a deal (contracts/routes.md § Pages): pipeline and stage from ?pipeline=&stage= when valid, else the first
// pipeline with a stage and its first stage; the owner is the user; Private unticked.
import { requireUser } from "@/server/auth/session";
import { dealFormChoices } from "@/server/deals/deals";
import { boardHref, parseBoardQuery, type BoardParams } from "@/server/deals/rules";
import { messages } from "@/server/messages";
import { toId } from "@/server/records/rules";
import { createDeal } from "../actions";
import { DealForm } from "../DealForm";

export default async function NewDealPage({ searchParams }: { searchParams: Promise<BoardParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const { pipeline } = parseBoardQuery(params);
  const stage = toId(Array.isArray(params.stage) ? params.stage[0] : params.stage);
  const choices = await dealFormChoices(user.id, null);
  const usable = choices.pipelines.filter((p) => p.stages.length > 0);
  const chosen = usable.find((p) => p.id === pipeline) ?? usable[0];
  const stageId = chosen?.stages.find((s) => s.id === stage)?.id ?? chosen?.stages[0]?.id;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> DEALS
          </div>
          <h1>Add deal</h1>
        </div>
      </div>
      {!chosen ? (
        <div className="empty">
          <p>{messages.no_pipelines_yet}</p>
        </div>
      ) : (
        <DealForm
          action={createDeal}
          choices={choices}
          canSetPrivate
          withStage
          cancelHref={boardHref(chosen.id)}
          initial={{
            title: "",
            value: "",
            pipelineId: String(chosen.id),
            stageId: String(stageId ?? ""),
            organisationId: "",
            newOrganisationName: "",
            personId: "",
            ownerId: String(user.id),
            expectedClose: "",
            private: false,
    labelIds: [],
          }}
        />
      )}
    </>
  );
}
