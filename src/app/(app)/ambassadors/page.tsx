// The Ambassadors page (SF-114 FR-002, contracts/routes.md § Pages): every ambassador the user can see, A–Z, in a design C
// table like the People list (no filters or pages: tens of ambassadors). Each row opens the ambassador page.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { countLabel, formatDate, formatMoney } from "@/server/format";
import { messages } from "@/server/messages";
import { listAmbassadors } from "@/server/records/ambassadors";

export default async function AmbassadorsPage() {
  const user = await requireUser();
  const rows = await listAmbassadors(user.id);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> CONTACTS
          </div>
          <h1>Ambassadors</h1>
        </div>
        <div className="head-r">
          <div className="label count">// {countLabel(rows.length, "AMBASSADOR", "AMBASSADORS")}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <p>{messages.ambassadors_empty}</p>
        </div>
      ) : (
        <table className="users list ambassadors">
          <thead>
            <tr>
              <th>Name</th>
              <th>Organisation</th>
              <th className="num">People</th>
              <th className="num">Deals</th>
              <th className="num">Open</th>
              <th className="num">Won</th>
              <th>Latest referral</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="nm" href={`/ambassadors/${r.id}`}>
                    {r.name}
                  </Link>
                  {r.archived && <span className="badge off tag">Archived</span>}
                </td>
                <td>{r.organisation ? <Link href={`/organisations/${r.organisation.id}`}>{r.organisation.name}</Link> : "—"}</td>
                <td className="num">{r.people}</td>
                <td className="num">{r.deals}</td>
                <td className="num">{formatMoney(r.openPence)}</td>
                <td className="num">{formatMoney(r.wonPence)}</td>
                <td>{r.latestReferral ? formatDate(r.latestReferral) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
