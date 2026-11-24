// Import from Pipedrive (SF-117 contracts/routes.md § Pages, design B): "← Settings", "// PIPEDRIVE", the title, the
// Pipedrive company in the header and the step bar 1 CHOOSE · 2 IMPORTING · 3 REPORT. requireUser() first; a user
// with no connection (and no open import) goes to /settings. Only the viewer's own import is shown.
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { messages } from "@/server/messages";
import { getConnection } from "@/server/pipedrive/connection";
import { getImportView } from "@/server/pipedrive/imports";
import { namesForReport } from "@/server/pipedrive/report";
import { StepBar } from "../../records/import/StepBar";
import { ChooseStep } from "./ChooseStep";
import { ProgressStep } from "./ProgressStep";
import { ReportStep } from "./ReportStep";

// A part (and its server action) must finish within one request: a few 10-second Pipedrive calls and one page, or
// (SF-122) file copies started within 15 seconds, each with a 20-second download and a 20-second upload.
export const maxDuration = 60;

const STEPS = ["1 CHOOSE", "2 IMPORTING", "3 REPORT"];
const ERRORS = ["pipedrive_tick_something", "pipedrive_consent_required", "files_unreachable"] as const;
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function PipedriveImportPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const query = await searchParams;
  const state = await getConnection(user.id);
  if (!state.ready) redirect("/settings");
  const view = await getImportView(user.id);
  const open = view !== null && (view.state === "running" || view.state === "waiting" || view.state === "paused");
  if (!state.connection && !open) redirect("/settings");
  const step = open ? 2 : view !== null && one(query.new) !== "1" ? 3 : 1;
  const code = one(query.error);
  const error = (ERRORS as readonly string[]).includes(code) ? messages[code as (typeof ERRORS)[number]] : null;
  const company = open || step === 3 ? view!.companyName : (state.connection?.companyName ?? "");
  return (
    <div className="import">
      <Link className="back" href="/settings">
        ← Settings
      </Link>
      <div className="page-head">
        <div>
          <div className="label">
            <span className="c">//</span> PIPEDRIVE
          </div>
          <h1>Import from Pipedrive</h1>
        </div>
        <div className="head-r">
          <div className="import-file-name">{company.toUpperCase()}</div>
        </div>
      </div>
      <StepBar step={step} steps={STEPS} />
      {step === 1 && <ChooseStep error={error} />}
      {step === 2 && <ProgressStep view={view!} confirmStop={one(query.stop) === "1"} />}
      {step === 3 && <ReportStep view={view!} names={await namesForReport(user.id, view!.report)} />}
    </div>
  );
}
