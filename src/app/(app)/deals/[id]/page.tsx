// The deal page, design C (SF-95 contracts/routes.md § Pages): back to the board, title with solid [ WON ] / [ LOST ]
// (or [ REOPEN ]), the arrow-shaped stage bar with days per stage, a strip (value, owner, expected close, status),
// the actions, // DETAILS (people, labels, followers) and // TIMELINE (SF-102: notes, day groups). ?confirm=lost opens the Lost box over the page;
// ?confirm=delete (admins) the delete confirmation; ?error= only from the allow-list. A deal the user cannot see
// answers "This deal doesn't exist or you can't see it." (not-found.tsx). SF-109: // NEXT ACTIVITIES above the timeline;
// ?activity= / ?followup= / ?delete-activity= open the activity box (ActivityOverlays). SF-116: // FILES between them
// and the timeline; ?file= / ?delete-file= open the image preview box / the delete confirmation (FileOverlays).
// SF-127 (FR-015): the actions above two columns: the stage bar, strip and // DETAILS on the left; the note box,
// // NEXT ACTIVITIES, // FILES and // TIMELINE (with EMAIL entries) on the right.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDeal, getStageSeconds } from "@/server/deals/deals";
import { linkablePeople } from "@/server/deals/links";
import { boardHref, stageBar } from "@/server/deals/rules";
import { formatDate, formatMoney } from "@/server/format";
import { messages } from "@/server/messages";
import { ownerName } from "@/server/records/common";
import { parseId, type Params } from "@/server/records/list-query";
import { readFlash } from "@/server/records/flash";
import { DeleteConfirm } from "../../records/DeleteConfirm";
import { PersonPicker } from "../../records/PersonPicker";
import { RecordTimeline } from "../../records/RecordTimeline";
import { TimelineNoteBox } from "../../records/TimelineNoteBox";
import { FileOverlays } from "../../records/FileOverlays";
import { FilesSection } from "../../records/FilesSection";
import { ReferredBy } from "../../records/ReferredBy";
import { archiveDeal, deleteDeal, followDeal, linkPerson, markWon, reopenDeal, restoreDeal, unfollowDeal, unlinkPerson } from "../actions";
import { day, resultText } from "../DealBits";
import { LostBox } from "./LostBox";
import { ActivityNotices } from "../../activities/ActivityNotices";
import { ActivityOverlays } from "../../activities/ActivityOverlays";
import { NextActivities } from "../../activities/NextActivities";
import { StageBar } from "./StageBar";
import { MoreDetails } from "../../records/MoreDetails";

const PAGE_ERRORS = ["deal_edit_conflict", "deal_person_already_linked", "note_not_found", "note_record_archived"] as const;
const BOX_ERRORS = ["lost_reason_required", "lost_reason_too_long"] as const;

function first(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function Hidden({ id, version }: { id: number; version?: number }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      {version !== undefined && <input type="hidden" name="version" value={version} />}
    </>
  );
}

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const user = await requireUser();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const deal = await getDeal(user.id, id);
  if (!deal) notFound();
  const query = await searchParams;
  const isAdmin = user.role === "admin";
  const [seconds, people, flash] = await Promise.all([
    getStageSeconds(deal.id, deal.pipeline.id),
    deal.archived ? Promise.resolve([]) : linkablePeople(user.id),
    readFlash(["note_deleted"]),
  ]);
  const open = deal.status === "open" && !deal.archived;
  const closed = deal.status !== "open" && !deal.archived;
  const error = first(query, "error");
  const pageError = (PAGE_ERRORS as readonly string[]).includes(error) ? (error as (typeof PAGE_ERRORS)[number]) : null;
  const boxError = (BOX_ERRORS as readonly string[]).includes(error) ? (error as (typeof BOX_ERRORS)[number]) : null;
  const confirmLost = open && first(query, "confirm") === "lost";
  const confirmDelete = isAdmin && first(query, "confirm") === "delete";
  const here = `/deals/${deal.id}`;

  return (
    <div className="deal-page">
      <Link className="back" href={boardHref(deal.pipeline.id)}>
        ← {deal.pipeline.name} board
      </Link>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> DEAL
          </div>
          <h1>
            {deal.title}
            {deal.private && <span className="badge tag">Private</span>}
            {deal.archived && <span className="badge off tag">Archived</span>}
          </h1>
        </div>
        <div className="head-acts">
          {open && (
            <>
              <form action={markWon}>
                <Hidden id={deal.id} version={deal.version} />
                <button className="btn won-solid" type="submit">
                  [ WON ]
                </button>
              </form>
              <Link className="btn lost-solid" href={`${here}?confirm=lost`} scroll={false}>
                [ LOST ]
              </Link>
            </>
          )}
          {closed && (
            <form action={reopenDeal}>
              <Hidden id={deal.id} version={deal.version} />
              <button className="btn" type="submit">
                [ REOPEN ]
              </button>
            </form>
          )}
        </div>
      </div>

      {flash && (
        <p className="notice" role="status">
          {flash.text}
        </p>
      )}
      {pageError && (
        <p className="err" role="alert">
          {messages[pageError]}
        </p>
      )}
      <ActivityNotices error={error} />
      {confirmDelete && <DeleteConfirm name={deal.title} id={deal.id} action={deleteDeal} cancelHref={here} back="list" />}

      <div className="deal-acts">
        {deal.archived ? (
          <form action={restoreDeal}>
            <Hidden id={deal.id} />
            <button className="btn solid" type="submit">
              [ RESTORE ]
            </button>
          </form>
        ) : (
          <>
            <Link className="btn" href={`${here}/edit?back=page`}>
              [ EDIT ]
            </Link>
            <form action={archiveDeal}>
              <Hidden id={deal.id} />
              <input type="hidden" name="back" value="page" />
              <button className="btn" type="submit">
                [ ARCHIVE ]
              </button>
            </form>
          </>
        )}
        {isAdmin && (
          <Link className="btn red" href={`${here}?confirm=delete`} scroll={false}>
            [ DELETE ]
          </Link>
        )}
        {!deal.archived && (
          <form action={deal.followedByViewer ? unfollowDeal : followDeal}>
            <Hidden id={deal.id} />
            <button className="btn" type="submit">
              {deal.followedByViewer ? "[ UNFOLLOW ]" : "[ FOLLOW ]"}
            </button>
          </form>
        )}
      </div>

      <div className="recordcols">
        <div className="recordleft">
          <StageBar items={stageBar(seconds, deal.stage.id)} dealId={deal.id} version={deal.version} stageId={deal.stage.id} canMove={open} />

          <dl className="strip">
            <div>
              <dt>Value</dt>
              <dd>{formatMoney(deal.valuePence)}</dd>
        </div>
            <div>
              <dt>Owner</dt>
              <dd>{ownerName(deal.owner)}</dd>
        </div>
            <div>
              <dt>Expected close</dt>
              <dd>{deal.expectedClose ? day(deal.expectedClose) : "—"}</dd>
        </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`result ${deal.status}`}>{resultText(deal)}</span>
                {deal.archivedAt && <span className="result archived">Archived · {formatDate(deal.archivedAt)}</span>}
              </dd>
        </div>
          </dl>
          {deal.status === "lost" && deal.lostReason && <p className="lost-reason">Lost because: {deal.lostReason}</p>}

          <section aria-label="Details">
            <div className="label sect">
              <span className="c">//</span> DETAILS
        </div>
            <dl className="details">
              <div>
                <dt>Pipeline · Stage</dt>
                <dd>
                  {deal.pipeline.name} · {deal.stage.name}
                </dd>
              </div>
              <div>
                <dt>Organisation</dt>
                <dd>
                  {deal.organisation ? (
                    <>
                      <Link href={`/organisations/${deal.organisation.id}`}>{deal.organisation.name}</Link>
                      {deal.organisation.archived && <span className="badge off tag">Archived</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Main person</dt>
                <dd>
                  {deal.person ? (
                    <>
                      <Link href={`/people/${deal.person.id}`}>{deal.person.name}</Link>
                      {deal.person.archived && <span className="badge off tag">Archived</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Other people</dt>
                <dd>
                  {deal.otherPeople.length === 0 && deal.archived && "—"}
                  <ul className="people-list" aria-label="Other people">
                    {deal.otherPeople.map((p) => (
                      <li key={p.id}>
                        <Link href={`/people/${p.id}`}>{p.name}</Link>
                        {p.archived && <span className="badge off tag">Archived</span>}
                        {!deal.archived && (
                          <form action={unlinkPerson}>
                            <Hidden id={deal.id} />
                            <input type="hidden" name="personId" value={p.id} />
                            <button className="btn link red" type="submit" aria-label={`Unlink ${p.name}`}>
                              [ UNLINK ]
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!deal.archived && (
                    <form action={linkPerson} className="link-person">
                      <Hidden id={deal.id} />
                      <PersonPicker people={people} initialId="" />
                      <button className="btn" type="submit">
                        [ LINK PERSON ]
                      </button>
                    </form>
                  )}
                </dd>
              </div>
              <div>
                <dt>Referred by</dt>
                <dd>
                  <ReferredBy referrer={deal.referredBy} />
                </dd>
              </div>
              <div>
                <dt>Labels</dt>
                <dd>{deal.labels.length > 0 ? deal.labels.map((l) => l.name).join(", ") : "—"}</dd>
              </div>
              <div>
                <dt>Followers</dt>
                <dd>{deal.followers.length > 0 ? deal.followers.map((f) => ownerName(f)).join(", ") : "—"}</dd>
              </div>
              <div>
                <dt>Date added</dt>
                <dd>{formatDate(deal.createdAt)}</dd>
              </div>
            </dl>
          </section>
          <MoreDetails details={deal.custom} />
        </div>
        <div className="recordright">
          <TimelineNoteBox viewerId={user.id} target={{ dealId: deal.id }} archived={deal.archived} />
          <NextActivities viewerId={user.id} target={{ dealId: deal.id }} archived={deal.archived} back={here} />

          <FilesSection viewerId={user.id} target={{ dealId: deal.id }} archived={deal.archived} back={here} error={error} />

          <RecordTimeline
            viewerId={user.id}
            target={{ dealId: deal.id }}
            archived={deal.archived}
            query={{ timeline: first(query, "timeline"), note: first(query, "note"), deleteNote: first(query, "delete-note") }}
          />
        </div>
      </div>

      <ActivityOverlays
        viewerId={user.id}
        target={{ dealId: deal.id }}
        archived={deal.archived}
        back={here}
        query={{ activity: first(query, "activity"), followup: first(query, "followup"), deleteActivity: first(query, "delete-activity") }}
      />
      <FileOverlays
        viewerId={user.id}
        target={{ dealId: deal.id }}
        archived={deal.archived}
        back={here}
        query={{ file: first(query, "file"), deleteFile: first(query, "delete-file") }}
      />
      {confirmLost && <LostBox dealId={deal.id} version={deal.version} error={boxError} />}
    </div>
  );
}
