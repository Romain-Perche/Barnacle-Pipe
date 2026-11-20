// The deal list (SF-95 contracts/routes.md § Pages, design C as the People list): head with the Board/List switch and
// "<n> deals · £<total>", a filter row, a sortable table, a pager and the deal drawer (?open=<id>). Everything is in
// the page address; values that are unknown or invalid are ignored and never shown.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getDeal, stageChoices } from "@/server/deals/deals";
import { dealFilterOptions, listDeals } from "@/server/deals/list";
import { formatDate, formatMoney } from "@/server/format";
import { messages, templates } from "@/server/messages";
import { ownerName } from "@/server/records/common";
import { readFlash } from "@/server/records/flash";
import { hasDealFilters, knownDealsQuery, parseDealsQuery, withParams, type DealsQuery, type Params } from "@/server/records/list-query";
import { readTimeline } from "@/server/records/timeline";
import { Cell, FilterRow, PreviewLink, Select, SortHeader } from "../../records/ListBits";
import { Pager } from "../../records/Pager";
import { DealDrawer } from "../DealDrawer";
import { day } from "../DealBits";
import { ViewSwitch } from "../ViewSwitch";

const PATH = "/deals/list";

function first(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function DealListPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;
  const parsed = parseDealsQuery(params);
  const options = await dealFilterOptions(user.id, parsed.pipeline);
  const query = knownDealsQuery(parsed, options);
  const [list, flash, found] = await Promise.all([
    listDeals(user.id, query),
    readFlash(["deal_deleted", "deal_no_longer_visible"]),
    query.open ? getDeal(user.id, query.open) : null,
  ]);
  const [events, pipelines] = found ? await Promise.all([readTimeline(user.id, { dealId: found.id }), stageChoices()]) : [[], []];
  const shown = { ...query, page: list.page };
  const link = (changes: Partial<DealsQuery>) => withParams(PATH, shown, changes);
  const preview = (id: number) => link({ open: id });
  const isAdmin = user.role === "admin";
  const filtered = hasDealFilters(query);
  const confirmDelete = found !== null && isAdmin && first(params, "confirm") === "delete";
  const withConfirm = (href: string) => `${href}${href.includes("?") ? "&" : "?"}confirm=delete`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> DEALS
          </div>
          <h1>Deals</h1>
        </div>
        <div className="head-r">
          <div className="head-acts">
            <ViewSwitch current="list" />
            <Link className="btn solid" href="/deals/new">
              [ ADD DEAL ]
            </Link>
          </div>
          <div className="label count">{templates.deal_list_count(list.total, list.totalPence)}</div>
        </div>
      </div>

      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}

      <FilterRow
        id="deal-filters"
        path={PATH}
        q={query.q}
        searchLabel="Search deals"
        archived={query.archived}
        toggles={[
          { name: "closed", label: "Show closed deals", checked: query.closed },
          { name: "archived", label: "Show archived deals", checked: query.archived },
        ]}
        clearHref={filtered ? PATH : undefined}
      >
        <Select name="pipeline" label="Pipeline" value={query.pipeline} options={[{ value: "", label: "Any pipeline" }, ...options.pipelines.map((o) => ({ value: o.id, label: o.name }))]} />
        {query.pipeline !== null && (
          <Select name="stage" label="Stage" value={query.stage} options={[{ value: "", label: "Any stage" }, ...options.stages.map((o) => ({ value: o.id, label: o.name }))]} />
        )}
        <Select name="owner" label="Owner" value={query.owner} options={[{ value: "", label: "Any owner" }, ...options.owners.map((o) => ({ value: o.id, label: o.name }))]} />
        <Select name="label" label="Label" value={query.label} options={[{ value: "", label: "Any label" }, ...options.labels.map((o) => ({ value: o.id, label: o.name }))]} />
        {(query.closed || query.archived) && (
          <Select
            name="status"
            label="Status"
            value={query.status}
            options={[{ value: "", label: "Any status" }, { value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }]}
          />
        )}
        <Select
          name="sort"
          label="Sort by"
          value={query.sort}
          options={[
            { value: "added", label: "Sort: date added" },
            { value: "title", label: "Sort: title" },
            { value: "value", label: "Sort: value" },
            { value: "organisation", label: "Sort: organisation" },
            { value: "stage", label: "Sort: stage" },
            { value: "owner", label: "Sort: owner" },
            { value: "close", label: "Sort: expected close" },
          ]}
        />
        <Select name="dir" label="Order" value={query.dir} options={[{ value: "desc", label: "Descending" }, { value: "asc", label: "Ascending" }]} />
      </FilterRow>

      <div className={found ? "listwrap open" : "listwrap"}>
        <div className="listmain">
          {list.rows.length === 0 ? (
            <div className="empty">
              <p>{filtered ? messages.no_deals_match : messages.no_deals_yet}</p>
              {filtered && (
                <Link className="btn" href={PATH}>
                  [ CLEAR FILTERS ]
                </Link>
              )}
            </div>
          ) : (
            <table className="users list deals-list">
              <thead>
                <tr>
                  <SortHeader label="Title" sort="title" query={shown} path={PATH} />
                  <SortHeader label="Value" sort="value" query={shown} path={PATH} />
                  <SortHeader label="Organisation" sort="organisation" query={shown} path={PATH} />
                  <th>Main person</th>
                  <SortHeader label="Pipeline · Stage" sort="stage" query={shown} path={PATH} />
                  <SortHeader label="Owner" sort="owner" query={shown} path={PATH} />
                  <SortHeader label="Expected close" sort="close" query={shown} path={PATH} />
                  <SortHeader label="Date added" sort="added" query={shown} path={PATH} />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className={found?.id === r.id ? "sel" : undefined} aria-selected={found?.id === r.id ? true : undefined}>
                    <Cell href={preview(r.id)}>
                      <Link className="nm" href={`/deals/${r.id}`}>
                        {r.title}
                      </Link>
                      {r.status === "won" && <span className="badge tag won">Won</span>}
                      {r.status === "lost" && <span className="badge tag lost">Lost</span>}
                      {r.archived && <span className="badge off tag">Archived</span>}
                      {r.private && <span className="badge tag">Private</span>}
                      {r.labels.length > 0 && <span className="em">{r.labels.join(", ")}</span>}
                      <PreviewLink href={preview(r.id)} name={r.title} />
                    </Cell>
                    <Cell href={preview(r.id)}>
                      <span className="money">{formatMoney(r.valuePence)}</span>
                    </Cell>
                    <Cell href={preview(r.id)}>
                      {r.organisation ? (
                        <>
                          <Link className="nm" href={`/organisations/${r.organisation.id}`}>
                            {r.organisation.name}
                          </Link>
                          {r.organisation.archived && <span className="badge off tag">Archived</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </Cell>
                    <Cell href={preview(r.id)}>
                      {r.person ? (
                        <Link className="nm" href={`/people/${r.person.id}`}>
                          {r.person.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Cell>
                    <Cell href={preview(r.id)}>
                      {r.pipeline.name} · {r.stage.name}
                    </Cell>
                    <Cell href={preview(r.id)}>{ownerName(r.owner)}</Cell>
                    <Cell href={preview(r.id)}>{r.expectedClose ? day(r.expectedClose) : "—"}</Cell>
                    <Cell href={preview(r.id)}>{formatDate(r.createdAt)}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={list.page} pages={list.pages} prevHref={link({ page: list.page - 1 })} nextHref={link({ page: list.page + 1 })} />
        </div>
        {found && (
          <DealDrawer
            deal={found}
            pipelines={pipelines}
            events={events}
            isAdmin={isAdmin}
            confirmDelete={confirmDelete}
            hereHref={preview(found.id)}
            closeHref={link({ open: null })}
            deleteHref={withConfirm(preview(found.id))}
            back="list"
          />
        )}
      </div>
    </>
  );
}
