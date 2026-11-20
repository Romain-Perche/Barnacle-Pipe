// Edit a deal (contracts/routes.md § Pages): no pipeline or stage (moves are made from the board); "Private" only
// for its creator and current owner; a main person the user cannot see shows as empty and is kept on save.
// SF-95: deal labels; `?back=page` (from the deal page) or `?back=list` (from the list's drawer) returns there.
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { dealFormChoices, dealToForm, getDeal } from "@/server/deals/deals";
import { boardHref, parseBack } from "@/server/deals/rules";
import { parseId } from "@/server/records/list-query";
import { updateDeal } from "../../actions";
import { DealForm } from "../../DealForm";

export default async function EditDealPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string | string[] }> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  const raw = (await searchParams).back;
  const back = parseBack(Array.isArray(raw) ? raw[0] : raw);
  if (id === null) notFound();
  const deal = await getDeal(user.id, id);
  if (!deal || deal.archived) notFound();
  const choices = await dealFormChoices(user.id, deal);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> DEAL
          </div>
          <h1>Edit {deal.title}</h1>
        </div>
      </div>
      <DealForm
        action={updateDeal}
        choices={choices}
        canSetPrivate={deal.createdBy === user.id || deal.owner.id === user.id}
        withStage={false}
        initial={dealToForm(deal)}
        id={deal.id}
        version={deal.version}
        back={back ?? undefined}
        cancelHref={back === "page" ? `/deals/${deal.id}` : back === "list" ? `/deals/list?open=${deal.id}` : boardHref(deal.pipeline.id, { open: deal.id })}
      />
    </>
  );
}
