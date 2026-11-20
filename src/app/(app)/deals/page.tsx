// The deals board, design A (contracts/routes.md § Pages): "// DEALS", the pipeline name, a "Pipeline: <name>"
// picker and [ ADD DEAL ] above one column per stage; the deal drawer on the right (?open=<id>). The pipeline and
// the open deal are in the address as numbers; nothing typed in the address is ever shown.
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getBoard, getDeal, stageChoices } from "@/server/deals/deals";
import { boardHref, parseBoardQuery, type BoardParams } from "@/server/deals/rules";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { readTimeline } from "@/server/records/timeline";
import { AutoSubmit } from "../records/AutoSubmit";
import { Board } from "./Board";
import { DealDrawer } from "./DealDrawer";
import { ViewSwitch } from "./ViewSwitch";

export default async function DealsPage({ searchParams }: { searchParams: Promise<BoardParams> }) {
  const user = await requireUser();
  const query = parseBoardQuery(await searchParams);
  const [board, flash] = await Promise.all([
    getBoard(user.id, query.pipeline),
    readFlash(["deal_deleted", "deal_no_longer_visible"]),
  ]);
  const isAdmin = user.role === "admin";

  if (!board) {
    return (
      <>
        <Head title="Deals">
          <ViewSwitch current="board" />
        </Head>
        {flash && (
          <p className="notice" role="status">
            {flash.text}
          </p>
        )}
        <div className="empty">
          <p>{messages.no_pipelines_yet}</p>
          {isAdmin && (
            <Link className="btn solid" href="/admin/pipelines">
              [ ADD PIPELINE ]
            </Link>
          )}
        </div>
      </>
    );
  }

  const found = query.open ? await getDeal(user.id, query.open) : null;
  // No drawer for a deal that is missing, archived, won or lost, private to someone else or in another pipeline.
  const open = found && !found.archived && found.status === "open" && found.pipeline.id === board.pipeline.id ? found : null;
  const [events, pipelines] = open ? await Promise.all([readTimeline(user.id, { dealId: open.id }), stageChoices()]) : [[], []];

  return (
    <>
      <Head title={board.pipeline.name}>
        <ViewSwitch current="board" />
        <form id="pipeline-picker" className="picker-form" action="/deals" method="get">
          <label className="pick">
            <span>Pipeline:</span>
            <select className="input sel" name="pipeline" aria-label="Pipeline" defaultValue={board.pipeline.id}>
              {board.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <button className="btn" type="submit">
              [ GO ]
            </button>
          </noscript>
          <AutoSubmit formId="pipeline-picker" />
        </form>
        <Link className="btn solid" href={`/deals/new?pipeline=${board.pipeline.id}`}>
          [ ADD DEAL ]
        </Link>
      </Head>
      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      {query.error && (
        <p className="err" role="alert">
          {messages[query.error]}
        </p>
      )}
      {board.columns.length === 0 ? (
        <div className="empty">
          <p>{messages.no_stages_yet}</p>
          {isAdmin && (
            <Link className="btn" href={`/admin/pipelines/${board.pipeline.id}`}>
              [ ADD STAGE ]
            </Link>
          )}
        </div>
      ) : (
        <div className={open ? "boardwrap open" : "boardwrap"}>
          <div className="boardmain">
            <Board key={board.pipeline.id} pipelineId={board.pipeline.id} columns={board.columns} openId={open?.id ?? null} />
          </div>
          {open && (
            <DealDrawer
              deal={open}
              pipelines={pipelines}
              events={events}
              isAdmin={isAdmin}
              confirmDelete={query.confirmDelete}
              hereHref={boardHref(open.pipeline.id, { open: open.id })}
              closeHref={boardHref(open.pipeline.id)}
              deleteHref={boardHref(open.pipeline.id, { open: open.id, confirm: "delete" })}
            />
          )}
        </div>
      )}
    </>
  );
}

function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="label">
          <span className="c">//</span> DEALS
        </div>
        <h1>{title}</h1>
      </div>
      {children && <div className="head-acts">{children}</div>}
    </div>
  );
}
