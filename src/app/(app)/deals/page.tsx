// The deals board, design A (contracts/routes.md § Pages): "// DEALS", the pipeline name, a "Pipeline: <name>"
// picker and [ ADD DEAL ] above one column per stage; the deal drawer on the right (?open=<id>). The pipeline and
// the open deal are in the address as numbers; nothing typed in the address is ever shown.
import OpenOnDoubleClick from "../records/OpenOnDoubleClick";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getBoard, getDeal, stageChoices } from "@/server/deals/deals";
import { boardHref, parseBoardQuery, type BoardParams } from "@/server/deals/rules";
import { messages } from "@/server/messages";
import { readFlash } from "@/server/records/flash";
import { AutoSubmit } from "../records/AutoSubmit";
import { Board } from "./Board";
import { DealDrawer } from "./DealDrawer";
import { ViewSwitch } from "./ViewSwitch";
import { ActivityNotices } from "../activities/ActivityNotices";
import { ActivityOverlays } from "../activities/ActivityOverlays";
import { FileOverlays } from "../records/FileOverlays";
import { EmailOverlay } from "../records/EmailOverlay";

function first(params: BoardParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

// SF-129: sending an email from the drawer with 25 MB of attachments within one function run.
export const maxDuration = 60;

export default async function DealsPage({ searchParams }: { searchParams: Promise<BoardParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const query = parseBoardQuery(params);
  const [board, flash] = await Promise.all([
    getBoard(user.id, query.pipeline),
    readFlash(["deal_deleted", "deal_no_longer_visible", "note_not_found", "file_not_found", "email_sent"]),
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
  const pipelines = open ? await stageChoices() : [];

  return (
    <>
      <OpenOnDoubleClick />
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
      <ActivityNotices error={first(params, "error")} />
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
            <Board key={board.pipeline.id} pipelineId={board.pipeline.id} columns={board.columns} openId={open?.id ?? null} now={Date.now()} />
          </div>
          {open && (
            <DealDrawer
              deal={open}
              pipelines={pipelines}
              viewerId={user.id}
              isAdmin={isAdmin}
              confirmDelete={query.confirmDelete}
              hereHref={boardHref(open.pipeline.id, { open: open.id })}
              closeHref={boardHref(open.pipeline.id)}
              deleteHref={boardHref(open.pipeline.id, { open: open.id, confirm: "delete" })}
              fileError={first(params, "error")}
              emailHref={`${boardHref(open.pipeline.id, { open: open.id })}&email=new`}
            />
          )}
          {open && (
            <ActivityOverlays
              viewerId={user.id}
              target={{ dealId: open.id }}
              archived={open.archived}
              back={boardHref(open.pipeline.id, { open: open.id })}
              query={{ activity: first(params, "activity"), followup: first(params, "followup"), deleteActivity: first(params, "delete-activity") }}
            />
          )}
          {open && (
            <EmailOverlay viewerId={user.id} target={{ dealId: open.id }} email={first(params, "email")} back={boardHref(open.pipeline.id, { open: open.id })} />
          )}
          {open && (
            <FileOverlays
              viewerId={user.id}
              target={{ dealId: open.id }}
              archived={open.archived}
              back={boardHref(open.pipeline.id, { open: open.id })}
              query={{ file: first(params, "file"), deleteFile: first(params, "delete-file") }}
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
