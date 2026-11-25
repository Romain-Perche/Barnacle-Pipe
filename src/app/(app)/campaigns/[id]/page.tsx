// A campaign draft's edit page (SF-119 design A, contracts/routes.md § Pages). Any signed-in user may open any draft.
// `?delete=1` (exactly) opens the delete confirmation; nothing from the address is shown.
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getCampaignById } from "@/server/campaigns/campaigns";
import { mergeFields } from "@/server/campaigns/merge";
import { listFields } from "@/server/custom-fields/fields";
import { toId } from "@/server/records/rules";
import { CampaignDeleteConfirm } from "../CampaignDeleteConfirm";
import { CampaignEditor } from "../CampaignEditor";

type Params = Record<string, string | string[] | undefined>;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  await requireUser();
  const id = toId((await params).id);
  if (id === null) notFound();
  const [view, custom] = await Promise.all([getCampaignById(id), listFields("person")]);
  if (!view) notFound();
  const confirmDelete = (await searchParams).delete === "1";
  return (
    <>
      <CampaignEditor view={view} fields={mergeFields(custom)} />
      {confirmDelete && <CampaignDeleteConfirm id={view.id} name={view.name} cancelHref={`/campaigns/${view.id}`} />}
    </>
  );
}
