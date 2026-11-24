// Step 2 IMPORTING (SF-117 US3, FR-024, FR-029, design B): the counts, "// PROGRESS" with a bar and "<Kind> · <done> of
// <total>" per ticked kind and the state, the slow-down countdown, the pause message with [ CONTINUE ], the keep-open
// note and [ STOP IMPORT ]. The runner (client) is there only while the import runs and is not paused.
import Link from "next/link";
import { messages, templates } from "@/server/messages";
import type { ImportView } from "@/server/pipedrive/imports";
import { continuePipedriveImportAction } from "./actions";
import { Counts } from "./Counts";
import { ImportRunner } from "./ImportRunner";
import { StopConfirm } from "./StopConfirm";

const STATE_WORDS = { running: "RUNNING", waiting: "WAITING FOR PIPEDRIVE", paused: "PAUSED", stopped: "STOPPED", finished: "FINISHED" } as const;

function pauseText(view: ImportView): string {
  switch (view.pauseReason) {
    case "unreachable":
      return messages.pipedrive_stopped_unreachable;
    case "token_refused":
      return messages.pipedrive_token_no_longer;
    case "other_company":
      return messages.pipedrive_other_company;
    default:
      return view.pausedText;
  }
}

export function ProgressStep({ view, confirmStop }: { view: ImportView; confirmStop: boolean }) {
  const paused = view.effectiveState === "paused";
  return (
    <>
      <Counts totals={view.totals} />
      <section aria-label="Progress">
        <div className="label sect sect-row">
          <span>
            <span className="c">//</span> PROGRESS
          </span>
          <span className="pd-state">{STATE_WORDS[view.effectiveState]}</span>
        </div>
        {view.progress.map((p) => (
          <div key={p.kind} className="pd-bar">
            <div className="k">{templates.pipedrive_progress(p.kind, p.done, p.total)}</div>
            <progress value={p.done} max={Math.max(p.total, 1)} aria-label={templates.pipedrive_progress(p.kind, p.done, p.total)} />
          </div>
        ))}
      </section>
      {paused ? (
        <>
          <p className="err" role="alert">
            {pauseText(view)}
          </p>
          <form action={continuePipedriveImportAction} className="import-acts">
            <button className="btn solid" type="submit">
              [ CONTINUE ]
            </button>
            <Link className="btn" href="/settings/pipedrive-import?stop=1" scroll={false}>
              [ STOP IMPORT ]
            </Link>
          </form>
        </>
      ) : (
        <>
          <ImportRunner id={view.id} waitSeconds={view.waitSeconds} />
          <p className="hint">{messages.pipedrive_keep_open}</p>
          <div className="import-acts">
            <Link className="btn" href="/settings/pipedrive-import?stop=1" scroll={false}>
              [ STOP IMPORT ]
            </Link>
          </div>
        </>
      )}
      {confirmStop && <StopConfirm />}
    </>
  );
}
