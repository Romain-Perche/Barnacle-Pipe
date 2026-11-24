// 'Delete the campaign "<name>" for good?' in a box over the page (SF-119 US6 scenario 2; /campaigns?delete=<id> and
// /campaigns/<id>?delete=1), like the other confirmations. The name comes from the database.
import Link from "next/link";
import { messages, templates } from "@/server/messages";
import { deleteCampaignAction } from "./actions";

export function CampaignDeleteConfirm({ id, name, cancelHref }: { id: number; name: string; cancelHref: string }) {
  return (
    <div className="overlay">
      <div className="lostbox confirmbox" role="alertdialog" aria-modal="true" aria-labelledby="campaign-delete-q">
        <p id="campaign-delete-q">{templates.campaign_delete_confirm(name)}</p>
        <div className="form-acts">
          <form action={deleteCampaignAction}>
            <input type="hidden" name="id" value={id} />
            <button className="btn danger-solid" type="submit">
              {messages.delete_for_good}
            </button>
          </form>
          <Link className="btn" href={cancelHref} scroll={false}>
            {messages.delete_cancel}
          </Link>
        </div>
      </div>
    </div>
  );
}
