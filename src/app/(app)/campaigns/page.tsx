// The Campaigns page (SF-119 design A, contracts/routes.md § Pages): every draft of the team, most recently edited first,
// in a table; [ NEW CAMPAIGN ] in the header. `?new=1` opens the "New campaign" box, `?delete=<id>` the delete
// confirmation of that draft (an unknown id: no box). Nothing typed in the address is shown.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listCampaigns } from "@/server/campaigns/campaigns";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { toId } from "@/server/records/rules";
import { CampaignDeleteConfirm } from "./CampaignDeleteConfirm";
import { NewCampaignBox } from "./NewCampaignBox";
import { duplicateCampaignAction } from "./actions";

type Params = Record<string, string | string[] | undefined>;
const SUBJECT_SHOWN = 60;

// "—" when empty; cut to 60 characters with "…".
function shortSubject(subject: string): string {
  if (subject === "") return "—";
  const chars = Array.from(subject);
  return chars.length > SUBJECT_SHOWN ? chars.slice(0, SUBJECT_SHOWN).join("") + "…" : subject;
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const params = await searchParams;
  const [list, flash] = await Promise.all([listCampaigns(), readFlash(["campaign_deleted", "campaign_gone"])]);
  const deleteId = typeof params.delete === "string" ? toId(params.delete) : null;
  const toDelete = deleteId === null ? undefined : list.find((c) => c.id === deleteId);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CAMPAIGNS
          </div>
          <h1>Campaigns</h1>
        </div>
        <div className="head-acts">
          <Link className="btn solid" href="/campaigns?new=1" scroll={false}>
            {messages.campaign_new}
          </Link>
        </div>
      </div>

      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}

      {list.length === 0 ? (
        <div className="empty">
          <p>{messages.campaigns_empty}</p>
        </div>
      ) : (
        <table className="users list campaigns-list">
          <thead>
            <tr>
              <th>{messages.campaign_col_name}</th>
              <th>{messages.campaign_col_subject}</th>
              <th>{messages.campaign_col_status}</th>
              <th>{messages.campaign_col_created_by}</th>
              <th>{messages.campaign_col_last_edited}</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="nm" href={`/campaigns/${c.id}`}>
                    {c.name}
                  </Link>
                </td>
                <td>{shortSubject(c.subject)}</td>
                <td>
                  <span className="status">{messages.campaign_status_draft}</span>
                </td>
                <td>{c.createdBy}</td>
                <td>{c.lastEdited}</td>
                <td className="acts">
                  <form action={duplicateCampaignAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn link" type="submit" aria-label={`Duplicate ${c.name}`}>
                      {messages.campaign_duplicate}
                    </button>
                  </form>
                  <Link className="btn link red" href={`/campaigns?delete=${c.id}`} scroll={false} aria-label={`Delete ${c.name}`}>
                    {messages.campaign_delete}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {params.new === "1" && <NewCampaignBox />}
      {toDelete && <CampaignDeleteConfirm id={toDelete.id} name={toDelete.name} cancelHref="/campaigns" />}
    </>
  );
}
