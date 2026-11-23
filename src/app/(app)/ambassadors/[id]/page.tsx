// The ambassador page, design B (SF-114 FR-008–FR-010, FR-016, contracts/routes.md § Pages): one column with the kind
// AMBASSADOR, the name, "<role> at <organisation>", [ PERSON PAGE ], contact details and owner, a summary strip like the
// deal page's, // PEOPLE REFERRED, // DEALS REFERRED (50 at a time) and // LATEST UPDATES (20 at a time). `?people=`,
// `?deals=` and `?updates=` are parsed to counts only; nothing from the address is shown.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { formatDate, formatMoney } from "@/server/format";
import { messages } from "@/server/messages";
import { getAmbassadorPage, readAmbassadorUpdates } from "@/server/records/ambassadors";
import { ownerName } from "@/server/records/common";
import { parseId, type Params } from "@/server/records/list-query";
import { parseShown, parseShownBy } from "@/server/records/notes-rules";
import { KIND_LABELS } from "@/server/records/rules";
import { LatestUpdates } from "./LatestUpdates";

const STATUS = { open: "Open", won: "Won", lost: "Lost" } as const;

export default async function AmbassadorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const query = await searchParams;
  const shown = { people: parseShown(query.people), deals: parseShown(query.deals), updates: parseShownBy(query.updates, 20) };
  const [page, updates] = await Promise.all([
    getAmbassadorPage(user.id, id, shown),
    readAmbassadorUpdates(user.id, id, shown.updates),
  ]);
  if (!page) notFound();
  const { person, summary } = page;
  const here = `/ambassadors/${id}`;
  // A [ SHOW MORE ] link: the other two counts kept, an anchor on the last row shown.
  const more = (change: Partial<typeof shown>, anchor: string) => {
    const next = { ...shown, ...change };
    const search = new URLSearchParams();
    if (next.people > 50) search.set("people", String(next.people));
    if (next.deals > 50) search.set("deals", String(next.deals));
    if (next.updates > 20) search.set("updates", String(next.updates));
    return `${here}?${search.toString()}#${anchor}`;
  };
  const lastPerson = page.people.rows.at(-1);
  const lastDeal = page.deals.rows.at(-1);

  return (
    <div className="ambassador-page">
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> AMBASSADOR
          </div>
          <h1>
            {person.name}
            {page.former && <span className="badge off tag">{messages.no_longer_ambassador}</span>}
            {person.archived && <span className="badge off tag">Archived</span>}
            {person.private && <span className="badge tag">Private</span>}
          </h1>
          {(person.role || person.organisation) && (
            <div className="sub">
              {person.role}
              {person.role && person.organisation ? " at " : ""}
              {person.organisation && <Link href={`/organisations/${person.organisation.id}`}>{person.organisation.name}</Link>}
            </div>
          )}
        </div>
        <div className="head-acts">
          <Link className="btn" href={`/people/${id}`}>
            [ PERSON PAGE ]
          </Link>
        </div>
      </div>

      <section aria-label="Details">
        <dl className="details">
          <div>
            <dt>Email addresses</dt>
            <dd>
              {person.emails.length === 0
                ? "—"
                : person.emails.map((e) => (
                    <span key={e.email} className="multi">
                      {e.email} <span className="kind">{KIND_LABELS[e.kind]}</span>
                    </span>
                  ))}
            </dd>
          </div>
          <div>
            <dt>Phone numbers</dt>
            <dd>
              {person.phones.length === 0
                ? "—"
                : person.phones.map((p, i) => (
                    <span key={i} className="multi">
                      {p.phone} <span className="kind">{KIND_LABELS[p.kind]}</span>
                    </span>
                  ))}
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{ownerName(person.owner)}</dd>
          </div>
        </dl>
      </section>

      <dl className="strip" aria-label="Summary">
        <div>
          <dt>People referred</dt>
          <dd>{summary.people}</dd>
        </div>
        <div>
          <dt>Deals referred</dt>
          <dd>{summary.deals}</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{formatMoney(summary.openPence)}</dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd className="won">{formatMoney(summary.wonPence)}</dd>
        </div>
        <div>
          <dt>Lost</dt>
          <dd className="lost">{summary.lost}</dd>
        </div>
      </dl>

      <section aria-label="People referred">
        <div className="label sect">
          <span className="c">//</span> PEOPLE REFERRED
        </div>
        {page.people.rows.length === 0 ? (
          <p className="hint">{messages.no_people_referred}</p>
        ) : (
          <table className="users list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Organisation</th>
                <th>Owner</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {page.people.rows.map((r) => (
                <tr key={r.id} id={`person-${r.id}`}>
                  <td>
                    <Link className="nm" href={`/people/${r.id}`}>
                      {r.name}
                    </Link>
                    {r.archived && <span className="badge off tag">Archived</span>}
                  </td>
                  <td>{r.organisation ? <Link href={`/organisations/${r.organisation.id}`}>{r.organisation.name}</Link> : "—"}</td>
                  <td>{ownerName(r.owner)}</td>
                  <td>{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {page.people.more && lastPerson && (
          <div className="more">
            <Link className="btn" href={more({ people: shown.people + 50 }, `person-${lastPerson.id}`)} scroll={false}>
              [ SHOW MORE ]
            </Link>
          </div>
        )}
      </section>

      <section aria-label="Deals referred">
        <div className="label sect">
          <span className="c">//</span> DEALS REFERRED
        </div>
        {page.deals.rows.length === 0 ? (
          <p className="hint">{messages.no_deals_referred}</p>
        ) : (
          <table className="users list">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Pipeline · stage</th>
                <th className="num">Value</th>
                <th>Status</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {page.deals.rows.map((r) => (
                <tr key={r.id} id={`deal-${r.id}`}>
                  <td>
                    <Link className="nm" href={`/deals/${r.id}`}>
                      {r.title}
                    </Link>
                    {r.archived && <span className="badge off tag">Archived</span>}
                  </td>
                  <td>
                    {r.pipeline} · {r.stage}
                  </td>
                  <td className="num">{formatMoney(r.valuePence)}</td>
                  <td className={r.status === "open" ? undefined : `result ${r.status}`}>{STATUS[r.status]}</td>
                  <td>{ownerName(r.owner)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {page.deals.more && lastDeal && (
          <div className="more">
            <Link className="btn" href={more({ deals: shown.deals + 50 }, `deal-${lastDeal.id}`)} scroll={false}>
              [ SHOW MORE ]
            </Link>
          </div>
        )}
      </section>

      <LatestUpdates page={updates} moreHref={(lastId) => more({ updates: shown.updates + 20 }, `entry-${lastId}`)} />
    </div>
  );
}
